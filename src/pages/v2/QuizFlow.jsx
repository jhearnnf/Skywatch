import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import UpgradePrompt from '../../components/UpgradePrompt'
import { playSound } from '../../utils/sound'

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
                                        'bg-surface border-slate-200 text-slate-800 hover:border-brand-400 hover:bg-brand-50 cursor-pointer'
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

// ── Results screen ────────────────────────────────────────────────────────
function ResultsScreen({ score, total, xpEarned, breakdown = [], isFirstAttempt = true, won, onRetry, onBack }) {
  const pct     = total > 0 ? Math.round((score / total) * 100) : 0
  const perfect = score === total

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
        className="text-7xl mb-4"
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
        <p className="text-xs text-slate-400 mb-6">Score above 60% to earn Aircoins</p>
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

      {/* Aircoins earned */}
      {xpEarned > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mb-6"
        >
          <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 font-bold px-4 py-2 rounded-full mb-3 text-sm">
            ⭐ +{xpEarned} Aircoins earned!
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
          ✓ Already earned Aircoins for this brief
        </motion.div>
      )}

      <div className="space-y-3">
        <button
          onClick={onRetry}
          className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors"
        >
          🔄 Try Again
        </button>
        <button
          onClick={onBack}
          className="w-full py-3 border border-slate-200 text-slate-600 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
        >
          Back to Brief
        </button>
      </div>
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function QuizFlow() {
  const { briefId }      = useParams()
  const navigate         = useNavigate()
  const { user, API, awardAircoins } = useAuth()
  const { start }        = useAppTutorial()

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

  const questionStartRef = useRef(Date.now())
  const finishedRef      = useRef(false)

  // Load brief info + start quiz session
  useEffect(() => {
    async function startQuiz() {
      try {
        const [briefRes, startRes] = await Promise.all([
          fetch(`${API}/api/briefs/${briefId}`),
          fetch(`${API}/api/games/quiz/start`, {
            method: 'POST',
            credentials: 'include',
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

  const current  = questions[qIdx]
  const totalQs  = questions.length

  // Submit per-question result to backend
  const submitResult = useCallback(async (answerId) => {
    if (!attemptId || !gameSessionId || !current) return
    const timeTaken = Math.round((Date.now() - questionStartRef.current) / 1000)
    try {
      await fetch(`${API}/api/games/quiz/result`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId:         current._id,
          displayedAnswerIds: current.answers.map(a => a._id),
          selectedAnswerId:   answerId,
          timeTakenSeconds:   timeTaken,
          gameSessionId,
          attemptId,
        }),
      })
    } catch {}
  }, [API, attemptId, gameSessionId, current])

  const handleAnswer = (answerId) => {
    setSelected(answerId)
    setAnswered(true)
    if (String(answerId) === String(current.correctAnswerId)) {
      setScore(s => s + 1)
      playSound('fire')
    }
    submitResult(answerId)
  }

  const handleNext = async () => {
    const nextIdx = qIdx + 1
    if (nextIdx >= totalQs) {
      // Finish the attempt
      if (!finishedRef.current && attemptId) {
        finishedRef.current = true
        try {
          const res  = await fetch(`${API}/api/games/quiz/attempt/${attemptId}/finish`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' }),
          })
          const data = await res.json()
          const earned = data.data?.aircoinsEarned ?? 0
          const didWin = data.data?.won ?? false
          setWon(didWin)
          setBreakdown(data.data?.breakdown ?? [])
          setFirstAttempt(data.data?.isFirstAttempt ?? true)
          playSound(didWin ? 'quiz_complete_win' : 'quiz_complete_lose')
          if (earned > 0) {
            setXP(earned)
            if (awardAircoins) {
              awardAircoins(earned, 'Quiz complete', {
                cycleAfter:    data.data?.cycleAircoins,
                totalAfter:    data.data?.attempt?.totalAircoins,
                rankPromotion: data.data?.rankPromotion ?? null,
              })
            }
          }
        } catch {}
      }
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
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-slate-200 rounded-xl w-2/3" />
        <div className="h-4 bg-slate-100 rounded w-1/2" />
        {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-2xl" />)}
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
          <UpgradePrompt category={lockedCategory} variant="page" />
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
      <TutorialModal />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={async () => {
              // Abandon the attempt before navigating away
              if (attemptId && !finishedRef.current) {
                finishedRef.current = true
                await fetch(`${API}/api/games/quiz/attempt/${attemptId}/finish`, {
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
            {difficulty === 'medium' ? '🔥 Advanced' : '🌱 Standard'}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-brand-500 rounded-full"
            animate={{ width: `${((qIdx + (answered ? 1 : 0)) / totalQs) * 100}%` }}
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
          whileTap={{ scale: 0.97 }}
          className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors shadow-lg shadow-brand-200"
        >
          {qIdx + 1 >= totalQs ? 'See Results →' : 'Next Question →'}
        </motion.button>
      )}
    </>
  )
}
