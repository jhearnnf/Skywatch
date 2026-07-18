import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import InstrumentPanel from '../components/cbat/InstrumentPanel'
import CbatGameOver from '../components/CbatGameOver'

// ── Constants ────────────────────────────────────────────────────────────────
const TIME_LIMIT = 90          // seconds
const FEEDBACK_MS = 2000
const CALIBRATION_MIN_MS = 1000
const CALIBRATION_MAX_MS = 3000

const HEADINGS = ['N', 'E', 'S', 'W']
const VS_STATES = ['Level', 'Ascend', 'Descend']
const TURN_STATES = ['None', 'Standard', 'Non-standard']
const ALT_STEP = 200
const ALT_MAX = 10000
const AIRSPEED_STEP = 20
const AIRSPEED_MAX = 360
const DISTRACTOR_KEYS = ['altitude', 'airspeed', 'heading', 'vs', 'turn']

// ── Helpers ──────────────────────────────────────────────────────────────────
function pickOtherThan(list, current) {
  const options = list.filter(v => v !== current)
  return options[Math.floor(Math.random() * options.length)]
}

function randomParams() {
  return {
    altitude: Math.floor(Math.random() * (ALT_MAX / ALT_STEP + 1)) * ALT_STEP,
    airspeed: Math.floor(Math.random() * (AIRSPEED_MAX / AIRSPEED_STEP + 1)) * AIRSPEED_STEP,
    heading: HEADINGS[Math.floor(Math.random() * HEADINGS.length)],
    vs: VS_STATES[Math.floor(Math.random() * VS_STATES.length)],
    turn: TURN_STATES[Math.floor(Math.random() * TURN_STATES.length)],
  }
}

function alternateValueFor(key, current) {
  switch (key) {
    case 'heading': return pickOtherThan(HEADINGS, current)
    case 'vs': return pickOtherThan(VS_STATES, current)
    case 'turn': return pickOtherThan(TURN_STATES, current)
    case 'altitude': {
      const deltas = [-600, -400, -200, 200, 400, 600]
      const d = deltas[Math.floor(Math.random() * deltas.length)]
      const v = current + d
      if (v < 0 || v > ALT_MAX) return current - d
      return v
    }
    case 'airspeed': {
      const deltas = [-40, -20, 20, 40]
      const d = deltas[Math.floor(Math.random() * deltas.length)]
      const v = current + d
      if (v < 0 || v > AIRSPEED_MAX) return current - d
      return v
    }
    default: return current
  }
}

function paramsEqual(a, b) {
  return DISTRACTOR_KEYS.every(k => a[k] === b[k])
}

function makeDistractor(correct) {
  const nSwap = Math.random() < 0.5 ? 1 : 2
  const keys = [...DISTRACTOR_KEYS].sort(() => Math.random() - 0.5).slice(0, nSwap)
  const mutated = { ...correct }
  keys.forEach(k => { mutated[k] = alternateValueFor(k, correct[k]) })
  return mutated
}

function buildRound() {
  const correct = randomParams()
  const statements = [correct]
  let guard = 0
  while (statements.length < 5 && guard++ < 200) {
    const d = makeDistractor(correct)
    if (!statements.some(s => paramsEqual(s, d))) statements.push(d)
  }
  // Shuffle so the correct entry isn't always at index 0
  const shuffled = statements
    .map((s, i) => ({ s, i, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .map(({ s }) => s)
  const correctIdx = shuffled.findIndex(s => paramsEqual(s, correct))
  return { params: correct, statements: shuffled, correctIdx }
}

// Returns the statement as a list of segments, each tagged with the instrument
// key it refers to (or untagged for connective text). The renderer uses these
// tags to highlight whichever phrase matches the currently-pressed dial.
function statementSegments(p) {
  const turnPhrase =
    p.turn === 'None' ? 'maintaining direction'
    : p.turn === 'Standard' ? 'Standard turn'
    : 'Non-standard turn'
  const vsPhrase =
    p.vs === 'Level' ? 'maintaining height'
    : p.vs === 'Ascend' ? 'climbing'
    : 'descending'
  return [
    { text: 'Flying at ' },
    { text: `${p.airspeed} kt`, key: 'airspeed' },
    { text: ', ' },
    { text: turnPhrase, key: 'turn' },
    { text: ', ' },
    { text: `heading ${p.heading}`, key: 'heading' },
    { text: ', ' },
    { text: vsPhrase, key: 'vs' },
    { text: ' at ' },
    { text: `${p.altitude} feet`, key: 'altitude' },
    { text: '.' },
  ]
}

function gradeFor(correct) {
  if (correct >= 15) return 'Outstanding'
  if (correct >= 10) return 'Good'
  if (correct >= 5) return 'Needs Work'
  return 'Failed'
}

// ── Results screen ───────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime }) {
  const correct = answers.filter(a => a.correct).length
  const rounds = answers.length
  const pct = rounds ? Math.round((correct / rounds) * 100) : 0
  const grade = gradeFor(correct)
  const gradeStyle =
    grade === 'Outstanding' ? { emoji: '\u{1F396}\uFE0F', color: 'text-green-400' }
    : grade === 'Good' ? { emoji: '\u2708\uFE0F', color: 'text-brand-300' }
    : grade === 'Needs Work' ? { emoji: '\u{1F527}', color: 'text-amber-400' }
    : { emoji: '\u{1F4A5}', color: 'text-red-400' }
  const correctTimes = answers.filter(a => a.correct).map(a => a.roundTime)
  const avgTime = correctTimes.length
    ? correctTimes.reduce((s, v) => s + v, 0) / correctTimes.length
    : 0

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{gradeStyle.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${gradeStyle.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-6">Instrument Read Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{correct}</p>
            <p className="text-sm text-slate-400">correct / {rounds}</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{pct}%</p>
            <p className="text-sm text-slate-400">accuracy</p>
          </div>
        </div>
        {correctTimes.length > 0 && (
          <p className="text-xs text-slate-500 mt-3">
            Avg answer time: <span className="text-brand-300 font-mono">{avgTime.toFixed(2)}s</span>
            <span className="text-slate-600 mx-2">{'\u00b7'}</span>
            Total: <span className="text-brand-300 font-mono">{totalTime.toFixed(1)}s</span>
          </p>
        )}
      </div>

      {/* Answer review */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-6 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Round Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 text-left">#{i + 1}</span>
              <span>{a.correct ? '\u2713' : '\u2717'}</span>
              <span className="font-mono text-slate-500">
                {a.correct ? `${a.roundTime.toFixed(2)}s` : 'wrong'}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatInstruments() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  const [phase, setPhase] = useState('intro') // intro | calibrating | playing | feedback | results
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'calibrating' || phase === 'playing' || phase === 'feedback') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])
  const [round, setRound] = useState(null)
  const [answers, setAnswers] = useState([])
  const [pickedIdx, setPickedIdx] = useState(null)
  const [wasCorrect, setWasCorrect] = useState(null)
  const [lastRoundTime, setLastRoundTime] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [calibrationMs, setCalibrationMs] = useState(2000)
  const [roundIndex, setRoundIndex] = useState(0)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const roundStartRef = useRef(0)
  const advanceTimeoutRef = useRef(null)
  const calibrationTimeoutRef = useRef(null)
  const answersRef = useRef([])
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const [highlightedKey, setHighlightedKey] = useState(null)
  const [hintDismissed, setHintDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('cbat.instruments.highlightHint') === '1'
  )

  const toggleHighlight = useCallback((key) => {
    setHighlightedKey(prev => (prev === key ? null : key))
    if (!hintDismissed) {
      setHintDismissed(true)
      try { localStorage.setItem('cbat.instruments.highlightHint', '1') } catch {}
    }
  }, [hintDismissed])

  // Keep latest answers in a ref for use inside timer callback (avoids stale closure)
  useEffect(() => { answersRef.current = answers }, [answers])

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/instruments/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

  const submitScore = useCallback((finalAnswers, finalTime) => {
    const correct = finalAnswers.filter(a => a.correct).length
    const grade = gradeFor(correct)
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correct, round: finalAnswers.length })
    submitCbatResult(`instruments`, {
        correctCount: correct,
        roundsPlayed: finalAnswers.length,
        totalTime: finalTime,
        grade,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/instruments/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  // True elapsed since the run began, read from the single start timestamp set
  // in startGame. Deliberately not derived from the `elapsed` state: endGame
  // used to depend on it, so its identity changed every tick, which re-ran the
  // timer effect below and re-based the clock 10x a second — each re-base
  // dropped the sub-tick remainder, so the timer ran measurably slow.
  const readElapsed = useCallback(
    () => (startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0),
    []
  )

  const endGame = useCallback(() => {
    if (calibrationTimeoutRef.current) clearTimeout(calibrationTimeoutRef.current)
    if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
    const current = answersRef.current
    const finalTime = Math.min(readElapsed(), TIME_LIMIT)
    setElapsed(finalTime)
    submitScore(current, finalTime)
    setPhase('results')
  }, [readElapsed, submitScore])

  // Master timer — runs during calibrating/playing/feedback. Fires endGame at cap.
  useEffect(() => {
    if (phase === 'intro' || phase === 'results') {
      clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => {
      const now = readElapsed()
      setElapsed(now)
      if (now >= TIME_LIMIT) {
        clearInterval(timerRef.current)
        endGame()
      }
    }, 100)
    return () => clearInterval(timerRef.current)
  }, [phase, endGame, readElapsed])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
      if (calibrationTimeoutRef.current) clearTimeout(calibrationTimeoutRef.current)
      clearInterval(timerRef.current)
    }
  }, [])

  const startCalibration = useCallback(() => {
    const dur = CALIBRATION_MIN_MS + Math.random() * (CALIBRATION_MAX_MS - CALIBRATION_MIN_MS)
    setCalibrationMs(dur)
    setRound(buildRound())
    setRoundIndex(n => n + 1)
    setPickedIdx(null)
    setWasCorrect(null)
    setHighlightedKey(null)
    setPhase('calibrating')
    calibrationTimeoutRef.current = setTimeout(() => {
      roundStartRef.current = (Date.now() - startTimeRef.current) / 1000
      setPhase('playing')
    }, dur)
  }, [])

  const startGame = useCallback(() => {
    startTracking('instruments')
    setAnswers([])
    answersRef.current = []
    setElapsed(0)
    startTimeRef.current = Date.now()
    setScoreSaved(false)
    setRoundIndex(0)
    startCalibration()
  }, [startCalibration, apiFetch, API])

  const goToIntro = useCallback(() => {
    if (calibrationTimeoutRef.current) clearTimeout(calibrationTimeoutRef.current)
    if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current)
    clearInterval(timerRef.current)
    setPhase('intro')
    setAnswers([])
    answersRef.current = []
    setElapsed(0)
    startTimeRef.current = null
    setScoreSaved(false)
  }, [])

  const handlePick = useCallback((idx) => {
    if (phase !== 'playing' || !round) return
    const correct = idx === round.correctIdx
    const roundTime = readElapsed() - roundStartRef.current
    const newAnswers = [
      ...answersRef.current,
      { pickedIdx: idx, correctIdx: round.correctIdx, correct, roundTime, params: round.params },
    ]
    setAnswers(newAnswers)
    answersRef.current = newAnswers
    setPickedIdx(idx)
    setWasCorrect(correct)
    setLastRoundTime(roundTime)
    setPhase('feedback')

    advanceTimeoutRef.current = setTimeout(() => {
      if (readElapsed() >= TIME_LIMIT) {
        endGame()
        return
      }
      startCalibration()
    }, FEEDBACK_MS)
  }, [phase, round, readElapsed, startCalibration, endGame])

  const timeRemaining = Math.max(0, TIME_LIMIT - elapsed)
  const correctSoFar = answers.filter(a => a.correct).length

  return (
    <div className="cbat-instruments-page">
      <SEO title="Instruments — CBAT" description="Read cockpit instruments under time pressure." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <button onClick={goToIntro} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
        }
        <h1 className="text-sm font-extrabold text-slate-900">Instruments</h1>
      </div>

      {/* Not logged in */}
      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">{'\u{1F512}'}</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to play</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to access CBAT games.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {/* Logged in */}
      {user && (
        <div className="flex flex-col items-center">

          {/* Intro */}
          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className="text-4xl mb-3">{'\u{1F6EB}'}</p>
              <p className="text-xl font-extrabold text-white mb-2">Instrument Read</p>
              <p className="text-sm text-slate-400 mb-5">
                Read the six cockpit instruments and pick the statement that correctly
                describes the flight state. As many rounds as you can in 90 seconds.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u23F1'}</span>
                  <span>90-second total time limit</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F9ED}'}</span>
                  <span>Needles calibrate each round — wait for them to settle, then choose</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u2713'}</span>
                  <span>One correct statement, four distractors — variables swapped subtly</span>
                </div>
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore} correct
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/instruments/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
                  {'View Leaderboard \u2192'}
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

          {/* Playing / Calibrating / Feedback */}
          {(phase === 'calibrating' || phase === 'playing' || phase === 'feedback') && round && (
            <div className="w-full max-w-md">
              {/* HUD */}
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                <span className="text-slate-400">
                  Round <span className="text-brand-300">{answers.length + (phase === 'feedback' ? 0 : 1)}</span>
                </span>
                <span className="text-slate-400">
                  {'\u2713'} <span className="text-green-400">{correctSoFar}</span>
                </span>
                <span className="text-slate-400">
                  {'\u23F1'} <span className={timeRemaining < 10 ? 'text-red-400' : 'text-brand-300'}>{timeRemaining.toFixed(1)}s</span>
                </span>
              </div>

              {/* Time bar */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${timeRemaining < 10 ? 'bg-red-500' : 'bg-brand-600'}`}
                  initial={false}
                  animate={{ width: `${(timeRemaining / TIME_LIMIT) * 100}%` }}
                  transition={{ duration: 0.1, ease: 'linear' }}
                />
              </div>

              {/* Instruments */}
              <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 mb-3">
                <InstrumentPanel
                  key={roundIndex}
                  altitude={round.params.altitude}
                  airspeed={round.params.airspeed}
                  heading={round.params.heading}
                  vs={round.params.vs}
                  turn={round.params.turn}
                  durationMs={calibrationMs}
                  highlightedKey={phase === 'calibrating' ? null : highlightedKey}
                  onToggleHighlight={phase === 'calibrating' ? undefined : toggleHighlight}
                />
                {/* Fixed-height slot reserves space for the calibrating /
                    hint message so the panel doesn't grow/shrink as messages
                    appear, which would otherwise shove the answers below. */}
                <div className="relative mt-2 h-[1.75rem]">
                  <AnimatePresence mode="wait">
                    {phase === 'calibrating' && (
                      <motion.p
                        key="calibrating"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.45, ease: 'easeOut' }}
                        className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-500 uppercase tracking-wider font-bold"
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse mr-1.5" />
                        Calibrating instruments…
                      </motion.p>
                    )}
                    {(phase === 'playing' || phase === 'feedback') && !hintDismissed && (
                      <motion.p
                        key="hint"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.35, ease: 'easeOut' }}
                        className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-500"
                      >
                        Tap an instrument to highlight it in the answers
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Options — hidden during calibration, slide in after */}
              <AnimatePresence mode="wait">
                {(phase === 'playing' || phase === 'feedback') && (
                  <motion.div
                    key={`options-${roundIndex}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-2"
                  >
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide text-center mb-1">
                      Which statement is correct?
                    </p>
                    {round.statements.map((s, i) => {
                      const segments = statementSegments(s)
                      let btnClass = 'bg-[#060e1a] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240]'
                      if (phase === 'feedback') {
                        if (i === round.correctIdx) {
                          btnClass = 'bg-green-500/20 border-green-500/50 text-green-300'
                        } else if (i === pickedIdx && !wasCorrect) {
                          btnClass = 'bg-red-500/20 border-red-500/50 text-red-300'
                        } else {
                          btnClass = 'bg-[#060e1a] border-[#1a3a5c] text-[#5a6a80] opacity-50'
                        }
                      }
                      return (
                        <motion.button
                          key={`${roundIndex}-${i}`}
                          initial={{ opacity: 0, x: -16 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.06, duration: 0.22, ease: 'easeOut' }}
                          onClick={() => handlePick(i)}
                          disabled={phase === 'feedback'}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border-2 text-xs sm:text-sm transition-all min-h-[3.75rem] sm:min-h-[4.25rem] ${btnClass} ${
                            phase === 'feedback' ? 'cursor-default' : 'cursor-pointer'
                          }`}
                        >
                          <span className="font-mono text-[10px] text-slate-500 mr-2">{String.fromCharCode(65 + i)}</span>
                          {segments.map((seg, j) => {
                            // 'attitude' is a meta-key — the attitude indicator
                            // shows both pitch (vs) and roll (turn), so tapping
                            // it highlights both phrases at once.
                            const match = seg.key && (
                              seg.key === highlightedKey ||
                              (highlightedKey === 'attitude' && (seg.key === 'vs' || seg.key === 'turn'))
                            )
                            // No font-bold / no horizontal padding on the mark
                            // — both alter layout metrics (bold glyph width,
                            // padding wrap point) and would jitter the text
                            // when a dial is toggled. The bright amber bg vs.
                            // dark text already gives the highlight enough pop.
                            return match
                              ? <mark key={j} className="bg-amber-700 text-amber-50 rounded">{seg.text}</mark>
                              : <span key={j}>{seg.text}</span>
                          })}
                        </motion.button>
                      )
                    })}

                    {/* Feedback flash */}
                    <AnimatePresence>
                      {phase === 'feedback' && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className={`text-center mt-2 text-xs font-bold ${wasCorrect ? 'text-green-400' : 'text-red-400'}`}
                        >
                          {wasCorrect
                            ? `\u2713 Correct \u2014 ${lastRoundTime.toFixed(2)}s`
                            : '\u2717 Wrong'}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <CbatGameOver
              gameKey="instruments"
              score={answers.filter(a => a.correct).length}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={startGame}
            >
              <ResultsScreen
                answers={answers}
                totalTime={Math.min(elapsed, TIME_LIMIT)}
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
