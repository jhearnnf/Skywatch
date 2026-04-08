import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useAnimationControls } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import { MOCK_RANKS, CATEGORY_ICONS } from '../data/mockData'
import { pathwayTierRequired, getAccessibleCategories } from '../utils/subscription'
import { getLevelInfo } from '../utils/levelUtils'
import { playTypingSound } from '../utils/sound'
import SEO from '../components/SEO'

// ── Constants ─────────────────────────────────────────────────────────────────

const PATHWAY_COLORS = {
  News:        { stone: '#a16207', glow: 'rgba(161,98,7,0.4)',    ring: '#eab308', bg: '#422006' },
  Bases:       { stone: '#2563eb', glow: 'rgba(37,99,235,0.4)',   ring: '#3b82f6', bg: '#1e3a8a' },
  Aircrafts:   { stone: '#475569', glow: 'rgba(71,85,105,0.4)',   ring: '#64748b', bg: '#1e293b' },
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

const CARD_LINE1 = '> APTITUDE_SYNC — initiate terminal debrief sequence'
const CARD_LINE2 = 'knowledge verification protocol'

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
        playTypingSound()
        i++
        setTimeout(typeL1, 12)
      } else {
        setTimeout(() => {
          let j = 0
          const typeL2 = () => {
            if (cancelled) return
            if (j < CARD_LINE2.length) {
              setLine2(CARD_LINE2.slice(0, j + 1))
              playTypingSound()
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
        transition={{ duration: 0.25, ease: 'easeOut' }}
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

// ── Stone component ───────────────────────────────────────────────────────────

function formatEventDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Stone({ brief, state, colors, milestone, onTap, onSyncTap, quizPassed, aptitudeSyncEnabled, index, openSyncId, onCardOpen, onCardClose }) {
  const size         = milestone ? 72 : 60
  const isNext       = state === 'next'
  const isRead       = state === 'read'
  const isInProgress = state === 'inprogress'
  const isLocked     = state.startsWith('locked')
  const isStub       = state === 'stub'
  const isHistoric   = !!brief.historic && !isLocked && !isStub
  const [hovered,  setHovered]  = useState(false)
  const [inView,   setInView]   = useState(false)
  const containerRef = useRef(null)

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

  const showSync = isRead && quizPassed && aptitudeSyncEnabled && inView

  // Amber historic tones — overlaid regardless of pathway colour
  const HISTORIC_BG     = '#1e1200'
  const HISTORIC_BORDER = '#7a5200'
  const HISTORIC_RING   = '#c8860a'
  const HISTORIC_GLOW   = 'rgba(180,110,10,0.35)'

  const xOffset = ZIGZAG[index % ZIGZAG.length]

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center"
      style={{ paddingLeft: `calc(50% + ${xOffset}px - ${size / 2}px)`, alignItems: 'flex-start' }}
      onMouseEnter={() => { if (isStub) setHovered(true) }}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Connector dot strip above (except first) */}
      {index > 0 && (
        <div className="flex flex-col items-center gap-1.5 mb-1.5" style={{ marginLeft: size / 2 - 3 }}>
          {[0,1,2].map(i => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
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
      <div className="flex items-center gap-2">

      {/* The stone */}
      <button
        onClick={onTap}
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
          {isLocked ? '🔒' : isStub ? '📡' : milestone ? '⭐' : CATEGORY_ICONS[brief.category] ?? '📄'}
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
        <AnimatePresence mode="wait">
          {isStub ? (
            hovered ? (
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
            )
          ) : (
            <span className="block">{brief.title}</span>
          )}
        </AnimatePresence>
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
    </div>
  )
}

// ── Pathway view (vertical list of stones for one category) ──────────────────

function PathwayView({ category, briefs, colors, pathwayUnlocked, lockReason, readSet, inProgressSet, quizPassedSet, aptitudeSyncEnabled, onStoneTap, onLockedTap, direction }) {
  const navigate = useNavigate()
  const [openSyncId, setOpenSyncId] = useState(null)

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
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="flex flex-col items-center justify-center py-20 text-center px-6"
      >
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
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="flex flex-col items-center justify-center py-20 text-center px-6"
      >
        <span className="text-4xl mb-4">{CATEGORY_ICONS[category] ?? '📄'}</span>
        <p className="text-base font-bold text-slate-700 mb-1">No pathway briefs yet</p>
        <p className="text-sm text-slate-500">{category === 'News' ? 'No news briefs available yet. Check back soon.' : `Priority numbers haven't been assigned to ${category} briefs yet. Check back soon.`}</p>
      </motion.div>
    )
  }

  // Find the first unread brief index
  const firstUnreadIdx = briefs.findIndex(b => !readSet.has(b._id) && b.status !== 'stub')

  return (
    <motion.div
      key={category}
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="pb-8"
    >
      {briefs.map((brief, i) => {
        const isStub       = brief.status === 'stub'
        const isRead       = !isStub && readSet.has(brief._id)
        const isInProgress = !isStub && !isRead && inProgressSet.has(brief._id)
        const isNext       = !isStub && !isRead && !isInProgress && i === firstUnreadIdx
        const state        = isStub ? 'stub' : isRead ? 'read' : isInProgress ? 'inprogress' : isNext ? 'next' : 'unread'
        const milestone = (i + 1) % 5 === 0

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
  const [loading,        setLoading]        = useState(false)
  const [activeCatIndex, setActiveCatIndex] = useState(1)
  const [direction,      setDirection]      = useState(1)   // 1=forward, -1=backward
  const [unlockModal,    setUnlockModal]    = useState(null) // { unlock, category, colors }
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [aptSyncSettings, setAptSyncSettings] = useState({ enabled: false, tiers: ['admin'] })
  const [quizPassedSet,  setQuizPassedSet]  = useState(new Set())
  const dragX        = useMotionValue(0)
  const swipeControls = useAnimationControls()
  const [showSwipeHint, setShowSwipeHint] = useState(false)

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
  const lvlInfo         = getLevelInfo(user?.cycleAircoins ?? 0, levels)
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
  useEffect(() => {
    if (!settingsLoaded) return
    const cat = location.state?.category
    if (cat) {
      const idx = pathways.findIndex(p => p.category === cat)
      if (idx !== -1) setActiveCatIndex(idx)
      return
    }
    // Guest / free users: snap to their first accessible pathway (e.g. News)
    const accessible = getAccessibleCategories(user, catSettings)
    if (accessible !== null && accessible.length > 0) {
      const idx = pathways.findIndex(p => accessible.includes(p.category))
      if (idx !== -1) setActiveCatIndex(idx)
    }
  }, [settingsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Show inline swipe hint after learn-priority tutorial is seen ───────────
  // Gates on `visible` (no modal open) + hasSeen('learn-priority') so the hint
  // never fights with the modal. hasSeen reads live from localStorage — next()
  // sets the key before returning null, so the very next render sees both
  // visible=false and hasSeen=true simultaneously.
  useEffect(() => {
    if (visible) return
    if (pathways.length < 2) return
    if (!hasSeen('learn-priority')) return
    const uid = user?._id
    const key = uid ? `sw_tut_v2_${uid}_pathway_swipe` : 'sw_tut_v2_anon_pathway_swipe'
    if (localStorage.getItem(key)) return
    const t = setTimeout(() => setShowSwipeHint(true), 800)
    return () => clearTimeout(t)
  }, [visible, pathways.length, user?._id]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const activePathway = pathways[activeCatIndex] ?? pathways[0]

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
      <TutorialModal />

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

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="mb-5 pt-1">
          <h1 className="text-2xl font-extrabold text-slate-900">Learning Pathway</h1>
          <p className="text-sm text-slate-500 mt-0.5">Follow the stones to build RAF knowledge.</p>
        </div>

        {/* ── Pathway selector dots ─────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-2 mb-5">
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
          className="rounded-2xl p-4 mb-5 flex items-center justify-between card-shadow"
          style={{ background: activePathway.colors.bg, border: `1px solid ${activePathway.colors.stone}33` }}
        >
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

        {/* ── Swipeable pathway content ──────────────────────────────────────── */}
        <motion.div
          drag={pathways.length > 1 ? 'x' : false}
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

        {/* Locked pathways strip */}
        {pathways.some(p => !p.unlocked) && (
          <div className="mt-6 mb-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 text-center">Locked Pathways</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {pathways.filter(p => !p.unlocked).map(p => (
                <button
                  key={p.category}
                  onClick={() => setUnlockModal({ unlock: p, category: p.category, colors: p.colors })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
                  style={{ borderColor: '#243650', color: '#3d5a7a', background: '#0d1625' }}
                >
                  <span>{CATEGORY_ICONS[p.category] ?? '📄'}</span>
                  <span>{p.category}</span>
                  <span className="opacity-50">🔒</span>
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </>
  )
}
