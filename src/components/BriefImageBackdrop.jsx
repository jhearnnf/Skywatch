import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'

// ── CRT-tinted backdrop for a brief image, sized to fill its (relative) parent.
// Visual language mirrors the LearnPriority stone preview: frayed mask, scanlines,
// viewport-fixed page-grid overlay, pulsing transmission pip, tune-in fade on
// first image load.
//
// A single module-level ticker drives all mounted instances at 3.5s cadence so
// the page feels calm — one random card changes image per tick, not all at once.

// ── Shared global ticker ─────────────────────────────────────────────────────
// Rather than each card running its own setInterval, all mounted backdrops
// register with this ticker. Each tick, one random subscriber is selected and
// told to advance. Subscribers with <2 images are skipped for selection.
// The gap between ticks is randomised within [TICK_MIN_MS, TICK_MAX_MS] so the
// cadence feels organic rather than metronomic.
const TICK_MIN_MS = 1500
const TICK_MAX_MS = 4500
const subscribers = new Set()
let tickTimeout = null

function nextTickDelay() {
  return TICK_MIN_MS + Math.random() * (TICK_MAX_MS - TICK_MIN_MS)
}

function scheduleTick() {
  if (tickTimeout !== null) return
  tickTimeout = setTimeout(() => {
    tickTimeout = null
    const cyclable = Array.from(subscribers).filter(fn => fn.__cyclable)
    if (cyclable.length > 0) {
      const pick = cyclable[Math.floor(Math.random() * cyclable.length)]
      pick()
    }
    if (subscribers.size > 0) scheduleTick()
  }, nextTickDelay())
}

function stopIfIdle() {
  if (subscribers.size === 0 && tickTimeout !== null) {
    clearTimeout(tickTimeout)
    tickTimeout = null
  }
}

function subscribeTicker(fn) {
  subscribers.add(fn)
  scheduleTick()
  return () => {
    subscribers.delete(fn)
    stopIfIdle()
  }
}

// ── Helpers (ported from LearnPriority) ──────────────────────────────────────
function lowResUrl(url) {
  if (!url || typeof url !== 'string')             return url
  if (!/\/image\/upload\//.test(url))              return url
  if (/\/image\/upload\/[^/]*w_\d+/.test(url))     return url
  return url.replace('/image/upload/', '/image/upload/w_320,q_55,f_auto/')
}

function buildFrayMask(w, h) {
  const spec = [
    { cxPct: 0,    cyPct: 0.55, rxPct: 0.035, ryPct: 0.40 },
    { cxPct: 1,    cyPct: 0.32, rxPct: 0.028, ryPct: 0.55 },
    { cxPct: 0.18, cyPct: 1,    rxPct: 0.06,  ryPct: 0.18 },
    { cxPct: 0.74, cyPct: 0,    rxPct: 0.055, ryPct: 0.20 },
  ]
  const ellipses = spec.map(f =>
    `<ellipse cx='${Math.round(f.cxPct * w)}' cy='${Math.round(f.cyPct * h)}' rx='${Math.round(f.rxPct * w)}' ry='${Math.round(f.ryPct * h)}' fill='url(#b)'/>`
  ).join('')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'><defs><radialGradient id='b'><stop offset='0%' stop-color='black'/><stop offset='55%' stop-color='black'/><stop offset='100%' stop-color='white'/></radialGradient></defs><rect width='${w}' height='${h}' fill='white'/>${ellipses}</svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}

// Viewport-aligned replica of the body::before grid so the image reads as if
// sitting *under* the page grid, not carrying its own grid.
const PAGE_GRID_OVERLAY = {
  backgroundImage: `
    linear-gradient(rgba(91,170,255,0.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(91,170,255,0.022) 1px, transparent 1px)
  `,
  backgroundSize:       '48px 48px',
  backgroundAttachment: 'fixed',
}

// Minimum time the skeleton holds before tune-in can start. Jitter is layered
// on top per-instance so that when several backdrops mount together (e.g. the
// four-item Home news list), their tune-in animations don't all start on the
// same frame — each card feels like its own transmission tuning in.
const MIN_DELAY_MS    = 1100
const MIN_DELAY_JITTER_MS = 900

// Approximate mask dimensions — the fray mask scales to 100% of the container,
// so exact pixel size doesn't matter for mapping; but the SVG needs a
// non-degenerate aspect to produce sensible ellipse geometry.
const MASK_W = 420
const MASK_H = 64

export default function BriefImageBackdrop({ images = [], opacity = 0.28 }) {
  const list = useMemo(() => Array.isArray(images) ? images.filter(Boolean) : [], [images])
  const [idx, setIdx] = useState(0)
  const [minDelayElapsed, setMinDelayElapsed] = useState(false)
  const [firstImageReady, setFirstImageReady] = useState(false)
  const canReveal = minDelayElapsed && firstImageReady

  // Register with the shared ticker. Advance to a random *different* index on
  // each tick when this subscriber is picked.
  const idxRef = useRef(idx)
  useEffect(() => { idxRef.current = idx }, [idx])

  useEffect(() => {
    const advance = () => {
      if (list.length <= 1) return
      let next
      do {
        next = Math.floor(Math.random() * list.length)
      } while (next === idxRef.current)
      setIdx(next)
    }
    advance.__cyclable = list.length > 1
    return subscribeTicker(advance)
  }, [list.length])

  useEffect(() => {
    const jitter = Math.random() * MIN_DELAY_JITTER_MS
    const t = setTimeout(() => setMinDelayElapsed(true), MIN_DELAY_MS + jitter)
    return () => clearTimeout(t)
  }, [])

  const frayMask = useMemo(() => buildFrayMask(MASK_W, MASK_H), [])

  if (list.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Skeleton placeholder — dark panel shown immediately so the image
          appears to tune in within a loading frame. */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        style={{
          background:       'rgba(12, 24, 41, 0.5)',
          maskImage:        frayMask,
          WebkitMaskImage:  frayMask,
          maskSize:         '100% 100%',
          WebkitMaskSize:   '100% 100%',
          maskRepeat:       'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        }}
      />

      {/* Image + effect layer. Tune-in fade once the first image is loaded. */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={canReveal
          ? { opacity: [0, 0.15, 0.3, 0.28, 0.5, 0.7, 0.82, 1] }
          : { opacity: 0 }}
        transition={canReveal
          ? { duration: 2.4, times: [0, 0.12, 0.28, 0.36, 0.5, 0.68, 0.85, 1], ease: 'linear' }
          : undefined}
        style={{
          maskImage:        frayMask,
          WebkitMaskImage:  frayMask,
          maskSize:         '100% 100%',
          WebkitMaskSize:   '100% 100%',
          maskRepeat:       'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        }}
      >
        {/* Crossfading image stack */}
        <div
          className="absolute inset-0 motion-reduce:!animate-none"
          style={{ animation: 'lp-preview-flicker 2.3s ease-in-out infinite' }}
        >
          {list.map((url, i) => (
            <img
              key={url + i}
              src={lowResUrl(url)}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              onLoad={i === 0 ? () => setFirstImageReady(true) : undefined}
              onError={i === 0 ? () => setFirstImageReady(true) : undefined}
              style={{
                position:       'absolute',
                inset:          0,
                width:          '100%',
                height:         '100%',
                objectFit:      'cover',
                objectPosition: 'center',
                filter:         'contrast(1.05) saturate(0.75) hue-rotate(190deg) brightness(0.85)',
                opacity:        i === idx ? opacity : 0,
                transition:     'opacity 320ms ease-in-out',
              }}
            />
          ))}
        </div>

        {/* Scanlines */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:   'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.22) 2px, rgba(0,0,0,0.22) 3px)',
            mixBlendMode: 'multiply',
          }}
        />

        {/* Page-grid replica (viewport-fixed) */}
        <div className="absolute inset-0 pointer-events-none" style={PAGE_GRID_OVERLAY} />
      </motion.div>

      {/* Transmission pip — red, pulsing, stays visible through skeleton and
          tune-in so there's always something "live" on the frame. */}
      <span
        className="absolute"
        style={{
          top:          6,
          left:         8,
          width:        6,
          height:       6,
          borderRadius: '50%',
          background:   '#ff5a5f',
          boxShadow:    '0 0 7px #ff5a5f',
          animation:    'lp-preview-dot 1.2s ease-in-out infinite',
        }}
      />
    </div>
  )
}
