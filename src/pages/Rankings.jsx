import { useState, useEffect, useLayoutEffect, useRef, Fragment } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import LockedCategoryModal from '../components/LockedCategoryModal'
import UnlockBadges from '../components/UnlockBadges'
import { MOCK_RANKS } from '../data/mockData'
import { DEFAULT_PATHWAY_UNLOCKS } from '../data/pathways'
import { getLevelInfo } from '../utils/levelUtils'
import RankBadge from '../components/RankBadge'
import SEO from '../components/SEO'

// ── Theme colors ─────────────────────────────────────────────────────────────

const C = {
  brand:   '#5baaff',
  text:    '#ddeaf8',
  dim:     '#3d5a7a',
  muted:   '#4a6282',
  subtle:  '#8ba0c0',
  border:  '#1a3060',
  deep:    '#06101e',
  surface: '#0f2245',
}

// ── Shared small components ──────────────────────────────────────────────────

const VALID_TABS = ['levels', 'ranks']

function NumberCircle({ number, isCurrent, isAbove, isSelected, children }) {
  const bg    = isCurrent ? C.brand  : isSelected ? C.border : isAbove ? 'transparent' : C.surface
  const color = isCurrent ? C.deep   : isSelected ? C.brand  : isAbove ? C.dim  : C.brand
  const bdr   = isCurrent ? C.brand  : isSelected ? 'rgba(91,170,255,0.4)' : isAbove ? 'rgba(61,90,122,0.5)' : C.border
  const glow  = isCurrent ? '0 0 14px rgba(91,170,255,0.5)' : 'none'
  return (
    <span
      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-extrabold intel-mono shrink-0"
      style={{ background: bg, color, border: `1.5px solid ${bdr}`, boxShadow: glow }}
    >
      {children ?? number}
    </span>
  )
}

function YouBadge() {
  return (
    <span
      className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0 intel-mono"
      style={{ background: 'rgba(91,170,255,0.15)', color: C.brand, border: '1px solid rgba(91,170,255,0.3)' }}
    >
      YOU
    </span>
  )
}

// ── Level row ────────────────────────────────────────────────────────────────

function LevelRow({ lvl, i, isLast, userLevel, userRankNumber, userTier, pathwayUnlocks, userNextRank, onNextRankClick, onSubscriptionLocked }) {
  const isCurrent  = lvl.levelNumber === userLevel
  const isAbove    = lvl.levelNumber > userLevel
  const isBelow    = userLevel != null && lvl.levelNumber < userLevel
  const isMax      = lvl.levelNumber === 10
  const lvlUnlocks = pathwayUnlocks.filter(u => u.levelRequired === lvl.levelNumber && (u.rankRequired ?? 1) === userRankNumber)
  return (
    <motion.div
      data-current-level={isCurrent ? 'true' : undefined}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.04 }}
      className="px-4 py-3"
      style={{
        background:   isCurrent ? 'rgba(91,170,255,0.07)' : 'transparent',
        borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
        borderLeft:   isBelow ? `2px solid rgba(91,170,255,0.35)` : '2px solid transparent',
        opacity:      isAbove ? 0.4 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <NumberCircle number={lvl.levelNumber} isCurrent={isCurrent} isAbove={isAbove}>
          {isAbove ? <span style={{ fontSize: '12px' }}>🔒</span> : lvl.levelNumber}
        </NumberCircle>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: isCurrent ? C.text : isAbove ? C.dim : C.subtle }}>
            {isBelow && <span className="mr-1" style={{ color: C.brand, opacity: 0.75 }}>✓</span>}
            Level {lvl.levelNumber}
          </p>
          <p className="text-xs intel-mono" style={{ color: C.dim }}>
            {lvl.cumulativeAirstars.toLocaleString()} Airstars required
          </p>
        </div>
        {isCurrent && <YouBadge />}
        {isMax && userNextRank && (
          <button
            type="button"
            onClick={onNextRankClick}
            className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 intel-mono inline-flex items-center gap-1 transition-all cursor-pointer"
            style={{
              background: isCurrent ? 'rgba(91,170,255,0.18)' : 'rgba(91,170,255,0.08)',
              color:      C.brand,
              border:     `1px solid rgba(91,170,255,${isCurrent ? 0.4 : 0.25})`,
              boxShadow:  isCurrent ? '0 0 10px rgba(91,170,255,0.25)' : 'none',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = isCurrent ? 'rgba(91,170,255,0.28)' : 'rgba(91,170,255,0.18)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = isCurrent ? 'rgba(91,170,255,0.18)' : 'rgba(91,170,255,0.08)'
            }}
            title={`View ${userNextRank.rankName} in RAF Ranks`}
          >
            <span style={{ opacity: 0.7 }}>→</span>
            {userNextRank.rankAbbreviation ?? userNextRank.abbreviation}
          </button>
        )}
      </div>
      {lvlUnlocks.length > 0 && (
        <div
          className="ml-11"
          style={{ filter: isAbove ? 'grayscale(0.6)' : 'none' }}
        >
          <UnlockBadges
            unlocks={lvlUnlocks}
            userLevel={userLevel}
            userRankNumber={userRankNumber}
            userTier={userTier}
            onSubscriptionLocked={onSubscriptionLocked}
          />
        </div>
      )}
    </motion.div>
  )
}

// ── Rank row ─────────────────────────────────────────────────────────────────

function RankRow({ rank, i, isLast, isUser, isAbove, isBelow, isSelected, onClick }) {
  const dimBadge = isAbove && !isSelected
  return (
    <motion.div
      data-user-rank={isUser ? 'true' : undefined}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.025 }}
      onClick={onClick}
      className="px-4 py-3 flex items-center gap-3 cursor-pointer transition-all"
      style={{
        background:   isSelected ? 'rgba(91,170,255,0.09)' : 'transparent',
        borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
        borderLeft:   isSelected
          ? '2px solid rgba(91,170,255,0.5)'
          : isBelow ? '2px solid rgba(91,170,255,0.35)' : '2px solid transparent',
        opacity:      isAbove && !isSelected ? 0.45 : 1,
      }}
    >
      <NumberCircle number={rank.rankNumber} isCurrent={isUser} isAbove={isAbove} isSelected={isSelected}>
        {rank.rankNumber > 1
          ? <span style={{ filter: dimBadge ? 'grayscale(0.4)' : 'none', display: 'inline-flex' }}>
              <RankBadge rankNumber={rank.rankNumber} size={18} color={isUser ? C.deep : C.brand} />
            </span>
          : (rank.rankAbbreviation ?? 'AC')}
      </NumberCircle>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-bold truncate"
          style={{ color: isUser || isSelected ? C.text : isAbove ? C.dim : C.subtle }}
        >
          {isBelow && <span className="mr-1" style={{ color: C.brand, opacity: 0.75 }}>✓</span>}
          {rank.rankAbbreviation ?? rank.abbreviation}
        </p>
        <p className="text-xs truncate" style={{ color: C.dim }}>
          {rank.rankName} · {rank.rankType?.replace(/_/g, ' ')}
        </p>
      </div>
      {isUser && <YouBadge />}
      {isAbove && !isUser && <span className="text-base shrink-0" style={{ opacity: 0.3 }}>🔒</span>}
      {isSelected && !isUser && <span className="text-xs shrink-0" style={{ color: 'rgba(91,170,255,0.5)' }}>▶</span>}
    </motion.div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Rankings() {
  const { user, API, apiFetch } = useAuth()
  const navigate      = useNavigate()
  const location      = useLocation()
  const { start }     = useAppTutorial()

  const [levels,         setLevels]         = useState(null)
  const [ranks,          setRanks]          = useState(MOCK_RANKS?.map(r => ({ ...r, rankAbbreviation: r.abbreviation })) ?? [])
  const [pathwayUnlocks, setPathwayUnlocks] = useState(DEFAULT_PATHWAY_UNLOCKS)
  const [upgradeModal,   setUpgradeModal]   = useState(null)

  const [tab, setTab] = useState(VALID_TABS.includes(location.state?.tab) ? location.state.tab : 'levels')

  useEffect(() => {
    setTab(VALID_TABS.includes(location.state?.tab) ? location.state.tab : 'levels')
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => start('rankings'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([
      apiFetch(`${API}/api/users/levels`).then(r => r.json()),
      apiFetch(`${API}/api/users/ranks`).then(r => r.json()),
      apiFetch(`${API}/api/settings`).then(r => r.json()),
    ])
      .then(([lvlData, rankData, settingsData]) => {
        if (lvlData?.data?.levels?.length)       setLevels(lvlData.data.levels)
        if (rankData?.data?.ranks?.length)        setRanks(rankData.data.ranks)
        if (settingsData?.pathwayUnlocks?.length) setPathwayUnlocks(settingsData.pathwayUnlocks)
      })
      .catch(() => {})
  }, [API])

  // ── Derived values ─────────────────────────────────────────────────────────

  const coins    = user?.cycleAirstars ?? 0
  const userTier = user?.subscriptionTier ?? 'free'
  const lvlInfo  = getLevelInfo(coins, levels)
  const userLevel    = user ? (lvlInfo?.level ?? 1) : null
  const coinsInLevel = lvlInfo?.coinsInLevel ?? 0
  const coinsNeeded  = lvlInfo?.coinsNeeded ?? 0
  const lvlProgress  = lvlInfo?.progress ?? 0

  const sortedLevels = levels ? [...levels].sort((a, b) => b.levelNumber - a.levelNumber) : []

  const sortedRanks    = [...ranks].sort((a, b) => b.rankNumber - a.rankNumber)
  const userRankId     = user?.rank?._id ?? user?.rank ?? null
  const userRank       = userRankId
    ? (user.rank?.rankNumber != null ? user.rank : ranks.find(r => r._id?.toString() === userRankId?.toString()))
    : null
  const userRankNumber = user ? (userRank?.rankNumber ?? 1) : null

  const rankListScrollRef    = useRef(null)
  const levelsListScrollRef  = useRef(null)
  const cardRef              = useRef(null)
  const cardContentRef       = useRef(null)
  const [listMaxH,        setListMaxH]        = useState(null)
  const [selectedRankNum, setSelectedRankNum] = useState(userRankNumber)
  const [cardHeight,      setCardHeight]      = useState(0)

  useEffect(() => { setSelectedRankNum(userRankNumber) }, [userRankNumber])

  const selectedRank        = ranks.find(r => r.rankNumber === selectedRankNum) ?? null
  const previewRankUnlocks  = pathwayUnlocks.filter(u => (u.rankRequired ?? 1) === selectedRankNum)
  const isPreviewing        = selectedRankNum !== userRankNumber

  const nextUnlockLevel = [...(levels ?? [])]
    .sort((a, b) => a.levelNumber - b.levelNumber)
    .find(lvl =>
      lvl.levelNumber > userLevel &&
      pathwayUnlocks.some(u => u.levelRequired === lvl.levelNumber && (u.rankRequired ?? 1) === userRankNumber)
    )

  const userNextRank = userRankNumber != null
    ? ranks.find(r => r.rankNumber === userRankNumber + 1) ?? null
    : null

  const handleSubscriptionLocked = (cat, t) => setUpgradeModal({ category: cat, tier: t })

  const handleNextRankClick = () => {
    if (!userNextRank) return
    setSelectedRankNum(userNextRank.rankNumber)
    setTab('ranks')
  }

  // Hard-lock outer page scroll while on this route — the inner list has its own
  // overflow:auto, and locking here side-steps mobile URL-bar / safe-area math entirely
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  }, [])

  // Measure the card's inner content height so the parent can tween its height
  // during tab swaps. ResizeObserver picks up content changes (tab swap, rank
  // selection, sign-in state) without us having to re-trigger manually.
  useLayoutEffect(() => {
    const node = cardContentRef.current
    if (!node) return
    setCardHeight(node.offsetHeight)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const n = cardContentRef.current
      if (n) setCardHeight(n.offsetHeight)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  // Fit the active list to remaining viewport height so the visible content fills it.
  // Walks ancestor padding-bottom (e.g. AppShell's pb-20 + py-6) so the list ends right
  // at the page's natural content bottom — bottom nav overlap is already covered by
  // those paddings on mobile. Re-runs on selection/badge changes and observes the
  // preview card so the list shrinks (rather than overflowing) when the card grows.
  useEffect(() => {
    function measure() {
      const node = tab === 'levels' ? levelsListScrollRef.current : rankListScrollRef.current
      if (!node) return
      const top = node.getBoundingClientRect().top
      let paddingBelow = 0
      let el = node.parentElement
      while (el && el !== document.body) {
        paddingBelow += parseFloat(getComputedStyle(el).paddingBottom) || 0
        el = el.parentElement
      }
      const max = window.innerHeight - top - paddingBelow
      setListMaxH(Math.max(120, Math.round(max)))
    }
    const id = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    const card = cardRef.current
    let ro
    if (card && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure())
      ro.observe(card)
    }
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', measure)
      if (ro) ro.disconnect()
    }
  }, [tab, user, selectedRankNum])

  // Center the user's row in view. Look up the row by data attribute (sidesteps
  // motion.div ref-forwarding quirks) and use bounding rects rather than offsetTop —
  // offsetTop is relative to offsetParent, not the scroll container, so it gives
  // wrong results unless the container is explicitly positioned. Defer one frame
  // so layout / listMaxH have settled before reading.
  function centerRowInContainer(container, row) {
    const cRect = container.getBoundingClientRect()
    const rRect = row.getBoundingClientRect()
    const offsetWithin = (rRect.top - cRect.top) + container.scrollTop
    container.scrollTop = offsetWithin - container.clientHeight / 2 + rRect.height / 2
  }

  useEffect(() => {
    if (tab !== 'ranks') return
    const id = requestAnimationFrame(() => {
      const container = rankListScrollRef.current
      if (!container) return
      const row = container.querySelector('[data-user-rank="true"]')
      if (!row) return
      centerRowInContainer(container, row)
    })
    return () => cancelAnimationFrame(id)
  }, [tab, sortedRanks.length, userRankNumber, listMaxH])

  useEffect(() => {
    if (tab !== 'levels') return
    const id = requestAnimationFrame(() => {
      const container = levelsListScrollRef.current
      if (!container) return
      const row = container.querySelector('[data-current-level="true"]')
      if (!row) return
      centerRowInContainer(container, row)
    })
    return () => cancelAnimationFrame(id)
  }, [tab, sortedLevels.length, userLevel, listMaxH])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <SEO title="Rankings" description="See how you rank against other learners on the SkyWatch leaderboard." />
    <TutorialModal />
    <div className="max-w-lg mx-auto">

      {/* Header */}
      <div className="mb-5">
        <button
          onClick={() => navigate('/profile')}
          className="text-sm font-medium flex items-center gap-1 mb-3 transition-colors"
          style={{ color: C.muted }}
          onMouseEnter={e => e.currentTarget.style.color = C.subtle}
          onMouseLeave={e => e.currentTarget.style.color = C.muted}
        >
          ← Back
        </button>
        <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: C.muted }}>RAF Skywatch</p>
        <h1 className="text-2xl font-extrabold" style={{ color: C.text }}>Progression</h1>
        <p className="text-sm mt-0.5" style={{ color: C.muted }}>Level up and earn RAF Ranks to unlock new pathways.</p>
      </div>

      {/* Segmented selector */}
      <div
        className="grid grid-cols-2 mb-5 p-1 rounded-2xl"
        style={{ background: C.deep, border: `1px solid ${C.border}` }}
      >
        {[
          { key: 'levels', label: '🎖 Agent Levels' },
          { key: 'ranks',  label: '🎗 RAF Ranks'    },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200"
            style={{
              background: tab === t.key ? C.border : 'transparent',
              color:      tab === t.key ? C.brand  : C.muted,
              boxShadow:  tab === t.key ? '0 0 14px rgba(91,170,255,0.12)' : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Shared card — animates height between tabs ────────────────────── */}
      <motion.div
        ref={cardRef}
        animate={{ height: cardHeight }}
        transition={{ height: { duration: 0.55, ease: 'easeInOut' } }}
        className="rounded-2xl mb-3"
        style={{
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)',
          border: `1px solid ${tab === 'ranks' && isPreviewing ? 'rgba(91,170,255,0.35)' : 'rgba(91,170,255,0.2)'}`,
          transition: 'border-color 0.5s ease',
        }}
      >
        <div ref={cardContentRef} className="p-4">
        <AnimatePresence mode="wait" initial={false}>
          {tab === 'levels' ? (
            <motion.div
              key="levels-content"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
            >
              {user ? (
                <>
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="text-sm font-extrabold intel-mono" style={{ color: C.brand }}>
                      LEVEL {userLevel}
                    </p>
                    <p className="text-xs intel-mono" style={{ color: C.muted }}>
                      {coinsInLevel.toLocaleString()} / {coinsNeeded?.toLocaleString() ?? '—'} AC
                    </p>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: C.border }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: C.brand }}
                      initial={{ width: 0 }}
                      animate={{ width: `${lvlProgress}%` }}
                      transition={{ duration: 0.9, ease: 'easeOut' }}
                    />
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: coinsNeeded ? C.muted : '#ffffff' }}>
                    {coinsNeeded
                      ? `${Math.max(0, coinsNeeded - coinsInLevel).toLocaleString()} Airstars to Level ${userLevel + 1}`
                      : <><span className="star-silver">⭐</span> Max level — RAF Rank Promotion on next cycle</>
                    }
                  </p>
                  {nextUnlockLevel && (
                    <p className="text-xs mt-1.5 font-semibold" style={{ color: 'rgba(91,170,255,0.7)' }}>
                      ↓ Next pathway unlock at Level {nextUnlockLevel.levelNumber}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold intel-mono mb-1" style={{ color: C.brand }}>
                      AGENT LEVELS
                    </p>
                    <p className="text-xs" style={{ color: C.muted }}>
                      Sign in to earn Airstars and level up your agent.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="text-xs font-bold px-3 py-2 rounded-lg shrink-0 intel-mono transition-colors"
                    style={{
                      color: C.brand,
                      background: 'rgba(91,170,255,0.12)',
                      border: '1px solid rgba(91,170,255,0.3)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(91,170,255,0.22)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(91,170,255,0.12)' }}
                  >
                    Sign In
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="ranks-content"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
            >
              {/* Rank identity */}
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: C.deep, border: '1.5px solid rgba(91,170,255,0.2)' }}
                >
                  {selectedRank && selectedRank.rankNumber > 1
                    ? <RankBadge rankNumber={selectedRank.rankNumber} size={32} />
                    : <span className="text-sm font-extrabold intel-mono" style={{ color: C.brand }}>
                        {selectedRank?.rankAbbreviation ?? '—'}
                      </span>
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-extrabold truncate leading-tight" style={{ color: C.text }}>
                    {selectedRank?.rankName ?? 'Unranked'}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: C.muted }}>
                    {isPreviewing ? 'Previewing' : 'Your Rank'}
                    {selectedRank?.rankAbbreviation ? ` · ${selectedRank.rankAbbreviation}` : ''}
                    {selectedRank?.rankType ? ` · ${selectedRank.rankType.replace(/_/g, ' ')}` : ''}
                  </p>
                </div>
                {user && (
                  <button
                    type="button"
                    onClick={() => navigate('/profile/badge')}
                    className="text-[10px] uppercase tracking-wider font-bold px-2.5 py-1.5 rounded-lg shrink-0 intel-mono transition-colors"
                    style={{
                      color: C.brand,
                      background: 'rgba(91,170,255,0.1)',
                      border: '1px solid rgba(91,170,255,0.3)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(91,170,255,0.18)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(91,170,255,0.1)' }}
                  >
                    Change Badge
                  </button>
                )}
              </div>

              {/* Pathway unlocks */}
              <div className="pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                <p className="text-xs uppercase tracking-widest font-bold mb-1.5" style={{ color: C.muted }}>
                  Pathway Unlocks
                </p>
                <div className="flex flex-wrap gap-1">
                  {previewRankUnlocks.length > 0 ? (
                    <UnlockBadges
                      unlocks={previewRankUnlocks}
                      bare
                      userLevel={userLevel}
                      userRankNumber={userRankNumber}
                      userTier={userTier}
                      onSubscriptionLocked={handleSubscriptionLocked}
                    />
                  ) : (
                    <p className="text-xs" style={{ color: C.dim }}>
                      No pathway unlocks at this rank.
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </motion.div>

      {/* ── LEVELS LIST ────────────────────────────────────────────────────── */}
      {tab === 'levels' && (
        <motion.div key="levels-list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            <div
              ref={levelsListScrollRef}
              style={{ maxHeight: listMaxH ?? 540, overflowY: 'auto', scrollbarWidth: 'none' }}
            >
              {sortedLevels.map((lvl, i) => {
                const isCurrentRow  = lvl.levelNumber === userLevel
                const showLockLabel = isCurrentRow && i > 0
                return (
                  <Fragment key={lvl.levelNumber}>
                    {showLockLabel && (
                      <div
                        className="px-4 py-1.5 text-center text-[10px] uppercase tracking-[0.2em] font-bold"
                        style={{
                          background:   'rgba(0,0,0,0.25)',
                          color:        C.muted,
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        ↑ Locked
                      </div>
                    )}
                    <LevelRow
                      lvl={lvl}
                      i={i}
                      isLast={i === sortedLevels.length - 1}
                      userLevel={userLevel}
                      userRankNumber={userRankNumber}
                      userTier={userTier}
                      pathwayUnlocks={pathwayUnlocks}
                      userNextRank={userNextRank}
                      onNextRankClick={handleNextRankClick}
                      onSubscriptionLocked={handleSubscriptionLocked}
                    />
                  </Fragment>
                )
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── RANKS LIST ─────────────────────────────────────────────────────── */}
      {tab === 'ranks' && (
        <motion.div key="ranks-list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            <div ref={rankListScrollRef} style={{ maxHeight: listMaxH ?? 540, overflowY: 'auto', scrollbarWidth: 'none' }}>
              {sortedRanks.map((rank, i) => {
                const isUserRow     = rank.rankNumber === userRankNumber
                const showLockLabel = isUserRow && i > 0
                return (
                  <Fragment key={rank.rankNumber}>
                    {showLockLabel && (
                      <div
                        className="px-4 py-1.5 text-center text-[10px] uppercase tracking-[0.2em] font-bold"
                        style={{
                          background:   'rgba(0,0,0,0.25)',
                          color:        C.muted,
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        ↑ Locked · Tap to preview
                      </div>
                    )}
                    <RankRow
                      rank={rank}
                      i={i}
                      isLast={i === sortedRanks.length - 1}
                      isUser={isUserRow}
                      isAbove={rank.rankNumber > userRankNumber}
                      isBelow={userRankNumber != null && rank.rankNumber < userRankNumber}
                      isSelected={rank.rankNumber === selectedRankNum}
                      onClick={() => setSelectedRankNum(rank.rankNumber)}
                    />
                  </Fragment>
                )
              })}
              {sortedRanks.length === 0 && (
                <div className="px-4 py-6 text-center text-sm" style={{ color: C.dim }}>
                  No rank data available.
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

    </div>

    {upgradeModal && (
      <LockedCategoryModal
        category={upgradeModal.category}
        tier={upgradeModal.tier}
        user={user}
        onClose={() => setUpgradeModal(null)}
      />
    )}
    </>
  )
}
