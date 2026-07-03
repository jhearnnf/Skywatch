import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import { generateDadQuestion } from '../utils/cbat/dadGenerator'
import SEO from '../components/SEO'
import CbatGameOver from '../components/CbatGameOver'

// ── Constants ────────────────────────────────────────────────────────────────
const TOTAL_QUESTIONS = 15
const PER_QUESTION_MS = 45000
// Leg count ramps with progress: Q1–4 → 3 legs, Q5–8 → 4, Q9–12 → 5, Q13–15 → 6.
function legCountFor(idx) {
  return 3 + Math.floor(idx / 4)
}
// Intercardinal headings (NE/SE/SW/NW) and 45° turns only appear in the final
// rounds (10–15, i.e. 0-indexed ≥ 9); earlier rounds stay cardinal-only with
// 90° turns.
const DIAGONALS_FROM = 9

function buildQuestions() {
  const out = []
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    out.push(generateDadQuestion(legCountFor(i), undefined, { diagonals: i >= DIAGONALS_FROM }))
  }
  return out
}

// Each question's subject is like "A recon drone". In-sentence we want
// "the recon drone"; on the map marker we want a short uppercase tag, falling
// back to the last word when the full name is too wide for the frame.
function objectPhrase(subject) {
  return subject.replace(/^An? /i, 'the ')
}
function objectLabel(subject) {
  let s = subject.replace(/^An? /i, '').toUpperCase()
  if (s.length > 12) { const parts = s.split(' '); s = parts[parts.length - 1] }
  return s
}

// ── Path reveal (animated journey) ────────────────────────────────────────────
// North is up. The object travels its route from START to its final position,
// then a green arrow + labels fade in showing the answer direction (the object
// relative to the start point). This reveal ALWAYS animates (by request): it is
// meaningful content rather than decoration and its end state is fully static,
// so it plays once even under prefers-reduced-motion.
function PathReveal({ path, youLabel = 'YOU' }) {
  const xs = path.map(p => p[0])
  const ys = path.map(p => p[1])
  const minX = Math.min(0, ...xs), maxX = Math.max(0, ...xs)
  const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys)
  const span = Math.max(maxX - minX, maxY - minY, 1)
  // Fit every route into the SAME square viewBox, centred on the route's
  // bounding box, so the reveal always renders at the same aspect ratio (and
  // therefore the same height) whether a question's path is wide, tall or
  // square. `span` (the content extent) still drives marker/label sizing, which
  // keeps those a constant on-screen size across questions. The 0.3 margin keeps
  // the START / object labels clear of the edge.
  const pad = span * 0.3
  const side = span + pad * 2
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2
  const x0 = midX - side / 2, x1 = midX + side / 2
  const y0 = midY - side / 2, y1 = midY + side / 2
  const W = side, H = side
  const SX = (x) => x - x0
  const SY = (y) => y1 - y // flip so North (+y) is up
  const r = span * 0.028
  const fs = span * 0.058
  const a = span * 0.08
  const end = path[path.length - 1]
  const pts = path.map(p => [SX(p[0]), SY(p[1])])

  // Cumulative arc length along the route, for the travel animation.
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  }
  const totalLen = cum[cum.length - 1] || 1

  // Travel progress 0..1 — rAF-driven, restarts whenever the route changes.
  const [t, setT] = useState(0)
  useEffect(() => {
    setT(0)
    const dur = 1500
    let raf, startTs = null
    const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
    const step = (ts) => {
      if (startTs == null) startTs = ts
      const p = Math.min(1, (ts - startTs) / dur)
      setT(ease(p))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [path])

  // Object position + traveled polyline at the current progress.
  const targetLen = t * totalLen
  let head = pts[0]
  const drawn = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= targetLen) { drawn.push(pts[i]); head = pts[i] }
    else {
      const f = (targetLen - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)
      head = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]
      drawn.push(head)
      break
    }
  }
  const drawnStr = drawn.map(p => `${p[0]},${p[1]}`).join(' ')
  const done = t >= 1

  // Centre a label over (cx,cy) but keep it fully inside the viewBox.
  const placeLabel = (cx, cy, text) => {
    const half = text.length * fs * 0.33
    const x = Math.min(W - half - fs * 0.3, Math.max(half + fs * 0.3, cx))
    let y = cy - r * 1.8
    if (y - fs < 0) y = cy + r * 1.8 + fs * 0.8
    return { x, y }
  }
  const sxS = SX(0), syS = SY(0)
  const exS = SX(end[0]), eyS = SY(end[1])
  const startLbl = placeLabel(sxS, syS, 'START')
  const youLbl = placeLabel(exS, eyS, youLabel)
  // Stop the arrow just short of the object marker so the head stays visible.
  const vx = exS - sxS, vy = eyS - syS
  const L = Math.hypot(vx, vy) || 1
  const tipX = exS - (vx / L) * r * 1.8
  const tipY = eyS - (vy / L) * r * 1.8

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto max-w-[min(300px,34vh)] mx-auto" role="img" aria-label="Plotted route from the start to the object's final position">
      <defs>
        <pattern id="dadgrid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0 L0 0 0 1" fill="none" stroke="#13294a" strokeWidth={span * 0.004} />
        </pattern>
        <marker id="dadArrow" markerUnits="userSpaceOnUse" markerWidth={a} markerHeight={a}
          refX={a * 0.85} refY={a / 2} orient="auto">
          <path d={`M0,0 L${a},${a / 2} L0,${a} Z`} fill="#4ade80" />
        </marker>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="#060e1a" />
      <rect x="0" y="0" width={W} height={H} fill="url(#dadgrid)" />

      {/* N indicator */}
      <text x={fs * 0.4} y={fs * 1.1} fill="#5a6a80" fontSize={fs} fontWeight="bold">N ↑</text>

      {/* traveled route — grows as the object moves (full route once done) */}
      <polyline points={drawnStr} fill="none" stroke="#5baaff" strokeWidth={span * 0.012}
        strokeLinejoin="round" strokeLinecap="round" />

      {/* start marker */}
      <circle cx={sxS} cy={syS} r={r} fill="#4ade80" />

      {/* moving object marker — sits at the final position once travel completes */}
      <circle cx={head[0]} cy={head[1]} r={r} fill="#5baaff" />

      {/* answer arrow + labels — fade in once the journey finishes. Labels carry
          a dark halo (paint-order: stroke) so they stay legible over the route /
          arrow / grid without dimming the answer arrow itself. */}
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: done ? 1 : 0 }} transition={{ duration: 0.4 }}>
        <line x1={sxS} y1={syS} x2={tipX} y2={tipY}
          stroke="#4ade80" strokeWidth={span * 0.009}
          strokeDasharray={`${span * 0.035} ${span * 0.025}`} markerEnd="url(#dadArrow)" />
        <text x={startLbl.x} y={startLbl.y} fill="#4ade80" fontSize={fs} fontWeight="bold" textAnchor="middle"
          paintOrder="stroke" stroke="#060e1a" strokeWidth={fs * 0.22} strokeLinejoin="round">START</text>
        <text x={youLbl.x} y={youLbl.y} fill="#5baaff" fontSize={fs} fontWeight="bold" textAnchor="middle"
          paintOrder="stroke" stroke="#060e1a" strokeWidth={fs * 0.22} strokeLinejoin="round">{youLabel}</text>
      </motion.g>
    </svg>
  )
}

// ── Results screen (embedded inside CbatGameOver) ────────────────────────────
function ResultsScreen({ answers, totalTime }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / TOTAL_QUESTIONS) * 100)

  const grade = pct >= 90 ? { label: 'Outstanding', emoji: '🎖️', color: 'text-green-400' }
    : pct >= 70 ? { label: 'Good', emoji: '🧭', color: 'text-brand-300' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '🔧', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '💥', color: 'text-red-400' }

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Directions &amp; Distances Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{correct}/{TOTAL_QUESTIONS}</p>
            <p className="text-sm text-slate-400">{pct}% correct</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{totalTime.toFixed(1)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
      </div>

      {/* Answer review — scrollable */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Answer Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 text-left">#{i + 1}</span>
              <span>{a.correct ? '✓' : '✗'}</span>
              <span className="font-mono">answer: {a.answer}</span>
              <span className="text-slate-500">{a.picked === null ? 'timeout' : `you: ${a.picked}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatDAD() {
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
  const [feedback, setFeedback] = useState(null) // { correct, picked, answer }
  const [qRemainingMs, setQRemainingMs] = useState(PER_QUESTION_MS)
  const [totalElapsedMs, setTotalElapsedMs] = useState(0)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  const qStartRef = useRef(null)
  const tickRef = useRef(null)
  const answersRef = useRef([])
  const totalElapsedRef = useRef(0)

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { totalElapsedRef.current = totalElapsedMs }, [totalElapsedMs])

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/dad/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Submit score to backend
  const submitScore = useCallback((finalAnswers, finalTotalMs) => {
    const correctCount = finalAnswers.filter(a => a.correct).length
    const totalTime = finalTotalMs / 1000
    const avgTimePerQuestionMs = Math.round(finalTotalMs / TOTAL_QUESTIONS)

    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correctCount })
    submitCbatResult('dad', {
        correctCount,
        totalQuestions: TOTAL_QUESTIONS,
        totalTime,
        avgTimePerQuestionMs,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/dad/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted])

  const currentQuestion = questions[currentIdx] || null

  // Per-question countdown — runs only during 'playing'. On timeout, record a
  // wrong answer (picked = null) and move to the reveal.
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

  function recordAnswer(picked, elapsedMs) {
    if (!currentQuestion) return
    const correct = picked !== null && picked === currentQuestion.answer
    const entry = {
      answer: currentQuestion.answer,
      picked,
      correct,
      ms: elapsedMs,
    }
    const nextAnswers = [...answersRef.current, entry]
    setAnswers(nextAnswers)
    answersRef.current = nextAnswers
    setTotalElapsedMs(prev => prev + elapsedMs)
    totalElapsedRef.current = totalElapsedRef.current + elapsedMs
    setFeedback({ correct, picked, answer: currentQuestion.answer })
    setPhase('feedback')
  }

  function handlePick(option) {
    if (phase !== 'playing' || !currentQuestion) return
    clearInterval(tickRef.current)
    const elapsedMs = Date.now() - qStartRef.current
    recordAnswer(option, elapsedMs)
  }

  function goNext() {
    const nextIdx = currentIdx + 1
    setFeedback(null)
    if (nextIdx >= TOTAL_QUESTIONS) {
      submitScore(answersRef.current, totalElapsedRef.current)
      setPhase('results')
      return
    }
    setCurrentIdx(nextIdx)
    setPhase('playing')
  }

  const startGame = useCallback(() => {
    startTracking('dad')
    setQuestions(buildQuestions())
    setCurrentIdx(0)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setQRemainingMs(PER_QUESTION_MS)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setPhase('playing')
  }, [startTracking])

  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    setPhase('intro')
    setQuestions([])
    setCurrentIdx(0)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setQRemainingMs(PER_QUESTION_MS)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setScoreSaved(false)
  }, [])

  const remainingSec = (qRemainingMs / 1000).toFixed(0)
  const correctSoFar = answers.filter(a => a.correct).length

  return (
    <div className="cbat-dad-page">
      <SEO title="Directions & Distances — CBAT" description="Track a journey of relative turns from text alone, then name the direction back to the start." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <button onClick={goToIntro} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
        }
        <h1 className="text-sm font-extrabold text-slate-900">Directions &amp; Distances</h1>
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
              <p className="text-4xl mb-3">🧭</p>
              <p className="text-xl font-extrabold text-white mb-2">Directions &amp; Distances</p>
              <p className="text-sm text-slate-400 mb-5">
                Read each journey carefully. An object — a ship, aircraft or drone — sets off, and only its first leg gives a compass heading; every turn after that is relative to the way <span className="text-brand-300">it</span> is facing. Track its route and work out which direction it ends up from the start point.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]">
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">1.</span>
                  <span>Read the route — text only, no map while you solve.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">2.</span>
                  <span>Pick the compass direction the object ended up, relative to the start.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">3.</span>
                  <span>The route is then drawn so you can check your answer.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">🧭</span>
                  <span>Later rounds add diagonal headings (NE/SE/SW/NW) and 45° turns.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1">
                  <span className="shrink-0">⏱</span>
                  <span>{TOTAL_QUESTIONS} questions · 45s each — running out counts as wrong</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore}/{TOTAL_QUESTIONS}
                    <span className="text-slate-500 mx-1">·</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/dad/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
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
                  Q <span className="text-brand-300">{currentIdx + 1}</span>/{TOTAL_QUESTIONS}
                </span>
                <span className="text-slate-400">
                  ✓ <span className="text-green-400">{correctSoFar}</span>
                </span>
                <span className="text-slate-400">
                  ⏱ <span className={qRemainingMs < 10000 ? 'text-red-400' : 'text-brand-300'}>{remainingSec}s</span>
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

              {/* Scenario */}
              <motion.div
                key={currentIdx}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4 sm:p-5 mb-2 sm:mb-3"
              >
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">The Route</p>
                <p className="text-sm sm:text-lg text-[#ddeaf8] leading-relaxed">{currentQuestion.prose}</p>
                <p className="text-sm font-bold text-brand-300 mt-3 sm:mt-4">
                  Which direction is {objectPhrase(currentQuestion.subject)} from the start point?
                </p>
              </motion.div>

              {/* Options */}
              <div className="grid grid-cols-2 gap-2">
                {currentQuestion.options.map(opt => {
                  let cls = 'bg-[#0a1628] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240] cursor-pointer'
                  if (phase === 'feedback') {
                    if (opt === feedback?.answer) cls = 'bg-green-500/15 border-green-500/50 text-green-400'
                    else if (opt === feedback?.picked) cls = 'bg-red-500/15 border-red-500/50 text-red-400'
                    else cls = 'bg-[#0a1628] border-[#1a3a5c] text-[#5a6a80]'
                  }
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handlePick(opt)}
                      disabled={phase === 'feedback'}
                      className={`py-2.5 sm:py-4 rounded-lg border-2 font-mono font-bold text-base sm:text-lg transition-all ${cls}`}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>

              {/* Reveal */}
              <AnimatePresence>
                {phase === 'feedback' && feedback && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mt-2 sm:mt-3"
                  >
                    <div className={`text-center text-sm font-bold mb-1.5 sm:mb-2 ${feedback.correct ? 'text-green-400' : 'text-red-400'}`}>
                      {feedback.correct
                        ? '✓ Correct'
                        : feedback.picked === null
                          ? `⏱ Timeout — the answer was ${feedback.answer}`
                          : `✗ The answer was ${feedback.answer}`}
                    </div>
                    <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-2 sm:p-3 overflow-hidden">
                      <PathReveal path={currentQuestion.path} youLabel={objectLabel(currentQuestion.subject)} />
                    </div>
                    <button
                      onClick={goNext}
                      className="w-full mt-2 sm:mt-3 px-6 py-2.5 sm:py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
                    >
                      {currentIdx + 1 >= TOTAL_QUESTIONS ? 'See Results' : 'Next'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <CbatGameOver
              gameKey="dad"
              score={answers.filter(a => a.correct).length}
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
