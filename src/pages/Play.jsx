import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import { useNewGameUnlock } from '../context/NewGameUnlockContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import FlashcardGameModal from '../components/FlashcardGameModal'
import FlyingNewBadge from '../components/FlyingNewBadge'
import SEO from '../components/SEO'

// BOO states that trigger the unlock notification (game is actually playable)
const BOO_ACCESSIBLE_STATES = ['active']

// Labels for needs-*-reads gate states; unknown future states fall back to generic text
const NEEDS_READS_LABELS = {
  'needs-aircraft-reads': 'Read more Aircrafts',
  'needs-bases-reads':    'Read more Bases',
}

// Map game mode key → unlock context key (they differ for WTA and BOO)
const MODE_TO_UNLOCK_KEY = {
  'quiz':               'quiz',
  'flashcard':          'flashcard',
  'wheres-that-aircraft': 'wta',
  'battle-order':       'boo',
}
// Map unlock key → game mode key (for DOM queries)
const UNLOCK_TO_MODE_KEY = Object.fromEntries(
  Object.entries(MODE_TO_UNLOCK_KEY).map(([m, u]) => [u, m])
)

function PadlockIcon({ unlocked }) {
  return unlocked ? (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" aria-hidden="true">
      <rect x="1.5" y="6.5" width="10" height="7" rx="1.5" stroke="#22c55e" strokeWidth="1.4"/>
      <path d="M3.5 6.5V4.5a3 3 0 0 1 6 0" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ) : (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" aria-hidden="true">
      <rect x="1.5" y="6.5" width="10" height="7" rx="1.5" stroke="#94a3b8" strokeWidth="1.4"/>
      <path d="M3.5 6.5V4.5a3 3 0 0 1 6 0v2" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

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
    desc: 'Identify briefs from their content alone. Title hidden — type to recall.',
    available: true,
    badge: null,
  },
  {
    key: 'wheres-that-aircraft',
    emoji: '✈️',
    title: "Where's that Aircraft?",
    desc: 'Random identification missions that appear as you learn. Spot the aircraft, then locate its home base on the map.',
    available: true,
    badge: null,
  },
  {
    key: 'battle-order',
    emoji: '🗺️',
    title: 'Battle of Order',
    desc: 'Arrange aircraft, ranks, and missions in the correct order.',
    available: true,
    badge: null,
  },
]

export default function Play() {
  const { user, API, apiFetch } = useAuth()
  const { settings } = useAppSettings()
  const { start, step, visible, next: tutorialNext, hasSeen } = useAppTutorial()
  const { newGames, isUnlocked, markSeen, markUnlockFromServer } = useNewGameUnlock()

  const isHighlightingGrid = visible && !!step?.highlightGrid

  const [quizBriefs,     setQuizBriefs]     = useState([])
  const [booBriefs,      setBooBriefs]      = useState([])
  const [activeGame,     setActiveGame]     = useState(null)
  const [showFlashcard,  setShowFlashcard]  = useState(false)
  const [flashcardAvail, setFlashcardAvail] = useState(null)
  const [wtaSpawn,       setWtaSpawn]       = useState(null)

  // Badge fly animation state
  const [flyingBadges,  setFlyingBadges]  = useState([]) // [{ key, from:{x,y}, to:{x,y} }]
  const [flashingCards, setFlashingCards] = useState(new Set())
  const animatedKeysRef = useRef(new Set())

  // Suppress badge animations until the play tutorial is completed/skipped
  const [playTutorialDone, setPlayTutorialDone] = useState(() => hasSeen('play'))
  const prevVisibleRef = useRef(false)
  useEffect(() => {
    if (prevVisibleRef.current && !visible) setPlayTutorialDone(true)
    prevVisibleRef.current = visible
  }, [visible])

  const quizRef      = useRef(null)
  const flashcardRef = useRef(null)
  const aircraftRef  = useRef(null)
  const battleRef    = useRef(null)
  const highlightTimerRef = useRef(null)

  const sectionRefs = {
    'quiz':               quizRef,
    'flashcard':          flashcardRef,
    'wheres-that-aircraft': aircraftRef,
    'battle-order':       battleRef,
  }

  // Tutorial on first visit
  useEffect(() => {
    const t = setTimeout(() => start('play'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Warm engagement theme while on Play page
  useEffect(() => {
    document.body.classList.add('play-mode')
    return () => document.body.classList.remove('play-mode')
  }, [])

  // Clear highlight timer on unmount
  useEffect(() => () => clearTimeout(highlightTimerRef.current), [])

  // Badge fly animation — fires when newGames changes, but only after play tutorial is done
  const newGamesKey = [...newGames].sort().join(',')
  useEffect(() => {
    if (!newGamesKey || !playTutorialDone) return
    const timer = setTimeout(() => {
      const toAnimate = newGamesKey.split(',').filter(k => k && !animatedKeysRef.current.has(k))
      if (!toAnimate.length) return
      const navEl = document.querySelector('[data-nav="play"]')
      const badges = []
      for (const key of toAnimate) {
        const modeKey = UNLOCK_TO_MODE_KEY[key] ?? key
        const cardEl = document.querySelector(`[data-testid="card-${modeKey}"]`)
        animatedKeysRef.current.add(key)
        if (!navEl || !cardEl) {
          // Can't animate — dismiss immediately
          markSeen(key)
          continue
        }
        const navRect  = navEl.getBoundingClientRect()
        const cardRect = cardEl.getBoundingClientRect()
        badges.push({
          key,
          from: { x: navRect.left + navRect.width / 2 - 18, y: navRect.top  },
          to:   { x: cardRect.right - 52,                   y: cardRect.top + 4 },
        })
      }
      if (badges.length) setFlyingBadges(prev => [...prev, ...badges])
    }, 600)
    return () => clearTimeout(timer)
  }, [newGamesKey, playTutorialDone]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleBadgeArrived(key) {
    setFlyingBadges(prev => prev.filter(b => b.key !== key))
    setFlashingCards(prev => new Set([...prev, key]))
    setTimeout(() => {
      setFlashingCards(prev => { const n = new Set(prev); n.delete(key); return n })
      markSeen(key)
    }, 1500)
  }

  // Once a user has earned an unlock it stays unlocked forever — only an
  // admin "reset progress" wipe (which $unsets gameUnlocks server-side) can
  // re-lock a card. The dynamic content checks remain only as a first-time
  // fallback so the green padlock can flip on the same render that detection
  // happens, before the persist round-trip completes.
  function isCardUnlocked(modeKey) {
    if (!user) return false
    const unlockKey = MODE_TO_UNLOCK_KEY[modeKey]
    if (isUnlocked(unlockKey)) return true
    switch (modeKey) {
      case 'quiz':               return quizBriefs.some(b => b.quizState === 'active')
      case 'flashcard':          return flashcardAvail !== null && flashcardAvail >= 5
      case 'battle-order':       return booBriefs.some(b => BOO_ACCESSIBLE_STATES.includes(b.booState))
      case 'wheres-that-aircraft': return wtaSpawn?.prereqsMet === true
      default:                   return false
    }
  }

  // Fetch recommended briefs for each game type
  useEffect(() => {
    if (!user) {
      setQuizBriefs([])
      setBooBriefs([])
      setFlashcardAvail(null)
      setWtaSpawn(null)
      return
    }
    apiFetch(`${API}/api/games/quiz/recommended-briefs?limit=4`)
      .then(r => r.json())
      .then(data => {
        const briefs = data?.data?.briefs ?? []
        setQuizBriefs(briefs)
        if (briefs.some(b => b.quizState === 'active')) markUnlockFromServer('quiz')
      })
      .catch(() => {})
    apiFetch(`${API}/api/games/battle-of-order/recommended-briefs?limit=4`)
      .then(r => r.json())
      .then(data => {
        const briefs = data?.data?.briefs ?? []
        setBooBriefs(briefs)
        if (briefs.some(b => BOO_ACCESSIBLE_STATES.includes(b.booState))) {
          markUnlockFromServer('boo')
        }
      })
      .catch(() => {})
    apiFetch(`${API}/api/games/flashcard-recall/available-briefs`)
      .then(r => r.json())
      .then(data => {
        const count = data?.data?.count ?? 0
        setFlashcardAvail(count)
        if (count >= 5) markUnlockFromServer('flashcard')
      })
      .catch(() => setFlashcardAvail(0))
    apiFetch(`${API}/api/users/me/wta-spawn`)
      .then(r => r.json())
      .then(data => {
        const spawn = data?.data ?? null
        setWtaSpawn(spawn)
        if (spawn?.prereqsMet === true) markUnlockFromServer('wta')
      })
      .catch(() => {})
  }, [user, API]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Card / scroll ─────────────────────────────────────────────────────────

  function handleCardClick(key) {
    if (isHighlightingGrid) tutorialNext()
    const ref = sectionRefs[key]
    if (!ref?.current) return
    const OFFSET = 56 + 16
    const y = ref.current.getBoundingClientRect().top + window.scrollY - OFFSET
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    setActiveGame(key)
    clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setActiveGame(null), 1500)
  }

  function sectionClass(key) {
    const isActive = activeGame === key
    return [
      'bg-surface rounded-2xl border card-shadow transition-all duration-500',
      isActive ? 'border-brand-400' : 'border-slate-200',
    ].join(' ')
  }

  return (
    <>
      <SEO title="Play" description="Choose a game mode to test your aviation knowledge — quizzes, flashcards, and more." />
      <TutorialModal />
      {showFlashcard && <FlashcardGameModal onClose={() => setShowFlashcard(false)} />}

      {/* Flying "NEW GAME" badges — animate from nav Play button to game card */}
      <AnimatePresence>
        {flyingBadges.map(badge => (
          <FlyingNewBadge
            key={badge.key}
            from={badge.from}
            to={badge.to}
            label="NEW GAME"
            onArrived={() => handleBadgeArrived(badge.key)}
          />
        ))}
      </AnimatePresence>

      <div className="play-page">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-extrabold text-slate-900">Play</h1>
          {settings?.cbatEnabled && (
            <Link to="/cbat" className="text-[10px] font-semibold tracking-wide uppercase text-slate-500 border border-slate-700 rounded px-1.5 py-0.5 hover:text-brand-400 hover:border-brand-500 transition-colors">Play CBAT</Link>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-6">Test your aviation knowledge with training games.</p>

        {/* ── Game mode grid ─────────────────────────────────────────── */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8${isHighlightingGrid ? ' tutorial-grid-highlight' : ''}`}>
          {GAME_MODES.map((mode, i) => (
            <motion.div
              key={mode.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35 }}
              className="h-full"
            >
              <div
                data-testid={`card-${mode.key}`}
                role="button"
                tabIndex={0}
                onClick={() => handleCardClick(mode.key)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleCardClick(mode.key)}
                className={`relative flex items-start gap-4 bg-surface rounded-2xl p-4 border transition-all card-shadow cursor-pointer h-full
                  ${mode.available
                    ? 'border-slate-200 hover:border-brand-300 hover:bg-brand-50 group hover:-translate-y-0.5'
                    : 'border-slate-100 opacity-60'
                  }${flashingCards.has(MODE_TO_UNLOCK_KEY[mode.key]) ? ' game-card--flash' : ''}`}
              >
                {/* Padlock — top-right corner */}
                <span className="absolute top-3 right-3 opacity-70">
                  <PadlockIcon unlocked={isCardUnlocked(mode.key)} />
                </span>

                <span className="text-3xl shrink-0 group-hover:scale-110 transition-transform">{mode.emoji}</span>
                <div className="min-w-0 pr-4">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-bold text-slate-800">{mode.title}</p>
                    {mode.badge && (
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                        {mode.badge}
                      </span>
                    )}
                    {newGames.has(MODE_TO_UNLOCK_KEY[mode.key]) && (
                      <span className="text-[10px] font-bold bg-brand-100 text-brand-600 px-1.5 py-0.5 rounded-full">
                        NEW
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
              <Link to="/play/quiz" className="text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors">
                Browse intel quizzes →
              </Link>
            </div>
            <div className="p-5">
              {!user ? (
                <div className="text-center py-4">
                  <p className="text-sm text-slate-500 mb-4">Sign in to take quizzes and earn Airstars.</p>
                  <Link
                    to="/login"
                    className="inline-flex px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                  >
                    Sign In
                  </Link>
                </div>
              ) : quizBriefs.length > 0 ? (
                <div className="space-y-2">
                  {quizBriefs.map((brief, i) => {
                    const state = brief.quizState
                    const isFirstNeedsRead = state === 'needs-read' && quizBriefs.findIndex(b => b.quizState === 'needs-read') === i
                    const hasActive = quizBriefs.some(b => b.quizState === 'active')

                    if (state === 'no-questions') {
                      return (
                        <motion.div
                          key={brief._id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-60 cursor-not-allowed">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                              <span className="text-slate-400 text-xs">🔒</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                              <p className="text-xs text-slate-400">{brief.category}</p>
                            </div>
                            <span className="text-xs text-slate-400 shrink-0">No questions yet</span>
                          </div>
                        </motion.div>
                      )
                    }

                    if (state === 'needs-read') {
                      return (
                        <motion.div
                          key={brief._id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <Link
                            to={`/brief/${brief._id}`}
                            className="flex items-center gap-3 rounded-xl px-4 py-3 border bg-amber-50 border-amber-200 hover:border-amber-300 transition-all group"
                          >
                            <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                              <span className="font-bold text-xs text-amber-600">📖</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                              <p className="text-xs text-slate-400">{brief.category}</p>
                            </div>
                            <span className="text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                              Read first →
                            </span>
                          </Link>
                        </motion.div>
                      )
                    }

                    const passed = state === 'passed'
                    return (
                      <motion.div
                        key={brief._id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
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
                            : <span className="text-[10px] font-bold bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full shrink-0">Play now</span>
                          }
                        </Link>
                      </motion.div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-slate-500 mb-4">Read some briefs first, then return here to quiz yourself.</p>
                  <Link
                    to="/learn-priority"
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
                {newGames.has('flashcard') && (
                  <span className="text-[10px] font-bold bg-brand-100 text-brand-600 px-1.5 py-0.5 rounded-full">
                    NEW
                  </span>
                )}
              </div>
            </div>
            <div className="p-5">
              {!user ? (
                <div className="text-center py-4">
                  <p className="text-sm text-slate-500 mb-4">Sign in to run Flashcard drills and earn Airstars.</p>
                  <Link
                    to="/login"
                    className="inline-flex px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                  >
                    Sign In
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-500 mb-4 leading-relaxed">
                    Each card shows a brief's content with the title hidden. Type and select the correct title to score.
                    {flashcardAvail !== null && (
                      <span className="ml-1 font-semibold text-slate-700">{flashcardAvail} flashcard{flashcardAvail !== 1 ? 's' : ''} available.</span>
                    )}
                  </p>
                  {flashcardAvail !== null && flashcardAvail < 5 ? (
                    <div className="flex items-center gap-3 bg-amber-50 rounded-xl px-4 py-3 border border-amber-200 mb-3">
                      <span className="text-base shrink-0">📖</span>
                      <p className="text-sm text-amber-800 font-medium">
                        Read at least 5 briefs to unlock Flashcard Round.
                      </p>
                    </div>
                  ) : null}
                  <button
                    onClick={() => setShowFlashcard(true)}
                    disabled={flashcardAvail !== null && flashcardAvail < 5}
                    data-testid="flashcard-launch-btn"
                    className="w-full py-2.5 font-extrabold rounded-xl text-sm transition-all"
                    style={flashcardAvail !== null && flashcardAvail < 5
                      ? { background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed' }
                      : { background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#0f172a', cursor: 'pointer' }
                    }
                  >
                    {flashcardAvail !== null && flashcardAvail < 5 ? 'Read more briefs to unlock' : 'Start Drill ⚡'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Where's that Aircraft? */}
          <div ref={aircraftRef} className={sectionClass('wheres-that-aircraft')}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">✈️</span>
                <h2 className="font-bold text-slate-800">Where's that Aircraft?</h2>
              </div>
            </div>
            <div className="p-5">
              <Link to="/learn-priority" className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3.5 border border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all group mb-3">
                <span className="text-xl shrink-0">✈️</span>
                <p className="text-sm font-semibold text-slate-700 leading-snug">
                  Learn about aircrafts for these random missions to appear
                </p>
                <span className="text-slate-300 group-hover:text-brand-400 transition-colors ml-auto shrink-0">→</span>
              </Link>
              <p className="text-xs text-slate-400 px-1">
                Bases knowledge is also required — missions won't appear without it.
              </p>
              {!user && (
                <Link
                  to="/login"
                  className="inline-flex w-full justify-center px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors mt-4"
                >
                  Sign In to Play
                </Link>
              )}
            </div>
          </div>

          {/* Battle of Order */}
          <div ref={battleRef} className={sectionClass('battle-order')}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🗺️</span>
                <h2 className="font-bold text-slate-800">Battle of Order</h2>
              </div>
              <Link to="/play/battle-of-order" className="text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors">
                Browse briefs →
              </Link>
            </div>
            <div className="p-5">
              {!user ? (
                <div className="text-center py-4">
                  <p className="text-sm text-slate-500 mb-4">Sign in to play Battle of Order and earn Airstars.</p>
                  <Link
                    to="/login"
                    className="inline-flex px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                  >
                    Sign In
                  </Link>
                </div>
              ) : booBriefs.length > 0 ? (
                <div className="space-y-2">
                  {booBriefs.map((brief, i) => {
                    const state = brief.booState

                    if (state.startsWith('needs-') && state.endsWith('-reads')) {
                      const readsLabel = NEEDS_READS_LABELS[state] ?? 'Read more briefs'
                      return (
                        <motion.div
                          key={brief._id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-60 cursor-not-allowed">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                              <span className="text-slate-400 text-xs">🔒</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                              <p className="text-xs text-slate-400">{brief.category}</p>
                            </div>
                            <span className="text-xs text-slate-400 shrink-0">{readsLabel}</span>
                          </div>
                        </motion.div>
                      )
                    }

                    if (state === 'no-data') {
                      return (
                        <motion.div
                          key={brief._id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-60 cursor-not-allowed">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                              <span className="text-slate-400 text-xs">🔒</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                              <p className="text-xs text-slate-400">{brief.category}</p>
                            </div>
                            <span className="text-xs text-slate-400 shrink-0">No data yet</span>
                          </div>
                        </motion.div>
                      )
                    }

                    if (state === 'needs-read') {
                      return (
                        <motion.div
                          key={brief._id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <Link
                            to={`/brief/${brief._id}`}
                            className="flex items-center gap-3 rounded-xl px-4 py-3 border bg-amber-50 border-amber-200 hover:border-amber-300 transition-all group"
                          >
                            <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                              <span className="font-bold text-xs text-amber-600">📖</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                              <p className="text-xs text-slate-400">{brief.category}</p>
                            </div>
                            <span className="text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                              Read first →
                            </span>
                          </Link>
                        </motion.div>
                      )
                    }

                    if (state === 'quiz-pending') {
                      return (
                        <motion.div
                          key={brief._id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200 opacity-60 cursor-not-allowed">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                              <span className="text-slate-400 text-xs">🔒</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                              <p className="text-xs text-slate-400">{brief.category}</p>
                            </div>
                            <span className="text-xs text-slate-400 shrink-0">Intel Pending</span>
                          </div>
                        </motion.div>
                      )
                    }

                    if (state === 'needs-quiz') {
                      return (
                        <motion.div
                          key={brief._id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <Link
                            to={`/quiz/${brief._id}`}
                            className="flex items-center gap-3 rounded-xl px-4 py-3 border bg-amber-50 border-amber-200 hover:border-amber-300 transition-all group"
                          >
                            <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                              <span className="font-bold text-xs text-amber-600">🧠</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                              <p className="text-xs text-slate-400">{brief.category}</p>
                            </div>
                            <span className="text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                              Pass quiz first →
                            </span>
                          </Link>
                        </motion.div>
                      )
                    }

                    const played = state === 'completed'
                    return (
                      <motion.div
                        key={brief._id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <Link
                          to={`/battle-of-order/${brief._id}`}
                          className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all group
                            ${played
                              ? 'bg-emerald-50/60 border-emerald-200 hover:border-emerald-300'
                              : 'bg-slate-50 border-slate-200 hover:border-brand-300 hover:bg-brand-50'
                            }`}
                        >
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                            ${played ? 'bg-emerald-100' : 'bg-slate-800 group-hover:bg-slate-700 transition-colors'}`}
                          >
                            <span className={`font-bold text-xs ${played ? 'text-emerald-600' : 'text-white'}`}>
                              {played ? '✓' : '⊞'}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{brief.title}</p>
                            <p className="text-xs text-slate-400">{brief.category}</p>
                          </div>
                          {played
                            ? <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">✓ Played</span>
                            : <span className="text-[10px] font-bold bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full shrink-0">Play now</span>
                          }
                        </Link>
                      </motion.div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-slate-500 mb-4">
                    Read briefs in eligible categories (Aircrafts, Ranks, Training, Missions, Tech, Treaties) to unlock Battle of Order.
                  </p>
                  <Link
                    to="/learn-priority"
                    className="inline-flex px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                  >
                    Explore Subjects
                  </Link>
                </div>
              )}
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
