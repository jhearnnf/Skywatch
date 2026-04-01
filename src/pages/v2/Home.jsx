import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import WelcomeAgentFlow from '../../components/onboarding/WelcomeAgentFlow'
import FlashcardGameModal from '../../components/FlashcardGameModal'
import { CATEGORY_ICONS, MOCK_LEVELS } from '../../data/mockData'

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


export default function Home() {
  const { user, API }  = useAuth()
  const { start }      = useAppTutorial()
  const navigate       = useNavigate()
  const [missionDone,       setMissionDone]       = useState(false)
  const [latestBriefs,      setLatestBriefs]      = useState([])
  const [showCROFlow,       setShowCROFlow]       = useState(
    () => !!sessionStorage.getItem('sw_pending_onboarding')
  )
  const [missionLoading,    setMissionLoading]    = useState(false)
  const [showFlashcard,     setShowFlashcard]     = useState(false)
  const [jumpBackBrief,     setJumpBackBrief]     = useState(null)
  const levelInfo = user ? getLevelInfo(user.cycleAircoins ?? 0) : null

  // Mission done if the user completed a brief today (server-authoritative via lastStreakDate)
  useEffect(() => {
    if (!user?.lastStreakDate) { setMissionDone(false); return }
    setMissionDone(new Date(user.lastStreakDate).toDateString() === new Date().toDateString())
  }, [user?.lastStreakDate])

  // Consume the onboarding flag (CRO state was already initialised above)
  useEffect(() => {
    sessionStorage.removeItem('sw_pending_onboarding')
  }, [])

  // Start tutorial on first visit — skip when the CRO modal is showing
  useEffect(() => {
    if (showCROFlow) return
    const t = setTimeout(() => start('home'), 600)
    return () => clearTimeout(t)
  }, [showCROFlow]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch a random in-progress brief for "Jump Back In"
  useEffect(() => {
    if (!user) { setJumpBackBrief(null); return }
    fetch(`${API}/api/briefs/random-in-progress`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setJumpBackBrief(d.data ?? null))
      .catch(() => {})
  }, [user, API])

  // Fetch latest 4 News briefs — re-fetch on user change so isRead/isStarted resets after logout
  useEffect(() => {
    fetch(`${API}/api/briefs?limit=4&status=published&category=News`, { credentials: 'include' })
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
      {showCROFlow && <WelcomeAgentFlow onClose={() => setShowCROFlow(false)} />}
      {showFlashcard && <FlashcardGameModal onClose={() => setShowFlashcard(false)} />}

      {/* Greeting + stats */}
      <div className="mb-6">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">{today}</p>
        <h1 className="text-2xl font-extrabold text-slate-900">{greeting}</h1>
        {!user && (
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setShowCROFlow(true)}
              className="flex-1 text-center text-sm font-bold bg-brand-600 text-slate-900 px-4 py-2.5 rounded-xl hover:bg-brand-500 transition-colors"
            >
              Start for Free
            </button>
            <Link
              to="/login"
              className="flex-1 text-center text-sm font-semibold border border-brand-300/60 text-brand-600 px-4 py-2.5 rounded-xl hover:border-brand-400 transition-colors"
            >
              Sign In
            </Link>
          </div>
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
      {user && <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2 }}
        onClick={!missionDone && !missionLoading ? async () => {
          setMissionLoading(true)
          try {
            const res = await fetch(`${API}/api/briefs/random-unlocked`, { credentials: 'include' })
            const data = await res.json()
            if (data.status === 'success') {
              navigate(`/brief/${data.data.briefId}`)
            } else {
              navigate('/learn-priority')
            }
          } catch {
            navigate('/learn-priority')
          } finally {
            setMissionLoading(false)
          }
        } : undefined}
        className={`rounded-2xl p-4 mb-6 flex items-center gap-3 border transition-all
          ${missionDone
            ? 'bg-emerald-50 border-emerald-200'
            : missionLoading
              ? 'bg-amber-50 border-amber-200 opacity-60 cursor-wait'
              : 'bg-amber-50 border-amber-200 cursor-pointer hover:border-amber-400 hover:-translate-y-0.5 card-shadow hover:card-shadow-hover'
          }`}
      >
        <span className="text-2xl">{missionDone ? '✅' : missionLoading ? '…' : '⭐'}</span>
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
          <span className="shrink-0 text-xs font-bold bg-amber-500 text-white px-3 py-1.5 rounded-xl">
            {missionLoading ? '…' : 'Go →'}
          </span>
        )}
      </motion.div>}

      {/* Jump Back In */}
      {jumpBackBrief && (
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25 }}
          onClick={() => navigate(`/brief/${jumpBackBrief.briefId}`)}
          className="rounded-2xl p-4 mb-6 flex items-center gap-3 border border-brand-300/40 transition-all cursor-pointer hover:border-brand-400/60 hover:-translate-y-0.5 card-shadow hover:card-shadow-hover"
          style={{ background: 'linear-gradient(135deg, #0d1e35 0%, #091628 100%)' }}
        >
          <div className="w-10 h-10 rounded-xl bg-brand-200/60 flex items-center justify-center shrink-0 text-xl text-brand-600">
            ◑
          </div>
          <div className="flex-1 min-w-0">
            <p className="intel-mono text-brand-600 mb-0.5">Jump Back In</p>
            <p className="text-sm font-bold text-white truncate">{jumpBackBrief.title}</p>
            <p className="text-xs text-brand-700">{jumpBackBrief.category} · In Progress</p>
          </div>
          <span className="shrink-0 text-xs font-bold bg-brand-600 text-slate-900 px-3 py-1.5 rounded-xl">Resume →</span>
        </motion.div>
      )}

      {/* Quick Actions */}
      {user && (
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-6"
        >
          <h2 className="text-base font-bold text-slate-800 mb-3">Quick Actions</h2>
          <button
            onClick={() => setShowFlashcard(true)}
            data-testid="home-flashcard-btn"
            className="w-full flex items-center gap-3 rounded-2xl p-4 border transition-all card-shadow hover:card-shadow-hover hover:-translate-y-0.5 cursor-pointer bg-amber-50 border-amber-200 hover:border-amber-400"
          >
            <span className="text-2xl">⚡</span>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-bold text-amber-900">Flashcard Round</p>
              <p className="text-xs text-amber-600">Identify briefs from content alone — title hidden</p>
            </div>
            <span className="text-xs font-bold bg-amber-500 text-white px-3 py-1.5 rounded-xl shrink-0">Play →</span>
          </button>
        </motion.div>
      )}

      {/* Latest News */}
      {latestBriefs.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">Latest News</h2>
            <Link to="/learn-priority" className="text-xs font-semibold text-brand-600 hover:text-brand-700">See all →</Link>
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

    </>
  )
}
