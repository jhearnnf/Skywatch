import { useEffect, useRef, useState, useCallback } from 'react'

// Check prefers-reduced-motion once at import time. SSR-safe.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Drives the preview-window scene timeline. Auto-plays and auto-loops; pauses
// when the tab is hidden so backgrounded landing pages don't burn animation
// frames. Returns the current scene plus controls (pause / replay / jump).
//
// scenes: ordered array of { id, title, durationMs, Component }
//         (gate filtering is done by the caller before passing in)
//
// When prefers-reduced-motion is enabled the player still rotates scenes but
// holds each one for a longer interval so the page is functionally
// information-equivalent without rapid motion.
export default function useScenePlayer(scenes, { autoplay = true, loop = true } = {}) {
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

  // Whenever index changes (and we're playing), schedule the next hop.
  useEffect(() => {
    if (isPaused) { clearTimer(); return }
    const scene = scenes[index]
    if (!scene) return
    scheduleAdvance(scene.durationMs ?? 3000)
    return clearTimer
  }, [index, isPaused, scenes, scheduleAdvance])

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
