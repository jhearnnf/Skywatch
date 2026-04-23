import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useAnimationControls } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import { useNewCategoryUnlock } from '../context/NewCategoryUnlockContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import FlyingNewBadge from '../components/FlyingNewBadge'
import { MOCK_RANKS, CATEGORY_ICONS, CATEGORY_DESCRIPTIONS } from '../data/mockData'
import { pathwayTierRequired, getAccessibleCategories } from '../utils/subscription'
import { getLevelInfo } from '../utils/levelUtils'
import SEO from '../components/SEO'

// ── Constants ─────────────────────────────────────────────────────────────────

const PATHWAY_COLORS = {
  News:        { stone: '#a16207', glow: 'rgba(161,98,7,0.4)',    ring: '#eab308', bg: '#422006' },
  Bases:       { stone: '#2563eb', glow: 'rgba(37,99,235,0.4)',   ring: '#3b82f6', bg: '#1e3a8a' },
  Aircrafts:   { stone: '#7c8ba2', glow: 'rgba(176,189,207,0.42)', ring: '#b4c0d1', bg: '#1e293b' },
  Ranks:       { stone: '#d97706', glow: 'rgba(217,119,6,0.4)',   ring: '#f59e0b', bg: '#451a03' },
  Squadrons:   { stone: '#7c3aed', glow: 'rgba(124,58,237,0.4)',  ring: '#8b5cf6', bg: '#3b0764' },
  Training:    { stone: '#059669', glow: 'rgba(5,150,105,0.4)',   ring: '#10b981', bg: '#022c22' },
  Roles:       { stone: '#ea580c', glow: 'rgba(234,88,12,0.4)',   ring: '#f97316', bg: '#431407' },
  Threats:     { stone: '#dc2626', glow: 'rgba(220,38,38,0.4)',   ring: '#ef4444', bg: '#450a0a' },
  Missions:    { stone: '#0891b2', glow: 'rgba(8,145,178,0.4)',   ring: '#22d3ee', bg: '#0c4a6e' },
  Terminology: { stone: '#4f46e5', glow: 'rgba(79,70,229,0.4)',   ring: '#6366f1', bg: '#1e1b4b' },
  Heritage:    { stone: '#b45309', glow: 'rgba(180,83,9,0.4)',    ring: '#d97706', bg: '#431a00' },
  Allies:      { stone: '#16a34a', glow: 'rgba(22,163,74,0.4)',   ring: '#22c55e', bg: '#052e16' },
  AOR:         { stone: '#0d9488', glow: 'rgba(13,148,136,0.4)',  ring: '#14b8a6', bg: '#042f2e' },
  Tech:        { stone: '#0284c7', glow: 'rgba(2,132,199,0.4)',   ring: '#38bdf8', bg: '#082f49' },
  Treaties:    { stone: '#db2777', glow: 'rgba(219,39,119,0.4)',  ring: '#f472b6', bg: '#500724' },
  Actors:      { stone: '#9333ea', glow: 'rgba(147,51,234,0.4)',  ring: '#a855f7', bg: '#3b0764' },
}
const DEFAULT_COLORS = { stone: '#334155', glow: 'rgba(51,65,85,0.4)', ring: '#475569', bg: '#1e293b' }

const DEFAULT_PATHWAY_UNLOCKS = [
  { category: 'News',        levelRequired: 1, rankRequired: 1 },
  { category: 'Bases',       levelRequired: 1, rankRequired: 1 },
  { category: 'Terminology', levelRequired: 1, rankRequired: 1 },
  { category: 'Aircrafts',   levelRequired: 2, rankRequired: 1 },
  { category: 'Heritage',    levelRequired: 2, rankRequired: 1 },
  { category: 'Ranks',       levelRequired: 2, rankRequired: 1 },
  { category: 'Squadrons',   levelRequired: 3, rankRequired: 2 },
  { category: 'Allies',      levelRequired: 3, rankRequired: 2 },
  { category: 'Training',    levelRequired: 4, rankRequired: 2 },
  { category: 'AOR',         levelRequired: 4, rankRequired: 2 },
  { category: 'Roles',       levelRequired: 5, rankRequired: 3 },
  { category: 'Actors',      levelRequired: 5, rankRequired: 3 },
  { category: 'Tech',        levelRequired: 5, rankRequired: 3 },
  { category: 'Threats',     levelRequired: 6, rankRequired: 3 },
  { category: 'Missions',    levelRequired: 7, rankRequired: 4 },
  { category: 'Treaties',    levelRequired: 8, rankRequired: 4 },
]

// Zigzag horizontal offsets (px), cycling every 4 stones
const ZIGZAG = [-56, -16, 24, -16]

// ── Helpers ───────────────────────────────────────────────────────────────────


function tierRank(tier) {
  return { free: 0, trial: 1, silver: 1, gold: 2 }[tier] ?? 0
}

function isPathwayUnlocked(unlock, userLevel, userRankNumber, userTier) {
  const levelRequired = unlock.levelRequired ?? 1
  const rankRequired  = unlock.rankRequired  ?? 1
  const pathwayMet    = userRankNumber > rankRequired || (userRankNumber >= rankRequired && userLevel >= levelRequired)
  return pathwayMet && tierRank(userTier) >= tierRank(unlock.tierRequired ?? 'free')
}

function getRankName(rankNumber) {
  return MOCK_RANKS.find(r => r.rankNumber === rankNumber)?.rankName ?? `Rank ${rankNumber}`
}

// ── AptitudeSync badge ────────────────────────────────────────────────────────

const SYNC_GLITCH_CHARS = '!@/\\|<>{}01*%$-~^?#=_'
const SYNC_BASE_TEXT    = 'aptitude_sync'

const CARD_LINE1 = '> APTITUDE_SYNC — face the debriefer'
const CARD_LINE2 = 'live interrogation · prove what you know'

function SyncHoverCard() {
  const [line1, setLine1]       = useState('')
  const [line2, setLine2]       = useState('')
  const [cursor, setCursor]     = useState(true)
  const cardRef                 = useRef(null)

  // Typewriter
  useEffect(() => {
    let cancelled = false
    let i = 0
    const typeL1 = () => {
      if (cancelled) return
      if (i < CARD_LINE1.length) {
        setLine1(CARD_LINE1.slice(0, i + 1))
        i++
        setTimeout(typeL1, 12)
      } else {
        setTimeout(() => {
          let j = 0
          const typeL2 = () => {
            if (cancelled) return
            if (j < CARD_LINE2.length) {
              setLine2(CARD_LINE2.slice(0, j + 1))
              j++
              setTimeout(typeL2, 16)
            }
          }
          typeL2()
        }, 80)
      }
    }
    typeL1()
    return () => { cancelled = true }
  }, [])

  // Blinking cursor
  useEffect(() => {
    const id = setInterval(() => setCursor(c => !c), 530)
    return () => clearInterval(id)
  }, [])

  // Edge detection: flip to right-anchor if card overflows viewport
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) {
      el.style.left  = 'auto'
      el.style.right = '0'
    }
  }, [])

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: -4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      exit={{    opacity: 0, y: -4, scale: 0.96 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      style={{
        position:      'absolute',
        top:           'calc(100% + 6px)',
        left:          0,
        minWidth:      180,
        maxWidth:      220,
        zIndex:        50,
        fontFamily:    "'Courier New', Courier, monospace",
        fontSize:      '9px',
        lineHeight:    1.65,
        background:    '#030d18',
        border:        '1px solid #1a4060',
        borderLeft:    '2px solid #2d8ad4',
        borderRadius:  '4px',
        padding:       '5px 8px',
        boxShadow:     '0 4px 18px rgba(0,20,50,0.8), inset 0 0 8px #040f1e',
        pointerEvents: 'none',
        whiteSpace:    'pre-wrap',
        wordBreak:     'break-word',
      }}
    >
      <span style={{ color: '#7dd4fc', display: 'block' }}>{line1}</span>
      <span style={{ color: '#2d6a9a', display: 'block' }}>{line2}{line2.length === CARD_LINE2.length && cursor && <span style={{ color: '#4ab0f5', marginLeft: 1 }}>█</span>}</span>
    </motion.div>
  )
}

function SyncBadge({ onClick, isCardOpen, onCardOpen, onCardClose, index = 0 }) {
  const [label, setLabel]         = useState(SYNC_BASE_TEXT)
  const [scanline, setScanline]   = useState(0) // 0 = off, 0–1 = intensity
  const [touchPhase, setTouchPhase]   = useState('idle')
  const dismissTimer       = useRef(null)
  const touchJustOpenedRef = useRef(false)
  const isTouchRef   = useRef(
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  )

  // Glitch effect — staggered by index so multiple badges don't all fire at once
  useEffect(() => {
    let tid
    const fire = () => {
      const corruptions = 1 + (Math.random() < 0.3 ? 1 : 0)
      let chars = SYNC_BASE_TEXT.split('')
      for (let c = 0; c < corruptions; c++) {
        const idx = Math.floor(Math.random() * SYNC_BASE_TEXT.length)
        chars[idx] = SYNC_GLITCH_CHARS[Math.floor(Math.random() * SYNC_GLITCH_CHARS.length)]
      }
      const intensity = 0.15 + Math.random() * 0.85  // 0.15 (faint) → 1.0 (full)
      setLabel(chars.join(''))
      setScanline(intensity)
      setTimeout(() => { setLabel(SYNC_BASE_TEXT); setScanline(0) }, 55 + Math.random() * 90)
      tid = setTimeout(fire, 4000 + Math.random() * 5000)
    }
    // Spread initial fires across a 4 s window based on position in the list
    tid = setTimeout(fire, 800 + (index % 6) * 650 + Math.random() * 600)
    return () => clearTimeout(tid)
  }, [index])

  // Dismiss timer cleanup
  useEffect(() => () => clearTimeout(dismissTimer.current), [])

  const handleMouseEnter = () => { if (!isTouchRef.current) onCardOpen() }
  const handleMouseLeave = () => { if (!isTouchRef.current) onCardClose() }

  const handleTouchStart = (e) => {
    if (!isTouchRef.current) return
    if (touchPhase === 'idle') {
      touchJustOpenedRef.current = true
      onCardOpen()
      setTouchPhase('card-shown')
      clearTimeout(dismissTimer.current)
      dismissTimer.current = setTimeout(() => {
        onCardClose()
        setTouchPhase('idle')
      }, 2500)
    }
  }

  const handleClick = (e) => {
    e.stopPropagation()
    if (isTouchRef.current) {
      // React passive touch listeners mean e.preventDefault() can't suppress the
      // synthesised click. Guard against the click that fires right after the
      // touchstart that opened the card.
      if (touchJustOpenedRef.current) {
        touchJustOpenedRef.current = false
        return
      }
      if (touchPhase === 'card-shown') {
        clearTimeout(dismissTimer.current)
        onCardClose()
        setTouchPhase('idle')
        onClick()
      }
    } else {
      onClick()
    }
  }

  const cornerStyle = (pos) => ({
    position:  'absolute',
    width:     5,
    height:    5,
    ...(pos.includes('top')    ? { top: 1 }    : { bottom: 1 }),
    ...(pos.includes('left')   ? { left: 1 }   : { right: 1 }),
    borderTop:    pos.includes('top')    ? '1px solid #2a6090' : undefined,
    borderBottom: pos.includes('bottom') ? '1px solid #2a6090' : undefined,
    borderLeft:   pos.includes('left')   ? '1px solid #2a6090' : undefined,
    borderRight:  pos.includes('right')  ? '1px solid #2a6090' : undefined,
    pointerEvents: 'none',
    transition:  'border-color 0.15s',
  })

  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <motion.button
        initial={{ opacity: 0, x: -8, scale: 0.92 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onClick={handleClick}
        style={{
          fontFamily:    "'Courier New', Courier, monospace",
          fontSize:      '9px',
          fontWeight:    700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding:       '3px 7px',
          borderRadius:  '4px',
          background:    scanline ? `rgba(10,30,48,${0.4 + scanline * 0.6})` : '#030d18',
          border:        '1px solid #1a4060',
          borderLeft:    '2px solid #2d8ad4',
          color:         scanline
            ? `rgba(${Math.round(32 + scanline * 42)},${Math.round(102 + scanline * 68)},${Math.round(160 + scanline * 85)},1)`
            : '#2066a0',
          cursor:        'pointer',
          whiteSpace:    'nowrap',
          lineHeight:    1.5,
          flexShrink:    0,
          transition:    'color 0.15s, border-color 0.15s, background 0.15s, text-shadow 0.15s, box-shadow 0.15s',
          textShadow:    scanline && scanline > 0.5 ? `0 0 ${Math.round(scanline * 6)}px rgba(45,138,212,${scanline * 0.7})` : 'none',
          boxShadow:     scanline
            ? `inset 0 0 ${Math.round(4 + scanline * 6)}px rgba(13,45,74,${scanline}), 0 0 ${Math.round(scanline * 5)}px rgba(26,74,112,${scanline * 0.6})`
            : 'inset 0 0 4px #060f1a',
          position:      'relative',
          overflow:      'visible',
        }}
        whileHover={{
          color:           '#7dd4fc',
          borderColor:     '#2d8ad4',
          borderLeftColor: '#7dd4fc',
          textShadow:      '0 0 8px #2d8ad4, 0 0 2px #7dd4fc',
          boxShadow:       'inset 0 0 10px #0d2d4a, 0 0 8px #1a4a7066',
          background:      '#071525',
        }}
      >
        <span style={cornerStyle('top-left')} />
        <span style={cornerStyle('top-right')} />
        <span style={cornerStyle('bottom-left')} />
        <span style={cornerStyle('bottom-right')} />
        {label}
      </motion.button>

      <AnimatePresence>
        {isCardOpen && <SyncHoverCard />}
      </AnimatePresence>
    </div>
  )
}

// ── Next-brief image preview (cycling, CRT-tinted) ────────────────────────────

// Downscale Cloudinary-hosted image URLs so `image-rendering: pixelated`
// stays chunky when scaled up. Mirrors the helper in AptitudeSync.jsx.
function lowResUrl(url) {
  if (!url || typeof url !== 'string')             return url
  if (!/\/image\/upload\//.test(url))              return url
  if (/\/image\/upload\/[^/]*w_\d+/.test(url))     return url
  return url.replace('/image/upload/', '/image/upload/w_320,q_55,f_auto/')
}

// Preview width; height matches the stone it sits next to (passed in as prop)
// so the frame sits neatly in the same row as the stone.
const PREVIEW_W   = 255
// Horizontal gap between the stone and the preview. Needs to clear the stone's
// title label, which extends ~20px beyond each side of the stone.
const PREVIEW_GAP = 20

// Frayed-edge mask: the full rect is shown, with soft "bite" radial gradients
// eating into the left and right edges at irregular points. At stone height
// the frame is a wide strip, so top/bottom frays would be meaningless.
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

// Viewport-aligned replica of the body::before grid (see main.css:124).
// `background-attachment: fixed` ties the pattern origin to the viewport so
// these lines land on the same 48px lattice as the page's grid — making the
// image read as if it's sitting *under* the background grid.
const PAGE_GRID_OVERLAY = {
  backgroundImage: `
    linear-gradient(rgba(91,170,255,0.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(91,170,255,0.022) 1px, transparent 1px)
  `,
  backgroundSize:       '48px 48px',
  backgroundAttachment: 'fixed',
}

// Opacity applied to the image content so the page bg bleeds through.
const PREVIEW_IMAGE_OPACITY = 0.45

// Minimum wrapper width; guards against the viewport-fraction formula producing
// something too small to read on tiny screens.
const PREVIEW_MIN_W = 120

// Derives a consistent wrapper width from the viewport. All previews on the
// same device land on the same value, so the cropped edge looks uniform
// regardless of which ZIGZAG offset the "next" stone happens to sit at.
function computeWrapperWidth(vw) {
  // ~45% of viewport, minus a small allowance for the stone + gap, capped at
  // PREVIEW_W and floored at PREVIEW_MIN_W.
  const raw = vw * 0.45 - 30
  return Math.max(PREVIEW_MIN_W, Math.min(PREVIEW_W, raw))
}

// Minimum time the skeleton must show before the tune-in fade can start.
// Also the *max* — if the first image is slower than this to load, the fade
// starts as soon as it's ready (no additional delay stacked on top).
const PREVIEW_MIN_DELAY_MS = 1100

function BriefImagePreview({ images, side, accent, onTap, height }) {
  const [idx, setIdx] = useState(0)
  // Shared wrapper width derived from viewport width only. Consistent across
  // every preview on the same device — image is always cropped by the same
  // amount, regardless of which stone the preview sits next to.
  const [wrapperW, setWrapperW] = useState(() =>
    typeof window !== 'undefined' ? computeWrapperWidth(window.innerWidth) : PREVIEW_W
  )
  // Two gates that must both be true before the tune-in animation fires:
  //   1. MIN_DELAY has elapsed since mount (skeleton must hold at least this long)
  //   2. The first image has loaded (or errored) so there's actually something
  //      to reveal when the fade starts.
  const [minDelayElapsed, setMinDelayElapsed] = useState(false)
  const [firstImageReady, setFirstImageReady] = useState(false)
  const canReveal = minDelayElapsed && firstImageReady

  useEffect(() => {
    if (images.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 3500)
    return () => clearInterval(t)
  }, [images])

  useEffect(() => {
    const onResize = () => setWrapperW(computeWrapperWidth(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setMinDelayElapsed(true), PREVIEW_MIN_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  const handleFirstImageReady = () => setFirstImageReady(true)

  // Fray mask scales with the *visible* frame (wrapperW) so the frays land on
  // the currently-visible edges, including the cropped one.
  const frayMask = useMemo(() => buildFrayMask(wrapperW || PREVIEW_W, height), [wrapperW, height])

  // side='left' → image sits to the LEFT of the parent → anchor its right edge
  // beyond the parent's left edge. side='right' is the mirror image.
  const positionStyle = side === 'left'
    ? { right: `calc(100% + ${PREVIEW_GAP}px)` }
    : { left:  `calc(100% + ${PREVIEW_GAP}px)` }

  // Image layer is horizontally centred within the wrapper so any crop
  // (PREVIEW_W − wrapperW) is split evenly between the left and right edges
  // of the image rather than landing only on one side.
  const imageLayerStyle = {
    left:      '50%',
    marginLeft: -PREVIEW_W / 2,
  }

  // Outer wrapper owns vertical centring on the stone (translateY(-50%)) so
  // framer's animated transform on the inner button can't clobber it.
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        top:       '50%',
        transform: 'translateY(-50%)',
        ...positionStyle,
        width:     wrapperW,
        height,
      }}
    >
      {/* Skeleton placeholder — see-through dark card shown immediately so
          the image appears to tune in within a loading frame. */}
      <motion.div
        className="pointer-events-none absolute inset-0"
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

      <motion.button
        type="button"
        onClick={onTap}
        initial={{ opacity: 0, x: 0 }}
        animate={canReveal
          ? {
              opacity: [0, 0.15, 0.3, 0.28, 0.5, 0.7, 0.82, 1],
              x:       [0, 0, 0, -1, 0, 0, 0, 0],
            }
          : { opacity: 0, x: 0 }}
        transition={canReveal
          ? {
              duration: 2.8,
              times:    [0, 0.12, 0.28, 0.36, 0.5, 0.68, 0.85, 1],
              ease:     'linear',
            }
          : undefined}
        aria-label="Preview next intel brief"
        className="pointer-events-auto absolute inset-0 overflow-hidden"
        style={{
          border:           'none',
          background:       'transparent',
          boxShadow:        `0 0 24px ${accent}14`,
          cursor:           'pointer',
          maskImage:        frayMask,
          WebkitMaskImage:  frayMask,
          maskSize:         '100% 100%',
          WebkitMaskSize:   '100% 100%',
          maskRepeat:       'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        }}
      >
        {/* Crossfading image stack — the inner layer is fixed at PREVIEW_W and
            anchored on the stone side, so when the outer wrapper is cropped
            (viewport edge) the image stays at full scale and only its outer
            edge is clipped by the button's overflow:hidden. */}
        <div
          className="absolute top-0 motion-reduce:!animate-none"
          style={{
            ...imageLayerStyle,
            width:     PREVIEW_W,
            height:    '100%',
            animation: 'lp-preview-flicker 2.3s ease-in-out infinite',
          }}
        >
          {images.map((url, i) => (
            <img
              key={url + i}
              src={lowResUrl(url)}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              onLoad={i === 0 ? handleFirstImageReady : undefined}
              onError={i === 0 ? handleFirstImageReady : undefined}
              style={{
                position:       'absolute',
                inset:          0,
                width:          '100%',
                height:         '100%',
                objectFit:      'cover',
                objectPosition: 'center',
                filter:         'contrast(1.05) saturate(0.75) hue-rotate(190deg) brightness(0.85)',
                opacity:        i === idx ? PREVIEW_IMAGE_OPACITY : 0,
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

        {/* Page-grid replica — viewport-fixed so lines align with body::before,
            making the image read as if the grid is passing *over* it. */}
        <div className="absolute inset-0 pointer-events-none" style={PAGE_GRID_OVERLAY} />
      </motion.button>

      {/* Top-left transmission pip — sits outside the motion.button so it
          stays visible through the skeleton/tune-in phase. */}
      <span
        className="pointer-events-none absolute"
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

// ── Stone component ───────────────────────────────────────────────────────────

function formatEventDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Stone({ brief, state, colors, milestone, onTap, onSyncTap, quizPassed, aptitudeSyncEnabled, index, openSyncId, onCardOpen, onCardClose, nextBriefImages, revealedStubId, onStubReveal, hoveredStubId, onStubHover, prevStubExpanded }) {
  const size         = milestone ? 72 : 60
  const isNext       = state === 'next'
  const isRead       = state === 'read'
  const isInProgress = state === 'inprogress'
  const isLocked     = state.startsWith('locked')
  const isStub       = state === 'stub'
  const isHistoric   = !!brief.historic && !isLocked && !isStub
  const hovered      = hoveredStubId === brief._id
  const [inView,   setInView]   = useState(false)
  const containerRef = useRef(null)
  const isTouchRef = useRef(false)

  // Touch-device tap-to-reveal: on stubs, the first tap reveals the title
  // (mirroring desktop hover) and the second tap opens the brief. Parent
  // tracks which stub is revealed so a tap on another stub resets this one.
  const touchRevealed = revealedStubId === brief._id

  // Intersection observer — marks stone as in-view once it enters the viewport
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true) },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const handlePointerDown = (e) => {
    isTouchRef.current = e.pointerType === 'touch'
  }

  const handleStoneClick = (e) => {
    if (isStub && isTouchRef.current && !touchRevealed) {
      // First tap on mobile: reveal title, don't open brief yet
      e.preventDefault()
      onStubReveal?.(brief._id)
      return
    }
    if (touchRevealed) onStubReveal?.(null)
    onTap()
  }

  const showSync = isRead && quizPassed && aptitudeSyncEnabled && inView

  // Amber historic tones — overlaid regardless of pathway colour
  const HISTORIC_BG     = '#1e1200'
  const HISTORIC_BORDER = '#7a5200'
  const HISTORIC_RING   = '#c8860a'
  const HISTORIC_GLOW   = 'rgba(180,110,10,0.35)'

  const xOffset = ZIGZAG[index % ZIGZAG.length]

  return (
    <motion.div
      ref={containerRef}
      data-brief-index={index}
      className="flex flex-col items-center"
      style={{ paddingLeft: `calc(50% + ${xOffset}px - ${size / 2}px)`, alignItems: 'flex-start' }}
    >
      {/* Connector dot strip above (except first) — per-dot marginTop grows/
          shrinks to mirror the sliding distance when the previous stub
          reveals/hides its title. */}
      {index > 0 && (
        <div
          className="flex flex-col items-center mb-1.5"
          style={{ marginLeft: size / 2 - 3 }}
        >
          {[0,1,2].map(i => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              animate={{ marginTop: i === 0 ? 0 : (prevStubExpanded ? 14 : 6) }}
              transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
              style={{
                background: isHistoric && isRead ? HISTORIC_BORDER
                  : isHistoric                   ? HISTORIC_BORDER + '88'
                  : isRead                       ? colors.stone
                  :                                '#243650',
                opacity: isRead ? 0.5 : 0.4,
              }}
            />
          ))}
        </div>
      )}

      {/* Stone circle + optional SYNC badge in a row */}
      <div className="relative flex items-center gap-2">

      {/* The stone */}
      <button
        onPointerDown={handlePointerDown}
        onClick={handleStoneClick}
        onMouseEnter={() => { if (isStub) onStubHover?.(brief._id) }}
        onMouseLeave={() => { if (isStub && hovered) onStubHover?.(null) }}
        className="relative flex items-center justify-center rounded-full transition-transform active:scale-95 select-none"
        style={{
          width:  size,
          height: size,
          background: (isLocked || isStub) ? '#172236'
            : isHistoric && isRead       ? HISTORIC_BG
            : isHistoric && isInProgress ? HISTORIC_BORDER + '44'
            : isHistoric                 ? HISTORIC_BORDER + 'bb'
            : isRead                     ? colors.bg
            : isInProgress               ? colors.stone + '44'
            :                              colors.stone,
          border: `2px solid ${
            (isLocked || isStub) ? '#243650'
            : isHistoric && isNext       ? HISTORIC_RING
            : isHistoric && isRead       ? HISTORIC_BORDER + '80'
            : isHistoric && isInProgress ? HISTORIC_BORDER + 'aa'
            : isHistoric                 ? HISTORIC_BORDER
            : isNext                     ? colors.ring
            : isRead                     ? colors.stone + '80'
            : isInProgress               ? colors.stone + 'aa'
            :                              colors.stone
          }`,
          boxShadow: isNext && isHistoric ? `0 0 0 6px ${HISTORIC_GLOW}, 0 0 20px ${HISTORIC_GLOW}`
            : isNext                      ? `0 0 0 6px ${colors.glow}, 0 0 20px ${colors.glow}`
            : isRead                      ? 'none'
            : (isLocked || isStub)        ? 'none'
            : isHistoric && isInProgress  ? `0 2px 8px ${HISTORIC_GLOW}`
            : isHistoric                  ? `0 2px 12px ${HISTORIC_GLOW}`
            : isInProgress                ? `0 2px 8px ${colors.glow}`
            :                               `0 2px 12px ${colors.glow}`,
        }}
      >
        {/* Pulsing ring for 'next' stone */}
        {isNext && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ border: `2px solid ${isHistoric ? HISTORIC_RING : colors.ring}` }}
            animate={{ scale: [1, 1.35, 1], opacity: [0.8, 0, 0.8] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        <span className="text-xl leading-none select-none" style={{ opacity: (isLocked || isStub) ? 0.5 : (isRead || isHistoric) ? 0.45 : isInProgress ? 0.75 : 1 }}>
          {isLocked ? '🔒' : isStub ? '📡' : CATEGORY_ICONS[brief.category] ?? '📄'}
        </span>

        {/* Diagonal "cleared" line for read stones */}
        {isRead && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
          >
            <line
              x1={size * 0.25}
              y1={size * 0.25}
              x2={size * 0.75}
              y2={size * 0.75}
              stroke={isHistoric ? HISTORIC_RING : colors.ring}
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.45"
            />
            <line
              x1={size * 0.75}
              y1={size * 0.25}
              x2={size * 0.25}
              y2={size * 0.75}
              stroke={isHistoric ? HISTORIC_RING : colors.ring}
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.45"
            />
          </svg>
        )}

        {/* Historic hourglass badge — unread */}
        {isHistoric && !isRead && !isInProgress && (
          <span
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{ background: HISTORIC_BG, color: HISTORIC_RING, border: `1px solid ${HISTORIC_BORDER}` }}
          >
            ⧗
          </span>
        )}

        {/* Read badge — rank pip (historic variant uses hourglass) */}
        {isRead && (
          <span
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{
              background: isHistoric ? HISTORIC_BG          : colors.stone + 'cc',
              color:      isHistoric ? HISTORIC_RING         : colors.ring,
              border:     `1px solid ${isHistoric ? HISTORIC_BORDER : colors.ring + '55'}`,
            }}
          >
            {isHistoric ? '⧗' : '★'}
          </span>
        )}

        {/* In-progress badge */}
        {isInProgress && (
          <span
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{
              background: isHistoric ? HISTORIC_BG           : colors.stone + 'cc',
              color:      isHistoric ? HISTORIC_RING         : '#fff',
              border:     `1px solid ${isHistoric ? HISTORIC_BORDER : colors.ring}`,
            }}
          >
            {isHistoric ? '⧗' : '●'}
          </span>
        )}
      </button>

      {/* AptitudeSync badge — glitches in when stone scrolls into view */}
      <AnimatePresence>
        {showSync && (
          <SyncBadge
            onClick={onSyncTap}
            isCardOpen={openSyncId === brief._id}
            onCardOpen={() => onCardOpen(brief._id)}
            onCardClose={onCardClose}
            index={index}
          />
        )}
      </AnimatePresence>

      {/* Next-to-read cycling image preview — shown on whichever stone is the
          parent-designated "next" (includes in-progress briefs). */}
      {nextBriefImages && nextBriefImages.length > 0 && (
        <BriefImagePreview
          images={nextBriefImages}
          side={xOffset >= 0 ? 'left' : 'right'}
          accent={isHistoric ? HISTORIC_RING : colors.ring}
          onTap={onTap}
          height={size}
        />
      )}

      </div>{/* end stone-row */}

      {/* Title label */}
      <p
        className="text-xs font-semibold mt-1.5 text-center leading-tight relative overflow-hidden"
        style={{
          color: (isLocked || isStub) ? '#3d5a7a'
            : isHistoric && isRead       ? '#6b5020'
            : isHistoric && isInProgress ? '#8a6828'
            : isHistoric && isNext       ? '#c8a050'
            : isHistoric                 ? '#7a6040'
            : isRead                     ? '#5a7a9a'
            : isNext                     ? '#ddeaf8'
            : isInProgress               ? '#a0c4e4'
            :                              '#8ba0c0',
          marginLeft: -(size / 2) + 6,
          width: size + 40,
          minHeight: '2.5em',
        }}
      >
        {isStub ? (
          <AnimatePresence mode="popLayout" initial={false}>
            {(hovered || touchRevealed) ? (
              <motion.span
                key="title"
                className="block"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                style={{ color: '#8ba0c0' }}
              >
                {brief.title}
              </motion.span>
            ) : (
              <motion.span
                key="collecting"
                className="block"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                Intel being collected
              </motion.span>
            )}
          </AnimatePresence>
        ) : (
          <span className="block">{brief.title}</span>
        )}
      </p>

      {/* Event date label — News pathway only */}
      {brief.category === 'News' && brief.eventDate && (
        <p
          className="text-[10px] mt-0.5 text-center leading-none"
          style={{
            color: (isLocked || isStub) ? '#2a4060' : isRead ? '#3d6080' : '#4a6a8a',
            marginLeft: -(size / 2) + 6,
            width: size + 40,
          }}
        >
          {formatEventDate(brief.eventDate)}
        </p>
      )}
    </motion.div>
  )
}

// ── Pathway header row ────────────────────────────────────────────────────────
// Renders the category title + long-form description as the first row of each
// pathway list, occupying the slot where a "zero-th" stepping stone would be.
// Sits inside the scrolling pathway content (not above the sticky card) so it
// scrolls out naturally with the rest of the stones — no fade/collapse needed.

function PathwayHeader({ category, colors }) {
  return (
    <div className="text-center pt-4 pb-7 px-4">
      <h1 className="text-2xl font-extrabold text-slate-900">
        Learn <span style={{ color: colors.ring }}>{category}</span>
      </h1>
      <p className="text-sm text-slate-500 mt-1.5 leading-snug">
        {CATEGORY_DESCRIPTIONS[category] ?? 'Complete the intel briefs to build RAF knowledge.'}
      </p>
    </div>
  )
}

// ── Pathway view (vertical list of stones for one category) ──────────────────

// Progressive render — long pathways (100+ stones) render in batches over idle
// frames instead of all at once. The initial batch always covers the auto-scroll
// target (next unread + buffer), so landing position is correct on first paint.
const INITIAL_RENDER_COUNT = 25
const RENDER_BATCH_SIZE    = 20

function PathwayView({ category, briefs, colors, pathwayUnlocked, lockReason, readSet, inProgressSet, quizPassedSet, aptitudeSyncEnabled, onStoneTap, onLockedTap, direction, nextBriefImages, nextBriefId }) {
  const navigate = useNavigate()
  const [openSyncId, setOpenSyncId] = useState(null)
  const [revealedStubId, setRevealedStubId] = useState(null)
  const [hoveredStubId, setHoveredStubId] = useState(null)
  const listRef = useRef(null)

  const [renderLimit, setRenderLimit] = useState(() => {
    const firstUnread = briefs.findIndex(b => !readSet.has(b._id) && b.status !== 'stub')
    return Math.max(INITIAL_RENDER_COUNT, firstUnread + 10)
  })

  useEffect(() => {
    if (renderLimit >= briefs.length) return
    const schedule = typeof window.requestIdleCallback === 'function'
      ? (cb) => window.requestIdleCallback(cb, { timeout: 200 })
      : (cb) => setTimeout(cb, 16)
    const cancel = typeof window.cancelIdleCallback === 'function'
      ? window.cancelIdleCallback
      : clearTimeout
    const id = schedule(() => {
      setRenderLimit(n => Math.min(briefs.length, n + RENDER_BATCH_SIZE))
    })
    return () => cancel(id)
  }, [renderLimit, briefs.length])

  // Scroll so the next-to-read brief sits just below the page header on arrival.
  // In-progress briefs count as "next"; read/stub briefs are scrolled past.
  // Fires exactly once per mount — PathwayView re-mounts on pathway swap via the
  // `key` in the parent, so this also covers category swaps. readSet/inProgressSet
  // are NOT deps (they are new refs every parent render); including them would make
  // the scroll re-fire and fight the user's own scrolling.
  const didAutoScrollRef = useRef(false)
  useLayoutEffect(() => {
    if (didAutoScrollRef.current) return
    if (!pathwayUnlocked || briefs.length === 0) return
    didAutoScrollRef.current = true
    const targetIdx = briefs.findIndex(b => !readSet.has(b._id) && b.status !== 'stub')
    if (targetIdx <= 0) {
      window.scrollTo(0, 0)
      return
    }
    const listEl = listRef.current
    if (!listEl) return
    const targetEl = listEl.querySelector(`[data-brief-index="${targetIdx}"]`)
    if (!targetEl) return
    const headerOffset = listEl.getBoundingClientRect().top + window.scrollY
    const targetTop = targetEl.getBoundingClientRect().top + window.scrollY
    window.scrollTo(0, Math.max(0, targetTop - headerOffset))
  }, [briefs, pathwayUnlocked]) // eslint-disable-line react-hooks/exhaustive-deps

  const variants = {
    enter:  (d) => ({ opacity: 0, x: d > 0 ? 80 : -80 }),
    center: { opacity: 1, x: 0 },
    exit:   (d) => ({ opacity: 0, x: d > 0 ? -80 : 80 }),
  }

  if (!pathwayUnlocked) {
    return (
      <motion.div
        key={category}
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <PathwayHeader category={category} colors={colors} />
        <div className="flex flex-col items-center justify-center py-12 text-center px-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl mb-4"
            style={{ background: '#172236', border: '2px solid #243650' }}
          >
            🔒
          </div>
          <p className="text-base font-bold text-slate-700 mb-1">{category} Pathway Locked</p>
          <p className="text-sm text-slate-500 mb-5">{lockReason}</p>
          <button
            onClick={onLockedTap}
            className="px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
            style={{ background: colors.stone + '22', color: colors.ring, border: `1px solid ${colors.stone}44` }}
          >
            How to Unlock
          </button>
        </div>
      </motion.div>
    )
  }

  if (briefs.length === 0) {
    return (
      <motion.div
        key={category}
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <PathwayHeader category={category} colors={colors} />
        <div className="flex flex-col items-center justify-center py-12 text-center px-6">
          <span className="text-4xl mb-4">{CATEGORY_ICONS[category] ?? '📄'}</span>
          <p className="text-base font-bold text-slate-700 mb-1">No pathway briefs yet</p>
          <p className="text-sm text-slate-500">{category === 'News' ? 'No news briefs available yet. Check back soon.' : `Priority numbers haven't been assigned to ${category} briefs yet. Check back soon.`}</p>
        </div>
      </motion.div>
    )
  }

  // Find the first unread brief index
  const firstUnreadIdx = briefs.findIndex(b => !readSet.has(b._id) && b.status !== 'stub')

  return (
    <motion.div
      ref={listRef}
      key={category}
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="pb-8"
    >
      <PathwayHeader category={category} colors={colors} />
      {briefs.slice(0, renderLimit).map((brief, i) => {
        const isStub       = brief.status === 'stub'
        const isRead       = !isStub && readSet.has(brief._id)
        const isInProgress = !isStub && !isRead && inProgressSet.has(brief._id)
        const isNext       = !isStub && !isRead && !isInProgress && i === firstUnreadIdx
        const state        = isStub ? 'stub' : isRead ? 'read' : isInProgress ? 'inprogress' : isNext ? 'next' : 'unread'
        const milestone = (i + 1) % 5 === 0
        const prevBrief = i > 0 ? briefs[i - 1] : null
        const prevStubExpanded = !!(prevBrief && prevBrief.status === 'stub'
          && (hoveredStubId === prevBrief._id || revealedStubId === prevBrief._id))

        return (
          <Stone
            key={brief._id}
            brief={brief}
            state={state}
            colors={colors}
            milestone={milestone}
            index={i}
            onTap={() => navigate(`/brief/${brief._id}`)}
            onSyncTap={() => navigate(`/aptitude-sync/${brief._id}`, { state: { briefTitle: brief.title, category: brief.category } })}
            quizPassed={quizPassedSet.has(brief._id)}
            aptitudeSyncEnabled={aptitudeSyncEnabled}
            openSyncId={openSyncId}
            onCardOpen={setOpenSyncId}
            onCardClose={() => setOpenSyncId(null)}
            nextBriefImages={i === firstUnreadIdx && String(brief._id) === String(nextBriefId) ? nextBriefImages : null}
            revealedStubId={revealedStubId}
            onStubReveal={setRevealedStubId}
            hoveredStubId={hoveredStubId}
            onStubHover={setHoveredStubId}
            prevStubExpanded={prevStubExpanded}
          />
        )
      })}
    </motion.div>
  )
}

// ── Upgrade / unlock info modal ───────────────────────────────────────────────

function UnlockInfoModal({ unlock, category, colors, userLevel, userRankNumber, userTier, onClose, onUpgrade }) {
  const rankRequired  = unlock?.rankRequired  ?? 1
  const levelRequired = unlock?.levelRequired ?? 1
  const rankOk        = userRankNumber >= rankRequired
  const rankSurpassed = userRankNumber > rankRequired
  const lvlOk         = rankSurpassed || userLevel >= levelRequired
  const tierOk        = tierRank(userTier) >= tierRank(unlock?.tierRequired ?? 'free')
  const needsTier     = unlock?.tierRequired !== 'free'

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <motion.div
        className="relative w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: '#0c1829', border: '1px solid #172236' }}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 260 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Color stripe */}
        <div className="h-1" style={{ background: colors.stone }} />

        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shrink-0"
              style={{ background: colors.stone + '22', border: `2px solid ${colors.stone}44` }}
            >
              {CATEGORY_ICONS[category] ?? '📄'}
            </div>
            <div>
              <p className="text-base font-extrabold text-slate-900">{category} Pathway</p>
              <p className="text-xs text-slate-500">Unlock requirements</p>
            </div>
          </div>

          <div className="space-y-2.5 mb-5">
            <RequirementRow
              label="Agent Level"
              value={`Level ${unlock?.levelRequired ?? 1}`}
              met={lvlOk}
              current={rankSurpassed ? 'Bypassed (rank surpassed)' : `You are Level ${userLevel}`}
            />
            <RequirementRow
              label="RAF Rank"
              value={getRankName(unlock?.rankRequired ?? 1)}
              met={rankOk}
              current={`You are ${getRankName(userRankNumber)}`}
            />
            {needsTier && (
              <RequirementRow
                label="Subscription"
                value={`${unlock.tierRequired.charAt(0).toUpperCase() + unlock.tierRequired.slice(1)} plan`}
                met={tierOk}
                current={tierOk ? 'You have access' : 'Upgrade required'}
              />
            )}
          </div>

          <div className="flex gap-3">
            {needsTier && !tierOk && (
              <button
                onClick={onUpgrade}
                className="flex-1 py-3 rounded-xl text-sm font-bold transition-colors"
                style={{ background: colors.stone, color: '#fff' }}
              >
                Upgrade Plan
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
            >
              {needsTier && !tierOk ? 'Maybe Later' : 'Got It'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function RequirementRow({ label, value, met, current }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-sm font-semibold text-slate-800">{value}</p>
      </div>
      <div className="text-right shrink-0">
        {met ? (
          <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">✓ Met</span>
        ) : (
          <span className="text-xs text-slate-400">{current}</span>
        )}
      </div>
    </div>
  )
}

// ── Pathway swipe inline hint ─────────────────────────────────────────────────

function PathwaySwipeHint({ onDismiss }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1100] flex items-center justify-center pointer-events-auto cursor-pointer"
      style={{ background: 'rgba(10,20,40,0.55)' }}
      onClick={onDismiss}
    >
      <div className="flex flex-col items-center gap-3 px-7 py-6 rounded-2xl select-none" style={{ background: 'rgba(6,16,30,0.85)', backdropFilter: 'blur(6px)' }}>
        <div className="flex items-center gap-4">
          <motion.span
            animate={{ x: [-6, 0, -6] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            className="text-3xl text-white/90"
          >←</motion.span>
          <motion.div
            animate={{ scaleX: [1, 1.08, 1] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            className="w-10 h-10 rounded-full border-2 border-white/60 flex items-center justify-center"
          >
            <span className="text-white/80 text-lg">☰</span>
          </motion.div>
          <motion.span
            animate={{ x: [6, 0, 6] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            className="text-3xl text-white/90"
          >→</motion.span>
        </div>
        <p className="text-white font-bold text-base tracking-wide">Swipe to change pathway</p>
        <p className="text-white/60 text-xs">tap anywhere to dismiss</p>
      </div>
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LearnPriority() {
  const { user, API, apiFetch } = useAuth()
  const navigate      = useNavigate()
  const location      = useLocation()
  const { start, visible, hasSeen } = useAppTutorial()

  const [levels,         setLevels]         = useState(null)
  const [pathwayUnlocks, setPathwayUnlocks] = useState(DEFAULT_PATHWAY_UNLOCKS)
  const [catSettings,    setCatSettings]    = useState(null) // { freeCategories, silverCategories }
  const [briefsCache,    setBriefsCache]    = useState({}) // { [category]: brief[] }
  const [nextBriefCache, setNextBriefCache] = useState({}) // { [category]: { id, images } }
  const [loading,        setLoading]        = useState(false)
  const [activeCatIndex, setActiveCatIndex] = useState(null)
  const [direction,      setDirection]      = useState(1)   // 1=forward, -1=backward
  const [unlockModal,    setUnlockModal]    = useState(null) // { unlock, category, colors }
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [aptSyncSettings, setAptSyncSettings] = useState({ enabled: false, tiers: ['admin'] })
  const [quizPassedSet,  setQuizPassedSet]  = useState(new Set())
  const dragX        = useMotionValue(0)
  const swipeControls = useAnimationControls()
  const [showSwipeHint, setShowSwipeHint] = useState(false)

  // ── New-category unlock animation state ───────────────────────────────────
  const { newCategories, markSeen: markCategorySeen } = useNewCategoryUnlock()
  const [unlockQueue,      setUnlockQueue]      = useState(null)   // null | string[] (category names in order)
  const [unlockCursor,     setUnlockCursor]     = useState(0)
  const [flyingBadge,      setFlyingBadge]      = useState(null)   // { category, from:{x,y}, to:{x,y} }
  const [landedCategories, setLandedCategories] = useState(() => new Set())
  const sequenceStartedRef = useRef(false)

  // ── Tutorial ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => start('learn-priority'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch settings (pathwayUnlocks + category tier lists) ─────────────────
  useEffect(() => {
    apiFetch(`${API}/api/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.pathwayUnlocks?.length) setPathwayUnlocks(d.pathwayUnlocks)
        if (d) setCatSettings({ freeCategories: d.freeCategories ?? [], silverCategories: d.silverCategories ?? [] })
        if (d) setAptSyncSettings({ enabled: d.aptitudeSyncEnabled ?? false, tiers: d.aptitudeSyncTiers ?? ['admin'] })
        setSettingsLoaded(true)
      })
      .catch(() => { setSettingsLoaded(true) })
  }, [API])

  // ── Fetch level thresholds ──────────────────────────────────────────────────
  useEffect(() => {
    apiFetch(`${API}/api/users/levels`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data?.levels?.length) setLevels(d.data.levels) })
      .catch(() => {})
  }, [API])

  // ── Fetch quiz-passed brief IDs (background, after page has loaded) ─────────
  useEffect(() => {
    if (!user) { setQuizPassedSet(new Set()); return }
    apiFetch(`${API}/api/games/quiz/completed-brief-ids`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.data?.ids) setQuizPassedSet(new Set(d.data.ids))
      })
      .catch(() => {})
  }, [user, API])

  // ── Check if this user can access AptitudeSync ──────────────────────────────
  const aptitudeSyncEnabled = useMemo(() => {
    if (!aptSyncSettings.enabled) return false
    if (!user) return false
    if (user.isAdmin) return true
    const tier      = user.subscriptionTier ?? 'free'
    const checkTier = tier === 'trial' ? 'silver' : tier
    return aptSyncSettings.tiers.includes(checkTier)
  }, [aptSyncSettings, user])

  // ── Compute user progression ────────────────────────────────────────────────
  const userTier        = user?.subscriptionTier ?? 'free'
  const lvlInfo         = getLevelInfo(user?.cycleAirstars ?? 0, levels)
  const userLevel       = lvlInfo?.level ?? 1
  const userRankObj     = user?.rank
  const userRankNumber  = userRankObj?.rankNumber ?? 1

  // ── Derive ordered pathway list ─────────────────────────────────────────────
  const TIER_ORDER = { free: 0, silver: 1, gold: 2 }
  const pathways = pathwayUnlocks
    .map(unlock => {
      const tierRequired = pathwayTierRequired(unlock.category, catSettings)
      return {
        ...unlock,
        tierRequired,
        colors:   PATHWAY_COLORS[unlock.category] ?? DEFAULT_COLORS,
        unlocked: isPathwayUnlocked({ ...unlock, tierRequired }, userLevel, userRankNumber, userTier),
      }
    })
    .sort((a, b) =>
      ((10 * a.rankRequired + a.levelRequired) - (10 * b.rankRequired + b.levelRequired)) ||
      ((TIER_ORDER[a.tierRequired] ?? 0) - (TIER_ORDER[b.tierRequired] ?? 0))
    )

  const unlockedCount = pathways.filter(p => p.unlocked).length

  // ── Jump to category passed via navigation state (e.g. back from BriefReader) ─
  // Fires once, after settings fetch settles, so pathways reflect server order.
  // Skipped if the unlock sequence has already taken over — it controls the index.
  useEffect(() => {
    if (!settingsLoaded) return
    if (sequenceStartedRef.current) return
    const cat = location.state?.category
    if (cat) {
      const idx = pathways.findIndex(p => p.category === cat)
      if (idx !== -1) setActiveCatIndex(idx)
      return
    }
    // Snap to the user's first accessible pathway (e.g. News for guests/free)
    const accessible = getAccessibleCategories(user, catSettings)
    if (accessible !== null && accessible.length > 0) {
      const idx = pathways.findIndex(p => accessible.includes(p.category))
      if (idx !== -1) { setActiveCatIndex(idx); return }
    }
    // Fallback: first unlocked pathway, or just 0
    const firstUnlocked = pathways.findIndex(p => p.unlocked)
    setActiveCatIndex(firstUnlocked !== -1 ? firstUnlocked : 0)
  }, [settingsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start the new-category unlock sequence (once per mount) ───────────────
  // After settings load and pathways are known, if there are any unseen category
  // unlocks, queue them in pathway order and swipe to the first one.
  useEffect(() => {
    if (!settingsLoaded) return
    if (sequenceStartedRef.current) return
    if (newCategories.size === 0) return
    if (pathways.length === 0) return
    const ordered = pathways
      .filter(p => newCategories.has(p.category))
      .map(p => p.category)
    if (ordered.length === 0) return
    sequenceStartedRef.current = true
    setUnlockQueue(ordered)
    setUnlockCursor(0)
    const firstIdx = pathways.findIndex(p => p.category === ordered[0])
    if (firstIdx !== -1) {
      setDirection(firstIdx > (activeCatIndex ?? 0) ? 1 : -1)
      setActiveCatIndex(firstIdx)
    }
  }, [settingsLoaded, pathways.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fly the next badge when the carousel lands on the queued category ─────
  useEffect(() => {
    if (!unlockQueue) return
    const targetCat = unlockQueue[unlockCursor]
    if (!targetCat) return
    if (pathways[activeCatIndex]?.category !== targetCat) return
    if (flyingBadge) return // already flying
    if (landedCategories.has(targetCat)) return // already landed
    const t = setTimeout(() => {
      const navEl  = document.querySelector('[data-nav="learn"]')
      const cardEl = document.querySelector(`[data-testid="category-card-${targetCat}"]`)
      if (!navEl || !cardEl) {
        handleBadgeArrived(targetCat)
        return
      }
      const navRect  = navEl.getBoundingClientRect()
      const cardRect = cardEl.getBoundingClientRect()
      // Measure the (invisible) target pill so the flying badge lands exactly
      // where the persistent pill will appear — avoids a visual snap on arrival.
      const pillEl   = document.querySelector(`[data-testid="new-pill-${targetCat}"]`)
      const pillRect = pillEl?.getBoundingClientRect()
      setFlyingBadge({
        category: targetCat,
        from: { x: navRect.left + navRect.width / 2 - 18, y: navRect.top },
        to:   pillRect
          ? { x: pillRect.left,      y: pillRect.top      }
          : { x: cardRect.right - 34, y: cardRect.top - 6 },
      })
    }, 250)
    return () => clearTimeout(t)
  }, [unlockQueue, unlockCursor, activeCatIndex, pathways, flyingBadge, landedCategories]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleBadgeArrived(category) {
    setFlyingBadge(null)
    setLandedCategories(prev => new Set([...prev, category]))
    markCategorySeen(category)
    setTimeout(() => {
      setUnlockCursor(cursor => {
        const next = cursor + 1
        if (!unlockQueue || next >= unlockQueue.length) {
          setUnlockQueue(null) // sequence complete — swipe unlocks
          return cursor
        }
        const nextCat = unlockQueue[next]
        const nextIdx = pathways.findIndex(p => p.category === nextCat)
        if (nextIdx !== -1) {
          setDirection(nextIdx > activeCatIndex ? 1 : -1)
          setActiveCatIndex(nextIdx)
        }
        return next
      })
    }, 1200)
  }

  // ── Show inline swipe hint after learn-priority tutorial is seen ───────────
  // Gates on `visible` (no modal open) + hasSeen('learn-priority') so the hint
  // never fights with the modal. hasSeen reads live from localStorage — next()
  // sets the key before returning null, so the very next render sees both
  // visible=false and hasSeen=true simultaneously.
  useEffect(() => {
    if (visible) return
    if (unlockQueue) return // don't fight with the unlock sequence
    if (pathways.length < 2) return
    if (!hasSeen('learn-priority')) return
    const uid = user?._id
    const key = uid ? `sw_tut_v2_${uid}_pathway_swipe` : 'sw_tut_v2_anon_pathway_swipe'
    if (localStorage.getItem(key)) return
    const t = setTimeout(() => setShowSwipeHint(true), 800)
    return () => clearTimeout(t)
  }, [visible, pathways.length, user?._id, unlockQueue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Oscillate the pathway content while the hint is visible — x-only (no rotate) so
  // the displacement stays constant regardless of how many stones are in the pathway.
  useEffect(() => {
    if (showSwipeHint) {
      const t = setTimeout(() => {
        swipeControls.start({
          x: [0, -28, 0, 28, 0],
          transition: { repeat: Infinity, duration: 2.4, ease: 'easeInOut' },
        })
      }, 600)
      return () => clearTimeout(t)
    } else {
      swipeControls.start({ x: 0, transition: { type: 'spring', stiffness: 350, damping: 28 } })
    }
  }, [showSwipeHint]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch briefs for the active pathway ────────────────────────────────────
  const activePathway = activeCatIndex != null ? pathways[activeCatIndex] : null

  useEffect(() => {
    if (!activePathway) return
    const cat = activePathway.category
    if (briefsCache[cat]) return // already loaded
    setLoading(true)
    apiFetch(`${API}/api/briefs/pathway/${encodeURIComponent(cat)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.data?.briefs) {
          setBriefsCache(prev => ({ ...prev, [cat]: d.data.briefs }))
          if (d.data.nextBrief) {
            setNextBriefCache(prev => ({ ...prev, [cat]: d.data.nextBrief }))
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activeCatIndex, activePathway?.category, API]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build read set ──────────────────────────────────────────────────────────
  const activeBriefs = briefsCache[activePathway?.category] ?? []
  const readSet = new Set(
    activeBriefs.filter(b => b.isRead).map(b => b._id)
  )
  const inProgressSet = new Set(
    activeBriefs.filter(b => b.isInProgress).map(b => b._id)
  )
  const readCount  = readSet.size
  const totalCount = activeBriefs.length

  // ── Swipe handler ───────────────────────────────────────────────────────────
  function markPathwaySwipeSeen() {
    const uid = user?._id
    const key = uid ? `sw_tut_v2_${uid}_pathway_swipe` : 'sw_tut_v2_anon_pathway_swipe'
    localStorage.setItem(key, '1')
  }

  function handleDragEnd(_, info) {
    if (unlockQueue) { dragX.set(0); return }

    const goNext = info.offset.x < -80 || info.velocity.x < -500
    const goPrev = info.offset.x > 80  || info.velocity.x > 500

    if (goNext && activeCatIndex < pathways.length - 1) {
      setDirection(1)
      setActiveCatIndex(i => i + 1)
    } else if (goPrev && activeCatIndex > 0) {
      setDirection(-1)
      setActiveCatIndex(i => i - 1)
    }
    dragX.set(0)

    if (showSwipeHint) {
      setShowSwipeHint(false)
      markPathwaySwipeSeen()
    }
  }

  function goToPathway(index) {
    if (unlockQueue) return
    if (index === activeCatIndex) return
    setDirection(index > activeCatIndex ? 1 : -1)
    setActiveCatIndex(index)
  }

  // ── Lock reason string ──────────────────────────────────────────────────────
  function getLockReason(unlock) {
    if (userRankNumber < (unlock.rankRequired ?? 1)) {
      return `Unlocks at ${getRankName(unlock.rankRequired)}`
    }
    const reasons = []
    if (userLevel < (unlock.levelRequired ?? 1)) reasons.push(`Reach Agent Level ${unlock.levelRequired}`)
    if (tierRank(userTier) < tierRank(unlock.tierRequired ?? 'free')) {
      const t = unlock.tierRequired
      reasons.push(`${t.charAt(0).toUpperCase() + t.slice(1)} subscription required`)
    }
    return reasons.join(' · ') || 'Keep levelling up'
  }

  if (!activePathway) return null

  return (
    <>
      <SEO title="Learn Priority" description="See your recommended learning path and priority briefs for RAF aptitude preparation." />
      <style>{`
        @keyframes lp-preview-flicker {
          0%, 100% { opacity: 0.92; }
          42%      { opacity: 0.92; }
          44%      { opacity: 0.62; }
          46%      { opacity: 0.92; }
          78%      { opacity: 0.92; }
          80%      { opacity: 0.72; }
          82%      { opacity: 0.92; }
        }
        @keyframes lp-preview-dot {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%      { opacity: 0.3; transform: scale(0.85); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes lp-preview-flicker { 0%,100% { opacity: 0.92; } }
          @keyframes lp-preview-dot     { 0%,100% { opacity: 1; transform: none; } }
        }
      `}</style>
      <TutorialModal />

      {/* Flying "NEW" badge — nav Learn button → category header card */}
      <AnimatePresence>
        {flyingBadge && (
          <FlyingNewBadge
            key={flyingBadge.category}
            from={flyingBadge.from}
            to={flyingBadge.to}
            label="NEW"
            onArrived={() => handleBadgeArrived(flyingBadge.category)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSwipeHint && (
          <PathwaySwipeHint onDismiss={() => {
            setShowSwipeHint(false)
            markPathwaySwipeSeen()
          }} />
        )}
      </AnimatePresence>

      {/* Unlock info modal */}
      <AnimatePresence>
        {unlockModal && (
          <UnlockInfoModal
            unlock={unlockModal.unlock}
            category={unlockModal.category}
            colors={unlockModal.colors}
            userLevel={userLevel}
            userRankNumber={userRankNumber}
            userTier={userTier}
            onClose={() => setUnlockModal(null)}
            onUpgrade={() => { setUnlockModal(null); navigate('/subscribe') }}
          />
        )}
      </AnimatePresence>

      <div className="max-w-sm mx-auto">

        {/* ── Sticky: pathway dots + active category card ──────────────────── */}
        {/* The category title + subtitle are rendered INSIDE PathwayView as a
            header row at the top of the stone list. They scroll naturally with
            the rest of the pathway content — no JS state, no animations, no
            layout thrash.

            `-mt-6` cancels the outer AppShell `py-6` top padding so the sticky's
            NATURAL doc position is doc-y=56 (flush against the TopBar's bottom
            edge). Combined with `top: 56`, this means at every scrollY ≥ 0 the
            sticky sits at viewport y=56 — natural position and pin position
            coincide, so there's no transition range where the card drifts. */}
        <div
          className="sticky z-20 -mt-6"
          style={{
            top:           56,
            background:    '#06101e',
            paddingTop:    10,
            paddingBottom: 4,
          }}
        >
        {/* ── Pathway selector dots ─────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-2 mb-3">
          {pathways.map((p, i) => {
            const isActive = i === activeCatIndex
            return (
              <button
                key={p.category}
                onClick={() => goToPathway(i)}
                className="flex flex-col items-center gap-1 transition-all"
                title={p.category}
              >
                <motion.div
                  className="rounded-full"
                  animate={{
                    width:  isActive ? 28 : 8,
                    height: 8,
                    backgroundColor: isActive ? p.colors.stone : p.unlocked ? p.colors.stone + '66' : '#172236',
                  }}
                  transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                />
              </button>
            )
          })}
        </div>

        {/* ── Active pathway header ─────────────────────────────────────────── */}
        <div
          data-testid={`category-card-${activePathway.category}`}
          className="relative rounded-2xl px-4 py-2.5 flex items-center justify-between card-shadow"
          style={{ background: activePathway.colors.bg, border: `1px solid ${activePathway.colors.stone}33` }}
        >
          {/* Persistent "NEW" pill — rendered invisibly while this category is
              queued for unlock (so the flying badge can measure its exact
              landing spot), then fades in once the flying badge arrives. */}
          {(landedCategories.has(activePathway.category) || unlockQueue?.includes(activePathway.category)) && (
            <span
              data-testid={`new-pill-${activePathway.category}`}
              className="absolute -top-1.5 -right-1.5 text-[10px] font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full shadow-lg"
              style={{ opacity: landedCategories.has(activePathway.category) ? 1 : 0, pointerEvents: 'none' }}
            >
              NEW
            </span>
          )}

          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
              style={{ background: activePathway.colors.stone + '33', border: `1px solid ${activePathway.colors.stone}55` }}
            >
              {CATEGORY_ICONS[activePathway.category] ?? '📄'}
            </div>
            <div>
              <p className="text-sm font-extrabold text-slate-900">{activePathway.category}</p>
              {activePathway.unlocked
                ? <p className="text-xs text-slate-500">{totalCount > 0 ? `${readCount} / ${totalCount} completed` : 'No briefs yet'}</p>
                : <p className="text-xs" style={{ color: activePathway.colors.ring }}>🔒 {getLockReason(activePathway)}</p>
              }
            </div>
          </div>

          {/* Mini progress arc */}
          {activePathway.unlocked && totalCount > 0 && (
            <div className="relative w-10 h-10 shrink-0">
              <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#172236" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="14" fill="none"
                  stroke={activePathway.colors.stone}
                  strokeWidth="3"
                  strokeDasharray={`${(readCount / totalCount) * 88} 88`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-800">
                {totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0}%
              </span>
            </div>
          )}
        </div>
        </div>{/* end sticky dots + card */}

        {/* ── Swipeable pathway content ──────────────────────────────────────── */}
        <motion.div
          drag={pathways.length > 1 && !unlockQueue ? 'x' : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          animate={swipeControls}
          style={{ x: dragX }}
          onDragEnd={handleDragEnd}
          className="touch-pan-y cursor-grab active:cursor-grabbing min-h-[300px]"
        >
          <AnimatePresence mode="wait" custom={direction}>
            {loading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-4"
              >
                {[0,1,2,3].map(i => {
                  const xOffset = ZIGZAG[i % ZIGZAG.length]
                  const size = 52
                  return (
                    <div key={i} className="flex flex-col items-center" style={{ paddingLeft: `calc(50% + ${xOffset}px - ${size / 2}px)`, alignItems: 'flex-start' }}>
                      {i > 0 && (
                        <div className="flex flex-col items-center gap-1.5 mb-1.5" style={{ marginLeft: size / 2 - 3 }}>
                          {[0,1,2].map(j => (
                            <div key={j} className="w-1.5 h-1.5 rounded-full" style={{ background: '#243650', opacity: 0.4 }} />
                          ))}
                        </div>
                      )}
                      <div
                        className="rounded-full animate-pulse"
                        style={{
                          width: size, height: size,
                          background: activePathway.colors.stone + '18',
                          border: `2px solid ${activePathway.colors.stone}22`,
                        }}
                      />
                      <div
                        className="mt-1.5 rounded animate-pulse"
                        style={{ width: 60 + (i % 2) * 20, height: 10, background: '#172236', marginLeft: 2 }}
                      />
                    </div>
                  )
                })}
              </motion.div>
            ) : (
              <PathwayView
                key={`${activePathway.category}-${activeCatIndex}`}
                category={activePathway.category}
                briefs={activeBriefs}
                colors={activePathway.colors}
                pathwayUnlocked={activePathway.unlocked}
                lockReason={getLockReason(activePathway)}
                readSet={readSet}
                inProgressSet={inProgressSet}
                quizPassedSet={quizPassedSet}
                aptitudeSyncEnabled={aptitudeSyncEnabled}
                nextBriefImages={nextBriefCache[activePathway.category]?.images ?? null}
                nextBriefId={nextBriefCache[activePathway.category]?.id ?? null}
                direction={direction}
                onStoneTap={() => {}}
                onLockedTap={() => setUnlockModal({
                  unlock:   activePathway,
                  category: activePathway.category,
                  colors:   activePathway.colors,
                })}
              />
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Swipe hint (shown when >1 pathway unlocked) ───────────────────── */}
        {pathways.length > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4 mb-2">
            {activeCatIndex > 0 && (
              <button
                onClick={() => goToPathway(activeCatIndex - 1)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors px-3 py-1.5 rounded-full border border-slate-200"
              >
                ← {pathways[activeCatIndex - 1]?.category}
              </button>
            )}
            {activeCatIndex < pathways.length - 1 && (
              <button
                onClick={() => goToPathway(activeCatIndex + 1)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors px-3 py-1.5 rounded-full border border-slate-200 ml-auto"
              >
                {pathways[activeCatIndex + 1]?.category} →
              </button>
            )}
          </div>
        )}

      </div>
    </>
  )
}
