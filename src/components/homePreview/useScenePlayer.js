import { useEffect, useRef, useState, useCallback } from 'react'

// Check prefers-reduced-motion once at import time. SSR-safe.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Drives the preview-window scene timeline. Auto-plays and auto-loops; pauses
// when the tab is hidden so backgrounded landing pages don't burn animation
// frames. Also pauses when the host element is scrolled out of view (driven by
// the caller via `inView`) so a window way below the fold doesn't burn through
// its scenes before the user gets there. Returns the current scene plus
// controls (pause / replay / jump).
//
// scenes: ordered array of { id, title, durationMs, Component }
//         (gate filtering is done by the caller before passing in)
// inView: caller-driven visibility flag. When false the timer pauses; when it
//         flips back to true the current scene replays from frame 0 (rather
//         than resuming mid-animation) so the user sees a clean first frame.
//
// When prefers-reduced-motion is enabled the player still rotates scenes but
// holds each one for a longer interval so the page is functionally
// information-equivalent without rapid motion.
export default function useScenePlayer(scenes, { autoplay = true, loop = true, inView = true } = {}) {
  // Honour reduced motion by starting paused if requested.
  const effectiveAutoplay = autoplay && !prefersReducedMotion
  const [index,    setIndex]    = useState(0)
  const [isPaused, setIsPaused] = useState(!effectiveAutoplay)
  // Bumps every time we jump or restart — scenes key off this so internal
  // animations re-mount cleanly on replay.
  const [runKey,   setRunKey]   = useState(0)

  const timerRef     = useRef(null)
  const lastBumpRef  = useRef(Date.now())
  const remainingRef = useRef(scenes[0]?.durationMs ?? 3000)
  // Tracks the previous inView so we can detect transitions (entering or
  // leaving the viewport) and replay the current scene from frame 0 on
  // re-entry — otherwise the user scrolls in and sees a frozen mid-frame.
  const prevInViewRef = useRef(inView)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  // Advance to the next scene (or loop / stop).
  const advance = useCallback(() => {
    setIndex(prev => {
      const next = prev + 1
      if (next >= scenes.length) return loop ? 0 : prev
      return next
    })
    setRunKey(k => k + 1)
  }, [scenes.length, loop])

  // Schedule the next advance after `ms`.
  const scheduleAdvance = useCallback((ms) => {
    clearTimer()
    lastBumpRef.current = Date.now()
    remainingRef.current = ms
    timerRef.current = setTimeout(() => {
      advance()
    }, ms)
  }, [advance])

  // Re-entry detection: when the host scrolls back into view, bump runKey so
  // the current scene re-mounts and plays its internal animation timeline
  // from frame 0 again. Without this, the user scrolls back and sees a
  // mid-state of whichever scene was active when they scrolled away.
  useEffect(() => {
    if (inView && !prevInViewRef.current) {
      setRunKey(k => k + 1)
    }
    prevInViewRef.current = inView
  }, [inView])

  // Whenever the active scene changes (or play/visibility state changes),
  // schedule the next hop. The inView gate prevents off-screen previews from
  // advancing; runKey is in deps so re-entry (which bumps runKey above)
  // reschedules with a fresh full duration.
  useEffect(() => {
    if (isPaused || !inView) { clearTimer(); return }
    const scene = scenes[index]
    if (!scene) return
    scheduleAdvance(scene.durationMs ?? 3000)
    return clearTimer
  }, [index, runKey, isPaused, inView, scenes, scheduleAdvance])

  // Pause when the tab loses focus so off-screen landing pages don't animate.
  useEffect(() => {
    function onVis() {
      if (document.hidden) {
        // pause but remember how much time was left so we can resume
        if (timerRef.current) {
          const elapsed = Date.now() - lastBumpRef.current
          remainingRef.current = Math.max(0, remainingRef.current - elapsed)
          clearTimer()
        }
        setIsPaused(true)
      } else if (effectiveAutoplay) {
        setIsPaused(false)
        scheduleAdvance(remainingRef.current || 1000)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [effectiveAutoplay, scheduleAdvance])

  // Reset when the scene list itself changes (e.g. gating toggled by settings).
  useEffect(() => {
    setIndex(0)
    setRunKey(k => k + 1)
  }, [scenes.length])

  const replay = useCallback(() => {
    setIndex(0)
    setRunKey(k => k + 1)
    setIsPaused(false)
  }, [])

  const togglePause = useCallback(() => {
    setIsPaused(p => {
      const willPause = !p
      if (willPause) {
        if (timerRef.current) {
          const elapsed = Date.now() - lastBumpRef.current
          remainingRef.current = Math.max(0, remainingRef.current - elapsed)
        }
        clearTimer()
      } else {
        scheduleAdvance(remainingRef.current || 1000)
      }
      return willPause
    })
  }, [scheduleAdvance])

  const jumpTo = useCallback((idx) => {
    if (idx < 0 || idx >= scenes.length) return
    setIndex(idx)
    setRunKey(k => k + 1)
    setIsPaused(false)
  }, [scenes.length])

  const currentScene = scenes[index] ?? null
  return { index, runKey, currentScene, isPaused, replay, togglePause, jumpTo, total: scenes.length }
}
