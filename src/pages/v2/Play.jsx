import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { isCategoryLocked } from '../../utils/subscription'
import TutorialModal from '../../components/tutorial/TutorialModal'

const GAME_MODES = [
  {
    key: 'quiz',
    emoji: '🧠',
    title: 'Intel Quiz',
    desc: 'Test your knowledge on a specific brief. Standard or Advanced difficulty.',
    available: true,
    badge: null,
  },
  {
    key: 'flashcard',
    emoji: '⚡',
    title: 'Flashcard Recall',
    desc: 'Quick-fire keyword and terminology drills.',
    available: false,
    badge: 'Coming soon',
  },
  {
    key: 'whos-that-aircraft',
    emoji: '✈️',
    title: "Who's that Aircraft?",
    desc: 'Identify aircraft from silhouettes and match them to their squadrons.',
    available: false,
    badge: 'Coming soon',
  },
  {
    key: 'battle-order',
    emoji: '🗺️',
    title: 'Battle Order',
    desc: 'Arrange squadrons, bases, and assets in correct operational order.',
    available: false,
    badge: 'Coming soon',
  },
]

export default function Play() {
  const { user, API } = useAuth()
  const { start }     = useAppTutorial()
  const { settings }  = useAppSettings()

  const [recentBriefs,   setRecentBriefs]   = useState([])
  const [passedBriefIds, setPassedBriefIds] = useState(new Set())
  const [activeGame,     setActiveGame]     = useState(null)

  const quizRef      = useRef(null)
  const flashcardRef = useRef(null)
  const aircraftRef  = useRef(null)
  const battleRef    = useRef(null)
  const highlightTimerRef = useRef(null)

  const sectionRefs = {
    'quiz':               quizRef,
    'flashcard':          flashcardRef,
    'whos-that-aircraft': aircraftRef,
    'battle-order':       battleRef,
  }

  // Tutorial on first visit
  useEffect(() => {
    const t = setTimeout(() => start('play'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear highlight timer on unmount
  useEffect(() => () => clearTimeout(highlightTimerRef.current), [])

  // Fetch recently read briefs + passed quiz IDs for the quiz launcher
  useEffect(() => {
    if (!user) { setRecentBriefs([]); setPassedBriefIds(new Set()); return }
    fetch(`${API}/api/briefs?limit=6`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setRecentBriefs(data?.data?.briefs ?? []))
      .catch(() => {})
    fetch(`${API}/api/games/quiz/completed-brief-ids`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setPassedBriefIds(new Set(data?.data?.ids ?? [])))
      .catch(() => {})
  }, [user, API])

  function handleCardClick(key) {
    const ref = sectionRefs[key]
    if (!ref?.current) return
    // 56px = fixed TopBar (h-14) + 16px breathing room
    const OFFSET = 56 + 16
    const y = ref.current.getBoundingClientRect().top + window.scrollY - OFFSET
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    setActiveGame(key)
    clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setActiveGame(null), 1500)
  }

  // Each launcher section is a card; active state pulses the border brand-coloured
  function sectionClass(key) {
    const isActive = activeGame === key
    return [
      'bg-surface rounded-2xl border card-shadow transition-all duration-500',
      isActive ? 'border-brand-400' : 'border-slate-200',
    ].join(' ')
  }

  return (
    <>
      <TutorialModal />
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Play</h1>
        <p className="text-sm text-slate-500 mb-6">Test your RAF knowledge with training games.</p>

        {/* ── Game mode grid ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          {GAME_MODES.map((mode, i) => (
            <motion.div
              key={mode.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35 }}
            >
              <div
                data-testid={`card-${mode.key}`}
                role="button"
                tabIndex={0}
                onClick={() => handleCardClick(mode.key)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleCardClick(mode.key)}
                className={`relative flex items-start gap-4 bg-surface rounded-2xl p-4 border transition-all card-shadow cursor-pointer
                  ${mode.available
                    ? 'border-slate-200 hover:border-brand-300 hover:bg-brand-50 group hover:-translate-y-0.5'
                    : 'border-slate-100 opacity-60'
                  }`}
              >
                <span className="text-3xl shrink-0 group-hover:scale-110 transition-transform">{mode.emoji}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-bold text-slate-800">{mode.title}</p>
                    {mode.badge && (
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                        {mode.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{mode.desc}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── Launcher sections ──────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Intel Quiz */}
          <div ref={quizRef} className={sectionClass('quiz')}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧠</span>
                <h2 className="font-bold text-slate-800">Intel Quiz</h2>
              </div>
              <Link to="/learn" className="text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors">
                Browse briefs →
              </Link>
            </div>
            <div className="p-5">
              {!user ? (
                <div className="text-center py-4">
                  <p className="text-sm text-slate-500 mb-4">Sign in to take quizzes and earn Aircoins.</p>
                  <Link
                    to="/login"
                    className="inline-flex px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                  >
                    Sign In
                  </Link>
                </div>
              ) : recentBriefs.length > 0 ? (
                <div className="space-y-2">
                  {recentBriefs.map((brief, i) => {
                    const locked = isCategoryLocked(brief.category, user, settings)
                    return (
                      <motion.div
                        key={brief._id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        {locked ? (
                          <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-60 cursor-not-allowed">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                              <span className="text-slate-400 text-xs">🔒</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                              <p className="text-xs text-slate-400">{brief.category}</p>
                            </div>
                          </div>
                        ) : (() => {
                          const passed = passedBriefIds.has(brief._id)
                          return (
                            <Link
                              to={`/quiz/${brief._id}`}
                              className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all group
                                ${passed
                                  ? 'bg-emerald-50/60 border-emerald-200 hover:border-emerald-300'
                                  : 'bg-slate-50 border-slate-200 hover:border-brand-300 hover:bg-brand-50'
                                }`}
                            >
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                                ${passed ? 'bg-emerald-100' : 'bg-brand-100'}`}
                              >
                                <span className={`font-bold text-xs ${passed ? 'text-emerald-600' : 'text-brand-600'}`}>
                                  {passed ? '✓' : 'Q'}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                                <p className="text-xs text-slate-400">{brief.category}</p>
                              </div>
                              {passed
                                ? <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">✓ Passed</span>
                                : <span className="text-slate-300 group-hover:text-brand-400 transition-colors">→</span>
                              }
                            </Link>
                          )
                        })()}
                      </motion.div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-slate-500 mb-4">Read some briefs first, then return here to quiz yourself.</p>
                  <Link
                    to="/learn"
                    className="inline-flex px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                  >
                    Browse Briefs
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Flashcard Recall */}
          <div ref={flashcardRef} className={sectionClass('flashcard')}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚡</span>
                <h2 className="font-bold text-slate-800">Flashcard Recall</h2>
              </div>
              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Coming soon</span>
            </div>
            <div className="p-5">
              <div className="space-y-2 mb-4">
                {['ISTAR', 'QRA', 'COMAO'].map(kw => (
                  <div key={kw} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-50">
                    <span className="text-base">⚡</span>
                    <span className="text-sm font-semibold text-slate-600">{kw}</span>
                    <span className="ml-auto text-xs text-slate-400">keyword</span>
                  </div>
                ))}
              </div>
              <button disabled className="w-full py-2.5 bg-slate-100 text-slate-400 font-bold rounded-xl text-sm cursor-not-allowed">
                Start Drill
              </button>
            </div>
          </div>

          {/* Who's that Aircraft? */}
          <div ref={aircraftRef} className={sectionClass('whos-that-aircraft')}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">✈️</span>
                <h2 className="font-bold text-slate-800">Who's that Aircraft?</h2>
              </div>
              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Coming soon</span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[1, 2, 3].map(n => (
                  <div key={n} className="aspect-square bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center opacity-40">
                    <span className="text-3xl">✈️</span>
                  </div>
                ))}
              </div>
              <button disabled className="w-full py-2.5 bg-slate-100 text-slate-400 font-bold rounded-xl text-sm cursor-not-allowed">
                Identify Aircraft
              </button>
            </div>
          </div>

          {/* Battle Order */}
          <div ref={battleRef} className={sectionClass('battle-order')}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🗺️</span>
                <h2 className="font-bold text-slate-800">Battle Order</h2>
              </div>
              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Coming soon</span>
            </div>
            <div className="p-5">
              <div className="space-y-2 mb-4">
                {[1, 2, 3].map(n => (
                  <div key={n} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-50">
                    <span className="text-xs font-bold text-slate-400 w-4 shrink-0">{n}.</span>
                    <div className="h-2.5 bg-slate-200 rounded-full flex-1" />
                  </div>
                ))}
              </div>
              <button disabled className="w-full py-2.5 bg-slate-100 text-slate-400 font-bold rounded-xl text-sm cursor-not-allowed">
                Order Units
              </button>
            </div>
          </div>

        </div>

        {/* ── Game history ───────────────────────────────────────────── */}
        {user && (
          <div className="mt-4">
            <Link
              to="/game-history"
              className="flex items-center justify-between bg-surface rounded-2xl px-4 py-3 border border-slate-200 hover:border-brand-300 transition-all card-shadow text-sm font-semibold text-slate-700"
            >
              <span>📜 View game history</span>
              <span className="text-slate-400">→</span>
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
