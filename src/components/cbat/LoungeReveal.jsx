import { useLayoutEffect, useRef } from 'react'
import {
  chevronOpacity, eyebrowOpacity, hairlineScale, headingGlow, headingMask, panelReveal,
} from '../../utils/cbat/loungeReveal'

// The phone hub's lounge reveal, in two pieces that both play off the one
// progress value from useLoungeScrollSnap: the CBAT CHAT heading filling with
// light from both ends inwards, and the chat panel rising into place. Scrubbed, never timed (see utils/cbat/
// loungeReveal.js), so a held finger holds every piece still.
//
// None of it re-renders on scroll. Each piece subscribes to the progress store
// and writes opacity and transform straight onto its elements: a React render
// per scroll frame, plus the blur and clip-path the first version animated, is
// what made that version stutter.

// Calls `apply(p)` now and on every change of the progress, before paint.
function useProgressStyles(progress, apply) {
  const applyRef = useRef(apply)
  useLayoutEffect(() => { applyRef.current = apply })
  useLayoutEffect(() => {
    const run = () => applyRef.current(progress.get())
    run()
    return progress.subscribe(run)
  }, [progress])
}

const setTapThrough = (el, through) => { if (el) el.style.pointerEvents = through ? 'none' : '' }

const HEADING = 'CBAT CHAT'
const LIT_COLOUR = 'rgba(160,208,255,0.92)'
const LIT_SHADOW = '0 0 18px rgba(91,170,255,0.55), 0 0 60px rgba(91,170,255,0.35)'

// The heading, the eyebrow under it and the chevron beneath that: the
// landmark's own markup, with a lit copy of the word laid exactly over the
// ghost one. Nothing moves across the word: the lit copy is shown through a
// mask that opens from both ends towards the middle, so there is only ever one
// word on screen, getting brighter. Its glow is a third copy with transparent
// letters, faded in by opacity (see headingGlow). The copies are aria-hidden,
// so the landmark still reads "CBAT CHAT" once.
export function LoungeRevealHeading({ progress }) {
  const litRef = useRef(null)
  const glowRef = useRef(null)
  const eyebrowRef = useRef(null)
  const hairRefs = useRef([])
  const chevronRef = useRef(null)

  useProgressStyles(progress, (p) => {
    const lit = litRef.current
    if (lit) {
      const mask = headingMask(p)
      lit.style.webkitMaskImage = mask
      lit.style.maskImage = mask
    }
    if (glowRef.current) glowRef.current.style.opacity = headingGlow(p)
    if (eyebrowRef.current) eyebrowRef.current.style.opacity = eyebrowOpacity(p)
    const scale = hairlineScale(p)
    hairRefs.current.forEach((el) => { if (el) el.style.transform = `scaleX(${scale.toFixed(3)})` })
    if (chevronRef.current) chevronRef.current.style.opacity = chevronOpacity(p)
  })

  return (
    <>
      <span className="relative block font-black leading-none tracking-[0.15em] text-[1.75rem] sm:text-[3rem]" style={{ zIndex: 1 }}>
        <span
          className="block"
          style={{ color: 'rgba(91,170,255,0.16)', textShadow: '0 0 60px rgba(91,170,255,0.15)' }}
        >
          {HEADING}
        </span>
        <span
          ref={glowRef}
          aria-hidden="true"
          className="absolute inset-0 block"
          style={{ color: 'transparent', textShadow: LIT_SHADOW, opacity: 0, willChange: 'opacity' }}
        >
          {HEADING}
        </span>
        <span
          ref={litRef}
          aria-hidden="true"
          className="absolute inset-0 block"
          style={{ color: LIT_COLOUR }}
        >
          {HEADING}
        </span>
      </span>
      <span ref={eyebrowRef} data-lounge-eyebrow className="relative flex items-center gap-3 mt-1.5" style={{ zIndex: 1, opacity: 0.55 }}>
        <span ref={(el) => { hairRefs.current[0] = el }} className="h-px w-8 origin-right" style={{ background: 'rgba(91,170,255,0.35)' }} />
        <span className="text-[10px] font-bold uppercase tracking-[0.35em]" style={{ color: 'rgba(91,170,255,0.6)' }}>
          Talk to other agents
        </span>
        <span ref={(el) => { hairRefs.current[1] = el }} className="h-px w-8 origin-left" style={{ background: 'rgba(91,170,255,0.35)' }} />
      </span>
      <span
        ref={chevronRef}
        className="relative block mt-2"
        aria-hidden="true"
        style={{ color: 'rgba(91,170,255,0.55)', zIndex: 1 }}
      >
        <span className="home-chevron-sway block">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </span>
    </>
  )
}

// The chat panel, scaling a touch into place with a faint scan line passing
// down it. At rest in the lounge its transform and opacity come off; its layer
// stays (nothing in the chat is position: fixed, and its dialogs open in the
// top layer, so the permanent will-change re-anchors nothing).
export function LoungePanelReveal({ progress, children }) {
  const wrapRef = useRef(null)
  const bodyRef = useRef(null)
  const scanRef = useRef(null)
  // The panel's height, for walking the scan line down it in pixels. Kept by a
  // ResizeObserver so a scroll frame never has to measure layout.
  const heightRef = useRef(0)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    heightRef.current = wrap.clientHeight
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { heightRef.current = wrap.clientHeight })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useProgressStyles(progress, (p) => {
    const r = panelReveal(p)
    // The panel tucks up over the landmark's chevron (see Cbat.jsx), so while
    // it is still faint it must not take the taps meant for the landmark. The
    // panel box itself is the parent: an empty, transparent div still catches
    // a tap.
    setTapThrough(wrapRef.current?.parentElement, p < 0.5)
    // Only opacity and transform change here, and the body keeps its own
    // compositor layer the whole time (will-change, set once below). Dropping
    // and re-creating that layer, and toggling a clip, at the moment a glide
    // left the lounge is what made the glide catch on its first frame.
    const body = bodyRef.current
    if (body) {
      body.style.opacity = r.done ? '' : r.opacity
      body.style.transform = r.done ? '' : `scale(${r.scale.toFixed(4)})`
    }
    const scan = scanRef.current
    if (scan) {
      scan.style.opacity = r.scanOpacity
      scan.style.transform = `translate3d(0,${(r.scan * Math.max(0, heightRef.current - 1)).toFixed(1)}px,0)`
    }
  })

  return (
    <div ref={wrapRef} className="relative flex flex-1 min-h-0 flex-col">
      <div ref={bodyRef} className="flex flex-1 min-h-0 flex-col origin-top" style={{ willChange: 'transform, opacity' }}>
        {children}
      </div>
      {/* A 1px line, walked down the panel in pixels: it never reaches past
          the panel's foot, so it cannot make the page any taller. */}
      <div
        ref={scanRef}
        aria-hidden="true"
        className="absolute inset-x-6 top-0 h-px pointer-events-none"
        style={{
          opacity: 0,
          willChange: 'transform, opacity',
          background: 'linear-gradient(90deg, transparent, rgba(160,208,255,0.9), transparent)',
          boxShadow: '0 0 12px 1px rgba(91,170,255,0.4)',
        }}
      />
    </div>
  )
}
