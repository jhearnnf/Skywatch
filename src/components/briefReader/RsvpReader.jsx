import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tokenize, clampWpm } from '../../utils/rsvp'

// EXIT_DURATION_MS is the single source of truth for the exit fade length.
// Change this one constant to retune the disengage animation everywhere.
const EXIT_DURATION_MS = 1000

const DEAD_X = 50
const DEAD_Y = 40
const BASE_WPM = 250

function loadWpm() {
  const stored = parseFloat(localStorage.getItem('sw_rsvp_wpm'))
  return isNaN(stored) ? BASE_WPM : clampWpm(stored)
}

export default function RsvpReader({ text, enabled, containerRef }) {
  if (!enabled) return null
  return <RsvpReaderInner text={text} containerRef={containerRef} />
}

function RsvpReaderInner({ text, containerRef }) {
  // ── Render state (only what drives DOM) ───────────────────────────────
  const [currentWord, setCurrentWord] = useState(null)
  const [currentRate, setCurrentRate] = useState(BASE_WPM)
  const [completed,   setCompleted]   = useState(false)
  const [isExiting,   setIsExiting]   = useState(false)

  // ── All mutable runtime state in refs (feedback_setstate_updater_closure) ──
  const phaseRef        = useRef('idle')        // 'idle' | 'armed' | 'active' | 'exiting'
  const originRef       = useRef({ x: 0, y: 0 })
  const pointerIdRef    = useRef(null)
  const wordIndexRef    = useRef(0)
  const tokensRef       = useRef([])
  const wpmRef          = useRef(loadWpm())
  const directionRef    = useRef('paused') // 'forward' | 'backward' | 'paused'
  const armTimerRef     = useRef(null)
  const advanceTimerRef = useRef(null)
  const exitTimerRef    = useRef(null)
  const lastBucketRef   = useRef(Math.floor(wpmRef.current / 25))
  const pointerYRef     = useRef(0)
  const touchBlockerRef = useRef(null)
  const wordSpansRef    = useRef([])
  const highlightDivRef = useRef(null)

  // Glow zone refs (4 edges: left, right, top, bottom)
  const glowLeftRef   = useRef(null)
  const glowRightRef  = useRef(null)
  const glowTopRef    = useRef(null)
  const glowBottomRef = useRef(null)

  // Overlay word element ref (for positioning)
  const overlayRef = useRef(null)

  // ── Re-tokenize when text changes ────────────────────────────────────
  useEffect(() => {
    tokensRef.current = tokenize(text)
  }, [text])

  // ── Word advance via chained setTimeout ──────────────────────────────
  // Idempotent: clears any pending timer and (re)schedules based on current
  // direction + wpm. No-ops when paused so callers can safely invoke on every
  // direction or rate change without restarting the index.
  function scheduleAdvance() {
    clearTimeout(advanceTimerRef.current)
    if (phaseRef.current !== 'active') return
    if (directionRef.current === 'paused') return

    const tokens = tokensRef.current
    if (!tokens.length) return

    const idx = wordIndexRef.current
    if (idx < 0 || idx >= tokens.length) return

    const token = tokens[idx]
    const dir   = directionRef.current
    const wpm   = clampWpm(dir === 'backward' ? wpmRef.current / 2 : wpmRef.current)
    const msPerWord = (60000 / wpm) * token.dwellMultiplier

    advanceTimerRef.current = setTimeout(() => {
      if (phaseRef.current !== 'active') return
      if (directionRef.current === 'paused') return

      const step = directionRef.current === 'backward' ? -1 : 1
      const nextIdx = wordIndexRef.current + step

      if (nextIdx < 0) {
        wordIndexRef.current = 0
        return
      }
      if (nextIdx >= tokensRef.current.length) {
        // End of section — show the completion tick during the 2s exit fade.
        setCompleted(true)
        engageExit()
        return
      }

      wordIndexRef.current = nextIdx
      setCurrentWord(tokensRef.current[nextIdx])
      updateWordHighlight(nextIdx)
      scheduleAdvance()
    }, msPerWord)
  }

  // ── Enter active phase ────────────────────────────────────────────────
  // Per spec: word appears but stays paused until the user slides — direction
  // starts 'paused' and the chained timer is not started until pointermove
  // detects a forward/backward transition.
  function enterActive(pointerId, el) {
    phaseRef.current = 'active'
    directionRef.current = 'paused'
    el.setPointerCapture(pointerId)
    document.body.dataset.rsvpActive = ''

    // Cancel framer-motion's drag controller on the parent card. Without this
    // the card keeps following the cursor during RSVP because framer-motion
    // has already attached window-level pointermove listeners we can't
    // intercept. We dispatch on el.parentElement (not el) so the event bubbles
    // up through the card without triggering our own pointercancel listener.
    if (el.parentElement) {
      try {
        el.parentElement.dispatchEvent(new PointerEvent('pointercancel', {
          pointerId,
          bubbles: true,
          cancelable: true,
        }))
      } catch {}
    }

    const tokens = tokensRef.current
    if (tokens.length === 0) return

    const idx = wordIndexRef.current
    setCurrentWord(tokens[Math.min(idx, tokens.length - 1)])
    setCurrentRate(wpmRef.current)

    navigator.vibrate?.(10)

    wordSpansRef.current = buildWordSpans(containerRef.current)
    updateWordHighlight(Math.min(idx, wordSpansRef.current.length - 1))
  }

  // ── Engage exit fade ──────────────────────────────────────────────────
  function engageExit() {
    if (highlightDivRef.current) highlightDivRef.current.style.display = 'none'
    clearTimeout(advanceTimerRef.current)
    phaseRef.current = 'exiting'
    directionRef.current = 'paused'
    setIsExiting(true)
    removeTouchBlocker()

    // exitTimerRef fires after EXIT_DURATION_MS to complete the disengage.
    // If a new pointerdown arrives during this window, it cancels this timer
    // and resumes from the same wordIndex (finger-slip recovery — see handler below).
    exitTimerRef.current = setTimeout(() => {
      phaseRef.current = 'idle'
      wordIndexRef.current = 0
      setCurrentWord(null)
      setCompleted(false)
      setIsExiting(false)
      setCurrentRate(wpmRef.current)
      delete document.body.dataset.rsvpActive

      if (containerRef.current) {
        containerRef.current.style.opacity = ''
        containerRef.current.style.touchAction = ''
        clearWordSpans(containerRef.current)
      }
      wordSpansRef.current = []
      clearGlows()
    }, EXIT_DURATION_MS)
  }

  // ── Glow helpers ─────────────────────────────────────────────────────
  function clearGlows() {
    const z = '0'
    if (glowLeftRef.current)   glowLeftRef.current.style.opacity   = z
    if (glowRightRef.current)  glowRightRef.current.style.opacity  = z
    if (glowTopRef.current)    glowTopRef.current.style.opacity    = z
    if (glowBottomRef.current) glowBottomRef.current.style.opacity = z
  }

  // ── Word-span helpers (background highlight) ─────────────────────────
  // Wraps every whitespace-delimited word in the container in a span so we
  // can position a highlight rect over the currently-spoken word. Skips
  // headings (H1-H6) which are not part of the tokenised text.
  function buildWordSpans(rootEl) {
    const spans = []
    const SKIP = new Set(['H1','H2','H3','H4','H5','H6','SCRIPT','STYLE'])
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent
        if (!text.trim()) return
        const parts = text.split(/(\s+)/)
        const frag = document.createDocumentFragment()
        for (const part of parts) {
          if (/\S/.test(part)) {
            const s = document.createElement('span')
            s.dataset.rsvpWord = String(spans.length)
            s.textContent = part
            frag.appendChild(s)
            spans.push(s)
          } else if (part) {
            frag.appendChild(document.createTextNode(part))
          }
        }
        node.parentNode.replaceChild(frag, node)
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      if (SKIP.has(node.tagName)) return
      Array.from(node.childNodes).forEach(walk)
    }
    walk(rootEl)
    return spans
  }

  function clearWordSpans(rootEl) {
    if (!rootEl) return
    rootEl.querySelectorAll('[data-rsvp-word]').forEach(s => {
      s.parentNode.replaceChild(document.createTextNode(s.textContent), s)
    })
    rootEl.normalize()
  }

  function updateWordHighlight(idx) {
    const div = highlightDivRef.current
    if (!div) return
    const spans = wordSpansRef.current
    if (!spans.length || idx < 0 || idx >= spans.length) { div.style.display = 'none'; return }
    const span = spans[idx]
    if (!span.isConnected) { div.style.display = 'none'; return }
    const rect = span.getBoundingClientRect()
    if (!rect.width) { div.style.display = 'none'; return }
    div.style.display = 'block'
    div.style.left   = `${rect.left - 3}px`
    div.style.top    = `${rect.top - 1}px`
    div.style.width  = `${rect.width + 6}px`
    div.style.height = `${rect.height + 2}px`
  }

  // ── Touch scroll blockers ─────────────────────────────────────────────
  // Attached on arm start so the browser can't claim the gesture as a scroll
  // before the 800ms hold timer fires. Removed on every exit path.
  function attachTouchBlocker() {
    if (touchBlockerRef.current) return
    const handler = (e) => { e.preventDefault() }
    touchBlockerRef.current = handler
    document.addEventListener('touchmove', handler, { passive: false })
  }

  function removeTouchBlocker() {
    if (!touchBlockerRef.current) return
    document.removeEventListener('touchmove', touchBlockerRef.current, { passive: false })
    touchBlockerRef.current = null
  }

  // ── Pointer event handlers ────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onPointerDown(e) {
      const phase = phaseRef.current

      if (phase !== 'idle') return

      // Don't preventDefault or stopPropagation here — let framer-motion's
      // card swipe see the down event so a quick tap-drag from the description
      // still works as a normal swipe. If the press becomes RSVP, we cancel
      // framer-motion's drag at enterActive() via a synthetic pointercancel.
      pointerIdRef.current = e.pointerId
      originRef.current = { x: e.clientX, y: e.clientY }
      pointerYRef.current = e.clientY
      phaseRef.current = 'armed'
      wordIndexRef.current = 0

      armTimerRef.current = setTimeout(() => {
        if (phaseRef.current !== 'armed') return
        attachTouchBlocker()
        enterActive(pointerIdRef.current, el)
      }, 800)
    }

    function onPointerMove(e) {
      if (e.pointerId !== pointerIdRef.current) return
      pointerYRef.current = e.clientY

      const phase = phaseRef.current

      // During arm: cancel if the user moves significantly — they're not
      // trying to hold for RSVP. Returns to idle so the next press starts
      // fresh.
      if (phase === 'armed') {
        const dxA = e.clientX - originRef.current.x
        const dyA = e.clientY - originRef.current.y
        if (Math.hypot(dxA, dyA) > 20) {
          clearTimeout(armTimerRef.current)
          phaseRef.current = 'idle'
          pointerIdRef.current = null
          el.style.touchAction = ''
          removeTouchBlocker()
        }
        return
      }

      if (phase === 'exiting') {
        e.stopPropagation()
        return
      }

      if (phase !== 'active') return

      // Lock out the framer-motion card swipe while RSVP is engaged.
      e.stopPropagation()

      const dx = e.clientX - originRef.current.x
      const dy = e.clientY - originRef.current.y

      // ── Vertical: adjust wpm independently of direction ────────────
      let newWpm = wpmRef.current
      if (dy <= -DEAD_Y) {
        newWpm = clampWpm(BASE_WPM * (1 + (-dy - DEAD_Y) / 250))
      } else if (dy >= DEAD_Y) {
        newWpm = clampWpm(BASE_WPM * (1 - (dy - DEAD_Y) / 350))
      } else {
        newWpm = BASE_WPM
      }

      if (newWpm !== wpmRef.current) {
        wpmRef.current = newWpm
        setCurrentRate(newWpm)
        localStorage.setItem('sw_rsvp_wpm', String(newWpm))

        const bucket = Math.floor(newWpm / 25)
        if (bucket !== lastBucketRef.current) {
          lastBucketRef.current = bucket
          navigator.vibrate?.(10)
        }
        scheduleAdvance() // recompute timing for new rate (no-ops if paused)
      }

      // ── Horizontal: detect direction CHANGE only — never restart on every move ──
      const newDir = dx >= DEAD_X ? 'forward' : dx <= -DEAD_X ? 'backward' : 'paused'
      if (newDir !== directionRef.current) {
        directionRef.current = newDir
        scheduleAdvance()
      }

      // ── Glow zone opacities (mutated directly, not via React state) ──
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const maxDist = Math.max(rect.width, rect.height) / 2

      const distLeft   = cx
      const distRight  = rect.width - cx
      const distTop    = cy
      const distBottom = rect.height - cy

      function edgeOp(dist) {
        return Math.max(0, Math.min(0.7, (1 - dist / (maxDist * 0.6)) * 0.7))
      }

      if (glowLeftRef.current)   glowLeftRef.current.style.opacity   = String(edgeOp(distLeft))
      if (glowRightRef.current)  glowRightRef.current.style.opacity  = String(edgeOp(distRight))
      if (glowTopRef.current)    glowTopRef.current.style.opacity    = String(edgeOp(distTop))
      if (glowBottomRef.current) glowBottomRef.current.style.opacity = String(edgeOp(distBottom))
    }

    function onPointerUp(e) {
      if (e.pointerId !== pointerIdRef.current) return
      clearTimeout(armTimerRef.current)
      el.style.touchAction = ''

      // IMPORTANT: do NOT stopPropagation here — framer-motion's drag controller
      // needs to see pointerup to clean up its tracking state. We already stop
      // pointermove during active, so framer-motion sees no movement and ends
      // the drag with zero velocity (no spurious swipe). If we swallowed
      // pointerup, the card would keep following the cursor on subsequent moves
      // even after release.
      try { el.releasePointerCapture(e.pointerId) } catch {}

      const phase = phaseRef.current
      if (phase === 'armed') {
        phaseRef.current = 'idle'
        pointerIdRef.current = null
        removeTouchBlocker()
        return
      }
      if (phase === 'active') {
        engageExit()
      }
      pointerIdRef.current = null
    }

    function onPointerCancel(e) {
      if (e.pointerId !== pointerIdRef.current) return
      clearTimeout(armTimerRef.current)
      clearTimeout(advanceTimerRef.current)
      el.style.touchAction = ''
      try { el.releasePointerCapture(e.pointerId) } catch {}

      const phase = phaseRef.current
      if (phase === 'armed') {
        phaseRef.current = 'idle'
        removeTouchBlocker()
      } else if (phase !== 'idle' && phase !== 'exiting') {
        engageExit()
      }
      pointerIdRef.current = null
    }

    // Document-level capture: while we're exiting, swallow any pointerdown
    // that lands outside the description so framer-motion can't start a card
    // swipe before our 2s exit animation finishes. Pointerdown INSIDE the
    // description still falls through to onPointerDown (which handles resume).
    function onDocPointerDownCapture(e) {
      if (phaseRef.current !== 'exiting') return
      if (containerRef.current && containerRef.current.contains(e.target)) return
      e.stopPropagation()
    }

    el.addEventListener('pointerdown',   onPointerDown)
    el.addEventListener('pointermove',   onPointerMove)
    el.addEventListener('pointerup',     onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('pointerdown', onDocPointerDownCapture, true)

    return () => {
      el.removeEventListener('pointerdown',   onPointerDown)
      el.removeEventListener('pointermove',   onPointerMove)
      el.removeEventListener('pointerup',     onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('pointerdown', onDocPointerDownCapture, true)
      clearTimeout(armTimerRef.current)
      clearTimeout(advanceTimerRef.current)
      clearTimeout(exitTimerRef.current)
      removeTouchBlocker()
      clearWordSpans(el)
      wordSpansRef.current = []
      delete document.body.dataset.rsvpActive
    }
  }, [containerRef]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dim the description text while active / exiting ──────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const phase = phaseRef.current
    if (currentWord !== null || completed || phase === 'exiting') {
      el.style.opacity = '0.1'
      el.style.transition = `opacity ${EXIT_DURATION_MS}ms ease-out`
    } else {
      el.style.opacity = ''
      el.style.transition = ''
    }
  }, [currentWord, completed, containerRef])

  // ── Overlay position ──────────────────────────────────────────────────
  // Fixed at the top of the description (just below the image). Doesn't
  // follow the pointer — keeps the focal letter at a steady reading position.
  function getOverlayStyle() {
    const el = containerRef.current
    if (!el || (!currentWord && !completed)) return { display: 'none' }
    const rect = el.getBoundingClientRect()
    return {
      position: 'fixed',
      left: rect.left + rect.width / 2,
      top: rect.top + 16,
      transform: 'translateX(-50%)',
      zIndex: 9999,
      pointerEvents: 'none',
    }
  }

  const bucket = Math.round(currentRate / 25) * 25

  return createPortal(
    <div className="rsvp-overlay" style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998,
      opacity: isExiting ? 0 : 1,
      transition: isExiting ? `opacity ${EXIT_DURATION_MS}ms ease-out` : 'none',
    }}>
      {/* Current-word position highlight — drawn over the dimmed background text */}
      <div ref={highlightDivRef} style={{
        position: 'fixed',
        display: 'none',
        background: 'rgba(91,170,255,0.2)',
        border: '1px solid rgba(91,170,255,0.4)',
        borderRadius: 3,
        pointerEvents: 'none',
      }} />

      {/* Glow zones — anchored to description card, opacity mutated via refs */}
      {containerRef.current && (() => {
        const rect = containerRef.current.getBoundingClientRect()
        return (
          <>
            <div ref={glowLeftRef} style={{
              position: 'fixed', left: rect.left, top: rect.top, width: 80, height: rect.height,
              background: 'radial-gradient(ellipse at left center, rgba(91,170,255,0.18) 0%, transparent 80%)',
              opacity: 0, transition: 'none', pointerEvents: 'none',
            }} />
            <div ref={glowRightRef} style={{
              position: 'fixed', left: rect.right - 80, top: rect.top, width: 80, height: rect.height,
              background: 'radial-gradient(ellipse at right center, rgba(91,170,255,0.18) 0%, transparent 80%)',
              opacity: 0, transition: 'none', pointerEvents: 'none',
            }} />
            <div ref={glowTopRef} style={{
              position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: 80,
              background: 'radial-gradient(ellipse at center top, rgba(91,170,255,0.18) 0%, transparent 80%)',
              opacity: 0, transition: 'none', pointerEvents: 'none',
            }} />
            <div ref={glowBottomRef} style={{
              position: 'fixed', left: rect.left, top: rect.bottom - 80, width: rect.width, height: 80,
              background: 'radial-gradient(ellipse at center bottom, rgba(91,170,255,0.18) 0%, transparent 80%)',
              opacity: 0, transition: 'none', pointerEvents: 'none',
            }} />
          </>
        )
      })()}

      {/* Word display (or completion tick) */}
      {(currentWord || completed) && (
        <div ref={overlayRef} style={getOverlayStyle()}>
          {completed ? (
            <div style={{
              fontFamily: 'var(--font-family-mono)',
              background: 'var(--color-surface)',
              border: '1px solid #10b981',
              borderRadius: 10,
              padding: '10px 20px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.7), 0 0 18px rgba(16,185,129,0.45)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
              <span style={{
                color: '#10b981',
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}>
                Section Read
              </span>
            </div>
          ) : (
            <>
              {/* Rate badge */}
              <div style={{
                textAlign: 'center',
                marginBottom: 6,
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--color-brand-400)',
                fontFamily: 'var(--font-family-mono)',
                letterSpacing: '0.1em',
              }}>
                {bucket} wpm
              </div>

              {/* ORP word */}
              <div style={{
                fontFamily: 'var(--font-family-mono)',
                fontSize: 30,
                fontWeight: 600,
                color: 'var(--color-text)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-slate-300)',
                borderRadius: 10,
                padding: '10px 22px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.7), 0 0 12px rgba(91,170,255,0.15)',
                display: 'flex',
                alignItems: 'baseline',
                gap: 0,
                whiteSpace: 'pre',
              }}>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {currentWord.word.slice(0, currentWord.focalIndex)}
                </span>
                <span style={{ color: 'var(--color-brand-600)', fontWeight: 800 }}>
                  {currentWord.word[currentWord.focalIndex] ?? ''}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {currentWord.word.slice(currentWord.focalIndex + 1)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>,
    document.body
  )
}
