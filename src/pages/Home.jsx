import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import WelcomeAgentFlow from '../components/onboarding/WelcomeAgentFlow'
import FlashcardGameModal from '../components/FlashcardGameModal'
import { CATEGORY_ICONS } from '../data/mockData'
import { useAppSettings } from '../context/AppSettingsContext'
import { getLevelInfo } from '../utils/levelUtils'
import SEO from '../components/SEO'
import { PENDING_ONBOARDING_KEY } from '../utils/storageKeys'

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
  const { user, API, apiFetch }  = useAuth()
  const { start }      = useAppTutorial()
  const navigate       = useNavigate()
  const { levels: liveLevels } = useAppSettings()
  const [missionDone,       setMissionDone]       = useState(false)
  const [latestBriefs,      setLatestBriefs]      = useState([])
  const [showCROFlow,       setShowCROFlow]       = useState(
    () => !!sessionStorage.getItem(PENDING_ONBOARDING_KEY)
  )
  const [missionLoading,    setMissionLoading]    = useState(false)
  const [showFlashcard,     setShowFlashcard]     = useState(false)
  const [jumpBackBrief,     setJumpBackBrief]     = useState(null)
  const [newsLoading,       setNewsLoading]       = useState(true)
  const levelInfo = user ? getLevelInfo(user.cycleAirstars ?? 0, liveLevels) : null

  // Mission done if the user completed a brief today (server-authoritative via lastStreakDate)
  useEffect(() => {
    if (!user?.lastStreakDate) { setMissionDone(false); return }
    setMissionDone(new Date(user.lastStreakDate).toDateString() === new Date().toDateString())
  }, [user?.lastStreakDate])

  // Consume the onboarding flag (CRO state was already initialised above)
  useEffect(() => {
    sessionStorage.removeItem(PENDING_ONBOARDING_KEY)
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
    apiFetch(`${API}/api/briefs/random-in-progress`)
      .then(r => r.json())
      .then(d => setJumpBackBrief(d.data ?? null))
      .catch(() => {})
  }, [user, API])

  // Fetch latest 4 News briefs — re-fetch on user change so isRead/isStarted resets after logout
  useEffect(() => {
    setNewsLoading(true)
    apiFetch(`${API}/api/briefs?limit=4&status=published&category=News`)
      .then(r => r.json())
      .then(data => setLatestBriefs(data.data?.briefs ?? []))
      .catch(() => {})
      .finally(() => setNewsLoading(false))
  }, [user, API])

  const today   = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const greeting = user
    ? `Welcome back, ${user.displayName?.split(' ')[0] || 'Agent'}`
    : 'Good to see you'

  return (
    <>
      <SEO title="Home" description="Browse RAF intel briefs by category — aircraft, bases, ranks, squadrons, operations, and more." />
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
                {levelInfo.coinsInLevel} / {levelInfo.coinsNeeded} Airstars to Level {levelInfo.level + 1}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl flame-blue">🔥</div>
              <div className="text-lg font-bold text-brand-700">{user.loginStreak ?? 0}</div>
              <div className="text-xs text-slate-600 intel-mono">streak</div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Daily challenge prompt */}
      {user && <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.25 }}
        onClick={!missionDone && !missionLoading ? async () => {
          setMissionLoading(true)
          try {
            const res = await apiFetch(`${API}/api/briefs/next-pathway-brief`, { credentials: 'include' })
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
        <span className={`text-2xl w-7 text-center shrink-0${!missionDone && !missionLoading ? ' target-amber' : ''}`}>{missionDone ? '✅' : missionLoading ? '…' : '🎯'}</span>
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

      {/* Quick Actions */}
      {user && (
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-6"
        >
          <h2 className="text-base font-bold text-slate-800 mb-3">Quick Actions</h2>
          <div className="space-y-2">
            {jumpBackBrief && (
              <button
                type="button"
                onClick={() => navigate(`/brief/${jumpBackBrief.briefId}`)}
                className="w-full flex items-center gap-3 rounded-2xl p-4 border transition-all card-shadow hover:card-shadow-hover hover:-translate-y-0.5 cursor-pointer bg-surface border-brand-300/40 hover:border-brand-400/60"
              >
                <span className="text-2xl w-7 text-center shrink-0">◑</span>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-bold text-white truncate">{jumpBackBrief.title}</p>
                  <p className="text-xs text-brand-600">{jumpBackBrief.category} · In Progress</p>
                </div>
                <span className="text-xs font-bold bg-brand-600 text-slate-900 px-3 py-1.5 rounded-xl shrink-0">Resume →</span>
              </button>
            )}
            <button
              onClick={() => setShowFlashcard(true)}
              data-testid="home-flashcard-btn"
              className="w-full flex items-center gap-3 rounded-2xl p-4 border transition-all card-shadow hover:card-shadow-hover hover:-translate-y-0.5 cursor-pointer bg-amber-50 border-amber-200 hover:border-amber-400"
            >
              <span className="text-2xl w-7 text-center shrink-0">⚡</span>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-bold text-amber-900">Flashcard Round</p>
                <p className="text-xs text-amber-600">Identify briefs from content alone — title hidden</p>
              </div>
              <span className="text-xs font-bold bg-amber-500 text-white px-3 py-1.5 rounded-xl shrink-0">Play →</span>
            </button>
          </div>
        </motion.div>
      )}

      {/* Latest News */}
      {(newsLoading || latestBriefs.length > 0) && (
        <div className="mb-6">

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">Latest News</h2>
            <Link to="/learn-priority" className="text-xs font-semibold text-brand-600 hover:text-brand-700">See all →</Link>
          </div>
          {newsLoading && latestBriefs.length === 0 ? (
            <div className="space-y-2">
              {[0,1,2,3].map(i => (
                <div
                  key={i}
                  className="relative overflow-hidden flex items-center gap-3 pl-5 pr-4 py-3.5 rounded-2xl border border-slate-700/20 bg-surface animate-pulse"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-slate-700/30 rounded" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-3.5 rounded bg-slate-700/30" style={{ width: `${60 + (i % 3) * 15}%` }} />
                    <div className="h-2.5 rounded bg-slate-700/20" style={{ width: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <div className="space-y-2">
            {latestBriefs.map((brief, i) => {
              const locked = brief.isLocked

              const accentBar = locked
                ? 'bg-slate-600/30'
                : brief.isRead
                  ? 'bg-emerald-500/40'
                  : brief.isStarted
                    ? 'bg-amber-400'
                    : 'bg-brand-600'

              const eventDate = brief.eventDate
                ? new Date(brief.eventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                : null

              const metaSuffix = brief.isRead ? 'Read' : brief.isStarted ? 'In Progress' : null
              const metaLine = locked
                ? 'Sign in to read'
                : [eventDate, metaSuffix ?? (eventDate ? null : brief.category)].filter(Boolean).join(' · ')

              const inner = (
                <>
                  {/* left accent bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentBar}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate leading-snug
                      ${locked ? 'font-semibold text-slate-500'
                        : brief.isRead ? 'font-semibold text-slate-600'
                        : brief.isStarted ? 'font-bold text-amber-300'
                        : 'font-semibold text-slate-900'}`}>
                      {brief.title}
                    </p>
                    <p className={`text-xs mt-0.5 intel-mono truncate
                      ${locked ? 'text-slate-600'
                        : brief.isRead ? 'text-slate-500'
                        : brief.isStarted ? 'text-amber-600'
                        : 'text-slate-500'}`}>
                      {metaLine}
                    </p>
                  </div>
                  {!locked && (
                    <span className={`text-sm shrink-0 transition-colors
                      ${brief.isRead ? 'text-slate-600 group-hover:text-emerald-400'
                        : brief.isStarted ? 'text-amber-500/80 group-hover:text-amber-300'
                        : 'text-slate-500 group-hover:text-brand-400'}`}>→</span>
                  )}
                </>
              )

              const baseClass = `relative overflow-hidden flex items-center gap-3 pl-5 pr-4 py-3.5 rounded-2xl border transition-all card-shadow`

              return (
                <motion.div
                  key={brief._id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  {locked ? (
                    <div className={`${baseClass} opacity-50 cursor-not-allowed bg-surface border-slate-700/30`}>
                      {inner}
                    </div>
                  ) : (
                    <Link
                      to={`/brief/${brief._id}`}
                      className={`group ${baseClass} bg-surface hover:-translate-y-0.5
                        ${brief.isRead
                          ? 'border-slate-700/25 hover:border-slate-600/50'
                          : brief.isStarted
                            ? 'border-slate-700/30 hover:border-amber-500/30'
                            : 'border-slate-700/30 hover:border-brand-600/40'}`}
                    >
                      {inner}
                    </Link>
                  )}
                </motion.div>
              )
            })}
          </div>
          )}
        </div>
      )}

    </>
  )
}
