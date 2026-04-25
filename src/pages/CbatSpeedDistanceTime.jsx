import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import {
  buildRound,
  scoreAnswer,
  gradeForScore,
  formatHHMM,
  SDT_NODES,
  SDT_EDGES,
  SDT_NODE_POS,
  SDT_LABEL_OFFSETS,
  WEIGHT_TABLE,
  QUESTION_META,
} from '../utils/sdtGenerator'

const ROUND_COUNT = 8
const ROUND_TIME = 60            // seconds per round
const FEEDBACK_MS = 1500

// ── Map ───────────────────────────────────────────────────────────────────────
function JourneyMap({ round }) {
  const activeEdges = new Set([
    [round.start, round.via].sort().join('-'),
    [round.via, round.destination].sort().join('-'),
  ])

  return (
    <svg viewBox="-50 0 580 420" preserveAspectRatio="xMidYMid meet" className="w-full h-auto md:h-full md:flex-1 md:min-h-0" aria-label="Journey map">
      {/* Edges */}
      {SDT_EDGES.map(([a, b]) => {
        const key = [a, b].sort().join('-')
        const active = activeEdges.has(key)
        const pa = SDT_NODE_POS[a]
        const pb = SDT_NODE_POS[b]
        return (
          <line
            key={key}
            x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke={active ? '#5baaff' : '#3d5a7a'}
            strokeWidth={active ? 2.5 : 1.25}
            strokeDasharray={active ? '' : '3 3'}
          />
        )
      })}

      {/* Distance labels — only on active segments */}
      {round.show.segments && (
        <>
          <DistanceLabel a={round.start} b={round.via} miles={round.seg1} />
          <DistanceLabel a={round.via} b={round.destination} miles={round.seg2} />
        </>
      )}

      {/* Nodes */}
      {SDT_NODES.map(name => {
        const p = SDT_NODE_POS[name]
        const off = SDT_LABEL_OFFSETS[name]
        const isStart = name === round.start
        const isVia = name === round.via
        const isDest = name === round.destination
        const onPath = isStart || isVia || isDest
        return (
          <g key={name}>
            <circle
              cx={p.x} cy={p.y} r={26}
              fill={onPath ? '#102040' : '#17293f'}
              stroke={
                isStart ? '#22c55e'
                : isDest ? '#ef4444'
                : isVia ? '#f59e0b'
                : '#5a7aa0'
              }
              strokeWidth={onPath ? 3.5 : 2}
            />
            <text
              x={p.x} y={p.y + 9}
              textAnchor="middle"
              fontSize="26"
              fontFamily="monospace"
              fontWeight="bold"
              fill={onPath ? '#ddeaf8' : '#b8c8dc'}
            >
              {name[0]}
            </text>
            <text
              x={p.x + off.dx} y={p.y + off.dy}
              textAnchor={off.anchor}
              fontSize="24"
              fontFamily="monospace"
              fontWeight="bold"
              fill={onPath ? '#ddeaf8' : '#b8c8dc'}
            >
              {name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function DistanceLabel({ a, b, miles }) {
  const pa = SDT_NODE_POS[a]
  const pb = SDT_NODE_POS[b]
  const mx = (pa.x + pb.x) / 2
  const my = (pa.y + pb.y) / 2
  return (
    <g>
      <rect x={mx - 31} y={my - 16} width={62} height={32} rx={5} fill="#0a1628" stroke="#5baaff" strokeWidth={1.5} />
      <text x={mx} y={my + 9} textAnchor="middle" fontSize="26" fontFamily="monospace" fill="#5baaff" fontWeight="bold">
        {miles}
      </text>
    </g>
  )
}

// ── Weight reference table ────────────────────────────────────────────────────
function WeightTable({ currentWeight }) {
  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg overflow-hidden">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide px-2 py-1 border-b border-[#1a3a5c] bg-[#0a1628]">
        Parcel Weight Reference
      </p>
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-slate-500">
            <th className="px-2 py-1 text-left font-normal">kg</th>
            <th className="px-2 py-1 text-right font-normal">miles/min</th>
            <th className="px-2 py-1 text-right font-normal">gal/hr</th>
          </tr>
        </thead>
        <tbody>
          {WEIGHT_TABLE.map(row => {
            const active = row.weight === currentWeight
            return (
              <tr key={row.weight} className={active ? 'bg-[#102040] text-brand-300 font-bold' : 'text-[#ddeaf8]'}>
                <td className="px-2 py-0.5">{row.weight}</td>
                <td className="px-2 py-0.5 text-right">{row.mpm}</td>
                <td className="px-2 py-0.5 text-right">{row.gph}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Data table ────────────────────────────────────────────────────────────────
function DataTable({ round }) {
  const hasParcel = round.show.parcel
  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg overflow-hidden">
      <table className="w-full text-xs font-mono">
        <thead className="bg-[#0a1628] text-slate-500">
          <tr>
            <th colSpan={3} className="px-2 py-1 text-left font-normal border-b border-[#1a3a5c]">Journey</th>
            <th colSpan={2} className="px-2 py-1 text-left font-normal border-b border-l border-[#1a3a5c]">Timings</th>
            <th colSpan={2} className="px-2 py-1 text-left font-normal border-b border-l border-[#1a3a5c]">Parcel</th>
          </tr>
          <tr className="text-[10px] text-slate-500 uppercase">
            <th className="px-2 py-1 text-left font-normal">Start</th>
            <th className="px-2 py-1 text-left font-normal">Via</th>
            <th className="px-2 py-1 text-left font-normal">End</th>
            <th className="px-2 py-1 text-left font-normal border-l border-[#1a3a5c]">Now</th>
            <th className="px-2 py-1 text-left font-normal">Arrive</th>
            <th className="px-2 py-1 text-left font-normal border-l border-[#1a3a5c]">Y/N</th>
            <th className="px-2 py-1 text-left font-normal">kg</th>
          </tr>
        </thead>
        <tbody className="text-[#ddeaf8]">
          <tr>
            <td className="px-2 py-2">{round.start}</td>
            <td className="px-2 py-2">{round.via}</td>
            <td className="px-2 py-2">{round.destination}</td>
            <td className="px-2 py-2 border-l border-[#1a3a5c]">
              {round.show.timeNow ? formatHHMM(round.timeNowMin) : <span className="text-amber-400">?</span>}
            </td>
            <td className="px-2 py-2">
              {round.show.arrivalTime ? formatHHMM(round.arrivalMin) : <span className="text-amber-400">?</span>}
            </td>
            <td className="px-2 py-2 border-l border-[#1a3a5c]">
              {hasParcel ? 'Y' : 'N'}
            </td>
            <td className="px-2 py-2">
              {hasParcel && round.show.weight ? round.weight : <span className="text-slate-600">—</span>}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Results screen ────────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime, totalScore, onPlayAgain, scoreSaved }) {
  const exact = answers.filter(a => a.exact).length
  const partial = answers.filter(a => a.partial).length
  const miss = answers.length - exact - partial
  const grade = gradeForScore(totalScore)
  const maxScore = ROUND_COUNT * 10
  const pct = Math.round((totalScore / maxScore) * 100)
  const gradeStyle =
    grade === 'Outstanding' ? { emoji: '\u{1F396}\uFE0F', color: 'text-green-400' }
    : grade === 'Good' ? { emoji: '\u2708\uFE0F', color: 'text-brand-300' }
    : grade === 'Needs Work' ? { emoji: '\u{1F527}', color: 'text-amber-400' }
    : { emoji: '\u{1F4A5}', color: 'text-red-400' }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center"
    >
      <p className="text-5xl mb-3">{gradeStyle.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${gradeStyle.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-6">Speed Distance Time Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{totalScore}</p>
            <p className="text-sm text-slate-400">pts / {maxScore}</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{pct}%</p>
            <p className="text-sm text-slate-400">accuracy</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Exact <span className="text-green-400 font-mono">{exact}</span>
          <span className="text-slate-600 mx-2">{'\u00b7'}</span>
          Close <span className="text-amber-400 font-mono">{partial}</span>
          <span className="text-slate-600 mx-2">{'\u00b7'}</span>
          Miss <span className="text-red-400 font-mono">{miss}</span>
          <span className="text-slate-600 mx-2">{'\u00b7'}</span>
          Total <span className="text-brand-300 font-mono">{totalTime.toFixed(1)}s</span>
        </p>
      </div>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-6 max-h-56 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Round Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => {
            const label = QUESTION_META[a.type].short
            const color = a.exact ? 'text-green-400' : a.partial ? 'text-amber-400' : 'text-red-400'
            const icon = a.exact ? '\u2713' : a.partial ? '\u223C' : '\u2717'
            return (
              <div key={i} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${color}`}>
                <span className="text-slate-500 w-6 text-left">#{i + 1}</span>
                <span className="w-14 text-left">{label}</span>
                <span>{icon}</span>
                <span className="font-mono text-slate-500 w-24 text-right">
                  {a.points} pt{a.points === 1 ? '' : 's'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {scoreSaved && (
        <p className="text-xs text-green-400 mb-4">{'\u2713'} Score saved</p>
      )}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Play Again
        </button>
        <Link
          to="/cbat/sdt/leaderboard"
          className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
        >
          {'\u{1F3C6}'} Leaderboard
        </Link>
      </div>
    </motion.div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CbatSpeedDistanceTime() {
  const { user, apiFetch, API } = useAuth()

  const [phase, setPhase] = useState('intro') // intro | playing | feedback | results
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'feedback') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])
  const [round, setRound] = useState(null)
  const [answers, setAnswers] = useState([])
  const [roundIndex, setRoundIndex] = useState(0)
  const [roundElapsed, setRoundElapsed] = useState(0)
  const [totalElapsed, setTotalElapsed] = useState(0)
  const [answerInput, setAnswerInput] = useState('')
  const [feedback, setFeedback] = useState(null) // { points, exact, partial, correct, user }
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)

  const answersRef = useRef([])
  const roundIndexRef = useRef(0)
  const roundStartRef = useRef(0)
  const tickRef = useRef(null)
  const advanceRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { roundIndexRef.current = roundIndex }, [roundIndex])

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/sdt/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

  const submitScore = useCallback((finalAnswers, finalTime) => {
    const totalScore = finalAnswers.reduce((s, a) => s + a.points, 0)
    const exactCount = finalAnswers.filter(a => a.exact).length
    const partialCount = finalAnswers.filter(a => a.partial).length
    const missCount = finalAnswers.length - exactCount - partialCount
    const grade = gradeForScore(totalScore)
    setScoreSaved(false)
    apiFetch(`${API}/api/games/cbat/sdt/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalScore,
        exactCount,
        partialCount,
        missCount,
        roundsPlayed: finalAnswers.length,
        totalTime: finalTime,
        grade,
      }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/sdt/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API])

  const endGame = useCallback((finalAnswers) => {
    clearInterval(tickRef.current)
    if (advanceRef.current) clearTimeout(advanceRef.current)
    const total = finalAnswers.reduce((s, a) => s + a.roundTime, 0)
    submitScore(finalAnswers, total)
    setTotalElapsed(total)
    setPhase('results')
  }, [submitScore])

  const startRound = useCallback((idx) => {
    const r = buildRound()
    setRound(r)
    setAnswerInput('')
    setFeedback(null)
    setRoundIndex(idx)
    roundIndexRef.current = idx
    setRoundElapsed(0)
    roundStartRef.current = Date.now()
    setPhase('playing')
    setTimeout(() => { inputRef.current?.focus() }, 50)
  }, [])

  // Round timer
  useEffect(() => {
    if (phase !== 'playing') {
      clearInterval(tickRef.current)
      return
    }
    tickRef.current = setInterval(() => {
      const el = (Date.now() - roundStartRef.current) / 1000
      setRoundElapsed(el)
      if (el >= ROUND_TIME) {
        clearInterval(tickRef.current)
        handleSubmit(true)
      }
    }, 100)
    return () => clearInterval(tickRef.current)
  }, [phase])

  useEffect(() => {
    return () => {
      clearInterval(tickRef.current)
      if (advanceRef.current) clearTimeout(advanceRef.current)
    }
  }, [])

  const handleSubmit = useCallback((timedOut = false) => {
    if (phase !== 'playing' || !round) return
    clearInterval(tickRef.current)
    const roundTime = Math.min((Date.now() - roundStartRef.current) / 1000, ROUND_TIME)
    const result = timedOut && answerInput.trim() === ''
      ? { points: 0, exact: false, partial: false }
      : scoreAnswer(round, answerInput)

    const newAnswer = {
      type: round.type,
      userInput: answerInput,
      correctAnswer: round.correctAnswer,
      roundTime,
      ...result,
    }
    const updated = [...answersRef.current, newAnswer]
    setAnswers(updated)
    answersRef.current = updated
    setFeedback({ ...result, correct: round.correctAnswer, user: answerInput, type: round.type, timedOut })
    setPhase('feedback')

    advanceRef.current = setTimeout(() => {
      const nextIdx = roundIndexRef.current + 1
      if (nextIdx >= ROUND_COUNT) {
        endGame(updated)
      } else {
        startRound(nextIdx)
      }
    }, FEEDBACK_MS)
  }, [phase, round, answerInput, startRound, endGame])

  const startGame = useCallback(() => {
    setAnswers([])
    answersRef.current = []
    setTotalElapsed(0)
    setScoreSaved(false)
    startRound(0)
  }, [startRound])

  const timeLeft = Math.max(0, ROUND_TIME - roundElapsed)
  const timePct = (timeLeft / ROUND_TIME) * 100

  const totalScoreSoFar = answers.reduce((s, a) => s + a.points, 0)
  const finalTotalScore = phase === 'results'
    ? answers.reduce((s, a) => s + a.points, 0)
    : totalScoreSoFar

  const formatCorrect = (r) => {
    if (!r) return ''
    if (r.type === 'arrival') return formatHHMM(r.correctAnswer)
    return `${r.correctAnswer} ${QUESTION_META[r.type].unit}`
  }

  return (
    <div className="cbat-sdt-page">
      <SEO title="Speed Distance Time — CBAT" description="Calculate arrival time, distance, fuel and speed under pressure." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
        <h1 className="text-sm font-extrabold text-slate-900">Speed Distance Time</h1>
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

      {user && (
        <div className="flex flex-col items-center">

          {/* Intro */}
          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-xl bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className="text-4xl mb-3">{'\u{1F4E1}'}</p>
              <p className="text-xl font-extrabold text-white mb-2">Speed Distance Time</p>
              <p className="text-sm text-slate-400 mb-5">
                Deliver a parcel across a five-node network. Each round one value is missing —
                Arrival Time, Total Distance, Fuel, or Speed. Calculate it from the given data.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-4 text-left space-y-2">
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u23F1'}</span>
                  <span>{ROUND_COUNT} rounds, {ROUND_TIME} seconds each</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F9EE}'}</span>
                  <span>Speed = Distance / Time. Parcel weight sets miles/min and gal/hr.</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F3AF}'}</span>
                  <span>Exact = 10 pts, within 5% = 5 pts, miss = 0 pts. Max score {ROUND_COUNT * 10}.</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F4CF}'}</span>
                  <span>Round up if decimal {'\u2265'} 0.5, else round down. Times entered as HHMM (e.g. 1430).</span>
                </div>
              </div>

              {/* Preview of weight table */}
              <div className="mb-4">
                <WeightTable currentWeight={null} />
              </div>

              {personalBest && (
                <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-300">
                    {personalBest.bestScore} pts
                    <span className="text-slate-500 mx-1">{'\u00b7'}</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/sdt/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
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

          {/* Playing / Feedback */}
          {(phase === 'playing' || phase === 'feedback') && round && (
            <div className="w-full max-w-5xl">
              {/* HUD */}
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                <span className="text-slate-400">
                  Round <span className="text-brand-300">{roundIndex + 1}</span>/{ROUND_COUNT}
                </span>
                <span className="text-slate-400">
                  Score <span className="text-brand-300">{totalScoreSoFar}</span>
                </span>
                <span className="text-slate-400">
                  {'\u23F1'} <span className={timeLeft < 10 ? 'text-red-400' : 'text-brand-300'}>{timeLeft.toFixed(1)}s</span>
                </span>
              </div>

              {/* Time bar */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${timeLeft < 10 ? 'bg-red-500' : 'bg-brand-600'}`}
                  initial={false}
                  animate={{ width: `${timePct}%` }}
                  transition={{ duration: 0.1, ease: 'linear' }}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {/* Left column — map (2/5) */}
                <div className="md:col-span-2 bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 flex flex-col md:min-h-0">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Map</p>
                  <JourneyMap round={round} />
                  {!round.show.segments && (
                    <p className="text-[10px] text-amber-400 text-center mt-2">Distances hidden — compute total distance</p>
                  )}
                </div>

                {/* Right column — data + tables (3/5) */}
                <div className="md:col-span-3 flex flex-col gap-3">
                  <DataTable round={round} />

                  {/* Ask */}
                  <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Solve For</p>
                    <p className="text-lg font-bold text-brand-300">
                      {QUESTION_META[round.type].label}
                      <span className="text-xs text-slate-500 font-mono font-normal ml-2">
                        ({QUESTION_META[round.type].unit})
                      </span>
                    </p>
                  </div>

                  <WeightTable currentWeight={round.show.weight ? round.weight : null} />

                  {/* Answer input OR feedback — same fixed-height slot so the layout doesn't jump on submit */}
                  <div className="min-h-[9rem] sm:min-h-[5.25rem] flex">
                    {phase === 'feedback' && feedback ? (
                      <motion.div
                        key="fb"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`flex-1 rounded-xl border p-3 text-center flex flex-col items-center justify-center ${
                          feedback.exact ? 'bg-green-500/15 border-green-500/50'
                          : feedback.partial ? 'bg-amber-500/15 border-amber-500/50'
                          : 'bg-red-500/15 border-red-500/50'
                        }`}
                      >
                        <p className={`text-xl font-extrabold ${
                          feedback.exact ? 'text-green-300'
                          : feedback.partial ? 'text-amber-300'
                          : 'text-red-300'
                        }`}>
                          {feedback.exact
                            ? `\u2713 Exact  +${feedback.points} pts`
                            : feedback.partial
                            ? `\u223C Close (within 5%)  +${feedback.points} pts`
                            : feedback.timedOut
                            ? `\u23F1 Time up`
                            : `\u2717 Off`}
                        </p>
                        {!feedback.exact && (
                          <p className="text-xs font-mono text-slate-300 mt-1">
                            Correct: <span className="text-brand-300 font-bold">
                              {formatCorrect({ type: feedback.type, correctAnswer: feedback.correct })}
                            </span>
                            {feedback.user && !feedback.timedOut && (
                              <>
                                <span className="text-slate-600 mx-2">{'\u00b7'}</span>
                                You: <span className="text-slate-400">{feedback.user}</span>
                              </>
                            )}
                          </p>
                        )}
                      </motion.div>
                    ) : (
                      <div className="flex-1 flex flex-col sm:flex-row items-stretch gap-3">
                        <div className="flex-1 min-w-0 bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Answer</p>
                          <div className="flex items-center gap-2">
                            <input
                              ref={inputRef}
                              type="text"
                              inputMode="numeric"
                              autoFocus
                              value={answerInput}
                              onChange={(e) => setAnswerInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSubmit(false)
                              }}
                              placeholder={QUESTION_META[round.type].unit}
                              className="flex-1 min-w-0 bg-[#060e1a] border border-[#1a3a5c] rounded-lg px-3 py-2 text-white font-mono text-lg focus:outline-none focus:border-brand-400"
                            />
                            <button
                              onClick={() => handleSubmit(false)}
                              className="shrink-0 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
                            >
                              Submit
                            </button>
                          </div>
                        </div>
                        <div className="sm:w-36 shrink-0 bg-[#060e1a] border border-[#1a3a5c] rounded-xl p-3 flex flex-row sm:flex-col items-center justify-center gap-2 sm:gap-0 text-center">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide sm:mb-1">Formula</p>
                          <p className="text-xs font-mono text-brand-300 leading-tight">
                            Speed = Distance / Time
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <ResultsScreen
              answers={answers}
              totalTime={totalElapsed}
              totalScore={finalTotalScore}
              onPlayAgain={startGame}
              scoreSaved={scoreSaved}
            />
          )}
        </div>
      )}
    </div>
  )
}
