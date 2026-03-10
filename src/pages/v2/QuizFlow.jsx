import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'

// ── Single question card ──────────────────────────────────────────────────
function QuestionCard({ question, answers, onAnswer, answered, correctIdx, selectedIdx }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900 leading-snug mb-6">
        {question}
      </h2>

      <div className="space-y-3">
        {answers.slice(0, 4).map((ans, i) => {
          let state = 'idle'
          if (answered) {
            if (i === correctIdx)                        state = 'correct'
            else if (i === selectedIdx && i !== correctIdx) state = 'wrong'
          }

          return (
            <motion.button
              key={i}
              onClick={() => !answered && onAnswer(i)}
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
                                        'bg-white border-slate-200 text-slate-800 hover:border-brand-400 hover:bg-brand-50 cursor-pointer'
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
                  {state === 'correct' ? '✓' : state === 'wrong' ? '✗' : String.fromCharCode(65 + i)}
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
              ${selectedIdx === correctIdx
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
              }`}
          >
            {selectedIdx === correctIdx
              ? '✅ Correct! Well done.'
              : `❌ The correct answer was: ${answers[correctIdx]?.title}`
            }
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Results screen ────────────────────────────────────────────────────────
function ResultsScreen({ score, total, xpEarned, onRetry, onBack }) {
  const pct     = Math.round((score / total) * 100)
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
      <p className="text-slate-500 mb-6">
        {score} out of {total} correct ({pct}%)
      </p>

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

      {/* XP earned */}
      {xpEarned > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 font-bold px-4 py-2 rounded-full mb-6 text-sm"
        >
          ⭐ +{xpEarned} Aircoins earned!
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
  const [questions, setQuestions]  = useState([])
  const [brief, setBrief]          = useState(null)
  const [loading, setLoading]      = useState(true)
  const [qIdx, setQIdx]            = useState(0)
  const [answered, setAnswered]    = useState(false)
  const [selectedIdx, setSelected] = useState(null)
  const [score, setScore]          = useState(0)
  const [done, setDone]            = useState(false)
  const [xpEarned, setXP]          = useState(0)
  const [difficulty, setDifficulty] = useState('easy') // 'easy' | 'medium'
  const [diffChosen, setDiffChosen] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/briefs/${briefId}`).then(r => r.json()),
      fetch(`${API}/api/briefs/${briefId}/questions`).then(r => r.json()),
    ])
      .then(([briefData, qData]) => {
        setBrief(briefData.data?.brief ?? null)
        const easy   = qData.data?.easyQuestions   ?? []
        const medium = qData.data?.mediumQuestions  ?? []
        setQuestions({ easy, medium })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [briefId, API])

  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => start('quiz'), 600)
      return () => clearTimeout(t)
    }
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeQs  = questions[difficulty] ?? []
  const current   = activeQs[qIdx]
  const totalQs   = activeQs.length

  // Find the correct answer index
  const correctIdx = current?.answers?.findIndex(a => a.isCorrect) ?? 0

  const handleAnswer = (i) => {
    setSelected(i)
    setAnswered(true)
    if (i === correctIdx) setScore(s => s + 1)
  }

  const handleNext = async () => {
    const nextIdx = qIdx + 1
    if (nextIdx >= totalQs) {
      // Award XP
      const pts = Math.round((score + (selectedIdx === correctIdx ? 1 : 0)) / totalQs * 10)
      if (user && pts > 0) {
        try {
          const res  = await fetch(`${API}/api/games/quiz/complete`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ briefId, difficulty, score: score + (selectedIdx === correctIdx ? 1 : 0), total: totalQs }),
          })
          const data = await res.json()
          if (data.data?.aircoinsAwarded) {
            awardAircoins(data.data.aircoinsAwarded, 'Quiz complete', {
              cycleAfter: data.data.cycleAfter,
              totalAfter: data.data.totalAfter,
            })
            setXP(data.data.aircoinsAwarded)
          }
        } catch {}
      }
      setDone(true)
    } else {
      setQIdx(nextIdx)
      setAnswered(false)
      setSelected(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleRetry = () => {
    setQIdx(0); setAnswered(false); setSelected(null)
    setScore(0); setDone(false); setXP(0)
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-slate-200 rounded-xl w-2/3" />
        <div className="h-4 bg-slate-100 rounded w-1/2" />
        {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-2xl" />)}
      </div>
    )
  }

  // Difficulty chooser
  if (!diffChosen) {
    return (
      <>
        <TutorialModal />
        <button onClick={() => navigate(`/brief/${briefId}`)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors">
          ← Back to Brief
        </button>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Choose Difficulty</h1>
        <p className="text-sm text-slate-500 mb-6">{brief?.title}</p>
        <div className="space-y-3">
          {[
            { key: 'easy',   emoji: '🌱', title: 'Standard',   body: 'Direct recall questions — ideal for your first attempt.', count: questions.easy?.length ?? 0 },
            { key: 'medium', emoji: '🔥', title: 'Advanced',   body: 'Contextual questions requiring deeper understanding.',     count: questions.medium?.length ?? 0 },
          ].map(({ key, emoji, title, body, count }) => (
            <button
              key={key}
              onClick={() => { setDifficulty(key); setDiffChosen(true) }}
              disabled={count === 0}
              className="w-full text-left p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-brand-400 hover:bg-brand-50 transition-all card-shadow disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="flex items-start gap-3">
                <span className="text-3xl">{emoji}</span>
                <div>
                  <p className="font-bold text-slate-800">{title}</p>
                  <p className="text-sm text-slate-500">{body}</p>
                  <p className="text-xs text-slate-400 mt-1">{count} questions</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </>
    )
  }

  if (done) {
    const finalScore = score
    return (
      <>
        <TutorialModal />
        <ResultsScreen
          score={finalScore}
          total={totalQs}
          xpEarned={xpEarned}
          onRetry={handleRetry}
          onBack={() => navigate(`/brief/${briefId}`)}
        />
      </>
    )
  }

  if (!current) {
    return <div className="text-center py-16 text-slate-400">No questions available.</div>
  }

  return (
    <>
      <TutorialModal />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => navigate(`/brief/${briefId}`)} className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
            ✕ Quit
          </button>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            {qIdx + 1} / {totalQs}
          </span>
          <span className="text-xs font-semibold text-slate-400">
            {score} correct
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
      <div className="bg-white rounded-2xl p-5 border border-slate-200 mb-4 card-shadow">
        <QuestionCard
          question={current.question}
          answers={current.answers}
          onAnswer={handleAnswer}
          answered={answered}
          correctIdx={correctIdx}
          selectedIdx={selectedIdx}
        />
      </div>

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
