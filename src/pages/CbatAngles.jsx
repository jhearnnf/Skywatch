import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { recordCbatStart } from '../utils/cbat/recordStart'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'

// ── Constants ────────────────────────────────────────────────────────────────
const ROUND_1_COUNT = 10
const ROUND_2_COUNT = 10
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
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block mx-auto">
      {/* Subtle grid circles */}
      <circle cx={cx} cy={cy} r={len * 0.95} fill="none" stroke="#1a3a5c" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
      <circle cx={cx} cy={cy} r={len * 0.5} fill="none" stroke="#1a3a5c" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.3" />

      {/* Arc showing the angle */}
      <path
        d={`M ${cx + arcRadius} ${cy} A ${arcRadius} ${arcRadius} 0 ${largeArc} 0 ${arcX} ${arcY}`}
        fill="none"
        stroke="#5baaff"
        strokeWidth={2 * scale}
        opacity="0.6"
      />

      {/* Line 1 — base (horizontal) */}
      <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#ddeaf8" strokeWidth={2.5 * scale} strokeLinecap="round" />

      {/* Line 2 — angled */}
      <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="#5baaff" strokeWidth={2.5 * scale} strokeLinecap="round" />

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={3.5 * scale} fill="#5baaff" />

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
            stroke="#5baaff"
            strokeWidth={1.5 * scale}
            opacity="0.5"
          />
        )
      })}
    </svg>
  )
}

// ── Results screen ───────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime, onPlayAgain, onMenu, scoreSaved }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / TOTAL_QUESTIONS) * 100)
  const r1 = answers.filter(a => a.round === 1)
  const r2 = answers.filter(a => a.round === 2)
  const r1Correct = r1.filter(a => a.correct).length
  const r2Correct = r2.filter(a => a.correct).length

  const grade = pct >= 90 ? { label: 'Outstanding', emoji: '🎖️', color: 'text-green-400' }
    : pct >= 70 ? { label: 'Good', emoji: '✈️', color: 'text-brand-300' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '🔧', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '💥', color: 'text-red-400' }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
    >
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Bearing Angle Assessment Complete</p>

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

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Round 1 (10°)</p>
          <p className="text-xl font-mono font-bold text-brand-300">{r1Correct}/{ROUND_1_COUNT}</p>
        </div>
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Round 2 (5°)</p>
          <p className="text-xl font-mono font-bold text-brand-300">{r2Correct}/{ROUND_2_COUNT}</p>
        </div>
      </div>

      {/* Answer review — scrollable */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-6 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Answer Review</p>
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

      {scoreSaved && (
        <p className="text-xs text-green-400 mb-4">✓ Score saved</p>
      )}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Play Again
        </button>
        <Link
          to="/cbat/angles/leaderboard"
          className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
        >
          🏆 Leaderboard
        </Link>
      </div>
    </motion.div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatAngles() {
  const { user, apiFetch, API } = useAuth()

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
    apiFetch(`${API}/api/games/cbat/angles/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correctCount: correct,
        round1Correct: r1Correct,
        round2Correct: r2Correct,
        totalTime: finalTime,
        grade,
      }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/angles/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  const currentQuestion = questions[currentIdx] || null
  const currentRound = currentQuestion ? currentQuestion.round : 1
  const questionInRound = currentRound === 1 ? currentIdx + 1 : currentIdx - ROUND_1_COUNT + 1
  const roundTotal = currentRound === 1 ? ROUND_1_COUNT : ROUND_2_COUNT

  // Timer — runs during 'playing' phase, pauses during 'feedback'
  useEffect(() => {
    if (phase === 'playing') {
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
  }, [phase])

  const startGame = useCallback(() => {
    recordCbatStart('angles', apiFetch, API)
    setQuestions(buildQuestions())
    setCurrentIdx(0)
    setAnswers([])
    setSelectedOption(null)
    setIsCorrect(null)
    setElapsed(0)
    setPhase('playing')
  }, [apiFetch, API])

  const handleAnswer = (option) => {
    if (phase !== 'playing') return
    const correct = option === currentQuestion.angle
    setSelectedOption(option)
    setIsCorrect(correct)
    setAnswers(prev => [...prev, {
      angle: currentQuestion.angle,
      picked: option,
      correct,
      round: currentQuestion.round,
    }])
    setPhase('feedback')
  }

  const handleNext = () => {
    const nextIdx = currentIdx + 1
    if (nextIdx >= TOTAL_QUESTIONS) {
      submitScore(answers, elapsed)
      setPhase('results')
      return
    }
    setCurrentIdx(nextIdx)
    setSelectedOption(null)
    setIsCorrect(null)
    setPhase('playing')
  }

  return (
    <div className="cbat-angles-page">
      <SEO title="Angles — CBAT" description="Judge bearing angles quickly and accurately." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
        <h1 className="text-sm font-extrabold text-slate-900">Angles</h1>
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
              <p className="text-4xl mb-3">📐</p>
              <p className="text-xl font-extrabold text-white mb-2">Bearing Angle Assessment</p>
              <p className="text-sm text-slate-400 mb-5">
                Identify the displayed angle from 5 options. Two rounds of increasing difficulty.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">R1</span>
                  <span>10 angles — multiples of 10°</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">R2</span>
                  <span>10 angles — multiples of 5°</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">📊</span>
                  <span>Results and accuracy breakdown shown at the end</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore}/{TOTAL_QUESTIONS} ({Math.round((personalBest.bestScore / TOTAL_QUESTIONS) * 100)}%)
                    <span className="text-slate-500 mx-1">·</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/angles/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
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
                  Round <span className="text-brand-300">{currentRound}</span>/2
                </span>
                <span className="text-slate-400">
                  Q <span className="text-brand-300">{questionInRound}</span>/{roundTotal}
                </span>
                <span className="text-slate-400">
                  Overall <span className="text-brand-300">{currentIdx + 1}</span>/{TOTAL_QUESTIONS}
                </span>
                <span className="text-slate-400">
                  ✓ <span className="text-green-400">{answers.filter(a => a.correct).length}</span>
                </span>
                <span className="text-slate-400">
                  ⏱ <span className="text-brand-300">{elapsed.toFixed(1)}s</span>
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

              {/* Angle display */}
              <motion.div
                key={currentIdx}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5 mb-3 relative overflow-hidden"
              >
                {/* Radar sweep */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0deg, rgba(91,170,255,0.5) 30deg, transparent 60deg)',
                    animation: 'radar-sweep 4s linear infinite',
                  }}
                />

                <p className="text-[10px] text-slate-500 uppercase tracking-wide text-center mb-2 relative z-10">
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
                      className={`absolute top-2 right-2 z-20 px-3 py-1.5 rounded-lg text-xs font-bold ${
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
              <div className="grid grid-cols-5 gap-2 mb-3">
                {currentQuestion.options.map((opt) => {
                  let btnClass = 'bg-[#0a1628] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240]'
                  if (phase === 'feedback') {
                    if (opt === currentQuestion.angle) {
                      btnClass = 'bg-green-500/20 border-green-500/50 text-green-400'
                    } else if (opt === selectedOption && !isCorrect) {
                      btnClass = 'bg-red-500/20 border-red-500/50 text-red-400'
                    } else {
                      btnClass = 'bg-[#0a1628] border-[#1a3a5c] text-[#5a6a80] opacity-50'
                    }
                  }

                  return (
                    <button
                      key={opt}
                      onClick={() => handleAnswer(opt)}
                      disabled={phase === 'feedback'}
                      className={`py-3 rounded-lg border-2 font-mono font-bold text-sm transition-all ${btnClass} ${
                        phase === 'feedback' ? 'cursor-default' : 'cursor-pointer'
                      }`}
                    >
                      {opt}°
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
                      className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
                    >
                      {currentIdx + 1 >= TOTAL_QUESTIONS ? 'View Results' : 'Next Angle'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Round transition indicator */}
              <AnimatePresence>
                {phase === 'playing' && currentIdx === ROUND_1_COUNT && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center mt-2"
                  >
                    <span className="text-xs text-brand-300 font-bold">Round 2 — angles now in 5° increments</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <ResultsScreen
              answers={answers}
              totalTime={elapsed}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
              scoreSaved={scoreSaved}
            />
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
