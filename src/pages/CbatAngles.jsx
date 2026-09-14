import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import CbatGameOver from '../components/CbatGameOver'
import CbatIntroLabel from '../components/cbat/CbatIntroLabel'
import { CbatGameHeader, CbatFooterStrip, CbatKeyCap, PRACTICE_SKIP_HINT } from '../components/cbat/CbatTestChrome'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import { useCbatTheme } from '../hooks/useCbatTheme'
import { useCbatMcq, useCbatAnswerKeys } from '../hooks/useCbatAnswerKeys'

// ── Constants ────────────────────────────────────────────────────────────────
const ROUND_1_COUNT = 10
const ROUND_2_COUNT = 10
// Real CBAT theme only: unscored practice items before the test, the way the
// real software runs "Practice 1 of 3" before "Testing".
const PRACTICE_COUNT = 3
const TOTAL_QUESTIONS = ROUND_1_COUNT + ROUND_2_COUNT
const OPTIONS_COUNT = 5
const CANVAS_SIZE = 220
const LINE_LENGTH = 90
const CENTER_X = CANVAS_SIZE / 2
const CENTER_Y = CANVAS_SIZE / 2

// ── Angle generation ─────────────────────────────────────────────────────────
function generateAngle(round) {
  const step = round === 1 ? 10 : 5
  // Range 10–350 for round 1, 5–355 for round 2 (avoid 0/360 — identical flat lines)
  const min = step
  const max = round === 1 ? 350 : 355
  const count = Math.floor((max - min) / step) + 1
  return min + Math.floor(Math.random() * count) * step
}

function generateOptions(correctAngle, round) {
  const step = round === 1 ? 10 : 5
  const maxAngle = round === 1 ? 350 : 355
  const options = new Set([correctAngle])

  // Build nearby distractors within ±50 of the correct angle
  const candidates = []
  for (let d = -10; d <= 10; d++) {
    const v = correctAngle + d * step
    if (v >= step && v <= maxAngle && v !== correctAngle) {
      candidates.push(v)
    }
  }
  // Shuffle candidates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  for (const c of candidates) {
    if (options.size >= OPTIONS_COUNT) break
    options.add(c)
  }
  // If we still need more, widen the net
  if (options.size < OPTIONS_COUNT) {
    const allAngles = []
    for (let v = step; v <= maxAngle; v += step) {
      if (!options.has(v)) allAngles.push(v)
    }
    for (let i = allAngles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allAngles[i], allAngles[j]] = [allAngles[j], allAngles[i]]
    }
    for (const v of allAngles) {
      if (options.size >= OPTIONS_COUNT) break
      options.add(v)
    }
  }

  const arr = [...options]
  // Shuffle final options
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function generateAngleCapped(round, maxAngle) {
  const step = round === 1 ? 10 : 5
  const min = step
  const max = Math.min(maxAngle, round === 1 ? 350 : 355)
  const count = Math.floor((max - min) / step) + 1
  return min + Math.floor(Math.random() * count) * step
}

function buildQuestions() {
  const questions = []
  // First 5: angles ≤ 180 only
  for (let i = 0; i < 5; i++) {
    const angle = generateAngleCapped(1, 170)
    questions.push({ angle, round: 1, options: generateOptions(angle, 1) })
  }
  // Remaining round 1: full range
  for (let i = 5; i < ROUND_1_COUNT; i++) {
    const angle = generateAngle(1)
    questions.push({ angle, round: 1, options: generateOptions(angle, 1) })
  }
  for (let i = 0; i < ROUND_2_COUNT; i++) {
    const angle = generateAngle(2)
    questions.push({ angle, round: 2, options: generateOptions(angle, 2) })
  }
  return questions
}

// Practice items are round-1 difficulty and flagged so nothing about them is
// scored or timed.
function buildPracticeQuestions() {
  const questions = []
  for (let i = 0; i < PRACTICE_COUNT; i++) {
    const angle = generateAngleCapped(1, 170)
    questions.push({ angle, round: 1, options: generateOptions(angle, 1), practice: true })
  }
  return questions
}

// ── Angle SVG ────────────────────────────────────────────────────────────────
function AngleDiagram({ angle, size = CANVAS_SIZE }) {
  const scale = size / CANVAS_SIZE
  const cx = CENTER_X * scale
  const cy = CENTER_Y * scale
  const len = LINE_LENGTH * scale

  // Line 1: always horizontal to the right
  const x1 = cx + len
  const y1 = cy

  // Line 2: at the given angle (measured counter-clockwise from line 1)
  const rad = (angle * Math.PI) / 180
  const x2 = cx + len * Math.cos(rad)
  const y2 = cy - len * Math.sin(rad) // SVG y is inverted

  // Arc for the angle indicator
  const arcRadius = len * 0.3
  const arcX = cx + arcRadius * Math.cos(rad)
  const arcY = cy - arcRadius * Math.sin(rad)
  const largeArc = angle > 180 ? 1 : 0

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block mx-auto w-full h-auto max-w-[220px] lg:max-w-none">
      {/* Subtle grid circles */}
      <circle cx={cx} cy={cy} r={len * 0.95} fill="none" stroke="var(--color-game-line)" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
      <circle cx={cx} cy={cy} r={len * 0.5} fill="none" stroke="var(--color-game-line)" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.3" />

      {/* Arc showing the angle */}
      <path
        d={`M ${cx + arcRadius} ${cy} A ${arcRadius} ${arcRadius} 0 ${largeArc} 0 ${arcX} ${arcY}`}
        fill="none"
        stroke="var(--color-game-accent)"
        strokeWidth={2 * scale}
        opacity="0.6"
      />

      {/* Line 1 — base (horizontal) */}
      <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="var(--color-game-text)" strokeWidth={2.5 * scale} strokeLinecap="round" />

      {/* Line 2 — angled */}
      <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="var(--color-game-accent)" strokeWidth={2.5 * scale} strokeLinecap="round" />

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={3.5 * scale} fill="var(--color-game-accent)" />

      {/* Small tick marks on the arc for bearing feel */}
      {[0, angle].map((a, i) => {
        const tr = arcRadius + 6 * scale
        const tRad = (a * Math.PI) / 180
        return (
          <line
            key={i}
            x1={cx + (arcRadius - 3 * scale) * Math.cos(tRad)}
            y1={cy - (arcRadius - 3 * scale) * Math.sin(tRad)}
            x2={cx + tr * Math.cos(tRad)}
            y2={cy - tr * Math.sin(tRad)}
            stroke="var(--color-game-accent)"
            strokeWidth={1.5 * scale}
            opacity="0.5"
          />
        )
      })}
    </svg>
  )
}

// ── Results screen ───────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / TOTAL_QUESTIONS) * 100)
  const r1 = answers.filter(a => a.round === 1)
  const r2 = answers.filter(a => a.round === 2)
  const r1Correct = r1.filter(a => a.correct).length
  const r2Correct = r2.filter(a => a.correct).length

  const grade = pct >= 90 ? { label: 'Outstanding', emoji: '🎖️', color: 'text-green-400' }
    : pct >= 70 ? { label: 'Good', emoji: '✈️', color: 'text-brand-600' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '🔧', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '💥', color: 'text-red-400' }

  return (
    <div className="w-full bg-game-panel border border-game-line rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Bearing Angle Assessment Complete</p>

      <div className="bg-game-arena rounded-lg border border-game-line p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{pct}%</p>
            <p className="text-sm text-slate-400">{correct} / {TOTAL_QUESTIONS} correct</p>
          </div>
          <div className="w-px h-12 bg-game-line" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{totalTime.toFixed(1)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-game-arena rounded-lg border border-game-line p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Round 1 (10°)</p>
          <p className="text-xl font-mono font-bold text-brand-600">{r1Correct}/{ROUND_1_COUNT}</p>
        </div>
        <div className="bg-game-arena rounded-lg border border-game-line p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Round 2 (5°)</p>
          <p className="text-xl font-mono font-bold text-brand-600">{r2Correct}/{ROUND_2_COUNT}</p>
        </div>
      </div>

      {/* Answer review — scrollable */}
      <div className="bg-game-arena rounded-lg border border-game-line p-3 mb-6 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-game-arena">Answer Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 text-left">#{i + 1}</span>
              <span>{a.correct ? '✓' : '✗'}</span>
              <span className="font-mono">{a.angle}°</span>
              {!a.correct && <span className="text-slate-500">picked {a.picked}°</span>}
              {a.correct && <span className="text-slate-500">—</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatAngles() {
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
  const [selectedOption, setSelectedOption] = useState(null)
  const [isCorrect, setIsCorrect] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/angles/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

  // Submit score to backend
  const submitScore = useCallback((finalAnswers, finalTime) => {
    const correct = finalAnswers.filter(a => a.correct).length
    const pct = Math.round((correct / TOTAL_QUESTIONS) * 100)
    const r1Correct = finalAnswers.filter(a => a.round === 1 && a.correct).length
    const r2Correct = finalAnswers.filter(a => a.round === 2 && a.correct).length
    const grade = pct >= 90 ? 'Outstanding' : pct >= 70 ? 'Good' : pct >= 50 ? 'Needs Work' : 'Failed'

    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correct })
    submitCbatResult(`angles`, {
        correctCount: correct,
        round1Correct: r1Correct,
        round2Correct: r2Correct,
        totalTime: finalTime,
        grade,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/angles/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  const cbat = useCbatTheme()
  const currentQuestion = questions[currentIdx] || null
  const isPractice = !!currentQuestion?.practice
  // Index within the scored test, ignoring any practice items in front of it.
  const practiceCount = questions.filter(q => q.practice).length
  const testIdx = currentIdx - practiceCount
  const currentRound = currentQuestion ? currentQuestion.round : 1
  const questionInRound = currentRound === 1 ? testIdx + 1 : testIdx - ROUND_1_COUNT + 1
  const roundTotal = currentRound === 1 ? ROUND_1_COUNT : ROUND_2_COUNT

  // Timer — runs during 'playing' phase, pauses during 'feedback' and never
  // runs on a practice item
  useEffect(() => {
    if (phase === 'playing' && !isPractice) {
      const offset = elapsed * 1000
      const t0 = Date.now() - offset
      startTimeRef.current = t0
      timerRef.current = setInterval(() => {
        setElapsed((Date.now() - t0) / 1000)
      }, 100)
      return () => clearInterval(timerRef.current)
    } else {
      clearInterval(timerRef.current)
    }
  }, [phase, isPractice])

  const startGame = useCallback(() => {
    startTracking('angles')
    setQuestions(cbat ? [...buildPracticeQuestions(), ...buildQuestions()] : buildQuestions())
    setCurrentIdx(0)
    setAnswers([])
    setSelectedOption(null)
    setIsCorrect(null)
    setElapsed(0)
    setPhase('playing')
  }, [apiFetch, API, cbat])

  const goToIntro = useCallback(() => {
    clearInterval(timerRef.current)
    setPhase('intro')
    setQuestions([])
    setCurrentIdx(0)
    setAnswers([])
    setSelectedOption(null)
    setIsCorrect(null)
    setElapsed(0)
    setScoreSaved(false)
  }, [])

  // Desktop: the stage below sizes itself to the viewport height, which on a
  // tall monitor is wider than the shell's max-w-3xl. See main.css.
  useGameBodyClass('cbat-stage-wide', phase === 'playing' || phase === 'feedback')

  const advance = (fromIdx, finalAnswers) => {
    const nextIdx = fromIdx + 1
    if (nextIdx >= questions.length) {
      submitScore(finalAnswers, elapsed)
      setPhase('results')
      return
    }
    setCurrentIdx(nextIdx)
    setSelectedOption(null)
    setIsCorrect(null)
    setPhase('playing')
  }

  const handleAnswer = (option) => {
    if (phase !== 'playing') return
    const correct = option === currentQuestion.angle
    // Practice items are not recorded
    const nextAnswers = isPractice ? answers : [...answers, {
      angle: currentQuestion.angle,
      picked: option,
      correct,
      round: currentQuestion.round,
    }]
    setAnswers(nextAnswers)
    // The real test gives no right/wrong mid-run; under the Real CBAT theme
    // a scored item moves straight on. Practice still shows the answer.
    if (cbat && !isPractice) {
      advance(currentIdx, nextAnswers)
      return
    }
    setSelectedOption(option)
    setIsCorrect(correct)
    setPhase('feedback')
  }

  const handleNext = () => advance(currentIdx, answers)

  // Escape is the real keyboard's green "Go": skip what's left of practice
  // and begin the test.
  const skipPractice = () => {
    if (!isPractice) return
    setCurrentIdx(practiceCount)
    setSelectedOption(null)
    setIsCorrect(null)
    setPhase('playing')
  }

  // Keyboard answering: 1-5 pick an option (marked under the Real CBAT theme,
  // committed with Enter; committed at once otherwise), Enter moves past
  // feedback.
  const { pending, select, commit } = useCbatMcq({
    enabled: phase === 'playing',
    count: OPTIONS_COUNT,
    kind: 'number',
    onCommit: (i) => handleAnswer(currentQuestion.options[i]),
    resetKey: currentIdx,
  })
  useCbatAnswerKeys({ enabled: phase === 'feedback', onEnter: handleNext })
  useCbatAnswerKeys({ enabled: (phase === 'playing' || phase === 'feedback') && isPractice, count: 0, onEscape: skipPractice })

  const testBar = (phase === 'playing' || phase === 'feedback') && currentQuestion ? {
    stage: isPractice ? 'Practice' : 'Testing',
    item: isPractice ? currentIdx + 1 : testIdx + 1,
    total: isPractice ? practiceCount : TOTAL_QUESTIONS,
    timeFrac: null,
    progressFrac: isPractice ? 0 : (testIdx + (phase === 'feedback' ? 1 : 0)) / TOTAL_QUESTIONS,
  } : null

  return (
    <div className="cbat-angles-page">
      <SEO title="Angles — CBAT" description="Judge bearing angles quickly and accurately." />

      {/* Header */}
      <CbatGameHeader
        title="Angles"
        fullTitle="Angles, Bearings and Degrees"
        intro={phase === 'intro'}
        onQuit={goToIntro}
        confirmNeeded={['playing', 'feedback'].includes(phase)}
        test={testBar}
      />

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
              className="w-full max-w-md lg:max-w-2xl bg-game-panel border border-game-line rounded-xl p-6 lg:p-9 text-center"
            >
              <p className="text-4xl lg:text-5xl mb-3">📐</p>
              <p className="text-xl lg:text-2xl font-extrabold text-white mb-2">Bearing Angle Assessment</p>
              <p className="text-sm lg:text-base text-slate-400 mb-5 lg:mb-7 lg:max-w-lg lg:mx-auto">
                Identify the displayed angle from 5 options. Two rounds of increasing difficulty.
              </p>

              <div className="bg-game-arena rounded-lg border border-game-line p-4 lg:p-6 mb-5 lg:mb-7 text-left space-y-2 lg:space-y-3">
                <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
                  <CbatIntroLabel>R1</CbatIntroLabel>
                  <span className="pt-0.5">10 angles — multiples of 10°</span>
                </div>
                <div className="flex items-start gap-3 text-sm lg:text-base text-game-text">
                  <CbatIntroLabel>R2</CbatIntroLabel>
                  <span className="pt-0.5">10 angles — multiples of 5°</span>
                </div>
                <div className="flex items-start gap-3 text-xs lg:text-sm text-game-muted border-t border-game-line pt-2 lg:pt-3 mt-1">
                  <span className="shrink-0 w-8 text-center lg:text-lg" aria-hidden>📊</span>
                  <span className="pt-0.5">Results and accuracy breakdown shown at the end</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-game-arena rounded-lg border border-game-line p-3 lg:p-4 mb-4 text-center">
                  <p className="text-[10px] lg:text-xs text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg lg:text-xl font-mono font-bold text-brand-600">
                    {personalBest.bestScore}/{TOTAL_QUESTIONS} ({Math.round((personalBest.bestScore / TOTAL_QUESTIONS) * 100)}%)
                    <span className="text-slate-500 mx-1">·</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] lg:text-xs text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/angles/leaderboard" className="text-xs lg:text-sm text-brand-600 hover:text-brand-700 transition-colors">
                  View Leaderboard →
                </Link>
              </div>

              <button
                onClick={startGame}
                data-demo-start
                className="px-8 py-3 lg:px-10 lg:py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm lg:text-base"
              >
                Start
              </button>
            </motion.div>
          )}

          {/* Playing / Feedback */}
          {(phase === 'playing' || phase === 'feedback') && currentQuestion && (
            <div className="w-full max-w-md lg:max-w-none lg:w-[min(50rem,calc(100vh_-_24rem))]">
              {/* HUD — under the Real CBAT theme the title bar carries this */}
              {!cbat && <div className="flex items-center justify-between text-xs lg:text-sm font-mono mb-2 px-1">
                <span className="text-slate-400">
                  Round <span className="text-brand-600">{currentRound}</span>/2
                </span>
                <span className="text-slate-400">
                  Q <span className="text-brand-600">{questionInRound}</span>/{roundTotal}
                </span>
                <span className="text-slate-400">
                  Overall <span className="text-brand-600">{currentIdx + 1}</span>/{TOTAL_QUESTIONS}
                </span>
                <span className="text-slate-400">
                  ✓ <span className="text-green-400">{answers.filter(a => a.correct).length}</span>
                </span>
                <span className="text-slate-400">
                  ⏱ <span className="text-brand-600">{elapsed.toFixed(1)}s</span>
                </span>
              </div>}

              {/* Progress bar */}
              {!cbat && <div className="w-full h-1 bg-game-line rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${((testIdx + (phase === 'feedback' ? 1 : 0)) / TOTAL_QUESTIONS) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>}

              {/* Angle display */}
              <motion.div
                key={currentIdx}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-game-panel border border-game-line rounded-xl p-5 lg:p-8 mb-3 relative overflow-hidden"
              >
                {/* Radar sweep */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0deg, rgba(91,170,255,0.5) 30deg, transparent 60deg)',
                    animation: 'radar-sweep 4s linear infinite',
                  }}
                />

                <p className="text-[10px] lg:text-xs text-slate-500 uppercase tracking-wide text-center mb-2 relative z-10">
                  Identify this bearing angle
                </p>

                <div className="relative z-10">
                  <AngleDiagram angle={currentQuestion.angle} />
                </div>

                {/* Feedback overlay */}
                <AnimatePresence>
                  {phase === 'feedback' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`absolute top-2 right-2 lg:top-3 lg:right-3 z-20 px-3 py-1.5 rounded-lg text-xs lg:text-sm font-bold ${
                        isCorrect
                          ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                          : 'bg-red-500/20 border border-red-500/40 text-red-400'
                      }`}
                    >
                      {isCorrect ? '✓ Correct' : `✗ It was ${currentQuestion.angle}°`}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Options */}
              <div className="grid grid-cols-5 gap-2 lg:gap-3 mb-3">
                {currentQuestion.options.map((opt, i) => {
                  let btnClass = 'bg-game-panel border-game-line text-game-text hover:border-brand-400 hover:bg-game-raised'
                  if (pending === i) btnClass += ' cbat-option-pending'
                  if (phase === 'feedback') {
                    if (opt === currentQuestion.angle) {
                      btnClass = 'bg-green-500/20 border-green-500/50 text-green-400'
                    } else if (opt === selectedOption && !isCorrect) {
                      btnClass = 'bg-red-500/20 border-red-500/50 text-red-400'
                    } else {
                      btnClass = 'bg-game-panel border-game-line text-game-faint opacity-50'
                    }
                  }

                  return (
                    <button
                      key={opt}
                      onClick={() => select(i)}
                      disabled={phase === 'feedback'}
                      data-demo-answer
                      className={`py-3 lg:py-4 rounded-lg border-2 font-mono font-bold text-sm lg:text-xl transition-all ${btnClass} ${
                        phase === 'feedback' ? 'cursor-default' : 'cursor-pointer'
                      }`}
                    >
                      <CbatKeyCap label={i + 1} className="mr-1.5" />{opt}°
                    </button>
                  )
                })}
              </div>

              {/* Next button (feedback phase) */}
              <AnimatePresence>
                {phase === 'feedback' && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center"
                  >
                    <button
                      onClick={handleNext}
                      className="px-6 py-2.5 lg:px-8 lg:py-3 bg-brand-600 hover:bg-brand-700 text-white text-sm lg:text-base font-bold rounded-lg transition-colors"
                    >
                      {currentIdx + 1 >= TOTAL_QUESTIONS ? 'View Results' : 'Next Angle'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Real CBAT theme: the instruction strip, and the way out of practice */}
              <CbatFooterStrip
                answer={phase === 'playing' ? (pending != null ? pending + 1 : null) : selectedOption != null ? currentQuestion.options.indexOf(selectedOption) + 1 : null}
                onSubmit={phase === 'playing' ? commit : handleNext}
                canSubmit={phase === 'feedback' || pending != null}
                hint={isPractice ? PRACTICE_SKIP_HINT : undefined}
              />
              {cbat && isPractice && (
                <div className="text-center mt-2">
                  <button type="button" onClick={skipPractice} className="text-xs text-brand-600 hover:text-brand-700 transition-colors">
                    Skip practice and begin the test
                  </button>
                </div>
              )}

              {/* Round transition indicator */}
              <AnimatePresence>
                {phase === 'playing' && testIdx === ROUND_1_COUNT && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center mt-2"
                  >
                    <span className="text-xs lg:text-sm text-brand-600 font-bold">Round 2 — angles now in 5° increments</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <CbatGameOver
              gameKey="angles"
              score={answers.filter(a => a.correct).length}
              time={elapsed}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
            >
              <ResultsScreen
                answers={answers}
                totalTime={elapsed}
              />
            </CbatGameOver>
          )}
        </div>
      )}

      <style>{`
        @keyframes radar-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
