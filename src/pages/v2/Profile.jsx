import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import { MOCK_LEVELS, MOCK_LEADERBOARD } from '../../data/mockData'
import { getMasterVolume, setMasterVolume } from '../../utils/sound'
import { displayTier } from '../../utils/subscription'

function getLevelInfo(coins) {
  const levels = MOCK_LEVELS
  const idx    = [...levels].reverse().findIndex(l => coins >= l.cumulativeAircoins)
  const lvl    = idx >= 0 ? levels[levels.length - 1 - idx] : levels[0]
  const next   = levels[levels.indexOf(lvl) + 1]
  const base   = lvl.cumulativeAircoins
  const cap    = next ? next.cumulativeAircoins - base : 200
  const earned = Math.max(0, coins - base)
  return { level: lvl.levelNumber, progress: Math.min(100, Math.round((earned / cap) * 100)), current: earned, next: cap }
}

function StatCard({ label, value, icon, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`flex flex-col items-center gap-1 bg-surface rounded-2xl p-3 border border-slate-200 card-shadow text-center
        ${onClick ? 'hover:border-brand-300 hover:bg-brand-50 transition-all cursor-pointer' : ''}`}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-lg font-extrabold text-slate-900">{value}</span>
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
    </Tag>
  )
}

const TUTORIAL_LABELS = [
  { key: 'home',        label: '🏠 Home',         emoji: '🏠' },
  { key: 'learn',       label: '📚 Learn',        emoji: '📚' },
  { key: 'briefReader', label: '📋 Brief Reader', emoji: '📋' },
  { key: 'quiz',        label: '🎯 Quiz',         emoji: '🎯' },
  { key: 'play',        label: '🎮 Play Hub',     emoji: '🎮' },
  { key: 'profile',     label: '👤 Profile',      emoji: '👤' },
  { key: 'rankings',    label: '🏆 Rankings',     emoji: '🏆' },
]

export default function Profile() {
  const { user, setUser, API } = useAuth()
  const navigate = useNavigate()
  const { start, replay } = useAppTutorial()

  const [stats,       setStats]       = useState({ brifsRead: 0, gamesPlayed: 0, winPercent: 0 })
  const [levels,      setLevels]      = useState(MOCK_LEVELS)
  const [leaderboard, setLeaderboard] = useState(MOCK_LEADERBOARD)
  const [diffBusy,    setDiffBusy]    = useState(false)
  const [masterVol,   setMasterVol]   = useState(() => getMasterVolume())
  const [tab,         setTab]         = useState('stats') // 'stats' | 'leaderboard' | 'tutorials'

  // Tutorial on first visit
  useEffect(() => {
    const t = setTimeout(() => start('profile'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/users/levels`).then(r => r.json()),
      fetch(`${API}/api/users/settings`).then(r => r.json()),
    ])
      .then(([lvlData, settingsData]) => {
        if (lvlData?.data?.levels?.length) setLevels(lvlData.data.levels)
        const useLive = settingsData?.data?.useLiveLeaderboard ?? false
        if (useLive) {
          return fetch(`${API}/api/users/leaderboard`)
            .then(r => r.json())
            .then(lbData => setLeaderboard(lbData?.data?.agents ?? []))
        }
      })
      .catch(() => {})
  }, [API])

  useEffect(() => {
    if (!user) { setStats({ brifsRead: 0, gamesPlayed: 0, winPercent: 0 }); return }
    fetch(`${API}/api/users/stats`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data?.data) setStats({
          brifsRead:   data.data.brifsRead   ?? 0,
          gamesPlayed: data.data.gamesPlayed ?? 0,
          winPercent:  data.data.winPercent  ?? 0,
        })
      })
      .catch(() => {})
  }, [API, user])

  const changeDifficulty = async (d) => {
    if (diffBusy || d === user?.difficultySetting) return
    setDiffBusy(true)
    try {
      const res  = await fetch(`${API}/api/users/me/difficulty`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: d }),
      })
      const data = await res.json()
      if (data?.data?.user) setUser(data.data.user)
    } catch { /* non-fatal */ }
    finally { setDiffBusy(false) }
  }

  const cycleCoins = user?.cycleAircoins ?? 0   // drives XP bar (resets per rank cycle)
  const totalCoins = user?.totalAircoins ?? 0   // lifetime total — shown in stats grid
  const levelInfo  = getLevelInfo(cycleCoins)
  const rankDisplay = user?.rank && typeof user.rank === 'object' && user.rank.rankName
    ? `${user.rank.rankName} (${user.rank.rankAbbreviation})`
    : 'Unranked'

  return (
    <>
    <TutorialModal />
    <div className="max-w-lg mx-auto">

      {/* User card */}
      {user ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-5 mb-5 card-shadow border border-brand-300/40"
          style={{ background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)' }}
        >
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-14 h-14 rounded-2xl bg-brand-200/60 border-2 border-brand-400/50 flex items-center justify-center text-xl font-extrabold text-brand-600 shrink-0">
              {(user.displayName || user.email || 'A')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-lg text-slate-800 leading-tight truncate">{user.displayName || 'Agent'}</p>
              <p className="text-slate-600 text-sm">{rankDisplay}</p>
              <p className="text-slate-500 text-xs mt-0.5 intel-mono">Agent #{user.agentNumber ?? '———'}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-slate-500 intel-mono">Streak</p>
              <p className="text-2xl font-extrabold text-amber-700">{user.loginStreak ?? 0}</p>
              <p className="text-lg">🔥</p>
            </div>
          </div>

          {/* XP bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-600 mb-1 intel-mono">
              <span>Level {levelInfo.level}</span>
              <span>{levelInfo.current} / {levelInfo.next} Aircoins</span>
            </div>
            <div className="h-2 bg-brand-200/50 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-brand-600 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${levelInfo.progress}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 mb-5 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to view your profile</p>
          <p className="text-sm text-slate-500 mb-4">Track progress, earn Aircoins, and climb the ranks.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { key: 'stats',       label: '📊 Stats' },
          { key: 'leaderboard', label: '🏆 Ranks' },
          { key: 'tutorials',   label: '💡 Help' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all
              ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-surface border border-slate-200 text-slate-500 hover:border-brand-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Stats tab */}
      {tab === 'stats' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">

          {/* Stats grid */}
          <div className={`grid grid-cols-2 gap-3 ${!user ? 'opacity-40 pointer-events-none select-none blur-sm' : ''}`}>
            <StatCard label="Briefs Read"  value={stats.brifsRead}           icon="📋" onClick={user ? () => navigate('/intel-brief-history') : undefined} />
            <StatCard label="Games Played" value={stats.gamesPlayed}         icon="🎯" onClick={user ? () => navigate('/game-history') : undefined} />
            <StatCard label="Avg Score"    value={`${stats.winPercent}%`}    icon="✓"  onClick={user ? () => navigate('/game-history') : undefined} />
            <StatCard label="Aircoins"     value={totalCoins.toLocaleString()} icon="⭐" onClick={user ? () => navigate('/aircoin-history') : undefined} />
          </div>

          {user && (
            <>
              {/* Difficulty */}
              <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Quiz Difficulty</p>
                <div className="flex gap-2">
                  {[
                    { value: 'easy',   label: '🌱 Standard' },
                    { value: 'medium', label: '🔥 Advanced' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => changeDifficulty(opt.value)}
                      disabled={diffBusy}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                        ${(user.difficultySetting ?? 'easy') === opt.value
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Volume */}
              <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
                <div className="flex justify-between items-center mb-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">App Volume</p>
                  <span className="text-sm font-bold text-brand-600">{masterVol}%</span>
                </div>
                <input
                  type="range"
                  className="w-full accent-brand-500 cursor-pointer"
                  min={0} max={100}
                  value={masterVol}
                  onChange={e => {
                    const v = Number(e.target.value)
                    setMasterVol(v)
                    setMasterVolume(v)
                  }}
                  aria-label="App volume"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>Mute</span><span>Max</span>
                </div>
              </div>

              {/* Subscription */}
              {(() => {
                const tier        = user.subscriptionTier ?? 'free'
                const isGold      = tier === 'gold'
                const isSilver    = tier === 'silver'
                const isActiveTrial = tier === 'trial' && user.isTrialActive
                const hasPaidPerks  = isGold || isSilver || isActiveTrial
                const icon = isGold ? '🥇' : (isSilver || isActiveTrial) ? '🥈' : '🆓'
                const badgeClass = isGold
                  ? 'bg-amber-100 text-amber-700 group-hover:bg-amber-200'
                  : (isSilver || isActiveTrial)
                    ? 'bg-brand-100 text-brand-700 group-hover:bg-brand-200'
                    : 'bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700'
                return (
                  <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Subscription</p>
                    <Link
                      to="/subscribe"
                      className="flex items-center justify-between hover:bg-slate-50 rounded-xl px-1 py-1 -mx-1 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{icon}</span>
                        <div>
                          <p className="text-sm font-semibold text-slate-700">Current Plan</p>
                          <p className="text-xs text-slate-400">{displayTier(user)}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${badgeClass}`}>
                        {hasPaidPerks ? 'Manage →' : 'Upgrade →'}
                      </span>
                    </Link>
                  </div>
                )
              })()}

              {/* Links */}
              <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow space-y-2">
                <Link to="/rankings" className="flex items-center justify-between py-2 px-1 text-sm font-semibold text-slate-700 hover:text-brand-600 transition-colors">
                  <span>🏅 View Progression & Ranks</span>
                  <span className="text-slate-400">→</span>
                </Link>
                <div className="h-px bg-slate-100" />
                <Link to="/report" className="flex items-center justify-between py-2 px-1 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors">
                  <span>⚠️ Report a Problem</span>
                  <span className="text-slate-400">→</span>
                </Link>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* Leaderboard tab */}
      {tab === 'leaderboard' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <p className="font-bold text-slate-800 text-sm">Top Agents — Aircoins</p>
          </div>
          <ol className="divide-y divide-slate-100">
            {leaderboard.map((agent, i) => {
              const pos = i + 1
              const isCurrent = user?.agentNumber === agent.agentNumber
              return (
                <li
                  key={agent.agentNumber}
                  className={`flex items-center gap-3 px-4 py-3 ${isCurrent ? 'bg-brand-50' : ''}`}
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0
                    ${pos === 1 ? 'bg-amber-400 text-white' : pos === 2 ? 'bg-slate-300 text-white' : pos === 3 ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {pos}
                  </span>
                  <span className={`flex-1 text-sm font-semibold ${isCurrent ? 'text-brand-700' : 'text-slate-800'}`}>
                    Agent {agent.agentNumber} {isCurrent && <span className="text-xs text-brand-500">(You)</span>}
                  </span>
                  <span className="text-sm font-bold text-amber-600">⭐ {agent.totalAircoins.toLocaleString()}</span>
                </li>
              )
            })}
            {leaderboard.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-400">No agents yet</li>
            )}
          </ol>
        </motion.div>
      )}

      {/* Tutorials tab */}
      {tab === 'tutorials' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <p className="text-sm text-slate-500 mb-1">Replay any tutorial to revisit how a feature works.</p>
          <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
            {TUTORIAL_LABELS.map((tut, i) => (
              <div
                key={tut.key}
                className={`flex items-center gap-3 px-4 py-3 ${i < TUTORIAL_LABELS.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <span className="text-xl w-7 text-center">{tut.emoji}</span>
                <span className="flex-1 text-sm font-semibold text-slate-700">{tut.label}</span>
                <button
                  onClick={() => replay(tut.key)}
                  className="text-xs font-bold text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-full transition-colors"
                >
                  Replay
                </button>
              </div>
            ))}
          </div>
        </motion.div>
      )}

    </div>
    </>
  )
}
