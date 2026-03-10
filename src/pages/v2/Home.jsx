import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
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
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="5"/>
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke="#1a76e4" strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-extrabold text-brand-700">{level}</span>
      </div>
    </div>
  )
}

// Category card
function CategoryCard({ category, progress = 0, total = 0, done = 0, index = 0 }) {
  const icon = CATEGORY_ICONS[category] ?? '📄'
  const pct  = total > 0 ? Math.round((done / total) * 100) : 0
  const complete = pct === 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        to={`/learn/${encodeURIComponent(category)}`}
        className={`flex flex-col gap-3 bg-white rounded-2xl p-4 border transition-all card-shadow hover:card-shadow-hover hover:-translate-y-0.5 group
          ${complete ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 hover:border-brand-300'}`}
      >
        {/* Icon + label */}
        <div className="flex items-start justify-between">
          <span className="text-3xl group-hover:scale-110 transition-transform">{icon}</span>
          {complete && (
            <span className="text-emerald-600 text-xs font-bold bg-emerald-100 px-2 py-0.5 rounded-full">
              ✓ Done
            </span>
          )}
        </div>

        <div>
          <p className="font-bold text-slate-800 text-sm">{category}</p>
          <p className="text-xs text-slate-400 mt-0.5">{total} briefs</p>
        </div>

        {/* Progress bar */}
        {total > 0 && (
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
      </Link>
    </motion.div>
  )
}

export default function Home() {
  const { user, API } = useAuth()
  const { start }     = useAppTutorial()
  const navigate      = useNavigate()
  const [stats, setStats] = useState({}) // { [category]: { total, done } }
  const levelInfo = user ? getLevelInfo(user.cycleAircoins ?? 0) : null

  // Start tutorial on first visit
  useEffect(() => {
    const t = setTimeout(() => start('home'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch per-category read counts
  useEffect(() => {
    if (!user) return
    fetch(`${API}/api/briefs/category-stats`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data.status === 'success') setStats(data.data?.stats ?? {}) })
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
          className="bg-gradient-to-r from-brand-600 to-brand-500 rounded-2xl p-4 mb-6 text-white card-shadow"
        >
          <div className="flex items-center gap-4">
            <XPRing pct={levelInfo.progress} level={levelInfo.level} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-brand-100 mb-0.5">Level {levelInfo.level}</p>
              <div className="h-2 bg-brand-400/50 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-white rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${levelInfo.progress}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <p className="text-xs text-brand-200 mt-1">
                {levelInfo.current} / {levelInfo.next} XP to Level {levelInfo.level + 1}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl">🔥</div>
              <div className="text-lg font-bold">{user.streak ?? 0}</div>
              <div className="text-xs text-brand-200">streak</div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Daily challenge prompt */}
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-center gap-3"
      >
        <span className="text-2xl">⭐</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-800">Daily mission available</p>
          <p className="text-xs text-amber-600">Read one brief today to keep your streak going.</p>
        </div>
        <Link
          to="/learn"
          className="shrink-0 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-xl transition-colors"
        >
          Go →
        </Link>
      </motion.div>

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
            total={stats[cat]?.total ?? 0}
            done={stats[cat]?.done ?? 0}
            index={i}
          />
        ))}
      </div>
    </>
  )
}
