import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import { MOCK_LEVELS, MOCK_RANKS, CATEGORY_ICONS } from '../../data/mockData'

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

const PATHWAY_STONE_COLORS = {
  Bases: '#2563eb', Aircrafts: '#475569', Ranks: '#d97706',
  Squadrons: '#7c3aed', Training: '#059669', Roles: '#dc2626',
  Threats: '#ea580c', Missions: '#0891b2',
}

function tierRankNum(tier) {
  return { free: 0, trial: 1, silver: 1, gold: 2 }[tier] ?? 0
}

function getLevelInfo(coins, levels) {
  if (!levels?.length) return { current: levels?.[0] ?? { levelNumber: 1, aircoinsToNextLevel: 100, cumulativeAircoins: 0 }, coinsInLevel: 0, coinsNeeded: 100, progress: 0 }
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

export default function Rankings() {
  const { user, API } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { start } = useAppTutorial()

  const [levels,         setLevels]         = useState(MOCK_LEVELS)
  const [ranks,          setRanks]          = useState(MOCK_RANKS?.map(r => ({ ...r, rankAbbreviation: r.abbreviation })) ?? [])
  const [pathwayUnlocks, setPathwayUnlocks] = useState(DEFAULT_PATHWAY_UNLOCKS)
  const [tab,            setTab]            = useState(location.state?.tab ?? 'levels') // 'levels' | 'ranks' | 'pathways'

  // Re-sync tab whenever the user navigates to this page (even if already here)
  useEffect(() => {
    setTab(location.state?.tab ?? 'levels')
  }, [location.key])

  // Tutorial on first visit
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
        if (lvlData?.data?.levels?.length)            setLevels(lvlData.data.levels)
        if (rankData?.data?.ranks?.length)            setRanks(rankData.data.ranks)
        if (settingsData?.pathwayUnlocks?.length)     setPathwayUnlocks(settingsData.pathwayUnlocks)
      })
      .catch(() => {})
  }, [API])

  const coins = user?.cycleAircoins ?? 0
  const { current: currentLvl, coinsInLevel, coinsNeeded, progress: lvlProgress } = getLevelInfo(coins, levels)
  const userLevel = currentLvl.levelNumber ?? 1

  const sortedRanks    = [...ranks].sort((a, b) => b.rankNumber - a.rankNumber)
  const userRankId     = user?.rank?._id ?? user?.rank ?? null
  const userRank       = userRankId
    ? (user.rank?.rankNumber != null ? user.rank : ranks.find(r => r._id?.toString() === userRankId?.toString()))
    : null
  const userRankNumber = userRank?.rankNumber ?? 1

  return (
    <>
    <TutorialModal />
    <div className="max-w-lg mx-auto">

      {/* Header */}
      <div className="mb-5">
        <button onClick={() => navigate('/profile')} className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-extrabold text-slate-900">Progression</h1>
        <p className="text-sm text-slate-500 mt-0.5">Level up and earn RAF Ranks.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {[
          { key: 'levels',   label: '🎖 Levels'   },
          { key: 'ranks',    label: '🎗️ Ranks'    },
          { key: 'pathways', label: '🗺️ Pathways' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
              ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-surface border border-slate-200 text-slate-500 hover:border-brand-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Levels tab */}
      {tab === 'levels' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">

          {/* XP panel */}
          <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
            <div className="flex justify-between items-baseline mb-2">
              <p className="text-sm font-bold text-slate-800">Level {currentLvl.levelNumber}</p>
              <p className="text-xs text-slate-500">{coinsInLevel.toLocaleString()} / {coinsNeeded?.toLocaleString() ?? '—'} Aircoins</p>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-brand-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${lvlProgress}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              {coinsNeeded
                ? `${Math.max(0, coinsNeeded - coinsInLevel).toLocaleString()} Aircoins to Level ${currentLvl.levelNumber + 1}`
                : '⭐ Max level — Rank Promotion on next cycle'
              }
            </p>
          </div>

          {/* Level list */}
          <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
            {[...levels].sort((a, b) => b.levelNumber - a.levelNumber).map((lvl, i) => {
              const isCurrent = lvl.levelNumber === currentLvl.levelNumber
              const isAbove   = lvl.levelNumber > currentLvl.levelNumber
              const isMax     = lvl.levelNumber === 10
              return (
                <motion.div
                  key={lvl.levelNumber}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0
                    ${isCurrent ? 'bg-brand-50' : isAbove ? 'opacity-40' : ''}`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-extrabold shrink-0
                    ${isCurrent ? 'bg-brand-600 text-white' : isAbove ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600'}`}>
                    {lvl.levelNumber}
                  </span>
                  <div className="flex-1">
                    <p className={`text-sm font-bold ${isCurrent ? 'text-brand-700' : 'text-slate-700'}`}>
                      Level {lvl.levelNumber} {isMax && <span className="text-amber-500">⭐</span>}
                    </p>
                    <p className="text-xs text-slate-400">{lvl.cumulativeAircoins.toLocaleString()} Aircoins required</p>
                  </div>
                  {isCurrent && <span className="text-xs font-bold text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full">You</span>}
                  {isMax && !isCurrent && <span className="text-xs text-amber-600">Rank Promotion</span>}
                  {isAbove && <span className="text-slate-300 text-lg">🔒</span>}
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Ranks tab */}
      {tab === 'ranks' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">

          {/* Current rank panel */}
          <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Current RAF Rank</p>
            <p className="text-lg font-extrabold text-slate-900">{userRank?.rankName ?? 'Unranked'}</p>
            {userRank?.rankAbbreviation && (
              <p className="text-sm text-slate-500">{userRank.rankAbbreviation} · {userRank.rankType?.replace(/_/g, ' ')}</p>
            )}
          </div>

          {/* Rank list */}
          <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
            {sortedRanks.map((rank, i) => {
              const isUser  = userRankNumber !== null && rank.rankNumber === userRankNumber
              const isAbove = userRankNumber !== null && rank.rankNumber > userRankNumber
              return (
                <motion.div
                  key={rank.rankNumber}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0
                    ${isUser ? 'bg-brand-50' : isAbove ? 'opacity-40' : ''}`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0
                    ${isUser ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {rank.rankNumber}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate ${isUser ? 'text-brand-700' : 'text-slate-800'}`}>
                      {rank.rankAbbreviation ?? rank.abbreviation}
                    </p>
                    <p className="text-xs text-slate-400 truncate">{rank.rankName} · {rank.rankType?.replace(/_/g, ' ')}</p>
                  </div>
                  {isUser && <span className="text-xs font-bold text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full shrink-0">You</span>}
                  {isAbove && !isUser && <span className="text-slate-300">🔒</span>}
                </motion.div>
              )
            })}
            {sortedRanks.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-slate-400">No rank data available.</div>
            )}
          </div>
        </motion.div>
      )}

      {/* Pathways tab */}
      {tab === 'pathways' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">

          <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Learning Pathways</p>
            <p className="text-sm text-slate-400">
              Complete levels and achieve ranks to unlock new subject pathways.
              Some pathways also require a Silver or Gold subscription.
            </p>
          </div>

          <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
            {pathwayUnlocks.map((unlock, i) => {
              const color    = PATHWAY_STONE_COLORS[unlock.category] ?? '#475569'
              const lvlMet   = userLevel      >= (unlock.levelRequired ?? 1)
              const rankMet  = userRankNumber >= (unlock.rankRequired  ?? 1)
              const tierMet  = tierRankNum(user?.subscriptionTier ?? 'free') >= tierRankNum(unlock.tierRequired ?? 'free')
              const unlocked = lvlMet && rankMet && tierMet
              const rankName = MOCK_RANKS.find(r => r.rankNumber === unlock.rankRequired)?.rankName ?? `Rank ${unlock.rankRequired}`

              return (
                <motion.div
                  key={unlock.category}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 ${!unlocked ? 'opacity-50' : ''}`}
                >
                  {/* Category icon */}
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
                    style={{ background: unlocked ? color + '22' : '#172236', border: `2px solid ${unlocked ? color + '55' : '#243650'}` }}
                  >
                    <span style={{ opacity: unlocked ? 1 : 0.4 }}>{CATEGORY_ICONS[unlock.category] ?? '📄'}</span>
                  </div>

                  {/* Category name + requirements */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${unlocked ? 'text-slate-900' : 'text-slate-500'}`}>{unlock.category}</p>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lvlMet ? 'text-emerald-400 bg-emerald-950' : 'text-slate-500 bg-slate-800'}`}>
                        Lv {unlock.levelRequired}
                      </span>
                      {(unlock.rankRequired ?? 1) > 1 && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${rankMet ? 'text-emerald-400 bg-emerald-950' : 'text-slate-500 bg-slate-800'}`}>
                          {rankName}
                        </span>
                      )}
                      {unlock.tierRequired !== 'free' && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tierMet ? 'text-emerald-400 bg-emerald-950' : 'text-amber-400 bg-amber-950'}`}>
                          {unlock.tierRequired.charAt(0).toUpperCase() + unlock.tierRequired.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status badge */}
                  {unlocked
                    ? <span className="text-xs font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-full shrink-0">✓ Unlocked</span>
                    : (
                      !tierMet
                        ? <button onClick={() => navigate('/subscribe')} className="text-xs font-bold text-amber-400 bg-amber-950 border border-amber-800 px-2 py-0.5 rounded-full shrink-0 hover:bg-amber-900 transition-colors">Upgrade ↗</button>
                        : <span className="text-slate-400 shrink-0">🔒</span>
                    )
                  }
                </motion.div>
              )
            })}
          </div>

          <button
            onClick={() => navigate('/learn-priority')}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-colors"
            style={{ background: '#2563eb' }}
          >
            Go to Learning Pathway ✈️
          </button>
        </motion.div>
      )}

    </div>
    </>
  )
}
