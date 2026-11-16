import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { offsetWithin } from './cbatPresenceSlots'
import {
  christmasTreeFor, easterEggFor, hasSnowCap, isHolidayThemeLive, jackOLanternFor, spiderWebFor,
} from '../../data/holidayThemes'
import EasterBunnySvg from './EasterBunnySvg'

// Seasonal decoration on the CBAT hub, chosen by an admin (AppSettings
// `cbatHolidayTheme`, see data/holidayThemes.js). Rendered by pages/Cbat.jsx
// only, so it never reaches a game, a leaderboard or any other page.
//
// Every layer here is pointer-events-none and aria-hidden. It must never take a
// tap or a hover from a tile underneath: the Trace and Visualisation tiles open
// their mode split on hover, and the long-press shortcut to a board needs the
// touch to land on the tile itself.
export default function CbatHolidayTheme({ theme, pageRef, areaRef, containerRef }) {
  if (!isHolidayThemeLive(theme)) return null
  if (theme === 'christmas') {
    return (
      <>
        <Snowfall pageRef={pageRef} areaRef={areaRef} />
        <SnowCaps containerRef={containerRef} />
        <ChristmasTrees containerRef={containerRef} />
      </>
    )
  }
  if (theme === 'easter') {
    return (
      <>
        <EasterEggs containerRef={containerRef} />
        <EasterBunny containerRef={containerRef} />
      </>
    )
  }
  if (theme === 'halloween') {
    return (
      <>
        <SpiderWebs containerRef={containerRef} />
        <JackOLanterns containerRef={containerRef} />
        <PeekingSpider containerRef={containerRef} />
      </>
    )
  }
  return null
}

// ── Snowfall ────────────────────────────────────────────────────────────────
// One canvas fixed to the viewport, clipped every frame to the game area: from
// the top of the page down to the bottom of the game grid column, and only as
// wide as that column. That keeps the snow off the lounge chat in both layouts:
// below `lg` the chat sits under the grid (so the clip's bottom edge rises past
// it as you scroll down), and in the desktop split view the chat dock sits
// beside the column (so the clip's right edge stops short of it).
//
// Flakes live in viewport coordinates, not page coordinates, so scrolling the
// page does not drag the snow with it.
//
// z-20 puts it over the tiles but under the sidebar (z-30), bottom bar (z-40)
// and top bar, so the app chrome is never snowed on.
function Snowfall({ pageRef, areaRef }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    // jsdom and the build-time pre-render have no 2D context; draw nothing.
    let ctx = null
    try { ctx = canvas?.getContext?.('2d') ?? null } catch { ctx = null }
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width  = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    // x is a fraction of the column width so a resize never strands flakes
    // outside it; y is viewport pixels.
    const flakes = []
    const makeFlake = (y) => ({
      x:     Math.random(),
      y,
      r:     0.8 + Math.random() * 2.2,
      speed: 16 + Math.random() * 28,   // px per second: gentle
      sway:  6 + Math.random() * 14,
      freq:  0.3 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.35 + Math.random() * 0.5,
    })

    const region = () => {
      const page = pageRef?.current?.getBoundingClientRect?.()
      const area = (areaRef?.current ?? pageRef?.current)?.getBoundingClientRect?.()
      if (!page || !area) return null
      const top    = Math.max(page.top, 0)
      const bottom = Math.min(area.bottom, h)
      const left   = Math.max(area.left, 0)
      const right  = Math.min(area.right, w)
      if (bottom - top < 1 || right - left < 1) return null
      return { top, bottom, left, width: right - left, height: bottom - top }
    }

    let raf = 0
    let last = performance.now()
    const frame = (now) => {
      // Cap the step so a tab coming back from the background does not dump
      // every flake to the bottom in one frame.
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const t = now / 1000

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const r = region()
      if (r) {
        // Density follows the visible area: a phone gets a light flurry, a
        // big monitor gets more flakes rather than the same few spread thin.
        const target = Math.max(20, Math.min(130, Math.round((r.width * h) / 9000)))
        while (flakes.length < target) flakes.push(makeFlake(Math.random() * h))
        if (flakes.length > target) flakes.length = target

        ctx.save()
        ctx.beginPath()
        ctx.rect(r.left, r.top, r.width, r.height)
        ctx.clip()
        for (const f of flakes) {
          f.y += f.speed * dt
          if (f.y > h + 4) Object.assign(f, makeFlake(-4))
          const x = r.left + f.x * r.width + Math.sin(t * f.freq + f.phase) * f.sway
          ctx.globalAlpha = f.alpha
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(x, f.y, f.r, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [pageRef, areaRef])

  if (typeof document === 'undefined') return null
  return createPortal(
    <motion.canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="cbat-holiday-snow"
      className="pointer-events-none fixed left-0 top-0 z-20 w-screen h-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 2 }}
    />,
    document.body,
  )
}

// ── Snow caps ───────────────────────────────────────────────────────────────
// A little drift of settled snow on the top edge of some of the tiles. One
// overlay layer positioned against the grid wrapper, measured from the same
// `data-cbat-card` wrappers the admin presence dots use (offsets, not rects, so
// the tiles' staggered entrance does not throw the measurement).
//
// The caps build up slowly after the page opens, staggered tile by tile, so
// it reads as snow settling rather than decoration that was always there.

// Every `data-cbat-card` tile's box inside the grid wrapper, in the wrapper's
// own coordinates, re-measured whenever the grid reflows. Offsets rather than
// rects so the tiles' staggered entrance does not throw the measurement.
function useCardBoxes(containerRef) {
  const [boxes, setBoxes] = useState([])

  const measure = useCallback(() => {
    const el = containerRef?.current
    if (!el) return
    const next = []
    for (const node of el.querySelectorAll('[data-cbat-card]')) {
      next.push({ key: node.dataset.cbatCard, ...offsetWithin(node, el), width: node.offsetWidth, height: node.offsetHeight })
    }
    setBoxes(prev => (sameBoxes(prev, next) ? prev : next))
  }, [containerRef])

  useEffect(() => {
    const el = containerRef?.current
    if (!el) return
    const raf = requestAnimationFrame(measure)
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [containerRef, measure])

  return boxes
}

function SnowCaps({ containerRef }) {
  const caps = useCardBoxes(containerRef).filter(b => hasSnowCap(b.key))

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="cbat-holiday-snowcaps"
    >
      {caps.map((c, i) => {
        // ~7px on the 83px phone tile, up to 13px on the desktop card.
        const capH  = Math.max(6, Math.min(13, c.width * 0.05))
        const width = c.width * 0.88
        return (
          <motion.svg
            key={c.key}
            data-snowcap={c.key}
            viewBox="0 0 100 14"
            preserveAspectRatio="none"
            className="absolute"
            style={{
              left: c.left + (c.width - width) / 2,
              // The flat base overlaps the tile's top edge; the drips hang over it.
              top: c.top - capH * 0.62,
              width,
              height: capH,
              transformOrigin: '50% 100%',
              filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))',
            }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ delay: 1.5 + i * 0.7, duration: 6, ease: 'easeOut' }}
          >
            <path
              d="M0,9 Q2,5 8,5 Q16,1 26,3.5 Q34,0.5 46,3 Q56,1 66,3 Q78,0 86,3.5 Q96,3 100,8.5
                 L100,9.5 Q98,10.5 95,9.5 Q93,13.5 91,9.5 L72,9.5 Q69.5,12.5 67,9.5
                 L42,9.5 Q39,14 36,9.5 L14,9.5 Q11.5,11.5 9,9.5 Q4,10.5 0,9.5 Z"
              fill="#f2f7ff"
            />
          </motion.svg>
        )
      })}
    </div>
  )
}

function sameBoxes(a, b) {
  if (a.length !== b.length) return false
  return b.every((n, i) => {
    const p = a[i]
    return p.key === n.key && p.left === n.left && p.top === n.top && p.width === n.width && p.height === n.height
  })
}

// ── Christmas trees ─────────────────────────────────────────────────────────
// A mini tree on the top edge of a few tiles, each on its own little pile of
// snow, with a twinkling star. Which tiles, where along the edge and how big
// come from the game key (see christmasTreeFor). They pop up once the snow has
// had a moment to start falling.
function ChristmasTrees({ containerRef }) {
  const trees = useCardBoxes(containerRef)
    .map(b => ({ ...b, tree: christmasTreeFor(b.key) }))
    .filter(b => b.tree)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="cbat-holiday-trees"
    >
      {trees.map((b, i) => {
        // ~18px tall on the phone tile, up to 32px on the desktop card.
        const h = Math.max(18, Math.min(32, b.width * 0.11)) * b.tree.scale
        const w = h * 0.75
        return (
          <motion.svg
            key={b.key}
            data-christmas-tree={b.key}
            viewBox="0 0 24 32"
            className="absolute"
            style={{
              // Somewhere along the edge, kept clear of the rounded corners.
              left: b.left + 10 + b.tree.along * Math.max(0, b.width - 20 - w),
              // The snow pile at its foot overlaps the tile's top edge.
              top: b.top - h + h * 0.08,
              width: w,
              height: h,
              overflow: 'visible',
              transformOrigin: '50% 100%',
              filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.4))',
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 1.8 + i * 0.5, type: 'spring', stiffness: 220, damping: 13 }}
          >
            <TreeArt delay={i * 0.7} />
          </motion.svg>
        )
      })}
    </div>
  )
}

function TreeArt({ delay }) {
  return (
    <>
      {/* trunk */}
      <rect x="10.5" y="25" width="3" height="4" rx="0.6" fill="#7c4a24" />
      {/* three tiers, darkest at the back */}
      <path d="M12,10 L21,26 Q12,28 3,26 Z" fill="#166534" />
      <path d="M12,6 L18.5,19 Q12,20.8 5.5,19 Z" fill="#15803d" />
      <path d="M12,2.5 L16.5,12.5 Q12,13.8 7.5,12.5 Z" fill="#16a34a" />
      {/* snow on the boughs */}
      <path d="M5,25.3 Q8,24 11,25 Q14,24 17,25 Q19,24.4 20.3,25.2" fill="none" stroke="#f2f7ff" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M7,18.6 Q10,17.6 12.5,18.4 Q15,17.6 17.2,18.5" fill="none" stroke="#f2f7ff" strokeWidth="1" strokeLinecap="round" />
      {/* baubles */}
      <circle cx="8.5" cy="22.5" r="1.2" fill="#ef4444" />
      <circle cx="15.5" cy="21.5" r="1.2" fill="#facc15" />
      <circle cx="12"   cy="16"   r="1.1" fill="#60a5fa" />
      <circle cx="9.8"  cy="11.5" r="0.9" fill="#facc15" />
      <circle cx="14.6" cy="15.2" r="0.9" fill="#ef4444" />
      {/* snow pile at the foot, over the tile edge */}
      <ellipse cx="12" cy="30" rx="11" ry="2.6" fill="#f2f7ff" />
      {/* star */}
      <motion.path
        d="M12,-1.2 L12.9,1.1 L15.3,1.2 L13.4,2.7 L14.1,5 L12,3.7 L9.9,5 L10.6,2.7 L8.7,1.2 L11.1,1.1 Z"
        fill="#fde047"
        style={{ transformOrigin: '12px 2px' }}
        animate={{ opacity: [1, 0.55, 1], scale: [1, 1.15, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay }}
      />
    </>
  )
}

// ── Halloween: cobwebs ──────────────────────────────────────────────────────
// A cobweb strung across one corner of a couple of tiles (see spiderWebFor).
// Thin and see-through, so the tile underneath stays readable.
function SpiderWebs({ containerRef }) {
  const webs = useCardBoxes(containerRef)
    .map(b => ({ ...b, web: spiderWebFor(b.key) }))
    .filter(b => b.web && b.height > 0)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="cbat-holiday-webs"
    >
      {webs.map((b, i) => {
        const { width: w, height: h } = b
        const R = Math.min(w, h) * 0.5 * b.web.size
        // Drawn for the top-left corner, then mirrored into the right one.
        const flip = {
          tl: '',
          tr: `translate(${w},0) scale(-1,1)`,
          bl: `translate(0,${h}) scale(1,-1)`,
          br: `translate(${w},${h}) scale(-1,-1)`,
        }[b.web.corner]
        return (
          <motion.svg
            key={b.key}
            data-spider-web={b.key}
            data-corner={b.web.corner}
            className="absolute"
            style={{ left: b.left, top: b.top, width: w, height: h, overflow: 'visible' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 + i * 0.5, duration: 1.5 }}
          >
            <g transform={flip}>
              <path d={webPath(R)} fill="none" stroke="#e5e7f0" strokeOpacity="0.6" strokeWidth="0.8" strokeLinecap="round" />
            </g>
          </motion.svg>
        )
      })}
    </div>
  )
}

// A quarter web from a corner at (0,0) reaching R into the tile: five spokes,
// and four rings that sag towards the corner between spokes like real silk.
function webPath(R) {
  const spokes = [0, 22.5, 45, 67.5, 90].map(a => (a * Math.PI) / 180)
  const pt = (r, a) => [r * Math.cos(a), r * Math.sin(a)]
  const f = (n) => n.toFixed(1)
  let d = ''
  for (const a of spokes) {
    const [x, y] = pt(R, a)
    d += `M0,0 L${f(x)},${f(y)} `
  }
  for (let k = 1; k <= 4; k++) {
    const r = (R * k) / 4.4
    for (let s = 0; s < spokes.length - 1; s++) {
      const [x1, y1] = pt(r, spokes[s])
      const [x2, y2] = pt(r, spokes[s + 1])
      const mid = (spokes[s] + spokes[s + 1]) / 2
      const [cx, cy] = pt(r * 0.8, mid)
      d += `M${f(x1)},${f(y1)} Q${f(cx)},${f(cy)} ${f(x2)},${f(y2)} `
    }
  }
  return d.trim()
}

// ── Halloween: jack-o'-lanterns ─────────────────────────────────────────────
// A carved pumpkin on the top edge of a couple of tiles, lit from inside by a
// candle that flickers: the face and a soft glow round the pumpkin waver on an
// uneven loop, so it never looks like a regular blink.
const FLICKER_OPACITY = [1, 0.72, 0.95, 0.6, 0.9, 0.78, 1, 0.68, 0.92, 1]

function JackOLanterns({ containerRef }) {
  const lanterns = useCardBoxes(containerRef)
    .map(b => ({ ...b, jack: jackOLanternFor(b.key) }))
    .filter(b => b.jack)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="cbat-holiday-lanterns"
    >
      {lanterns.map((b, i) => {
        // ~16px tall on the phone tile, up to 30px on the desktop card.
        const h = Math.max(16, Math.min(30, b.width * 0.1)) * b.jack.scale
        const w = h * (28 / 24)
        return (
          <motion.svg
            key={b.key}
            data-jack-o-lantern={b.key}
            viewBox="0 0 28 24"
            className="absolute"
            style={{
              left: b.left + 10 + b.jack.along * Math.max(0, b.width - 20 - w),
              // Sits on the edge, sunk a little.
              top: b.top - h + h * 0.06,
              width: w,
              height: h,
              overflow: 'visible',
              transformOrigin: '50% 100%',
              filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))',
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 1 + i * 0.6, type: 'spring', stiffness: 220, damping: 13 }}
          >
            {/* candle glow spilling round the pumpkin */}
            <motion.ellipse
              cx="14" cy="15" rx="15" ry="11" fill="#ff9d2e"
              animate={{ opacity: FLICKER_OPACITY.map(o => o * 0.22) }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'linear', delay: i * 0.37 }}
            />
            {/* stem */}
            <path d="M13,5.5 Q12.6,2.5 14.8,1 L16,2 Q14.6,3 15,5.6 Z" fill="#4d7c0f" />
            {/* ribbed pumpkin: outer lobes, then the middle one */}
            <ellipse cx="8.5"  cy="14.5" rx="7.5" ry="9" fill="#ea580c" />
            <ellipse cx="19.5" cy="14.5" rx="7.5" ry="9" fill="#ea580c" />
            <ellipse cx="14"   cy="14.5" rx="7"   ry="9.3" fill="#f97316" />
            <path d="M10.5,6.5 Q8.8,14.5 10.5,22.8 M17.5,6.5 Q19.2,14.5 17.5,22.8" fill="none" stroke="#c2410c" strokeWidth="0.7" />
            {/* carved face, dark first so the flicker reads as light inside */}
            <g fill="#3b1300">
              <path d="M7.6,13 L10.4,9.6 L12.2,13 Z" />
              <path d="M15.8,13 L17.6,9.6 L20.4,13 Z" />
              <path d="M12.9,15.6 L14,14 L15.1,15.6 Z" />
              <path d="M7.4,17 Q14,21.5 20.6,17 L19,19.4 L17.6,18.3 L16.2,20.2 L14,19 L11.8,20.2 L10.4,18.3 L9,19.4 Z" />
            </g>
            <motion.g
              fill="#ffd34d"
              animate={{ opacity: FLICKER_OPACITY }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'linear', delay: i * 0.37 }}
            >
              <path d="M8.4,12.6 L10.4,10.3 L11.6,12.6 Z" />
              <path d="M16.4,12.6 L17.6,10.3 L19.6,12.6 Z" />
              <path d="M13.3,15.3 L14,14.4 L14.7,15.3 Z" />
              <path d="M8.3,17.6 Q14,21 19.7,17.6 L18.8,18.8 L17.6,17.9 L16.2,19.6 L14,18.5 L11.8,19.6 L10.4,17.9 L9.2,18.8 Z" />
            </motion.g>
          </motion.svg>
        )
      })}
    </div>
  )
}

// ── Halloween: the peeking spider ───────────────────────────────────────────
// Every so often a spider's head rises from behind a tile's top edge, looks
// left and right, and sinks back. "Behind" is done with a clip: the spider is
// drawn inside a box that ends exactly at the tile's top edge, so whatever is
// below the edge is simply not drawn, which looks like the tile hiding it.
// Never on a tile with a jack-o'-lantern, which already owns that edge.
const SPIDER_FIRST_MS = 4000
const SPIDER_GAP_MS   = [12000, 24000]
const SPIDER_PEEK_S   = 4.2

function PeekingSpider({ containerRef }) {
  const boxes = useCardBoxes(containerRef)
  const [run, setRun] = useState(null)   // { id, pick, along, finished? }
  const timer = useRef(null)

  const schedule = useCallback((ms) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setRun(prev => ({ id: (prev?.id ?? 0) + 1, pick: Math.random(), along: 0.3 + Math.random() * 0.4 }))
    }, ms)
  }, [])

  useEffect(() => {
    schedule(SPIDER_FIRST_MS)
    return () => clearTimeout(timer.current)
  }, [schedule])

  const done = () => {
    setRun(prev => (prev ? { ...prev, finished: true } : prev))
    schedule(SPIDER_GAP_MS[0] + Math.random() * (SPIDER_GAP_MS[1] - SPIDER_GAP_MS[0]))
  }

  const size = Math.max(16, Math.min(30, (boxes[0]?.width ?? 120) * 0.1))
  // Tiles with room above them and no jack-o'-lantern on their edge.
  const spots = boxes.filter(b => b.top >= size && !jackOLanternFor(b.key))
  const tile  = run && spots.length ? spots[Math.floor(run.pick * spots.length)] : null
  const active = Boolean(run && !run.finished && tile)

  // A visit that could not start books the next one rather than ending them.
  const stalled = Boolean(run && !run.finished && !tile)
  useEffect(() => {
    if (stalled) schedule(SPIDER_FIRST_MS)
  }, [stalled, run?.id, schedule])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="cbat-holiday-spider-layer"
    >
      {active && (
        <div
          key={run.id}
          data-peeking-spider={tile.key}
          className="absolute overflow-hidden"
          style={{
            left: tile.left + tile.width * run.along - size / 2,
            top: tile.top - size,
            width: size,
            height: size,
          }}
        >
          <motion.div
            style={{ width: size, height: size }}
            initial={{ y: size }}
            animate={{ y: [size, size * 0.38, size * 0.38, size * 0.38, size] }}
            transition={{ duration: SPIDER_PEEK_S, times: [0, 0.18, 0.5, 0.82, 1], ease: 'easeInOut' }}
            onAnimationComplete={done}
          >
            <SpiderHead />
          </motion.div>
        </div>
      )}
    </div>
  )
}

// Head-on spider peeking up: only the top ~60% shows above the tile edge.
function SpiderHead() {
  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%" style={{ overflow: 'visible' }}>
      {/* front legs, bent at the knee */}
      <path d="M11,27 Q5,18 4,11 L1.5,14.5 M29,27 Q35,18 36,11 L38.5,14.5" fill="none" stroke="#1c1426" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12,29 Q2,24 1,19 M28,29 Q38,24 39,19" fill="none" stroke="#1c1426" strokeWidth="2" strokeLinecap="round" />
      {/* head + a few hairs */}
      <circle cx="20" cy="25" r="11" fill="#241a30" />
      <path d="M15,15.2 L14,12.6 M20,14 L20,11.2 M25,15.2 L26,12.6" stroke="#241a30" strokeWidth="1.2" strokeLinecap="round" />
      {/* small upper eyes */}
      <circle cx="16.4" cy="18" r="1.3" fill="#ff4d4d" />
      <circle cx="23.6" cy="18" r="1.3" fill="#ff4d4d" />
      {/* big eyes, pupils glancing left then right */}
      <circle cx="15" cy="23" r="3.6" fill="#f8f8ff" />
      <circle cx="25" cy="23" r="3.6" fill="#f8f8ff" />
      <motion.g
        fill="#0b0710"
        animate={{ x: [0, 0, -1.7, -1.7, 1.7, 1.7, 0] }}
        transition={{ duration: SPIDER_PEEK_S, times: [0, 0.22, 0.32, 0.48, 0.58, 0.74, 0.84] }}
      >
        <circle cx="15" cy="23.4" r="1.8" />
        <circle cx="25" cy="23.4" r="1.8" />
      </motion.g>
      <circle cx="14" cy="21.8" r="0.7" fill="#ffffff" />
      <circle cx="24" cy="21.8" r="0.7" fill="#ffffff" />
    </svg>
  )
}

// ── Easter eggs ─────────────────────────────────────────────────────────────
// A few painted eggs resting on the top edge of some tiles, as if hidden
// around the page. Which tiles, where along the edge, the tilt and the colour
// all come from the game key (see easterEggFor), so the eggs are in the same
// spots on every visit. They pop in one by one shortly after the page opens.

// Pastel shell + darker band, readable on both the SkyWatch blue and the Real
// CBAT navy.
const EGG_COLOURS = [
  { shell: '#f9a8d4', band: '#db2777', dots: '#fdf2f8' },
  { shell: '#fde68a', band: '#d97706', dots: '#fffbeb' },
  { shell: '#a7f3d0', band: '#059669', dots: '#ecfdf5' },
  { shell: '#c4b5fd', band: '#7c3aed', dots: '#f5f3ff' },
  { shell: '#93c5fd', band: '#2563eb', dots: '#eff6ff' },
]

function EasterEggs({ containerRef }) {
  const eggs = useCardBoxes(containerRef)
    .map(b => ({ ...b, egg: easterEggFor(b.key) }))
    .filter(b => b.egg)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="cbat-holiday-eggs"
    >
      {eggs.map((b, i) => {
        // The biggest egg: ~11px tall on the phone tile, up to 22px on the
        // desktop card. The rest of a group are scaled down from it.
        const base = Math.max(11, Math.min(22, b.width * 0.075))
        const sizes = b.egg.eggs.map(e => ({ h: base * e.scale, w: base * e.scale * 0.78 }))
        // Eggs in a group overlap by about a third, so they read as a heap.
        const step = (k) => sizes[k].w * 0.68
        const groupW = sizes.reduce((sum, s, k) => sum + (k < sizes.length - 1 ? step(k) : s.w), 0)
        // Somewhere along the edge, kept clear of the rounded corners.
        let x = b.left + 8 + b.egg.along * Math.max(0, b.width - 16 - groupW)
        return (
          <div key={b.key} data-easter-egg={b.key} data-egg-count={b.egg.eggs.length}>
            {b.egg.eggs.map((egg, j) => {
              const { h, w } = sizes[j]
              const left = x
              x += step(j)
              return (
                <motion.svg
                  key={j}
                  viewBox="0 0 20 26"
                  className="absolute"
                  style={{
                    left,
                    // Rests on the edge, sunk a little so it sits rather than floats.
                    top: b.top - h + 1.5,
                    width: w,
                    height: h,
                    // Smaller eggs in front of the big one they lean on.
                    zIndex: Math.round((1 - egg.scale) * 10),
                    transformOrigin: '50% 100%',
                    rotate: egg.tilt,
                    filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.4))',
                  }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.8 + i * 0.35 + j * 0.12, type: 'spring', stiffness: 260, damping: 12 }}
                >
                  <EggShell colour={EGG_COLOURS[egg.colour % EGG_COLOURS.length]} pattern={egg.pattern} />
                </motion.svg>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// One painted egg in a 20x26 box. Patterns: 0 wavy band with dots, 1 zigzag
// stripe, 2 spots all over.
function EggShell({ colour, pattern }) {
  return (
    <>
      <path d="M10,1 C15,1 19,9 19,16 C19,22 15,25 10,25 C5,25 1,22 1,16 C1,9 5,1 10,1 Z" fill={colour.shell} />
      {pattern === 0 && (
        <>
          <path d="M1.6,13 Q5.5,11 10,13 Q14.5,15 18.4,13 L18.9,16.5 Q14.5,18.5 10,16.5 Q5.5,14.5 1.1,16.5 Z" fill={colour.band} />
          <circle cx="6" cy="8" r="1.3" fill={colour.dots} />
          <circle cx="13" cy="7" r="1.1" fill={colour.dots} />
          <circle cx="7" cy="21" r="1.2" fill={colour.dots} />
          <circle cx="14" cy="20.5" r="1.3" fill={colour.dots} />
        </>
      )}
      {pattern === 1 && (
        <>
          <path d="M1.8,12 L4.5,15 L7.3,12 L10,15 L12.7,12 L15.5,15 L18.2,12" fill="none" stroke={colour.band} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M1.4,18.5 L18.6,18.5" stroke={colour.dots} strokeWidth="1.4" />
          <path d="M4,7.5 L16,7.5" stroke={colour.dots} strokeWidth="1.2" />
        </>
      )}
      {pattern === 2 && (
        <>
          <circle cx="7" cy="7" r="1.5" fill={colour.band} />
          <circle cx="13.5" cy="9.5" r="1.7" fill={colour.band} />
          <circle cx="5" cy="14" r="1.6" fill={colour.band} />
          <circle cx="11" cy="15.5" r="1.4" fill={colour.dots} />
          <circle cx="15.5" cy="18" r="1.5" fill={colour.band} />
          <circle cx="8" cy="21" r="1.7" fill={colour.band} />
        </>
      )}
      {/* a soft highlight so the shell reads as round */}
      <ellipse cx="7" cy="9" rx="1.6" ry="3" transform="rotate(20 7 9)" fill="#ffffff" opacity="0.35" />
    </>
  )
}

// ── Easter bunny ────────────────────────────────────────────────────────────
// Every so often a bunny hops right across the grid along the top of a row of
// tiles, then is gone until next time, alternating direction. Its own clipped
// layer, so it appears from and disappears into the side of the game column
// rather than the page margin.
const BUNNY_FIRST_MS   = 3000
const BUNNY_GAP_MS     = [18000, 32000]   // quiet time between visits
const BUNNY_SPEED_PX_S = 110

function EasterBunny({ containerRef }) {
  const boxes = useCardBoxes(containerRef)
  const [run, setRun] = useState(null)   // { id, dir, width, finished? }
  const timer = useRef(null)

  const schedule = useCallback((ms) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      // The width is read here, when the hop starts, not during render.
      const width = containerRef?.current?.offsetWidth ?? 0
      setRun(prev => ({ id: (prev?.id ?? 0) + 1, dir: prev?.dir === 1 ? -1 : 1, width }))
    }, ms)
  }, [containerRef])

  useEffect(() => {
    schedule(BUNNY_FIRST_MS)
    return () => clearTimeout(timer.current)
  }, [schedule])

  const done = () => {
    setRun(prev => (prev ? { ...prev, finished: true } : prev))
    schedule(BUNNY_GAP_MS[0] + Math.random() * (BUNNY_GAP_MS[1] - BUNNY_GAP_MS[0]))
  }

  const width = run?.width ?? 0
  const size  = Math.max(20, Math.min(34, (boxes[0]?.width ?? 120) * 0.11))
  // Rows with room above them for the bunny. Picked from the run id, so a
  // re-render never moves it to another row mid-hop.
  const rows   = [...new Set(boxes.map(b => b.top))].filter(t => t >= size).sort((a, b) => a - b)
  const rowTop = rows.length ? rows[((run?.id ?? 0) * 7) % rows.length] : null
  const active = Boolean(run && !run.finished && rowTop != null && width > 0)

  // A visit that could not start (nothing measured yet, or the grid is hidden)
  // never fires onAnimationComplete, so book the next one here instead of
  // leaving the bunny gone for good.
  const stalled = Boolean(run && !run.finished && !active)
  useEffect(() => {
    if (stalled) schedule(BUNNY_FIRST_MS)
  }, [stalled, run?.id, schedule])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-testid="cbat-holiday-bunny-layer"
    >
      {active && (
        <motion.div
          key={run.id}
          data-easter-bunny={run.dir === 1 ? 'right' : 'left'}
          className="absolute left-0"
          style={{ top: rowTop - size, width: size, height: size }}
          initial={{ x: run.dir === 1 ? -size - 4 : width + 4 }}
          animate={{ x: run.dir === 1 ? width + 4 : -size - 4 }}
          transition={{ duration: (width + size) / BUNNY_SPEED_PX_S, ease: 'linear' }}
          onAnimationComplete={done}
        >
          <motion.div
            style={{ width: size, height: size, scaleX: run.dir }}
            animate={{ y: [0, -size * 0.6, 0] }}
            transition={{ duration: 0.5, repeat: Infinity, ease: ['easeOut', 'easeIn'] }}
          >
            <EasterBunnySvg />
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}
