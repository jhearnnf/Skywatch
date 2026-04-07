import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import LockedCategoryModal from '../components/LockedCategoryModal'
import { MOCK_LEVELS, MOCK_RANKS, CATEGORY_ICONS } from '../data/mockData'
import RankBadge from '../components/RankBadge'
import SEO from '../components/SEO'

// ── Defaults (overridden by /api/settings) ────────────────────────────────────

const DEFAULT_PATHWAY_UNLOCKS = [
  { category: 'Bases',     levelRequired: 1, rankRequired: 1, tierRequired: 'free'   },
  { category: 'Aircrafts', levelRequired: 2, rankRequired: 1, tierRequired: 'free'   },
  { category: 'Ranks',     levelRequired: 2, rankRequired: 1, tierRequired: 'silver' },
  { category: 'Squadrons', levelRequired: 3, rankRequired: 2, tierRequired: 'silver' },
  { category: 'Training',  levelRequired: 4, rankRequired: 2, tierRequired: 'silver' },
  { category: 'Roles',     levelRequired: 5, rankRequired: 3, tierRequired: 'silver' },
  { category: 'Threats',   levelRequired: 6, rankRequired: 3, tierRequired: 'gold'   },
  { category: 'Missions',  levelRequired: 7, rankRequired: 4, tierRequired: 'gold'   },
]

const PATHWAY_COLORS = {
  News:        '#a16207', Bases:       '#2563eb', Aircrafts:   '#64748b',
  Ranks:       '#d97706', Squadrons:   '#7c3aed', Training:    '#059669',
  Roles:       '#ea580c', Threats:     '#dc2626', Missions:    '#0891b2',
  Terminology: '#4f46e5', Heritage:    '#b45309', Allies:      '#16a34a',
  AOR:         '#0d9488', Tech:        '#0284c7', Treaties:    '#db2777',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierRankNum(tier) {
  return { free: 0, trial: 1, silver: 1, gold: 2 }[tier] ?? 0
}

function getLevelInfo(coins, levels) {
  if (!levels?.length) return { current: { levelNumber: 1, aircoinsToNextLevel: 100, cumulativeAircoins: 0 }, coinsInLevel: 0, coinsNeeded: 100, progress: 0 }
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

// ── Pathway badge strip ───────────────────────────────────────────────────────

function UnlockBadges({ unlocks, userLevel, userRankNumber, userTier, onSubscriptionLocked }) {
  if (!unlocks.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {unlocks.map(u => {
        const color       = PATHWAY_COLORS[u.category] ?? '#475569'
        const icon        = CATEGORY_ICONS?.[u.category] ?? '📄'
        const tier        = u.tierRequired ?? 'free'
        const pathwayMet = userRankNumber > (u.rankRequired ?? 1) || (userRankNumber >= (u.rankRequired ?? 1) && userLevel >= (u.levelRequired ?? 1))
        const tierMet    = tierRankNum(userTier) >= tierRankNum(tier)
        const unlocked   = pathwayMet && tierMet
        const subLocked  = !tierMet
        return (
          <span
            key={u.category}
            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full${subLocked ? ' cursor-pointer' : ''}`}
            style={{
              background: unlocked ? `${color}28` : '#0c1829',
              color:      unlocked ? color         : '#3d5a7a',
              border:    `1px solid ${unlocked ? `${color}55` : subLocked ? (tier === 'gold' ? '#92400e' : '#1a3a6b') : '#1a3060'}`,
            }}
            onClick={subLocked ? () => onSubscriptionLocked(u.category, tier) : undefined}
          >
            <span style={{ fontSize: 11, lineHeight: 1 }}>{icon}</span>
            {u.category}
            {tier === 'gold'   && <span style={{ color: unlocked ? '#fbbf24' : subLocked ? '#92400e' : '#3d5a7a' }}>★</span>}
            {tier === 'silver' && <span style={{ color: unlocked ? '#7eb8e8' : subLocked ? '#1a3a6b' : '#3d5a7a' }}>◆</span>}
            {unlocked  && <span style={{ opacity: 0.7 }}>🔓</span>}
            {!unlocked && <span style={{ opacity: subLocked ? 0.8 : 0.5 }}>🔒</span>}
          </span>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Rankings() {
  const { user, API } = useAuth()
  const navigate      = useNavigate()
  const location      = useLocation()
  const { start }     = useAppTutorial()

  const [levels,         setLevels]         = useState(MOCK_LEVELS)
  const [ranks,          setRanks]          = useState(MOCK_RANKS?.map(r => ({ ...r, rankAbbreviation: r.abbreviation })) ?? [])
  const [pathwayUnlocks, setPathwayUnlocks] = useState(DEFAULT_PATHWAY_UNLOCKS)
  const [upgradeModal,   setUpgradeModal]   = useState(null) // { category, tier }

  const validTabs = ['levels', 'ranks']
  const [tab, setTab] = useState(validTabs.includes(location.state?.tab) ? location.state.tab : 'levels')

  // Re-sync tab on navigation
  useEffect(() => {
    setTab(validTabs.includes(location.state?.tab) ? location.state.tab : 'levels')
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => start('rankings'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/users/levels`).then(r => r.json()),
      fetch(`${API}/api/users/ranks`).then(r => r.json()),
      fetch(`${API}/api/settings`).then(r => r.json()),
    ])
      .then(([lvlData, rankData, settingsData]) => {
        if (lvlData?.data?.levels?.length)       setLevels(lvlData.data.levels)
        if (rankData?.data?.ranks?.length)        setRanks(rankData.data.ranks)
        if (settingsData?.pathwayUnlocks?.length) setPathwayUnlocks(settingsData.pathwayUnlocks)
      })
      .catch(() => {})
  }, [API])

  // ── Derived values ──────────────────────────────────────────────────────────

  const coins    = user?.cycleAircoins ?? 0
  const userTier = user?.subscriptionTier ?? 'free'
  const { current: currentLvl, coinsInLevel, coinsNeeded, progress: lvlProgress } = getLevelInfo(coins, levels)
  const userLevel = currentLvl.levelNumber ?? 1

  const sortedLevels = [...levels].sort((a, b) => b.levelNumber - a.levelNumber)

  const sortedRanks    = [...ranks].sort((a, b) => b.rankNumber - a.rankNumber)
  const userRankId     = user?.rank?._id ?? user?.rank ?? null
  const userRank       = userRankId
    ? (user.rank?.rankNumber != null ? user.rank : ranks.find(r => r._id?.toString() === userRankId?.toString()))
    : null
  const userRankNumber = userRank?.rankNumber ?? 1

  const userRankRowRef    = useRef(null)
  const rankListScrollRef = useRef(null)

  // Rank preview selection — defaults to user's current rank
  const [selectedRankNum, setSelectedRankNum] = useState(userRankNumber)
  // Keep default in sync when ranks load
  useEffect(() => {
    setSelectedRankNum(userRankNumber)
  }, [userRankNumber])

  // Scroll user's rank to centre of windowed list
  useEffect(() => {
    const container = rankListScrollRef.current
    const row       = userRankRowRef.current
    if (!container || !row) return
    const containerH = container.clientHeight
    const rowH       = row.offsetHeight
    container.scrollTop = row.offsetTop - containerH / 2 + rowH / 2
  }, [ranks, userRankNumber, tab])

  const selectedRank        = ranks.find(r => r.rankNumber === selectedRankNum) ?? null
  const previewRankUnlocks  = pathwayUnlocks.filter(u => (u.rankRequired ?? 1) === selectedRankNum)
  const isPreviewing        = selectedRankNum !== userRankNumber

  // First locked level that has new pathway unlocks (the carrot)
  const nextUnlockLevel = [...levels]
    .sort((a, b) => a.levelNumber - b.levelNumber)
    .find(lvl =>
      lvl.levelNumber > userLevel &&
      pathwayUnlocks.some(u => u.levelRequired === lvl.levelNumber && (u.rankRequired ?? 1) === userRankNumber)
    )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
    <SEO title="Rankings" description="See how you rank against other RAF applicants on the SkyWatch leaderboard." />
    <TutorialModal />
    <div className="max-w-lg mx-auto">

      {/* Header */}
      <div className="mb-5">
        <button
          onClick={() => navigate('/profile')}
          className="text-sm font-medium flex items-center gap-1 mb-3 transition-colors"
          style={{ color: '#4a6282' }}
          onMouseEnter={e => e.currentTarget.style.color = '#8ba0c0'}
          onMouseLeave={e => e.currentTarget.style.color = '#4a6282'}
        >
          ← Back
        </button>
        <p className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: '#4a6282' }}>RAF Skywatch</p>
        <h1 className="text-2xl font-extrabold" style={{ color: '#ddeaf8' }}>Progression</h1>
        <p className="text-sm mt-0.5" style={{ color: '#4a6282' }}>Level up and earn RAF Ranks to unlock new pathways.</p>
      </div>

      {/* Segmented selector */}
      <div
        className="grid grid-cols-2 mb-5 p-1 rounded-2xl"
        style={{ background: '#06101e', border: '1px solid #1a3060' }}
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
              background: tab === t.key ? '#1a3060' : 'transparent',
              color:      tab === t.key ? '#5baaff'  : '#4a6282',
              boxShadow:  tab === t.key ? '0 0 14px rgba(91,170,255,0.12)' : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── LEVELS TAB ─────────────────────────────────────────────────────── */}
      {tab === 'levels' && (
        <motion.div key="levels" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">

          {/* XP card */}
          <div
            className="rounded-2xl p-4"
            style={{
              background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)',
              border: '1px solid rgba(91,170,255,0.2)',
            }}
          >
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-sm font-extrabold intel-mono" style={{ color: '#5baaff' }}>
                LEVEL {currentLvl.levelNumber}
              </p>
              <p className="text-xs intel-mono" style={{ color: '#4a6282' }}>
                {coinsInLevel.toLocaleString()} / {coinsNeeded?.toLocaleString() ?? '—'} AC
              </p>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1a3060' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: '#5baaff' }}
                initial={{ width: 0 }}
                animate={{ width: `${lvlProgress}%` }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
            </div>
            <p className="text-xs mt-1.5" style={{ color: '#4a6282' }}>
              {coinsNeeded
                ? `${Math.max(0, coinsNeeded - coinsInLevel).toLocaleString()} Aircoins to Level ${currentLvl.levelNumber + 1}`
                : '⭐ Max level — RAF Rank Promotion on next cycle'
              }
            </p>
            {nextUnlockLevel && (
              <p className="text-xs mt-1.5 font-semibold" style={{ color: 'rgba(91,170,255,0.7)' }}>
                ↓ Next pathway unlock at Level {nextUnlockLevel.levelNumber}
              </p>
            )}
          </div>

          {/* Level list */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #1a3060' }}>
            {sortedLevels.map((lvl, i) => {
              const isCurrent  = lvl.levelNumber === userLevel
              const isAbove    = lvl.levelNumber > userLevel
              const isMax      = lvl.levelNumber === 10
              const lvlUnlocks = pathwayUnlocks.filter(u => u.levelRequired === lvl.levelNumber && (u.rankRequired ?? 1) === userRankNumber)
              return (
                <motion.div
                  key={lvl.levelNumber}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="px-4 py-3"
                  style={{
                    background:   isCurrent ? 'rgba(91,170,255,0.07)' : 'transparent',
                    borderBottom: '1px solid #1a3060',
                    opacity:      isAbove ? 0.45 : 1,
                  }}
                >
                  <div className="flex items-center gap-3">
                    {/* Level number */}
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-extrabold intel-mono shrink-0"
                      style={{
                        background: isCurrent ? '#5baaff'  : isAbove ? '#06101e' : '#0f2245',
                        color:      isCurrent ? '#06101e'  : isAbove ? '#3d5a7a' : '#5baaff',
                        border:    `1.5px solid ${isCurrent ? '#5baaff' : isAbove ? '#1a3060' : '#1a3060'}`,
                        boxShadow:  isCurrent ? '0 0 14px rgba(91,170,255,0.5)' : 'none',
                      }}
                    >
                      {lvl.levelNumber}
                    </span>

                    {/* Info */}
                    <div className="flex-1">
                      <p className="text-sm font-bold" style={{ color: isCurrent ? '#ddeaf8' : isAbove ? '#3d5a7a' : '#8ba0c0' }}>
                        Level {lvl.levelNumber}{isMax && <span className="ml-1.5" style={{ color: '#fbbf24' }}>⭐ MAX</span>}
                      </p>
                      <p className="text-xs intel-mono" style={{ color: '#3d5a7a' }}>
                        {lvl.cumulativeAircoins.toLocaleString()} Aircoins required
                      </p>
                    </div>

                    {/* Badges */}
                    {isCurrent && (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0 intel-mono"
                        style={{ background: 'rgba(91,170,255,0.15)', color: '#5baaff', border: '1px solid rgba(91,170,255,0.3)' }}
                      >
                        YOU
                      </span>
                    )}
                    {isMax && !isCurrent && (
                      <span className="text-xs font-semibold shrink-0" style={{ color: '#fbbf24' }}>Rank Up</span>
                    )}
                    {isAbove && !isCurrent && (
                      <span className="text-base shrink-0" style={{ opacity: 0.4 }}>🔒</span>
                    )}
                  </div>

                  {/* Inline pathway unlock badges */}
                  {lvlUnlocks.length > 0 && (
                    <div className="ml-11">
                      <UnlockBadges
                        unlocks={lvlUnlocks}
                        userLevel={userLevel}
                        userRankNumber={userRankNumber}
                        userTier={userTier}
                        onSubscriptionLocked={(cat, t) => setUpgradeModal({ category: cat, tier: t })}
                      />
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* ── RANKS TAB ──────────────────────────────────────────────────────── */}
      {tab === 'ranks' && (
        <motion.div key="ranks" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">

          {/* Rank preview card */}
          <div
            className="rounded-2xl p-4"
            style={{
              background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)',
              border: `1px solid ${isPreviewing ? 'rgba(91,170,255,0.35)' : 'rgba(91,170,255,0.2)'}`,
            }}
          >
            {/* Card header */}
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-widest font-bold" style={{ color: '#4a6282' }}>
                {isPreviewing ? '— PREVIEWING —' : '— YOUR RANK —'}
              </p>
              {isPreviewing && (
                <button
                  onClick={() => setSelectedRankNum(userRankNumber)}
                  className="text-xs font-semibold transition-colors"
                  style={{ color: '#4a6282' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#8ba0c0'}
                  onMouseLeave={e => e.currentTarget.style.color = '#4a6282'}
                >
                  Reset ×
                </button>
              )}
            </div>

            {/* Rank identity */}
            <div className="flex items-center gap-3">
              {/* Badge */}
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: '#06101e', border: '1.5px solid rgba(91,170,255,0.2)' }}
              >
                {selectedRank && selectedRank.rankNumber > 1
                  ? <RankBadge rankNumber={selectedRank.rankNumber} size={40} />
                  : <span className="text-base font-extrabold intel-mono" style={{ color: '#5baaff' }}>
                      {selectedRank?.rankAbbreviation ?? '—'}
                    </span>
                }
              </div>

              {/* Name + meta */}
              <div>
                <p className="text-lg font-extrabold leading-tight" style={{ color: '#ddeaf8' }}>
                  {selectedRank?.rankName ?? (isPreviewing ? 'Unknown Rank' : 'Unranked')}
                </p>
                {selectedRank && (
                  <p className="text-sm mt-0.5" style={{ color: '#5baaff' }}>
                    {selectedRank.rankAbbreviation ?? selectedRank.abbreviation ?? ''}
                    {selectedRank.rankType ? ` · ${selectedRank.rankType.replace(/_/g, ' ')}` : ''}
                  </p>
                )}
              </div>
            </div>

            {/* Pathway unlocks for this rank */}
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid #1a3060' }}>
              <p className="text-xs uppercase tracking-widest font-bold mb-1.5" style={{ color: '#4a6282' }}>
                Pathway Unlocks
              </p>
              {previewRankUnlocks.length > 0 ? (
                <UnlockBadges
                  unlocks={previewRankUnlocks}
                  userLevel={userLevel}
                  userRankNumber={userRankNumber}
                  userTier={userTier}
                  onSubscriptionLocked={(cat, t) => setUpgradeModal({ category: cat, tier: t })}
                />
              ) : (
                <p className="text-xs" style={{ color: '#3d5a7a' }}>No pathway unlocks at this rank.</p>
              )}
            </div>
          </div>

          {/* Hint */}
          <p className="text-xs text-center" style={{ color: '#3d5a7a' }}>
            Tap a rank to preview its pathway unlocks
          </p>

          {/* Rank list */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #1a3060' }}>
            <div ref={rankListScrollRef} style={{ height: 372, overflowY: 'auto', scrollbarWidth: 'none' }}>
            {sortedRanks.map((rank, i) => {
              const isUser     = rank.rankNumber === userRankNumber
              const isAbove    = rank.rankNumber > userRankNumber
              const isSelected = rank.rankNumber === selectedRankNum
              return (
                <motion.div
                  key={rank.rankNumber}
                  ref={isUser ? userRankRowRef : undefined}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                  onClick={() => setSelectedRankNum(rank.rankNumber)}
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer transition-all"
                  style={{
                    background:   isSelected ? 'rgba(91,170,255,0.09)' : 'transparent',
                    borderBottom: '1px solid #1a3060',
                    borderLeft:   isSelected ? '2px solid rgba(91,170,255,0.5)' : '2px solid transparent',
                    opacity:      isAbove && !isSelected ? 0.45 : 1,
                  }}
                >
                  {/* Rank badge / number */}
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold intel-mono shrink-0"
                    style={{
                      background: isUser ? '#5baaff' : isSelected ? '#1a3060' : isAbove ? '#06101e' : '#0f2245',
                      color:      isUser ? '#06101e' : isSelected ? '#5baaff' : isAbove ? '#3d5a7a' : '#5baaff',
                      border:    `1.5px solid ${isUser ? '#5baaff' : isSelected ? 'rgba(91,170,255,0.4)' : '#1a3060'}`,
                      boxShadow:  isUser ? '0 0 14px rgba(91,170,255,0.5)' : 'none',
                    }}
                  >
                    {rank.rankNumber > 1
                      ? <RankBadge rankNumber={rank.rankNumber} size={18} color={isUser ? '#06101e' : '#5baaff'} />
                      : (rank.rankAbbreviation ?? 'AC')}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-bold truncate"
                      style={{ color: isUser || isSelected ? '#ddeaf8' : isAbove ? '#3d5a7a' : '#8ba0c0' }}
                    >
                      {rank.rankAbbreviation ?? rank.abbreviation}
                    </p>
                    <p className="text-xs truncate" style={{ color: '#3d5a7a' }}>
                      {rank.rankName} · {rank.rankType?.replace(/_/g, ' ')}
                    </p>
                  </div>

                  {/* Status */}
                  {isUser && (
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0 intel-mono"
                      style={{ background: 'rgba(91,170,255,0.15)', color: '#5baaff', border: '1px solid rgba(91,170,255,0.3)' }}
                    >
                      YOU
                    </span>
                  )}
                  {isAbove && !isUser && <span className="text-base shrink-0" style={{ opacity: 0.3 }}>🔒</span>}
                  {isSelected && !isUser && (
                    <span className="text-xs shrink-0" style={{ color: 'rgba(91,170,255,0.5)' }}>▶</span>
                  )}
                </motion.div>
              )
            })}
            {sortedRanks.length === 0 && (
              <div className="px-4 py-6 text-center text-sm" style={{ color: '#3d5a7a' }}>
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
