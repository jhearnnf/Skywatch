import { useState, useEffect, useRef } from 'react'
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
  const bg    = isCurrent ? C.brand  : isSelected ? C.border : isAbove ? C.deep : C.surface
  const color = isCurrent ? C.deep   : isSelected ? C.brand  : isAbove ? C.dim  : C.brand
  const bdr   = isCurrent ? C.brand  : isSelected ? 'rgba(91,170,255,0.4)' : C.border
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

function LevelRow({ lvl, i, isLast, userLevel, userRankNumber, userTier, pathwayUnlocks, onSubscriptionLocked }) {
  const isCurrent  = lvl.levelNumber === userLevel
  const isAbove    = lvl.levelNumber > userLevel
  const isMax      = lvl.levelNumber === 10
  const lvlUnlocks = pathwayUnlocks.filter(u => u.levelRequired === lvl.levelNumber && (u.rankRequired ?? 1) === userRankNumber)
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.04 }}
      className="px-4 py-3"
      style={{
        background:   isCurrent ? 'rgba(91,170,255,0.07)' : 'transparent',
        borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
        opacity:      isAbove ? 0.45 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <NumberCircle number={lvl.levelNumber} isCurrent={isCurrent} isAbove={isAbove} />
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: isCurrent ? C.text : isAbove ? C.dim : C.subtle }}>
            Level {lvl.levelNumber}{isMax && <span className="ml-1.5 text-white"><span className="star-silver">⭐</span> MAX</span>}
          </p>
          <p className="text-xs intel-mono" style={{ color: C.dim }}>
            {lvl.cumulativeAircoins.toLocaleString()} Aircoins required
          </p>
        </div>
        {isCurrent && <YouBadge />}
        {isMax && !isCurrent && <span className="text-xs font-semibold shrink-0 text-white">Rank Up</span>}
        {isAbove && !isCurrent && <span className="text-base shrink-0" style={{ opacity: 0.4 }}>🔒</span>}
      </div>
      {lvlUnlocks.length > 0 && (
        <div className="ml-11">
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

function RankRow({ rank, i, isLast, isUser, isAbove, isSelected, onClick, rowRef }) {
  return (
    <motion.div
      ref={rowRef}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.025 }}
      onClick={onClick}
      className="px-4 py-3 flex items-center gap-3 cursor-pointer transition-all"
      style={{
        background:   isSelected ? 'rgba(91,170,255,0.09)' : 'transparent',
        borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
        borderLeft:   isSelected ? '2px solid rgba(91,170,255,0.5)' : '2px solid transparent',
        opacity:      isAbove && !isSelected ? 0.45 : 1,
      }}
    >
      <NumberCircle number={rank.rankNumber} isCurrent={isUser} isAbove={isAbove} isSelected={isSelected}>
        {rank.rankNumber > 1
          ? <RankBadge rankNumber={rank.rankNumber} size={18} color={isUser ? C.deep : C.brand} />
          : (rank.rankAbbreviation ?? 'AC')}
      </NumberCircle>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-bold truncate"
          style={{ color: isUser || isSelected ? C.text : isAbove ? C.dim : C.subtle }}
        >
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

  const coins    = user?.cycleAircoins ?? 0
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

  const userRankRowRef    = useRef(null)
  const rankListScrollRef = useRef(null)
  const levelsListRef     = useRef(null)
  const [levelsListH, setLevelsListH] = useState(null)

  // Measure levels list height so ranks container can match
  useEffect(() => {
    if (tab === 'levels' && levelsListRef.current) {
      setLevelsListH(levelsListRef.current.offsetHeight)
    }
  }, [tab, sortedLevels])

  const [selectedRankNum, setSelectedRankNum] = useState(userRankNumber)
  useEffect(() => { setSelectedRankNum(userRankNumber) }, [userRankNumber])

  useEffect(() => {
    const container = rankListScrollRef.current
    if (!container) return
    const row = userRankRowRef.current
    if (row) {
      const containerH = container.clientHeight
      const rowH       = row.offsetHeight
      container.scrollTop = row.offsetTop - containerH / 2 + rowH / 2
    } else {
      // No user — scroll to bottom (lowest ranks, where newcomers start)
      container.scrollTop = container.scrollHeight
    }
  }, [ranks, userRankNumber, tab])

  const selectedRank        = ranks.find(r => r.rankNumber === selectedRankNum) ?? null
  const previewRankUnlocks  = pathwayUnlocks.filter(u => (u.rankRequired ?? 1) === selectedRankNum)
  const isPreviewing        = selectedRankNum !== userRankNumber

  const nextUnlockLevel = [...(levels ?? [])]
    .sort((a, b) => a.levelNumber - b.levelNumber)
    .find(lvl =>
      lvl.levelNumber > userLevel &&
      pathwayUnlocks.some(u => u.levelRequired === lvl.levelNumber && (u.rankRequired ?? 1) === userRankNumber)
    )

  const handleSubscriptionLocked = (cat, t) => setUpgradeModal({ category: cat, tier: t })

  // Measure badge content height for smooth card resize
  const badgeContentRef = useRef(null)
  const [badgeHeight, setBadgeHeight] = useState('auto')
  useEffect(() => {
    if (badgeContentRef.current) {
      setBadgeHeight(badgeContentRef.current.scrollHeight)
    }
  }, [selectedRankNum, previewRankUnlocks])

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

      {/* ── LEVELS TAB ────────────────────────────────────────────────────── */}
      {tab === 'levels' && (
        <motion.div key="levels" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">

          {/* XP card — only for signed-in users */}
          {user && (
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)',
                border: '1px solid rgba(91,170,255,0.2)',
              }}
            >
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
                  ? `${Math.max(0, coinsNeeded - coinsInLevel).toLocaleString()} Aircoins to Level ${userLevel + 1}`
                  : <><span className="star-silver">⭐</span> Max level — RAF Rank Promotion on next cycle</>
                }
              </p>
              {nextUnlockLevel && (
                <p className="text-xs mt-1.5 font-semibold" style={{ color: 'rgba(91,170,255,0.7)' }}>
                  ↓ Next pathway unlock at Level {nextUnlockLevel.levelNumber}
                </p>
              )}
            </div>
          )}

          {/* Level list */}
          <div ref={levelsListRef} className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            {sortedLevels.map((lvl, i) => (
              <LevelRow
                key={lvl.levelNumber}
                lvl={lvl}
                i={i}
                isLast={i === sortedLevels.length - 1}
                userLevel={userLevel}
                userRankNumber={userRankNumber}
                userTier={userTier}
                pathwayUnlocks={pathwayUnlocks}
                onSubscriptionLocked={handleSubscriptionLocked}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* ── RANKS TAB ─────────────────────────────────────────────────────── */}
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
            </div>

            {/* Pathway unlocks — animated on rank change */}
            <div className="pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
              <p className="text-xs uppercase tracking-widest font-bold mb-1.5" style={{ color: C.muted }}>
                Pathway Unlocks
              </p>
              <motion.div
                animate={{ height: badgeHeight }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                <div ref={badgeContentRef} className="flex flex-wrap gap-1">
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
              </motion.div>
              <p className="text-xs mt-2" style={{ color: C.dim }}>
                Tap a rank below to preview its unlocks
              </p>
            </div>
          </div>

          {/* Rank list */}
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            <div ref={rankListScrollRef} style={{ height: levelsListH ?? 540, overflowY: 'auto', scrollbarWidth: 'none' }}>
              {sortedRanks.map((rank, i) => (
                <RankRow
                  key={rank.rankNumber}
                  rank={rank}
                  i={i}
                  isLast={i === sortedRanks.length - 1}
                  isUser={rank.rankNumber === userRankNumber}
                  isAbove={rank.rankNumber > userRankNumber}
                  isSelected={rank.rankNumber === selectedRankNum}
                  onClick={() => setSelectedRankNum(rank.rankNumber)}
                  rowRef={rank.rankNumber === userRankNumber ? userRankRowRef : undefined}
                />
              ))}
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
