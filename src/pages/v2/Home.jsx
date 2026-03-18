import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { isCategoryLocked } from '../../utils/subscription'
import TutorialModal from '../../components/tutorial/TutorialModal'
import { CATEGORIES, CATEGORY_ICONS, MOCK_LEVELS } from '../../data/mockData'

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

// XP progress ring
function XPRing({ pct = 0, level = 1, size = 72 }) {
  const r = (size / 2) - 6
  const circ = 2 * Math.PI * r
  const dash = circ * (pct / 100)
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a3060" strokeWidth="5"/>
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke="#5baaff" strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-extrabold text-brand-600">{level}</span>
      </div>
    </div>
  )
}

// Category card
function CategoryCard({ category, total = 0, done = 0, index = 0, locked = false }) {
  const icon     = CATEGORY_ICONS[category] ?? '📄'
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0
  const complete = !locked && pct === 100

  const inner = (
    <>
      {/* Icon + label row */}
      <div className="flex items-start justify-between">
        <span className={`text-3xl transition-transform ${!locked ? 'group-hover:scale-110' : ''}`}>{icon}</span>
        {locked
          ? <span className="text-xs bg-slate-200 text-slate-500 rounded-full px-1.5 py-0.5 font-bold leading-none">🔒</span>
          : complete && <span className="text-emerald-600 text-xs font-bold bg-emerald-100 px-2 py-0.5 rounded-full">✓ Done</span>
        }
      </div>

      <div>
        <p className="font-bold text-slate-800 text-sm">{category}</p>
        <p className="text-xs text-slate-400 mt-0.5">{total} briefs</p>
      </div>

      {/* Progress bar — only for logged-in users on unlocked categories */}
      {!locked && total > 0 && (
        <div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${complete ? 'bg-emerald-500' : 'bg-brand-500'}`}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, delay: index * 0.05 + 0.3 }}
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{done}/{total} read</p>
        </div>
      )}
    </>
  )

  const baseClass = `flex flex-col gap-3 rounded-2xl p-4 border transition-all card-shadow card-intel`
  const stateClass = locked
    ? 'border-slate-200 bg-surface opacity-60 cursor-not-allowed'
    : complete
      ? 'border-emerald-300 bg-emerald-50/40 hover:card-shadow-hover hover:-translate-y-0.5'
      : 'bg-surface border-slate-200 hover:border-brand-400 hover:card-shadow-hover hover:-translate-y-0.5'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {locked ? (
        <div className={`${baseClass} ${stateClass}`}>{inner}</div>
      ) : (
        <Link to={`/learn/${encodeURIComponent(category)}`} className={`group ${baseClass} ${stateClass}`}>
          {inner}
        </Link>
      )}
    </motion.div>
  )
}

export default function Home() {
  const { user, API }  = useAuth()
  const { start }      = useAppTutorial()
  const { settings }   = useAppSettings()
  const navigate       = useNavigate()
  const [counts,       setCounts]       = useState({}) // { [category]: total } — all categories
  const [stats,        setStats]        = useState({}) // { [category]: { total, done } } — logged-in only
  const [missionDone,  setMissionDone]  = useState(false)
  const [latestBriefs, setLatestBriefs] = useState([])
  const levelInfo = user ? getLevelInfo(user.cycleAircoins ?? 0) : null

  // Mission done if the user completed a brief today (server-authoritative via lastStreakDate)
  useEffect(() => {
    if (!user?.lastStreakDate) { setMissionDone(false); return }
    setMissionDone(new Date(user.lastStreakDate).toDateString() === new Date().toDateString())
  }, [user?.lastStreakDate])

  // Start tutorial on first visit
  useEffect(() => {
    const t = setTimeout(() => start('home'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch total brief counts per category — available to all users including guests
  useEffect(() => {
    fetch(`${API}/api/briefs/category-counts`)
      .then(r => r.json())
      .then(data => { if (data.status === 'success') setCounts(data.data?.counts ?? {}) })
      .catch(() => {})
  }, [API])

  // Fetch per-category read progress — logged-in users only
  useEffect(() => {
    if (!user) { setStats({}); return }
    fetch(`${API}/api/briefs/category-stats`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data.status === 'success') setStats(data.data?.stats ?? {}) })
      .catch(() => {})
  }, [user, API])

  // Fetch latest 4 briefs for "keep learning" strip — re-fetch on user change so isRead/isStarted resets after logout
  useEffect(() => {
    fetch(`${API}/api/briefs?limit=4`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setLatestBriefs(data.data?.briefs ?? []))
      .catch(() => {})
  }, [user, API])

  const today   = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const greeting = user
    ? `Welcome back, ${user.displayName?.split(' ')[0] || 'Agent'}`
    : 'Good to see you'

  return (
    <>
      <TutorialModal />

      {/* Greeting + stats */}
      <div className="mb-6">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">{today}</p>
        <h1 className="text-2xl font-extrabold text-slate-900">{greeting}</h1>
        {!user && (
          <p className="text-sm text-slate-500 mt-1">
            <Link to="/login" className="text-brand-600 font-semibold">Sign in</Link> to track your progress and earn Aircoins.
          </p>
        )}
      </div>

      {/* User XP card */}
      {user && levelInfo && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 mb-6 card-shadow border border-brand-300/40"
          style={{ background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)' }}
        >
          <div className="flex items-center gap-4">
            <XPRing pct={levelInfo.progress} level={levelInfo.level} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-brand-600 mb-0.5 intel-mono">Level {levelInfo.level}</p>
              <div className="h-2 bg-brand-200/60 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${levelInfo.progress}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <p className="text-xs text-slate-600 mt-1">
                {levelInfo.current} / {levelInfo.next} Aircoins to Level {levelInfo.level + 1}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl">🔥</div>
              <div className="text-lg font-bold text-amber-700">{user.loginStreak ?? 0}</div>
              <div className="text-xs text-slate-600 intel-mono">streak</div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Daily challenge prompt */}
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2 }}
        className={`rounded-2xl p-4 mb-6 flex items-center gap-3 border
          ${missionDone
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'
          }`}
      >
        <span className="text-2xl">{missionDone ? '✅' : '⭐'}</span>
        <div className="flex-1 min-w-0">
          {missionDone ? (
            <>
              <p className="text-sm font-bold text-emerald-800">Mission complete!</p>
              <p className="text-xs text-emerald-600">You've read a brief today — streak secured. Keep it up!</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-amber-800">Daily mission available</p>
              <p className="text-xs text-amber-600">Read one brief today to keep your streak going.</p>
            </>
          )}
        </div>
        {!missionDone && (
          <Link
            to="/learn"
            className="shrink-0 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-xl transition-colors"
          >
            Go →
          </Link>
        )}
      </motion.div>

      {/* Keep learning — latest briefs */}
      {latestBriefs.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">Latest Briefs</h2>
            <Link to="/learn" className="text-xs font-semibold text-brand-600 hover:text-brand-700">See all →</Link>
          </div>
          <div className="space-y-2">
            {latestBriefs.map((brief, i) => {
              const locked = brief.isLocked

              const inner = (
                <>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg
                    ${locked ? 'bg-slate-100' : brief.isRead ? 'bg-emerald-100/80' : brief.isStarted ? 'bg-amber-100/80' : 'bg-brand-100'}`}>
                    {locked ? '🔒' : brief.isRead ? '✓' : brief.isStarted ? '◑' : (CATEGORY_ICONS[brief.category] ?? '📄')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate ${locked ? 'text-slate-400' : brief.isRead ? 'text-emerald-800' : brief.isStarted ? 'text-amber-900' : 'text-slate-800'}`}>
                      {brief.title}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {locked ? 'Sign in to read' : brief.isStarted && !brief.isRead ? 'In Progress' : brief.category}
                    </p>
                  </div>
                  {!locked && (
                    <span className={`transition-colors ${brief.isRead ? 'text-emerald-300 group-hover:text-emerald-500' : brief.isStarted ? 'text-amber-300 group-hover:text-amber-500' : 'text-slate-300 group-hover:text-brand-400'}`}>→</span>
                  )}
                </>
              )

              const baseClass = `flex items-center gap-3 rounded-2xl px-4 py-3 border transition-all card-shadow card-intel`

              return (
                <motion.div
                  key={brief._id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  {locked ? (
                    <div className={`${baseClass} opacity-60 cursor-not-allowed bg-surface border-slate-200`}>
                      {inner}
                    </div>
                  ) : (
                    <Link
                      to={`/brief/${brief._id}`}
                      className={`group ${baseClass} hover:-translate-y-0.5
                        ${brief.isRead
                          ? 'bg-emerald-50/60 border-emerald-200 hover:border-emerald-300'
                          : brief.isStarted
                            ? 'bg-amber-50/60 border-amber-200 hover:border-amber-300'
                            : 'bg-surface border-slate-200 hover:border-brand-400'}`}
                    >
                      {inner}
                    </Link>
                  )}
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {/* Subject grid */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-800">Subject Areas</h2>
        <Link to="/learn" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
          Browse all →
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {CATEGORIES.map((cat, i) => (
          <CategoryCard
            key={cat}
            category={cat}
            total={counts[cat] ?? stats[cat]?.total ?? 0}
            done={stats[cat]?.done ?? 0}
            index={i}
            locked={isCategoryLocked(cat, user, settings)}
          />
        ))}
      </div>
    </>
  )
}
