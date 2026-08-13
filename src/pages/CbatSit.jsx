// CBAT "Spatial Integration Test" (SIT).
//
// STUDY a set of isolated LAYERS, each a plan view showing one class of thing on
// the same ground → watch a two-second 3D CAMERA PASS over the whole scene,
// re-oriented → answer two questions on whether named classes are in the right
// place. The generator (utils/cbat/sitGenerator.js) carries the reasoning for
// the layers, the rotation and the distractor rule; this file is the
// presentation and the run loop.
//
// Three things worth restating here:
//
//   • No layer shows the full picture, which is what makes assembling it an
//     integration task rather than a memory one. The hills appear on every layer
//     because they are the only thing that lets one layer be registered against
//     another.
//   • On every clip at least one class NOBODY IS ASKED ABOUT is wrong. Checking
//     the whole frame is therefore the losing strategy, exactly as the guide
//     corpus describes.
//   • The clip is 3D — "a 3D rendered video of the scene" — while everything you
//     studied was a plan view. Carrying a plan across to an oblique pass is most
//     of the difficulty, and drawing the clip as a second map removed it.

import { useState, useCallback, useEffect, useRef, lazy, Suspense, Component } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import { useCbatDemo } from '../utils/cbat/demoMode'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import { DifficultyButton, DifficultyMarker } from '../components/CbatDifficultySelect'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import { generateSitRounds, GRID, COL_LABELS, CLASS_LABEL, MOVING_CLASSES } from '../utils/cbat/sitGenerator'
import { CLASS_STYLE, HEADING_DEG } from '../components/cbat/sitClassStyle'
import {
  SIT_DIFFICULTIES, SIT_ROUNDS, SIT_CLIPS, SIT_QUESTIONS_PER_CLIP, SIT_LAUNCH_MS,
  sitTuning, computeSitGrade, sitPhaseMs, sitRunEstimateMs,
  readStoredSitDifficulty, storeSitDifficulty,
} from '../utils/cbat/sitDifficulty'

// ── Map rendering ────────────────────────────────────────────────────────────
// The flat plan view, used for the STUDY LAYERS and the review diagram. The clip
// itself is 3D and lives in components/cbat/SitClipScene.jsx — the corpus
// describes the study material as grid displays and the clip as "a 3D rendered
// video of the scene", and reading a scene off an oblique pass is a different
// job from reading it off a plan.
//
// Colours come from the shared table both renderers use, so a truck cannot end
// up one colour here and another in the clip. See sitClassStyle.js.

function MapObject({ o, cell }) {
  const s = CLASS_STYLE[o.cls]
  const cx = (o.col + 0.5) * cell
  const cy = (o.row + 0.5) * cell
  const r = cell * 0.3
  const common = { fill: s.fill, stroke: s.stroke, strokeWidth: cell * 0.05 }

  if (s.shape === 'triangle' || s.shape === 'tree') {
    return <polygon points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`} {...common} />
  }
  if (s.shape === 'square') {
    return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} {...common} />
  }
  if (s.shape === 'truck') {
    // A flatbed seen from above: cab in front, body behind.
    return (
      <g {...common}>
        <rect x={cx - r * 0.55} y={cy - r} width={r * 1.1} height={r * 0.7} {...common} />
        <rect x={cx - r * 0.8} y={cy - r * 0.2} width={r * 1.6} height={r * 1.2} {...common} />
      </g>
    )
  }
  if (s.shape === 'troops') {
    // A section of three, drawn as a triangle of dots.
    return (
      <g {...common}>
        <circle cx={cx} cy={cy - r * 0.55} r={r * 0.34} {...common} />
        <circle cx={cx - r * 0.6} cy={cy + r * 0.45} r={r * 0.34} {...common} />
        <circle cx={cx + r * 0.6} cy={cy + r * 0.45} r={r * 0.34} {...common} />
      </g>
    )
  }
  // Moving contacts point the way they are heading — the flight path the corpus
  // mentions, drawn as the marker's own orientation rather than as a separate
  // line, so it survives a two-second look.
  const rot = HEADING_DEG[o.heading] ?? 0
  if (s.shape === 'arrow') {
    return (
      <polygon
        points={`${cx},${cy - r} ${cx + r * 0.75},${cy + r} ${cx},${cy + r * 0.45} ${cx - r * 0.75},${cy + r}`}
        transform={`rotate(${rot} ${cx} ${cy})`}
        {...common}
      />
    )
  }
  return (
    <g transform={`rotate(${rot} ${cx} ${cy})`}>
      <circle cx={cx} cy={cy} r={r * 0.45} {...common} />
      <line x1={cx - r} y1={cy - r * 0.6} x2={cx + r} y2={cy - r * 0.6} stroke={s.stroke} strokeWidth={cell * 0.07} />
    </g>
  )
}

const CELL = 40
const SIZE = GRID * CELL

// `labelled` draws the grid references. The STUDY map has them; the CLIP does
// NOT — with labels on both, matching becomes reading two grid references
// against each other and the spatial part of the task disappears entirely.
//
// `sizeClass` is the caller's, because the same component draws the big study
// map and the pair of thumbnails on the review screen. Left as a cap rather
// than a fixed width so it still shrinks on a phone.
function SitMap({ objects, labelled, dim, sizeClass = 'max-w-[min(360px,52vh)]' }) {
  const pad = labelled ? 18 : 4
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${SIZE + pad * 2} ${SIZE + pad * 2}`}
      className={`block w-full h-auto ${sizeClass} mx-auto`}
      role="img"
      aria-label={labelled ? 'Ground layout to study' : 'Camera pass over the same ground'}
      style={dim ? { opacity: 0.25 } : undefined}
    >
      <rect x={-pad} y={-pad} width={SIZE + pad * 2} height={SIZE + pad * 2} fill="#060e1a" />
      {Array.from({ length: GRID + 1 }, (_, i) => (
        <g key={i}>
          <line x1={i * CELL} y1={0} x2={i * CELL} y2={SIZE} stroke="#13294a" strokeWidth={1} />
          <line x1={0} y1={i * CELL} x2={SIZE} y2={i * CELL} stroke="#13294a" strokeWidth={1} />
        </g>
      ))}
      {labelled && COL_LABELS.map((l, i) => (
        <text key={`c${l}`} x={(i + 0.5) * CELL} y={-5} fill="#5a6a80" fontSize={13} textAnchor="middle" fontWeight="bold">{l}</text>
      ))}
      {labelled && Array.from({ length: GRID }, (_, i) => (
        <text key={`r${i}`} x={-6} y={(i + 0.5) * CELL + 4} fill="#5a6a80" fontSize={13} textAnchor="end" fontWeight="bold">{i + 1}</text>
      ))}
      {objects.map(o => <MapObject key={o.id} o={o} cell={CELL} />)}
    </svg>
  )
}

// The clip is WebGL, so it is loaded only when a run reaches it — the intro card
// has no business pulling three.js down — and it is wrapped in a boundary that
// falls back to the flat plan view. A device without WebGL should get a harder-
// to-read clip, not a run that dies halfway through.
const SitClipScene = lazy(() => import('../components/cbat/SitClipScene'))

class ClipBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}

function Legend({ classes }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
      {['hill', ...classes].map(cls => (
        <span key={cls} className="flex items-center gap-1 text-[10px] text-slate-500">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: CLASS_STYLE[cls].fill, border: `1px solid ${CLASS_STYLE[cls].stroke}` }}
          />
          {CLASS_LABEL[cls]}
          {MOVING_CLASSES.has(cls) && <span className="text-[9px] text-slate-600">(heading)</span>}
        </span>
      ))}
    </div>
  )
}

function ResultsScreen({ answers, totalTime, grade }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / SIT_ROUNDS) * 100)
  const emoji = grade === 'Outstanding' ? '🎖️' : grade === 'Good' ? '🛰️' : grade === 'Needs Work' ? '🔧' : '💥'
  const color = grade === 'Outstanding' ? 'text-green-400' : grade === 'Good' ? 'text-brand-300' : grade === 'Needs Work' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-6">Spatial Integration Test Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{correct}/{SIT_ROUNDS}</p>
            <p className="text-sm text-slate-400">{pct}% correct</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{totalTime.toFixed(1)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
      </div>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-h-48 overflow-y-auto text-left">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Round Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className="text-xs px-2 py-1">
              <span className={a.correct ? 'text-green-400' : 'text-red-400'}>{a.correct ? '✓' : '✗'}</span>
              <span className="text-slate-500 ml-2">
                #{i + 1} · {CLASS_LABEL[a.askedClass]} were {a.answer ? 'correct' : 'wrong'}
                {' · '}rotated {a.rotation}°
              </span>
              {a.otherWrong.length > 0 && (
                <span className="text-amber-400/70 ml-1">
                  ({CLASS_LABEL[a.otherWrong[0]]} were wrong too, and that never mattered)
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CbatSit() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const isDemo = useCbatDemo()

  // intro | launching | study | clip | answer | feedback | results
  const [phase, setPhase] = useState('intro')
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (['study', 'clip', 'answer', 'feedback'].includes(phase)) enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  const [difficulty, setDifficulty] = useState(readStoredSitDifficulty)
  const [runDifficulty, setRunDifficulty] = useState(difficulty)
  const runTuningRef = useRef(sitTuning(difficulty))

  const [rounds, setRounds] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  // Which of the clip's questions is being asked, and which study layer is on
  // screen. The layer is the player's choice — the corpus is explicit that "the
  // time per tab is not equal", so the study budget is one window they divide
  // between the layers themselves rather than a metronome we impose.
  const [questionIdx, setQuestionIdx] = useState(0)
  const [layerIdx, setLayerIdx] = useState(0)
  // The clip's countdown does not start until the renderer is actually up — see
  // the clip effect below.
  const [clipReady, setClipReady] = useState(false)
  const [answers, setAnswers] = useState([])
  const [feedback, setFeedback] = useState(null)
  const [remainingMs, setRemainingMs] = useState(0)
  // The WHOLE run: studying, watching the clip and answering. It used to be the
  // answering alone, which on this game is the short part — a run reported about
  // a third of its real length, on the results screen and on the leaderboard.
  const [totalElapsedMs, setTotalElapsedMs] = useState(0)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  const phaseStartRef = useRef(null)
  const tickRef = useRef(null)
  const timerRef = useRef(null)
  const launchTimerRef = useRef(null)
  const answersRef = useRef([])
  const totalElapsedRef = useRef(0)

  const runTuning = sitTuning(runDifficulty)
  const gameKey = runTuning.gameKey
  const current = rounds[currentIdx] || null
  const currentQuestion = current?.questions?.[questionIdx] || null
  // The whole study window for this clip: longer as the clips unlock more
  // layers, which is the ramp the corpus describes.
  const studyMs = (current?.layers?.length || 1) * runTuning.studyMsPerLayer

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { totalElapsedRef.current = totalElapsedMs }, [totalElapsedMs])

  // Times every phase that IS the test, by measuring how long each one is on
  // screen. Keyed on the question and clip indices too, so each segment is
  // counted once rather than the whole streak being counted on the way out.
  //
  // `feedback` is deliberately absent: how long someone reads the answer review
  // for is self-paced and is not the test, and counting it would turn the
  // leaderboard's time column into a measure of how long you looked at it.
  useEffect(() => {
    if (!['study', 'clip', 'answer'].includes(phase)) return undefined
    const enteredAt = Date.now()
    return () => {
      const spent = Date.now() - enteredAt
      totalElapsedRef.current += spent
      setTotalElapsedMs(prev => prev + spent)
    }
  }, [phase, currentIdx, questionIdx])

  const fetchBest = useCallback((key) => {
    apiFetch(`${API}/api/games/cbat/${key}/personal-best`)
      .then(r => r.json())
      .then(d => setPersonalBest(d?.data ?? null))
      .catch(() => {})
  }, [apiFetch, API])

  useEffect(() => {
    if (!user || phase !== 'intro') return
    fetchBest(sitTuning(difficulty).gameKey)
  }, [user, difficulty, phase, fetchBest])

  useEffect(() => () => {
    clearInterval(tickRef.current)
    clearTimeout(timerRef.current)
    clearTimeout(launchTimerRef.current)
  }, [])

  const submitScore = useCallback((finalAnswers, finalTotalMs, key) => {
    const correctCount = finalAnswers.filter(a => a.correct).length
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correctCount })
    submitCbatResult(key, {
      correctCount,
      totalQuestions: SIT_ROUNDS,
      totalTime: finalTotalMs / 1000,
      avgTimePerQuestionMs: Math.round(finalTotalMs / SIT_ROUNDS),
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchBest(key)
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted, fetchBest])

  // Pull the clip's WebGL chunk down while the player is still studying. The
  // study window is tens of seconds and the clip is two and a half, so this is
  // the one moment there is room to pay for it.
  useEffect(() => {
    if (phase === 'study') import('../components/cbat/SitClipScene')
  }, [phase])

  // Study and clip are fixed-length windows that roll straight on; only the
  // answer phase needs a visible countdown, so it is the only one that ticks.
  useEffect(() => {
    if (phase === 'study') {
      phaseStartRef.current = Date.now()
      setRemainingMs(studyMs)
      // The study clock DOES tick, unlike the clip's — the player is spending
      // this budget across the layers and needs to see what is left of it.
      tickRef.current = setInterval(() => {
        const left = Math.max(0, studyMs - (Date.now() - phaseStartRef.current))
        setRemainingMs(left)
        if (left === 0) { clearInterval(tickRef.current); setPhase('clip') }
      }, 100)
      return () => clearInterval(tickRef.current)
    }
    if (phase === 'clip') {
      // Two and a half seconds is the whole clip, so it cannot start ticking
      // while WebGL is still coming up — that would quietly hand a fast machine
      // a longer look than a slow one at the same test. The ceiling is there
      // because the flat fallback never reports itself ready.
      if (!clipReady) {
        timerRef.current = setTimeout(() => setClipReady(true), 1500)
        return () => clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => setPhase('answer'), runTuning.clipMs)
      return () => clearTimeout(timerRef.current)
    }
    if (phase === 'answer') {
      phaseStartRef.current = Date.now()
      setRemainingMs(runTuning.answerMs)
      tickRef.current = setInterval(() => {
        const left = Math.max(0, runTuning.answerMs - (Date.now() - phaseStartRef.current))
        setRemainingMs(left)
        if (left === 0) {
          clearInterval(tickRef.current)
          recordAnswer(null)
        }
      }, 100)
      return () => clearInterval(tickRef.current)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIdx, questionIdx, clipReady])

  // No elapsed argument any more: the phase timer above owns the run clock, and
  // the answer review does not show a per-question time.
  function recordAnswer(picked) {
    const round = rounds[currentIdx]
    const question = round?.questions?.[questionIdx]
    if (!question) return
    const correct = picked !== null && picked === question.answer
    const entry = {
      askedClass: question.askedClass,
      answer: question.answer,
      rotation: round.rotation,
      // Classes wrong in this frame that NOBODY was asked about. These are the
      // ones a player loses the point by checking, so the review names them.
      otherWrong: round.corruptedClasses.filter(
        c => !round.questions.some(q => q.askedClass === c),
      ),
      picked,
      correct,
    }
    const next = [...answersRef.current, entry]
    setAnswers(next)
    answersRef.current = next
    // The run clock is not touched here — the phase timer above already counts
    // the answer window, and adding it again would double it.
    setFeedback(entry)
    setPhase('feedback')
  }

  function handlePick(value) {
    if (phase !== 'answer') return
    clearInterval(tickRef.current)
    recordAnswer(value)
  }

  // The study window is the player's to spend, so they can hand back whatever is
  // left of it. It buys nothing: the clip runs on its own fixed window either
  // way, so this is only ever giving up a longer look at the layers.
  function endStudyEarly() {
    if (phase !== 'study') return
    clearInterval(tickRef.current)
    setPhase('clip')
  }

  // Within a clip, the next question comes straight away — no second viewing,
  // which is the corpus's "with no replay". Only when a clip's questions are
  // exhausted does the run move on to new ground.
  function goNext() {
    setFeedback(null)
    const nextQuestion = questionIdx + 1
    if (nextQuestion < (current?.questions?.length ?? 0)) {
      setQuestionIdx(nextQuestion)
      setPhase('answer')
      return
    }
    const nextIdx = currentIdx + 1
    if (nextIdx >= rounds.length) {
      submitScore(answersRef.current, totalElapsedRef.current, gameKey)
      setPhase('results')
      return
    }
    setCurrentIdx(nextIdx)
    setQuestionIdx(0)
    setLayerIdx(0)
    setClipReady(false)
    setPhase('study')
  }

  const beginLaunch = useCallback(() => {
    const tuning = sitTuning(difficulty)
    runTuningRef.current = tuning
    setRunDifficulty(difficulty)
    storeSitDifficulty(difficulty)

    setRounds(generateSitRounds({
      roundCount: SIT_CLIPS,
      classPool: tuning.classPool,
      rotations: tuning.rotations,
      questionsPerClip: SIT_QUESTIONS_PER_CLIP,
    }))
    setCurrentIdx(0)
    setQuestionIdx(0)
    setLayerIdx(0)
    setClipReady(false)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    startTracking(tuning.gameKey)

    if (isDemo) { setPhase('study'); return }
    setPhase('launching')
    launchTimerRef.current = setTimeout(() => setPhase('study'), SIT_LAUNCH_MS)
  }, [difficulty, startTracking, isDemo])

  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    clearTimeout(timerRef.current)
    clearTimeout(launchTimerRef.current)
    setPhase('intro')
    setRounds([])
    setCurrentIdx(0)
    setQuestionIdx(0)
    setLayerIdx(0)
    setClipReady(false)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setScoreSaved(false)
  }, [])

  const correctSoFar = answers.filter(a => a.correct).length
  const introTuning = sitTuning(difficulty)
  const playing = ['study', 'clip', 'answer', 'feedback'].includes(phase)

  // The study map and the camera pass are the game; give them the screen. See
  // the rule in main.css for why widening this page's own container achieves
  // nothing on its own — the app shell caps every route at max-w-3xl.
  useGameBodyClass('cbat-sit-wide', playing)

  // The panel is sized to whichever phase is in it. One width for all three
  // leaves the study map floating in a mostly-empty card and caps the clip —
  // which wants every pixel — at whatever the map needed.
  //
  // Both caps subtract the chrome that shares the column rather than guessing a
  // fraction of the viewport: the map is square and the clip is 4:3, so what
  // actually binds on a laptop is the height LEFT OVER once the header, the
  // clock, the tab strip and the buttons have taken theirs. A flat `62vh` is
  // either wasteful at 1200px tall or overflowing at 768.
  //
  //   study — square, so the height left over is also the width cap
  //   clip  — 4:3, so the height left over becomes a width cap × 4/3
  const panelWidth = phase === 'clip'
    ? 'max-w-[min(1180px,calc((100vh_-_210px)_*_4_/_3))]'
    : phase === 'study'
      ? 'max-w-[min(920px,calc(100vh_-_380px))]'
      : 'max-w-2xl'
  // Everything on the intro card except the flashing difficulty button dims
  // during the launch flash — the same treatment FLAG, SAT and RTT use.
  const dim = phase === 'launching' ? ' cbat-launch-dim' : ''

  return (
    <div>
      <SEO title="Spatial Integration Test (CBAT)" description="Study the ground one plan-view layer at a time, then judge a two-second 3D camera pass over the whole scene on one detail alone." />

      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={playing} />
        }
        <h1 className="text-sm font-extrabold text-slate-900">Spatial Integration Test</h1>
        {phase !== 'intro' && <DifficultyMarker tuning={runTuning} />}
      </div>

      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to play</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">Sign In</Link>
        </div>
      )}

      {user && (
        <div className="flex flex-col items-center">

          {(phase === 'intro' || phase === 'launching') && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className={`text-4xl mb-3${dim}`}>🛰️</p>

              {/* SIT_DIFFICULTIES is ordered [easier, hard], so the easier option
                  lands left and hard lands right. The pair sits under the title,
                  matching FLAG, CUT, Numerical Operations, SAT and RTT. */}
              <p className={`text-xl font-extrabold text-white mb-2${dim}`}>Spatial Integration Test</p>
              <div className="flex items-center justify-center gap-3 mb-1">
                {SIT_DIFFICULTIES.map(t => (
                  <DifficultyButton
                    key={t.key}
                    tuning={t}
                    selected={difficulty === t.key}
                    onSelect={setDifficulty}
                    flashing={phase === 'launching' && difficulty === t.key}
                    dimmed={phase === 'launching' && difficulty !== t.key}
                  />
                ))}
              </div>
              <p className={`text-[11px] text-brand-300 mb-3${dim}`}>{introTuning.blurb}</p>

              <p className={`text-sm text-slate-400 mb-5${dim}`}>
                Study the ground one layer at a time, from above. No layer shows the whole picture, so putting it together is on you. A camera then flies over the same ground in 3D, and not from the direction you studied it.
              </p>

              <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]${dim}`}>
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">1.</span>
                  <span>Study the layers. Each one holds a single kind of thing, and you move between them as you like. Only the hills appear on every layer.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">2.</span>
                  <span>The clip is a <span className="text-brand-300">3D pass</span> showing all of it at once, from a different direction. The hills never move, so use them to work out which way round you are looking.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">3.</span>
                  <span>Two questions per clip, and no second viewing. Answer the question you were asked, and only that one.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-amber-400/80 pt-1">
                  <span className="shrink-0">⚠️</span>
                  <span>Other things in the frame will be wrong. That never counts against the answer. Checking them costs you the question.</span>
                </div>
                {/* All THREE phases, and the total. Studying is where most of a
                    run goes on this test — quoting only the clip length, as this
                    line used to, made it look like a two-minute game. */}
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1">
                  <span className="shrink-0">⏱</span>
                  <span>
                    {SIT_CLIPS} clips of {SIT_QUESTIONS_PER_CLIP} questions ·{' '}
                    {Math.round(introTuning.studyMsPerLayer / 1000)}s per layer to study ·{' '}
                    {(introTuning.clipMs / 1000).toFixed(1)}s clip ·{' '}
                    {Math.round(introTuning.answerMs / 1000)}s per question
                  </span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
                  <span className="shrink-0">🕐</span>
                  <span>
                    About {Math.round(sitRunEstimateMs(introTuning) / 60000)} minutes if you use
                    every clock, of which {Math.round(sitPhaseMs(introTuning).study / 60000 * 10) / 10} is
                    studying. You can hand back the rest of any study window.
                  </span>
                </div>
              </div>

              {personalBest && (
                <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center${dim}`}>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best · {introTuning.label}</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore}/{SIT_ROUNDS}
                    <span className="text-slate-500 mx-1">·</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className={`text-center mb-4${dim}`}>
                <Link to={`/cbat/${introTuning.gameKey}/leaderboard`} className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
                  View Leaderboard →
                </Link>
              </div>

              <button
                onClick={beginLaunch}
                disabled={phase === 'launching'}
                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-bold rounded-lg transition-colors text-sm"
              >
                Start
              </button>
            </motion.div>
          )}

          {playing && current && (
            /* The panel takes whatever the shell gives it; each phase caps its
               own content, because a Yes/No pair stretched across 1100px is not
               an improvement on one that is 400px wide. */
            <div className="w-full">
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1 max-w-2xl mx-auto">
                <span className="text-slate-400">
                  Clip <span className="text-brand-300">{currentIdx + 1}</span>/{SIT_CLIPS}
                  <span className="text-slate-600 mx-1">·</span>
                  Q<span className="text-brand-300">{answers.length + (phase === 'feedback' ? 0 : 1)}</span>/{SIT_ROUNDS}
                </span>
                <span className="text-slate-400">✓ <span className="text-green-400">{correctSoFar}</span></span>
                <span className="text-slate-400">
                  {phase === 'answer' || phase === 'study'
                    ? <>⏱ <span className={remainingMs < 4000 ? 'text-red-400' : 'text-brand-300'}>{Math.ceil(remainingMs / 1000)}s</span></>
                    : phase === 'clip' ? 'CLIP' : ''}
                </span>
              </div>

              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden max-w-2xl mx-auto">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${(answers.length / SIT_ROUNDS) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              <div className={`bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 mx-auto w-full transition-[max-width] duration-300 ${panelWidth}`}>
                {phase === 'study' && (
                  /* Sized off the viewport HEIGHT as well as a pixel cap: the
                     map is square, and everything above and below it in this
                     column has to fit on screen with it. */
                  <div className="mx-auto w-full">
                    {/* The study clock, stated plainly and where the player is
                        already looking. The run-progress bar above counts
                        questions answered, which is a different thing and reads
                        as frozen during a study window that can run a minute. */}
                    <div className="flex items-baseline justify-between mb-1.5 px-0.5">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                        Study the layers · {layerIdx + 1} of {current.layers.length}
                      </p>
                      <p className="font-mono text-sm font-bold">
                        <span className={remainingMs < 8000 ? 'text-red-400' : 'text-brand-300'}>
                          {Math.ceil(remainingMs / 1000)}s
                        </span>
                        <span className="text-slate-600 text-[10px] ml-1">left</span>
                      </p>
                    </div>
                    <div className="w-full h-1.5 bg-[#13294a] rounded-full mb-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-100 ${
                          remainingMs < 8000 ? 'bg-red-500' : 'bg-brand-600'
                        }`}
                        style={{ width: `${(remainingMs / Math.max(1, studyMs)) * 100}%` }}
                      />
                    </div>
                    {/* One layer at a time, and never the whole scene. Moving
                        between them is free and unmetered — the corpus says "the
                        time per tab is not equal", so how the budget is divided
                        is the player's call, not ours. */}
                    <div className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1 justify-center">
                      {current.layers.map((layer, i) => (
                        <button
                          key={layer.cls}
                          type="button"
                          onClick={() => setLayerIdx(i)}
                          aria-pressed={i === layerIdx}
                          className={`shrink-0 px-2.5 py-1 rounded-lg border text-[10px] font-bold capitalize transition-colors cursor-pointer ${
                            i === layerIdx
                              ? 'bg-[#0f2240] border-brand-600 text-[#ddeaf8]'
                              : 'bg-[#060e1a] border-[#1a3a5c] text-slate-600 hover:text-[#ddeaf8]'
                          }`}
                        >
                          {CLASS_LABEL[layer.cls]}
                        </button>
                      ))}
                    </div>
                    <SitMap objects={current.layers[layerIdx].objects} labelled sizeClass="max-w-none" />
                    <Legend classes={[current.layers[layerIdx].cls]} />
                    <p className="text-[10px] text-slate-600 mt-2 text-center px-2">
                      No layer shows everything. Only the hills appear on all of them, so use those to line one layer up against the next.
                    </p>
                    {/* Ending study early only ever costs the player time they
                        were free to spend — it cannot buy them a longer look at
                        the clip, which runs on its own fixed window. */}
                    <button
                      onClick={endStudyEarly}
                      className="w-full mt-2.5 px-6 py-2.5 rounded-lg border border-[#1a3a5c] bg-[#060e1a] text-brand-300 font-bold text-sm hover:bg-[#0f2240] hover:border-brand-400 transition-colors cursor-pointer"
                    >
                      Skip study time · Go to the clip
                    </button>
                  </div>
                )}

                {phase === 'clip' && (
                  <>
                    <p className="text-[10px] text-amber-400 uppercase tracking-wide mb-2 text-center">Camera pass</p>
                    {/* A 3D pass over the ground, not a second map — "a 3D
                        rendered video of the scene", which is a different thing
                        to read than the plan view you studied. The camera moves;
                        nothing on the ground does, so a slow reader loses
                        nothing but the parallax. No compass and no grid labels:
                        working out which way round it has ended up is the task.
                        See components/cbat/SitClipScene.jsx. */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      /* 4:3, so the height cap has to be expressed as a WIDTH:
                         at 4:3 a width of 96vh is a height of 72vh. */
                      className="w-full mx-auto aspect-[4/3] rounded-lg overflow-hidden bg-[#060e1a] border border-[#13294a]"
                    >
                      <ClipBoundary fallback={<SitMap objects={current.clip} labelled={false} />}>
                        <Suspense fallback={<SitMap objects={current.clip} labelled={false} />}>
                          <SitClipScene
                            objects={current.clip}
                            grid={GRID}
                            durationMs={runTuning.clipMs}
                            onReady={() => setClipReady(true)}
                          />
                        </Suspense>
                      </ClipBoundary>
                    </motion.div>
                  </>
                )}

                {(phase === 'answer' || phase === 'feedback') && currentQuestion && (
                  <div className="py-2 mx-auto w-full">
                    <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-1 text-center">
                      Question {questionIdx + 1} of {current.questions.length} on this clip
                    </p>
                    <p className="text-center text-base sm:text-lg font-bold text-[#ddeaf8] mb-4 px-2">
                      {currentQuestion.prompt}
                    </p>
                    <div className="grid grid-cols-2 gap-2 px-2">
                      {[true, false].map(value => {
                        let cls = 'bg-[#060e1a] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240] cursor-pointer'
                        if (phase === 'feedback') {
                          if (value === currentQuestion.answer) cls = 'bg-green-500/15 border-green-500/50 text-green-400'
                          else if (value === feedback?.picked) cls = 'bg-red-500/15 border-red-500/50 text-red-400'
                          else cls = 'bg-[#060e1a] border-[#1a3a5c] text-[#5a6a80]'
                        }
                        return (
                          <button
                            key={String(value)}
                            type="button"
                            onClick={() => handlePick(value)}
                            disabled={phase === 'feedback'}
                            className={`py-4 rounded-lg border-2 font-bold text-lg transition-all ${cls}`}
                          >
                            {value ? 'Yes' : 'No'}
                          </button>
                        )
                      })}
                    </div>

                    <AnimatePresence>
                      {phase === 'feedback' && feedback && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 px-2">
                          <p className={`text-center text-sm font-bold mb-1 ${feedback.correct ? 'text-green-400' : 'text-red-400'}`}>
                            {feedback.correct ? '✓ Correct' : feedback.picked === null ? '⏱ Timeout' : '✗ Wrong'}
                          </p>
                          <p className="text-center text-xs text-slate-500 mb-2">
                            The camera passed {current.rotation}° round from the way you studied it.
                            {feedback.otherWrong.length > 0 && (
                              <> The {CLASS_LABEL[feedback.otherWrong[0]]} were out of place too, and nobody asked about those.</>
                            )}
                          </p>
                          {/* Only shown once the clip's last question is done —
                              revealing the scene between two questions on the
                              same clip would hand over the second answer. */}
                          {questionIdx + 1 >= current.questions.length && (
                            <div className="grid grid-cols-2 gap-3 mb-2">
                              <div>
                                <p className="text-[9px] text-slate-600 uppercase text-center mb-1">Should have been</p>
                                <SitMap objects={current.truth} labelled={false} sizeClass="max-w-[min(320px,34vh)]" />
                              </div>
                              <div>
                                <p className="text-[9px] text-slate-600 uppercase text-center mb-1">What you saw</p>
                                <SitMap objects={current.clip} labelled={false} sizeClass="max-w-[min(320px,34vh)]" />
                              </div>
                            </div>
                          )}
                          <button
                            onClick={goNext}
                            className="w-full px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
                          >
                            {answers.length >= SIT_ROUNDS
                              ? 'See Results'
                              : questionIdx + 1 < current.questions.length ? 'Next Question' : 'Next Clip'}
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          )}

          {phase === 'results' && (
            <CbatGameOver
              gameKey={gameKey}
              score={correctSoFar}
              time={totalElapsedMs / 1000}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); beginLaunch() }}
            >
              <ResultsScreen
                answers={answers}
                totalTime={totalElapsedMs / 1000}
                grade={computeSitGrade(correctSoFar, runTuning)}
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
