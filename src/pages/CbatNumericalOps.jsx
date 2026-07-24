import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'

// ── Constants ────────────────────────────────────────────────────────────────
const ROUNDS = 4
const QUESTIONS_PER_ROUND = 5
const TOTAL_QUESTIONS = ROUNDS * QUESTIONS_PER_ROUND
const PER_QUESTION_MS = 20000
const FEEDBACK_MS = 900
const ROUND_MAX = [10, 25, 50, 99]
// Weighted op pool — division is harder to satisfy (needs a clean integer
// result) and tends to dominate when picked uniformly, so it's deliberately
// rarer here: ÷ shows up ~1/7 of the time vs ~2/7 each for + − ×.
const OPS = ['+', '+', '-', '-', '*', '*', '/']

// ── Question generation ──────────────────────────────────────────────────────
function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function buildQuestion(round) {
  const max = ROUND_MAX[round - 1]
  const op = OPS[Math.floor(Math.random() * OPS.length)]

  // Both displayed operands kept within [1, max]; ÷ also requires a clean
  // integer result, so we retry until the random pair satisfies the rule
  // (with a generous cap for tiny ranges like round 1).
  for (let attempt = 0; attempt < 50; attempt++) {
    let a = randInt(1, max)
    let b = randInt(1, max)
    if (op === '-') {
      if (a < b) [a, b] = [b, a]
      return { a, b, op, answer: a - b, round }
    }
    if (op === '+') {
      return { a, b, op, answer: a + b, round }
    }
    if (op === '*') {
      return { a, b, op, answer: a * b, round }
    }
    // op === '/'
    if (b === 0) continue
    if (a % b !== 0) continue
    // Avoid trivial b=1 (answer = a) more often than chance — reroll once.
    if (b === 1 && attempt === 0) continue
    return { a, b, op, answer: a / b, round }
  }
  // Deterministic fallback if RNG happened to keep failing (extremely unlikely):
  // a clean small division that fits any round.
  return { a: 6, b: 2, op: '/', answer: 3, round }
}

function buildQuestions() {
  const out = []
  for (let r = 1; r <= ROUNDS; r++) {
    for (let i = 0; i < QUESTIONS_PER_ROUND; i++) {
      out.push(buildQuestion(r))
    }
  }
  return out
}

function formatOp(op) {
  if (op === '*') return '×'
  if (op === '/') return '÷'
  if (op === '-') return '−'
  return '+'
}

// ── Keypad ───────────────────────────────────────────────────────────────────
// NOTE: KeyButton is defined at module scope, NOT inside Keypad. The game's
// per-question countdown re-renders this subtree ~10×/second; a component
// defined inline would get a new type identity on every render, forcing React
// to unmount/remount every button each tick — which makes them visibly flash
// and swallows clicks (the node is replaced between mousedown and mouseup).
function KeyButton({ children, onClick, accent, disabled, canSubmit }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`py-4 rounded-lg border-2 font-mono font-bold text-xl transition-all ${
        accent === 'submit'
          ? (canSubmit && !disabled
              ? 'bg-brand-600 hover:bg-brand-700 border-brand-600 text-white cursor-pointer'
              : 'bg-[#0a1628] border-[#1a3a5c] text-[#5a6a80] cursor-not-allowed')
          : accent === 'back'
            ? (disabled
                ? 'bg-[#0a1628] border-[#1a3a5c] text-[#5a6a80] cursor-not-allowed'
                : 'bg-[#1a3a5c] hover:bg-[#254a6e] border-[#1a3a5c] text-white cursor-pointer')
            : (disabled
                ? 'bg-[#0a1628] border-[#1a3a5c] text-[#5a6a80] cursor-not-allowed'
                : 'bg-[#0a1628] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240] cursor-pointer')
      }`}
    >
      {children}
    </button>
  )
}

function Keypad({ onDigit, onBackspace, onSubmit, disabled, canSubmit }) {
  return (
    <div className="grid grid-cols-3 gap-2 mt-3">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
        <KeyButton key={d} onClick={() => onDigit(String(d))} disabled={disabled}>{d}</KeyButton>
      ))}
      <KeyButton accent="back" onClick={onBackspace} disabled={disabled}>⌫</KeyButton>
      <KeyButton onClick={() => onDigit('0')} disabled={disabled}>0</KeyButton>
      <KeyButton accent="submit" onClick={onSubmit} disabled={disabled || !canSubmit} canSubmit={canSubmit}>⏎</KeyButton>
    </div>
  )
}

// ── Results screen ───────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / TOTAL_QUESTIONS) * 100)
  const perRound = [1, 2, 3, 4].map(r => ({
    r,
    correct: answers.filter(a => a.round === r && a.correct).length,
  }))

  const grade = pct >= 90 ? { label: 'Outstanding', emoji: '🎖️', color: 'text-green-400' }
    : pct >= 70 ? { label: 'Good', emoji: '✈️', color: 'text-brand-300' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '🔧', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '💥', color: 'text-red-400' }

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Numerical Operations Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{pct}%</p>
            <p className="text-sm text-slate-400">{correct} / {TOTAL_QUESTIONS} correct</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{totalTime.toFixed(1)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-6">
        {perRound.map(({ r, correct }) => (
          <div key={r} className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">R{r}</p>
            <p className="text-xl font-mono font-bold text-brand-300">{correct}/{QUESTIONS_PER_ROUND}</p>
          </div>
        ))}
      </div>

      {/* Answer review — scrollable */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-6 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Answer Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 text-left">#{i + 1}</span>
              <span>{a.correct ? '✓' : '✗'}</span>
              <span className="font-mono">{a.a} {formatOp(a.op)} {a.b} = {a.answer}</span>
              {!a.correct && <span className="text-slate-500">
                {a.picked === null ? 'timeout' : `you: ${a.picked}`}
              </span>}
              {a.correct && <span className="text-slate-500">—</span>}
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatNumericalOps() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  const [phase, setPhase] = useState('intro') // intro | playing | feedback | results
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'feedback') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  const [questions, setQuestions] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState([])
  const [currentInput, setCurrentInput] = useState('')
  const [feedback, setFeedback] = useState(null) // { correct, picked, answer }
  const [qRemainingMs, setQRemainingMs] = useState(PER_QUESTION_MS)
  const [totalElapsedMs, setTotalElapsedMs] = useState(0)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  const qStartRef = useRef(null)
  const tickRef = useRef(null)
  const advanceRef = useRef(null)
  const answersRef = useRef([])
  const totalElapsedRef = useRef(0)

  // Keep refs synced so timeout/keyboard handlers always see current values.
  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { totalElapsedRef.current = totalElapsedMs }, [totalElapsedMs])

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/numerical-ops/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

  // Submit score to backend
  const submitScore = useCallback((finalAnswers, finalTotalMs) => {
    const correctCount = finalAnswers.filter(a => a.correct).length
    const correctPercentage = Math.round((correctCount / TOTAL_QUESTIONS) * 100)
    const round1Correct = finalAnswers.filter(a => a.round === 1 && a.correct).length
    const round2Correct = finalAnswers.filter(a => a.round === 2 && a.correct).length
    const round3Correct = finalAnswers.filter(a => a.round === 3 && a.correct).length
    const round4Correct = finalAnswers.filter(a => a.round === 4 && a.correct).length
    const totalTime = finalTotalMs / 1000
    const avgTimePerQuestionMs = Math.round(finalTotalMs / TOTAL_QUESTIONS)

    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correctCount })
    submitCbatResult(`numerical-ops`, {
        correctCount, correctPercentage,
        round1Correct, round2Correct, round3Correct, round4Correct,
        totalTime, avgTimePerQuestionMs,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/numerical-ops/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted])

  const currentQuestion = questions[currentIdx] || null
  const currentRound = currentQuestion ? currentQuestion.round : 1
  const questionInRound = currentQuestion
    ? ((currentIdx % QUESTIONS_PER_ROUND) + 1)
    : 1

  // Per-question countdown — runs only during 'playing'. On timeout, record a
  // wrong answer (picked = null) and advance through the feedback phase.
  useEffect(() => {
    if (phase !== 'playing' || !currentQuestion) return
    qStartRef.current = Date.now()
    setQRemainingMs(PER_QUESTION_MS)
    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - qStartRef.current
      const remaining = Math.max(0, PER_QUESTION_MS - elapsed)
      setQRemainingMs(remaining)
      if (remaining === 0) {
        clearInterval(tickRef.current)
        recordAnswer(null, PER_QUESTION_MS)
      }
    }, 100)
    return () => clearInterval(tickRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIdx])

  // After feedback flashes briefly, auto-advance.
  useEffect(() => {
    if (phase !== 'feedback') return
    advanceRef.current = setTimeout(() => {
      goNext()
    }, FEEDBACK_MS)
    return () => clearTimeout(advanceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function recordAnswer(pickedRaw, elapsedMs) {
    if (!currentQuestion) return
    const picked = pickedRaw === null || pickedRaw === '' ? null : Number(pickedRaw)
    const correct = picked !== null && picked === currentQuestion.answer
    const entry = {
      a: currentQuestion.a,
      b: currentQuestion.b,
      op: currentQuestion.op,
      answer: currentQuestion.answer,
      picked,
      correct,
      round: currentQuestion.round,
      ms: elapsedMs,
    }
    const nextAnswers = [...answersRef.current, entry]
    setAnswers(nextAnswers)
    setTotalElapsedMs(prev => prev + elapsedMs)
    totalElapsedRef.current = totalElapsedRef.current + elapsedMs
    answersRef.current = nextAnswers
    setFeedback({ correct, picked, answer: currentQuestion.answer })
    setPhase('feedback')
  }

  function goNext() {
    const nextIdx = currentIdx + 1
    setFeedback(null)
    setCurrentInput('')
    if (nextIdx >= TOTAL_QUESTIONS) {
      submitScore(answersRef.current, totalElapsedRef.current)
      setPhase('results')
      return
    }
    setCurrentIdx(nextIdx)
    setPhase('playing')
  }

  function handleSubmit() {
    if (phase !== 'playing' || !currentQuestion) return
    if (currentInput === '') return
    clearInterval(tickRef.current)
    const elapsedMs = Date.now() - qStartRef.current
    recordAnswer(currentInput, elapsedMs)
  }

  function handleDigit(d) {
    if (phase !== 'playing') return
    // Cap input length so users can't type runaway strings; max answer is
    // round 4: 99 × 99 = 9801 → 4 digits is plenty.
    if (currentInput.length >= 4) return
    setCurrentInput(prev => prev + d)
  }

  function handleBackspace() {
    if (phase !== 'playing') return
    setCurrentInput(prev => prev.slice(0, -1))
  }

  // Hardware keyboard support — digits, Backspace, Enter.
  useEffect(() => {
    if (phase !== 'playing') return
    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key)
        e.preventDefault()
      } else if (e.key === 'Backspace') {
        handleBackspace()
        e.preventDefault()
      } else if (e.key === 'Enter') {
        handleSubmit()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentInput, currentIdx])

  const startGame = useCallback(() => {
    startTracking('numerical-ops')
    setQuestions(buildQuestions())
    setCurrentIdx(0)
    setAnswers([])
    answersRef.current = []
    setCurrentInput('')
    setFeedback(null)
    setQRemainingMs(PER_QUESTION_MS)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setPhase('playing')
  }, [startTracking])

  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    clearTimeout(advanceRef.current)
    setPhase('intro')
    setQuestions([])
    setCurrentIdx(0)
    setAnswers([])
    answersRef.current = []
    setCurrentInput('')
    setFeedback(null)
    setQRemainingMs(PER_QUESTION_MS)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setScoreSaved(false)
  }, [])

  const remainingSec = (qRemainingMs / 1000).toFixed(1)
  const correctSoFar = answers.filter(a => a.correct).length

  return (
    <div className="cbat-numerical-ops-page">
      <SEO title="Numerical Operations — CBAT" description="Solve two-number arithmetic against the clock — +, −, ×, ÷." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={['playing', 'feedback'].includes(phase)} />
        }
        <h1 className="text-sm font-extrabold text-slate-900">Numerical Operations</h1>
      </div>

      {/* Not logged in */}
      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to play</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {/* Logged in — game */}
      {user && (
        <div className="flex flex-col items-center">

          {/* Intro screen */}
          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className="text-4xl mb-3">🧮</p>
              <p className="text-xl font-extrabold text-white mb-2">Numerical Operations</p>
              <p className="text-sm text-slate-400 mb-5">
                Solve two-number arithmetic against the clock. Four rounds of five questions, with numbers getting bigger each round. 20 seconds per question.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
                {[1, 2, 3, 4].map(r => (
                  <div key={r} className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                    <span className="text-brand-300 font-bold shrink-0">R{r}</span>
                    <span>5 questions · numbers 1–{ROUND_MAX[r - 1]} · +, −, ×, ÷</span>
                  </div>
                ))}
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1">
                  <span className="shrink-0">⏱</span>
                  <span>20s per question — running out counts as wrong</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore}%
                    <span className="text-slate-500 mx-1">·</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/numerical-ops/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
                  View Leaderboard →
                </Link>
              </div>

              <button
                onClick={startGame}
                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
              >
                Start
              </button>
            </motion.div>
          )}

          {/* Playing / Feedback */}
          {(phase === 'playing' || phase === 'feedback') && currentQuestion && (
            <div className="w-full max-w-md">
              {/* HUD */}
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                <span className="text-slate-400">
                  Round <span className="text-brand-300">{currentRound}</span>/{ROUNDS}
                </span>
                <span className="text-slate-400">
                  Q <span className="text-brand-300">{questionInRound}</span>/{QUESTIONS_PER_ROUND}
                </span>
                <span className="text-slate-400">
                  Overall <span className="text-brand-300">{currentIdx + 1}</span>/{TOTAL_QUESTIONS}
                </span>
                <span className="text-slate-400">
                  ✓ <span className="text-green-400">{correctSoFar}</span>
                </span>
                <span className="text-slate-400">
                  ⏱ <span className={qRemainingMs < 5000 ? 'text-red-400' : 'text-brand-300'}>{remainingSec}s</span>
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${((currentIdx + (phase === 'feedback' ? 1 : 0)) / TOTAL_QUESTIONS) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Question display */}
              <motion.div
                key={currentIdx}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 mb-3 relative overflow-hidden"
              >
                <p className="text-[10px] text-slate-500 uppercase tracking-wide text-center mb-3 relative z-10">
                  Solve
                </p>

                <div className="relative z-10 text-center">
                  <p className="text-4xl sm:text-5xl font-mono font-bold text-white tracking-wider">
                    {currentQuestion.a}
                    <span className="text-brand-300 mx-3">{formatOp(currentQuestion.op)}</span>
                    {currentQuestion.b}
                    <span className="text-slate-500 mx-3">=</span>
                    <span className={`inline-block min-w-[3ch] text-left ${
                      phase === 'feedback'
                        ? (feedback?.correct ? 'text-green-400' : 'text-red-400')
                        : 'text-brand-300'
                    }`}>
                      {phase === 'feedback' && feedback?.picked === null
                        ? '—'
                        : (currentInput || (phase === 'feedback' ? feedback?.picked : '?'))}
                    </span>
                  </p>
                </div>

                {/* Feedback overlay */}
                <AnimatePresence>
                  {phase === 'feedback' && feedback && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`absolute top-2 right-2 z-20 px-3 py-1.5 rounded-lg text-xs font-bold ${
                        feedback.correct
                          ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                          : 'bg-red-500/20 border border-red-500/40 text-red-400'
                      }`}
                    >
                      {feedback.correct
                        ? '✓ Correct'
                        : (feedback.picked === null ? `⏱ Timeout — ${feedback.answer}` : `✗ It was ${feedback.answer}`)}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Keypad */}
              <Keypad
                onDigit={handleDigit}
                onBackspace={handleBackspace}
                onSubmit={handleSubmit}
                disabled={phase === 'feedback'}
                canSubmit={currentInput.length > 0}
              />

              {/* Round transition indicator */}
              <AnimatePresence>
                {phase === 'playing'
                  && currentIdx > 0
                  && currentIdx % QUESTIONS_PER_ROUND === 0
                  && currentRound > 1 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center mt-2"
                  >
                    <span className="text-xs text-brand-300 font-bold">
                      Round {currentRound} — numbers now up to {ROUND_MAX[currentRound - 1]}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <CbatGameOver
              gameKey="numerical-ops"
              score={Math.round((answers.filter(a => a.correct).length / TOTAL_QUESTIONS) * 100)}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
            >
              <ResultsScreen
                answers={answers}
                totalTime={totalElapsedMs / 1000}
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
