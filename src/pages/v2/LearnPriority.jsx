import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import { MOCK_LEVELS, MOCK_RANKS, CATEGORY_ICONS } from '../../data/mockData'
import { pathwayTierRequired, getAccessibleCategories } from '../../utils/subscription'

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

function getLevelInfo(coins, levels) {
  if (!levels?.length) return { current: { levelNumber: 1 }, progress: 0, coinsInLevel: 0, coinsNeeded: 100 }
  let current = levels[0]
  for (const lvl of levels) {
    if (coins >= lvl.cumulativeAircoins) current = lvl
    else break
  }
  const coinsInLevel = coins - current.cumulativeAircoins
  const coinsNeeded  = current.aircoinsToNextLevel
  const progress     = coinsNeeded ? Math.min(100, Math.round((coinsInLevel / coinsNeeded) * 100)) : 100
  return { current, coinsInLevel, coinsNeeded, progress }
}

function tierRank(tier) {
  return { free: 0, trial: 1, silver: 1, gold: 2 }[tier] ?? 0
}

function isPathwayUnlocked(unlock, userLevel, userRankNumber, userTier) {
  return (
    userLevel      >= (unlock.levelRequired ?? 1) &&
    userRankNumber >= (unlock.rankRequired  ?? 1) &&
    tierRank(userTier) >= tierRank(unlock.tierRequired ?? 'free')
  )
}

function getRankName(rankNumber) {
  return MOCK_RANKS.find(r => r.rankNumber === rankNumber)?.rankName ?? `Rank ${rankNumber}`
}

// ── Stone component ───────────────────────────────────────────────────────────

function formatEventDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Stone({ brief, state, colors, milestone, onTap, index }) {
  const size         = milestone ? 72 : 60
  const isNext       = state === 'next'
  const isRead       = state === 'read'
  const isInProgress = state === 'inprogress'
  const isLocked     = state.startsWith('locked')
  const isStub       = state === 'stub'
  const isHistoric   = !!brief.historic && !isLocked && !isStub
  const [hovered, setHovered] = useState(false)

  // Amber historic tones — overlaid regardless of pathway colour
  const HISTORIC_BG     = '#1e1200'
  const HISTORIC_BORDER = '#7a5200'
  const HISTORIC_RING   = '#c8860a'
  const HISTORIC_GLOW   = 'rgba(180,110,10,0.35)'

  const xOffset = ZIGZAG[index % ZIGZAG.length]

  return (
    <div
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

function PathwayView({ category, briefs, colors, pathwayUnlocked, lockReason, readSet, inProgressSet, onStoneTap, onLockedTap, direction }) {
  const navigate = useNavigate()

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
            onTap={() => {
              navigate(`/brief/${brief._id}`)
            }}
          />
        )
      })}
    </motion.div>
  )
}

// ── Upgrade / unlock info modal ───────────────────────────────────────────────

function UnlockInfoModal({ unlock, category, colors, userLevel, userRankNumber, userTier, onClose, onUpgrade }) {
  const lvlOk    = userLevel      >= (unlock?.levelRequired ?? 1)
  const rankOk   = userRankNumber >= (unlock?.rankRequired  ?? 1)
  const tierOk   = tierRank(userTier) >= tierRank(unlock?.tierRequired ?? 'free')
  const needsTier = unlock?.tierRequired !== 'free'

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
              current={`You are Level ${userLevel}`}
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LearnPriority() {
  const { user, API } = useAuth()
  const navigate      = useNavigate()
  const location      = useLocation()
  const { start }     = useAppTutorial()

  const [levels,         setLevels]         = useState(MOCK_LEVELS)
  const [pathwayUnlocks, setPathwayUnlocks] = useState(DEFAULT_PATHWAY_UNLOCKS)
  const [catSettings,    setCatSettings]    = useState(null) // { freeCategories, silverCategories }
  const [briefsCache,    setBriefsCache]    = useState({}) // { [category]: brief[] }
  const [loading,        setLoading]        = useState(false)
  const [activeCatIndex, setActiveCatIndex] = useState(1)
  const [direction,      setDirection]      = useState(1)   // 1=forward, -1=backward
  const [unlockModal,    setUnlockModal]    = useState(null) // { unlock, category, colors }
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const dragX = useMotionValue(0)

  // ── Tutorial ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => start('learn-priority'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch settings (pathwayUnlocks + category tier lists) ─────────────────
  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.pathwayUnlocks?.length) setPathwayUnlocks(d.pathwayUnlocks)
        if (d) setCatSettings({ freeCategories: d.freeCategories ?? [], silverCategories: d.silverCategories ?? [] })
        setSettingsLoaded(true)
      })
      .catch(() => { setSettingsLoaded(true) })
  }, [API])

  // ── Fetch level thresholds ──────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/users/levels`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data?.levels?.length) setLevels(d.data.levels) })
      .catch(() => {})
  }, [API])

  // ── Compute user progression ────────────────────────────────────────────────
  const userTier        = user?.subscriptionTier ?? 'free'
  const { current: lvl } = getLevelInfo(user?.cycleAircoins ?? 0, levels)
  const userLevel       = lvl.levelNumber ?? 1
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
      (a.levelRequired - b.levelRequired) ||
      (a.rankRequired  - b.rankRequired)  ||
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

  // ── Fire pathway_swipe tutorial when ≥2 pathways unlocked ──────────────────
  useEffect(() => {
    if (unlockedCount >= 2) {
      const t = setTimeout(() => start('pathway_swipe'), 800)
      return () => clearTimeout(t)
    }
  }, [unlockedCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch briefs for the active pathway ────────────────────────────────────
  const activePathway = pathways[activeCatIndex] ?? pathways[0]

  useEffect(() => {
    if (!activePathway) return
    const cat = activePathway.category
    if (briefsCache[cat]) return // already loaded
    setLoading(true)
    fetch(`${API}/api/briefs/pathway/${encodeURIComponent(cat)}`, { credentials: 'include' })
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
  }

  function goToPathway(index) {
    if (index === activeCatIndex) return
    setDirection(index > activeCatIndex ? 1 : -1)
    setActiveCatIndex(index)
  }

  // ── Lock reason string ──────────────────────────────────────────────────────
  function getLockReason(unlock) {
    const reasons = []
    if (userLevel      < (unlock.levelRequired ?? 1)) reasons.push(`Reach Agent Level ${unlock.levelRequired}`)
    if (userRankNumber < (unlock.rankRequired  ?? 1)) reasons.push(`Achieve ${getRankName(unlock.rankRequired)}`)
    if (tierRank(userTier) < tierRank(unlock.tierRequired ?? 'free')) {
      const t = unlock.tierRequired
      reasons.push(`${t.charAt(0).toUpperCase() + t.slice(1)} subscription required`)
    }
    return reasons.join(' · ') || 'Keep levelling up'
  }

  if (!activePathway) return null

  return (
    <>
      <TutorialModal />

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
                className="flex flex-col items-center justify-center py-20 gap-3"
              >
                <div
                  className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: `${activePathway.colors.stone}44`, borderTopColor: activePathway.colors.stone }}
                />
                <p className="text-sm text-slate-500">Loading {activePathway.category} pathway…</p>
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
