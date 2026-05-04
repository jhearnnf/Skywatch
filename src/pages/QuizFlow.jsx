import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { isNative } from '../utils/isNative'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import LockedCategoryModal from '../components/LockedCategoryModal'
import { requiredTier, isFreeUser, isUpgradeUnlockable } from '../utils/subscription'
import { CATEGORY_ICONS } from '../data/mockData'
import { useAppSettings } from '../context/AppSettingsContext'
import { playSound } from '../utils/sound'
import SEO from '../components/SEO'
import { useNewGameUnlock } from '../context/NewGameUnlockContext'
import { useNewCategoryUnlock } from '../context/NewCategoryUnlockContext'
import { useGameChrome } from '../context/GameChromeContext'

// ── Related briefs strip ─────────────────────────────────────────────────
function RelatedBriefs({ brief, navigate }) {
  if (!brief) return null
  const seen = new Set()
  const cards = [
    ...(brief.associatedBaseBriefIds     ?? []),
    ...(brief.associatedSquadronBriefIds ?? []),
    ...(brief.associatedAircraftBriefIds ?? []),
    ...(brief.associatedMissionBriefIds  ?? []),
    ...(brief.associatedTrainingBriefIds ?? []),
    ...(brief.associatedTechBriefIds     ?? []),
    ...(brief.relatedBriefIds            ?? []),
  ]
    .filter(b => b?._id && !seen.has(String(b._id)) && seen.add(String(b._id)))
    .sort((a, b) => (a.status === 'stub' ? 1 : 0) - (b.status === 'stub' ? 1 : 0))
    .slice(0, 5)

  if (cards.length === 0) return null

  return (
    <div className="mt-4 text-left">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">📡 Related Briefs</p>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {cards.map(b => (
          <button
            key={b._id}
            onClick={() => b.status !== 'stub' && navigate(`/brief/${b._id}`)}
            className={`shrink-0 flex flex-col gap-1 p-3 rounded-xl border transition-all text-left w-36 ${b.status === 'stub' ? 'border-slate-100 opacity-60 cursor-default' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50 cursor-pointer'}`}
          >
            <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wide">{b.category}</span>
            <span className={`text-xs font-semibold leading-tight ${b.status === 'stub' ? 'text-slate-400' : 'text-slate-700'}`}>
              {b.status === 'stub' ? `🔒 ${b.title}` : b.title}
            </span>
            {b.status === 'stub' && (
              <span className="text-[10px] text-slate-400 font-medium">Coming soon</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Single question card ──────────────────────────────────────────────────
function QuestionCard({ question, answers, onAnswer, answered, correctAnswerId, selectedAnswerId }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900 leading-snug mb-6">
        {question}
      </h2>

      <div className="space-y-3">
        {answers.map((ans) => {
          const isCorrect  = String(ans._id) === String(correctAnswerId)
          const isSelected = String(ans._id) === String(selectedAnswerId)
          let state = 'idle'
          if (answered) {
            if (isCorrect)       state = 'correct'
            else if (isSelected) state = 'wrong'
          }

          return (
            <motion.button
              key={String(ans._id)}
              onClick={() => !answered && onAnswer(ans._id)}
              disabled={answered}
              whileTap={!answered ? { scale: 0.98 } : {}}
              animate={
                state === 'correct' ? { x: [0, -4, 4, -2, 2, 0] } :
                state === 'wrong'   ? { x: [0, -6, 6, -4, 4, 0] } :
                {}
              }
              transition={{ duration: 0.35 }}
              className={`w-full text-left p-4 rounded-2xl border-2 font-semibold text-sm transition-all
                ${state === 'correct' ? 'bg-emerald-50 border-emerald-500 text-emerald-800' :
                  state === 'wrong'   ? 'bg-red-50 border-red-400 text-red-700' :
                  answered            ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' :
                                        'bg-surface border-slate-200 text-slate-700 hover:border-brand-400 hover:bg-brand-50 cursor-pointer'
                }`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0
                  ${state === 'correct' ? 'bg-emerald-500 border-emerald-500 text-white' :
                    state === 'wrong'   ? 'bg-red-400 border-red-400 text-white' :
                    answered            ? 'border-slate-200 text-slate-300' :
                                          'border-slate-300 text-slate-500'
                  }`}
                >
                  {state === 'correct' ? '✓' : state === 'wrong' ? '✗' : ''}
                </span>
                {ans.title}
              </div>
            </motion.button>
          )
        })}
      </div>

      {/* Feedback */}
      <AnimatePresence>
        {answered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-4 p-3 rounded-xl text-sm font-semibold
              ${String(selectedAnswerId) === String(correctAnswerId)
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
              }`}
          >
            {String(selectedAnswerId) === String(correctAnswerId)
              ? '✅ Correct! Well done.'
              : `❌ The correct answer was: ${answers.find(a => String(a._id) === String(correctAnswerId))?.title ?? '—'}`
            }
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Priority order for the locked-category upsell teaser
const UPSELL_PRIORITY = ['Threats', 'Tech', 'Missions', 'Allies', 'Squadrons', 'Bases']

// ── Post-quiz difficulty nudge ────────────────────────────────────────────
function DifficultyNudge({ user, won, difficulty }) {
  const navigate                    = useNavigate()
  const { hasSeen, startAfterNav }  = useAppTutorial()
  const [nudgeVisible, setVisible]  = useState(false)

  const nudgeKey = `sw_tut_v2_${user?._id ?? 'anon'}_quiz_difficulty_nudge`

  useEffect(() => {
    if (!user || !won || difficulty !== 'easy') return
    if (localStorage.getItem(nudgeKey)) return
    const t = setTimeout(() => setVisible(true), 1200)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!nudgeVisible) return null

  const dismiss = () => {
    localStorage.setItem(nudgeKey, '1')
    setVisible(false)
  }

  const handleStepUp = () => {
    localStorage.setItem(nudgeKey, '1')
    // Infinity is clamped to the actual last step inside startAfterNav
    startAfterNav('profile', hasSeen('profile') ? Infinity : 0)
    navigate('/profile')
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-5 bg-surface rounded-2xl border border-brand-300/40 p-4 text-left"
    >
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Difficulty Check</p>
      <p className="text-sm font-bold text-slate-800 mb-1">Was that quiz too easy?</p>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        Step up to Advanced for tougher, deeper questions — and earn bigger Airstars rewards.
      </p>
      <div className="flex gap-2">
        <button
          onClick={dismiss}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          Felt right
        </button>
        <button
          onClick={handleStepUp}
          className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white transition-colors"
        >
          Show me how →
        </button>
      </div>
    </motion.div>
  )
}

// ── Results screen ────────────────────────────────────────────────────────
function ResultsScreen({ score, total, xpEarned, breakdown = [], isFirstAttempt = true, won, onRetry, onBack, brief, booAvailable = false, onStartBoo, user, settings, levelThresholds, navigate, difficulty }) {
  const pct     = total > 0 ? Math.round((score / total) * 100) : 0
  const perfect = score === total

  // Pick the first priority category that is locked for this user
  const upsellCategory = (won && user && isFreeUser(user))
    ? UPSELL_PRIORITY.find(c => isUpgradeUnlockable(c, user, settings, levelThresholds)) ?? null
    : null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 12, delay: 0.1 }}
        className={`text-7xl mb-4${pct >= 70 && pct < 100 ? ' star-silver' : ''}`}
      >
        {pct === 100 ? '🏆' : pct >= 70 ? '⭐' : pct >= 40 ? '💪' : '📚'}
      </motion.div>

      <h2 className="text-3xl font-extrabold text-slate-900 mb-1">
        {pct === 100 ? 'Perfect!' : pct >= 70 ? 'Great work!' : pct >= 40 ? 'Keep it up!' : 'Keep learning!'}
      </h2>
      <p className="text-slate-500 mb-2">
        {score} out of {total} correct ({pct}%)
      </p>
      {!won && total > 0 && (
        <p className="text-xs text-slate-400 mb-6">Score above 60% to earn Airstars</p>
      )}

      {/* Score ring */}
      <div className="relative w-28 h-28 mx-auto mb-6">
        <svg width="112" height="112" className="-rotate-90">
          <circle cx="56" cy="56" r="46" fill="none" stroke="#e2e8f0" strokeWidth="8"/>
          <motion.circle
            cx="56" cy="56" r="46"
            fill="none" strokeWidth="8" strokeLinecap="round"
            stroke={pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444'}
            strokeDasharray={`${2 * Math.PI * 46 * pct / 100} ${2 * Math.PI * 46}`}
            initial={{ strokeDasharray: `0 ${2 * Math.PI * 46}` }}
            animate={{ strokeDasharray: `${2 * Math.PI * 46 * pct / 100} ${2 * Math.PI * 46}` }}
            transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold text-slate-900">{pct}%</span>
        </div>
      </div>

      {/* Airstars earned */}
      {xpEarned > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mb-6"
        >
          <div className="inline-flex items-center gap-2 bg-slate-200 border border-slate-300 text-white font-bold px-4 py-2 rounded-full mb-3 text-sm">
            <span className="star-silver">⭐</span> +{xpEarned} Airstars earned!
          </div>
          {breakdown.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-left text-sm space-y-1.5 max-w-xs mx-auto">
              {breakdown.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                  <span className="text-amber-700 font-medium">{item.label}</span>
                  <span className="text-amber-800 font-extrabold shrink-0">+{item.amount}</span>
                </div>
              ))}
              <div className="border-t border-amber-200 pt-1.5 mt-1 flex items-center justify-between">
                <span className="text-amber-800 font-bold">Total</span>
                <span className="text-amber-900 font-extrabold">+{xpEarned}</span>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Already earned — repeat win */}
      {won && !isFirstAttempt && xpEarned === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-500 font-semibold px-4 py-2 rounded-full mb-6 text-sm"
        >
          ✓ Already earned Airstars for this brief
        </motion.div>
      )}

      <div className="space-y-3">
        {booAvailable && onStartBoo && (
          <button
            onClick={onStartBoo}
            className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors"
          >
            ⚔️ Start Battle of Order
          </button>
        )}
        {!won && (
          <button
            onClick={onRetry}
            className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors"
          >
            🔄 Try Again
          </button>
        )}
        <button
          onClick={onBack}
          className="w-full py-3 text-sm text-slate-500 font-medium border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors"
        >
          ↩ Back to Brief
        </button>
      </div>

      <RelatedBriefs brief={brief} navigate={navigate} />

      <DifficultyNudge
        user={user}
        won={won}
        difficulty={difficulty}
      />

      {/* Locked category upsell — win only, free signed-in users */}
      {upsellCategory && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-5 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left"
        >
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Unlock next</p>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">{CATEGORY_ICONS[upsellCategory]}</span>
              <div>
                <p className="font-bold text-slate-800 text-sm">{upsellCategory}</p>
                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">🔒 SILVER+</span>
              </div>
            </div>
            <a
              href="/subscribe"
              className="shrink-0 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors"
            >
              {isNative ? `${settings?.appTrialDays ?? 3}-day free trial →` : `${settings?.webStripeTrialDays ?? 5}-day free trial →`}
            </a>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function QuizFlow() {
  const { briefId }      = useParams()
  const navigate         = useNavigate()
  const { user, API, apiFetch, awardAirstars, refreshUser } = useAuth()
  const { applyUnlocks } = useNewGameUnlock()
  const { applyUnlocks: applyCategoryUnlocks } = useNewCategoryUnlock()
  const { start }        = useAppTutorial()

  const { settings, levelThresholds } = useAppSettings()
  const [loading, setLoading]        = useState(true)
  const [error, setError]            = useState(null)
  const [lockedCategory, setLockedCategory] = useState(null)
  const [brief, setBrief]            = useState(null)
  const [questions, setQuestions]    = useState([])
  const [attemptId, setAttemptId]    = useState(null)
  const [gameSessionId, setSession]  = useState(null)
  const [difficulty, setDifficulty]  = useState('easy')

  const [qIdx, setQIdx]              = useState(0)
  const [answered, setAnswered]      = useState(false)
  const [selectedAnswerId, setSelected] = useState(null)
  const [score, setScore]            = useState(0)
  const [done, setDone]              = useState(false)
  const [won, setWon]                = useState(false)
  const [xpEarned, setXP]            = useState(0)
  const [breakdown, setBreakdown]    = useState([])
  const [isFirstAttempt, setFirstAttempt] = useState(true)
  const [booAvailable,   setBooAvailable] = useState(false)
  const [finishing,      setFinishing]   = useState(false)

  // Hide TopBar / BottomNav on mobile while questions are being answered.
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (!loading && !error && !done) enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [loading, error, done, enterImmersive, exitImmersive])

  const questionStartRef = useRef(Date.now())
  const finishedRef      = useRef(false)
  const attemptIdRef     = useRef(null)
  const booPreFetched    = useRef(false)
  // Locally-retained answer set — sent in the /finish body so the server can
  // backfill any per-question POSTs that failed silently. Without this, a
  // single dropped /result request could push the user below the pass
  // threshold and silently cost them their airstar award.
  const answersRef       = useRef([])

  // Load brief info + start quiz session
  useEffect(() => {
    async function startQuiz() {
      try {
        const [briefRes, startRes] = await Promise.all([
          apiFetch(`${API}/api/briefs/${briefId}`),
          apiFetch(`${API}/api/games/quiz/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ briefId }),
          }),
        ])
        const briefData = await briefRes.json()
        const startData = await startRes.json()

        if (!startRes.ok) {
          if (startRes.status === 403) {
            setError('locked')
            setLockedCategory(startData.category ?? null)
          } else {
            setError(startData.message ?? 'Could not start quiz')
          }
          return
        }

        setBrief(briefData.data?.brief ?? null)
        setQuestions(startData.data?.questions ?? [])
        setAttemptId(startData.data?.attemptId ?? null)
        attemptIdRef.current = startData.data?.attemptId ?? null
        setSession(startData.data?.gameSessionId ?? null)
        setDifficulty(startData.data?.difficulty ?? 'easy')
      } catch {
        setError('Failed to load quiz')
      } finally {
        setLoading(false)
      }
    }
    startQuiz()
  }, [briefId, API])

  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => start('quiz'), 600)
      return () => clearTimeout(t)
    }
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Abandon on unmount (covers back-navigation / navbar clicks) ─────────
  useEffect(() => {
    return () => {
      if (!attemptIdRef.current || finishedRef.current) return
      finishedRef.current = true
      apiFetch(`${API}/api/games/quiz/attempt/${attemptIdRef.current}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ status: 'abandoned' }),
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Abandon on page refresh / tab close ────────────────────────────────
  useEffect(() => {
    function handleUnload() {
      if (!attemptIdRef.current || finishedRef.current) return
      finishedRef.current = true
      navigator.sendBeacon(
        `${API}/api/games/quiz/attempt/${attemptIdRef.current}/finish`,
        new Blob([JSON.stringify({ status: 'abandoned' })], { type: 'application/json' }),
      )
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [API]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fetch BOO availability (optimistic — assumes user will pass)
  const preFetchBoo = useCallback(() => {
    if (booPreFetched.current || !briefId) return
    booPreFetched.current = true
    apiFetch(`${API}/api/games/battle-of-order/options?briefId=${briefId}`)
      .then(r => r.json())
      .then(d => { if (d.data?.available) setBooAvailable(true) })
      .catch(() => {})
  }, [API, briefId, apiFetch])

  const current  = questions[qIdx]
  const totalQs  = questions.length

  // Submit per-question result to backend (fire-and-forget — no loading overlay)
  const submitResult = useCallback((answerId) => {
    if (!attemptId || !gameSessionId || !current) return Promise.resolve()
    const timeTaken = Math.round((Date.now() - questionStartRef.current) / 1000)
    return apiFetch(`${API}/api/games/quiz/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId:         current._id,
        displayedAnswerIds: current.answers.map(a => a._id),
        selectedAnswerId:   answerId,
        timeTakenSeconds:   timeTaken,
        gameSessionId,
        attemptId,
      }),
    }).catch(() => {})
  }, [API, attemptId, gameSessionId, current, apiFetch])

  // Pre-fired promise for the last question's /finish call — stored so
  // handleNext can await the already-in-flight request instead of starting fresh.
  const finishPromiseRef = useRef(null)
  // Baseline totalAirstars captured BEFORE the quiz can mutate the balance, so
  // the fallback path can detect coins awarded server-side even when the
  // response is lost. `null` = "not yet captured" — fallback skips the delta
  // notification rather than risk attributing the user's pre-existing balance
  // to this quiz (the +entire-balance bug).
  const preFinishTotalRef = useRef(null)
  // Resolves once fireFinish has been called and finishPromiseRef has been set.
  // handleNext awaits this so it can never observe a null finishPromiseRef
  // simply because the user clicked "See Results" before handleAnswer's
  // `await resultPromise` finished.
  const finishStartedRef = useRef(null)
  const finishStartedResolveRef = useRef(null)
  if (finishStartedRef.current === null) {
    finishStartedRef.current = new Promise(resolve => {
      finishStartedResolveRef.current = resolve
    })
  }

  // Continuously track the user's totalAirstars as the baseline UNTIL the
  // quiz is finalised. Capturing at hydration alone would attribute any
  // non-quiz awards (eg a brief-read +5 while the quiz was in progress) to
  // the quiz reward in the fallback delta. Capturing only inside fireFinish
  // leaves the baseline at its initial value of 0 if the user clicks "See
  // Results" before the per-question POST resolves — that was the +entire-
  // balance bug. Updating here while !finishedRef gives us both: an always-
  // current baseline AND immunity from the click-race.
  useEffect(() => {
    if (!finishedRef.current && user?.totalAirstars != null) {
      preFinishTotalRef.current = user.totalAirstars
    }
  }, [user?.totalAirstars])

  const fireFinish = useCallback(() => {
    if (finishedRef.current || !attemptId) return
    finishedRef.current = true
    // Belt-and-braces: re-capture the baseline if the useEffect above hasn't
    // run yet (very short quiz with eager click). Never overwrite a captured
    // baseline — the earliest snapshot is the most accurate.
    if (preFinishTotalRef.current == null && user?.totalAirstars != null) {
      preFinishTotalRef.current = user.totalAirstars
    }
    const p = apiFetch(`${API}/api/games/quiz/attempt/${attemptId}/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed', answers: answersRef.current }),
    }).then(res => (res.ok ? res.json() : Promise.reject(new Error(`finish failed: ${res.status}`))))
    // Observe the rejection so it isn't flagged as "unhandled" during the gap
    // between fire and the await in handleNext. handleNext still sees the error
    // via its own await, because p itself remains the rejected promise.
    p.catch(() => {})
    finishPromiseRef.current = p
    // Unblock handleNext if it was waiting on us.
    finishStartedResolveRef.current?.()
  }, [API, attemptId, apiFetch, user?.totalAirstars])

  const handleAnswer = async (answerId) => {
    setSelected(answerId)
    setAnswered(true)
    if (String(answerId) === String(current.correctAnswerId)) {
      setScore(s => s + 1)
      playSound('quiz_answer_correct')
    } else {
      playSound('quiz_answer_incorrect')
    }
    // Record locally so /finish can backfill if the per-question POST fails.
    answersRef.current.push({
      questionId:         current._id,
      displayedAnswerIds: current.answers.map(a => a._id),
      selectedAnswerId:   answerId,
      timeTakenSeconds:   Math.round((Date.now() - questionStartRef.current) / 1000),
    })
    // Pre-fetch BOO availability in background after first answer
    preFetchBoo()
    const resultPromise = submitResult(answerId)
    if (qIdx + 1 >= totalQs) {
      // Ensure the last answer is saved before finishing, so /finish
      // sees all results when computing airstars.
      await resultPromise
      fireFinish()
    }
  }

  const handleNext = async () => {
    const nextIdx = qIdx + 1
    if (nextIdx >= totalQs) {
      setFinishing(true)
      // Race guard: the user can click "See Results" before handleAnswer's
      // `await resultPromise` resolves and fires fireFinish. Without this wait,
      // finishPromiseRef.current would be null, the success path would skip,
      // and the fallback would compute delta from a 0 baseline → false +entire-
      // balance notification. Wait for fireFinish (handleAnswer triggers it),
      // with a hard timeout so the UI can never get permanently stuck.
      if (!finishPromiseRef.current && !finishedRef.current) {
        await Promise.race([
          finishStartedRef.current,
          new Promise(resolve => setTimeout(resolve, 10000)),
        ])
      }
      // Defensive: if 10s elapsed and fireFinish still hasn't run (handleAnswer
      // crashed?), fire it from here so we still attempt to award.
      if (!finishPromiseRef.current && !finishedRef.current) {
        fireFinish()
      }
      let awarded = false
      try {
        const data = await (finishPromiseRef.current ?? Promise.resolve(null))
        if (data) {
          const earned = data.data?.airstarsEarned ?? 0
          const didWin = data.data?.won ?? false
          setWon(didWin)
          setBreakdown(data.data?.breakdown ?? [])
          setFirstAttempt(data.data?.isFirstAttempt ?? true)
          playSound(didWin ? 'quiz_complete_win' : 'quiz_complete_lose')
          if (earned > 0) {
            setXP(earned)
            if (awardAirstars) {
              awardAirstars(earned, 'Intel Recall complete', {
                cycleAfter:         data.data?.cycleAirstars,
                totalAfter:         data.data?.totalAirstars,
                rankPromotion:      data.data?.rankPromotion ?? null,
                unlockedCategories: data.data?.unlockedCategories ?? [],
              })
              awarded = true
            }
          }
          if (data.data?.gameUnlocksGranted?.length) {
            applyUnlocks(data.data.gameUnlocksGranted)
          }
          if (data.data?.categoryUnlocksGranted?.length) {
            applyCategoryUnlocks(data.data.categoryUnlocksGranted)
          }
        }
      } catch (err) {
        console.error('[quiz] finish failed:', err)
      }
      // Fallback: if the client didn't actually notify (response lost, malformed
      // body with no airstarsEarned field, or a post-award throw on the server),
      // re-sync the user and fire the airstar notification based on the delta so
      // the UI never silently stays out of sync with the ledger.
      //
      // Sanity guards (defence against the +entire-balance bug):
      //   • Skip entirely if no baseline was ever captured — we cannot tell what
      //     the user had before the quiz, so any delta is meaningless.
      //   • Cap the delta at MAX_PLAUSIBLE_DELTA: a single quiz can award at
      //     most ~115 airstars (5 × 20 medium + 15 perfect bonus). Anything
      //     above the cap is almost certainly a stale-baseline artefact and is
      //     suppressed rather than shown as a false reward.
      const MAX_PLAUSIBLE_DELTA = 250
      if (!awarded && refreshUser && preFinishTotalRef.current != null) {
        try {
          const fresh = await refreshUser()
          const baseline = preFinishTotalRef.current
          const delta = (fresh?.totalAirstars ?? 0) - baseline
          if (delta > 0 && delta <= MAX_PLAUSIBLE_DELTA && awardAirstars) {
            setXP(delta)
            awardAirstars(delta, 'Intel Recall complete', {
              totalAfter: fresh.totalAirstars,
              cycleAfter: fresh.cycleAirstars,
            })
          } else if (delta > MAX_PLAUSIBLE_DELTA) {
            console.warn('[quiz] suppressed implausible airstar delta:', { delta, baseline, fresh: fresh?.totalAirstars })
          }
        } catch { /* swallow — best-effort resync */ }
      }
      setFinishing(false)
      setDone(true)
    } else {
      setQIdx(nextIdx)
      setAnswered(false)
      setSelected(null)
      questionStartRef.current = Date.now()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleRetry = () => {
    // Re-navigate to the same route so a fresh session starts
    navigate(0)
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="animate-pulse">
        {/* Header row: quit / counter / score */}
        <div className="flex items-center justify-between mb-2">
          <div className="h-4 w-10 bg-slate-200 rounded-full" />
          <div className="h-6 w-16 bg-slate-200 rounded-full" />
          <div className="h-4 w-14 bg-slate-100 rounded-full" />
        </div>
        {/* Difficulty badge */}
        <div className="flex justify-center mb-2">
          <div className="h-4 w-24 bg-slate-100 rounded-full" />
        </div>
        {/* Progress bar */}
        <div className="h-2.5 bg-slate-100 rounded-full mb-6" />
        {/* Question card */}
        <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 mb-4">
          <div className="h-5 bg-slate-200 rounded w-full mb-2" />
          <div className="h-5 bg-slate-200 rounded w-4/5 mb-6" />
          {/* Answer options */}
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4 rounded-2xl border-2 border-slate-100">
                <div className="w-7 h-7 rounded-full bg-slate-200 shrink-0" />
                <div className="h-4 bg-slate-200 rounded flex-1" style={{ width: `${65 + i * 7}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Error (not enough questions, subscription gate, etc.) ────────────────
  if (error) {
    if (error === 'locked') {
      return (
        <>
          <button
            onClick={() => navigate(`/brief/${briefId}`)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
          >
            ← Back to Brief
          </button>
          <LockedCategoryModal
            category={lockedCategory ?? ''}
            tier={lockedCategory ? requiredTier(lockedCategory, settings) : 'silver'}
            user={user}
            onClose={() => navigate(`/brief/${briefId}`)}
          />
        </>
      )
    }
    return (
      <>
        <button
          onClick={() => navigate(`/brief/${briefId}`)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← Back to Brief
        </button>
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">📭</div>
          <p className="font-semibold text-slate-600 mb-1">Quiz unavailable</p>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => navigate(`/brief/${briefId}`)}
            className="mt-6 text-brand-600 font-semibold text-sm hover:text-brand-700"
          >
            ← Back to brief
          </button>
        </div>
      </>
    )
  }

  // ── Results ──────────────────────────────────────────────────────────────
  if (done) {
    return (
      <>
        <TutorialModal />
        <ResultsScreen
          score={score}
          total={totalQs}
          xpEarned={xpEarned}
          breakdown={breakdown}
          isFirstAttempt={isFirstAttempt}
          won={won}
          onRetry={handleRetry}
          onBack={() => navigate(`/brief/${briefId}`)}
          brief={brief}
          navigate={navigate}
          booAvailable={(won || !isFirstAttempt) && booAvailable}
          onStartBoo={() => navigate(`/battle-of-order/${briefId}`)}
          user={user}
          settings={settings}
          levelThresholds={levelThresholds}
          difficulty={difficulty}
        />
      </>
    )
  }

  // ── No questions ─────────────────────────────────────────────────────────
  if (!current) {
    return <div className="text-center py-16 text-slate-400">No questions available.</div>
  }

  return (
    <>
      <SEO title="Quiz" description="Test your knowledge on this RAF intel brief." noIndex={true} />
      <TutorialModal />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={async () => {
              // Abandon the attempt before navigating away
              if (attemptId && !finishedRef.current) {
                finishedRef.current = true
                await apiFetch(`${API}/api/games/quiz/attempt/${attemptId}/finish`, {
                  method: 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'abandoned' }),
                }).catch(() => {})
              }
              navigate(`/brief/${briefId}`)
            }}
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            ✕ Quit
          </button>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            {qIdx + 1} / {totalQs}
          </span>
          <span className="text-xs font-semibold text-slate-400">
            {score} correct
          </span>
        </div>

        {/* Difficulty badge */}
        <div className="flex justify-center mb-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border
            ${difficulty === 'medium'
              ? 'bg-orange-50 border-orange-200 text-orange-600'
              : 'bg-emerald-50 border-emerald-200 text-emerald-600'
            }`}
          >
            {difficulty === 'medium'
              ? <><span className="flame-blue">🔥</span> Advanced</>
              : '🌱 Standard'}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-brand-500 rounded-full"
            animate={{ width: `${((qIdx + 1) / totalQs) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Question */}
      <AnimatePresence mode="wait">
        <motion.div
          key={qIdx}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="bg-surface rounded-2xl p-5 border border-slate-200 mb-4 card-shadow"
        >
          <QuestionCard
            question={current.question}
            answers={current.answers}
            onAnswer={handleAnswer}
            answered={answered}
            correctAnswerId={current.correctAnswerId}
            selectedAnswerId={selectedAnswerId}
          />
        </motion.div>
      </AnimatePresence>

      {/* Next button */}
      {answered && (
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={handleNext}
          disabled={finishing}
          whileTap={!finishing ? { scale: 0.97 } : {}}
          className={`w-full py-4 font-bold rounded-2xl text-base transition-colors shadow-lg shadow-brand-200
            ${finishing
              ? 'bg-brand-500 text-white/80 cursor-wait'
              : 'bg-brand-600 hover:bg-brand-700 text-white'
            }`}
        >
          {finishing ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
              </svg>
              Loading results…
            </span>
          ) : qIdx + 1 >= totalQs ? 'See Results →' : 'Next Question →'}
        </motion.button>
      )}
    </>
  )
}
