// ── ANT (Hard) — the whole run ────────────────────────────────────────────────
// The realistic Airborne Numerical Test. Structurally a different board from the
// original ANT in CbatAnt.jsx, so it owns its own screen rather than sharing
// that one's panels: an objective box of prose at the top (the ask is the last
// line, and reading it is most of the test), the route map, per-leg flight data
// carrying each leg's weather and revised speed, and a tabbed chart reference
// you look speeds and economy up on.
//
// Charts, not tables. The accounts describe three tabs — a short brief telling
// you to round and estimate, a speed-against-load chart and a
// speed-against-fuel chart, both plain bar graphs with whole numbers. Reading a
// bar chart is a real part of the task, so the reference here is drawn the same
// way rather than handed over as a tidy grid.
//
// See src/utils/cbat/antHardGenerator.js for what every round is made of.

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { submitCbatResult } from '../../lib/cbatOutbox'
import { useCbatTracking } from '../../utils/cbat/useCbatTracking'
import CbatQuitButton from '../CbatQuitButton'
import CbatGameOver from '../CbatGameOver'
import { ModeMarker } from '../CbatModeSelector'
import {
  ANT_NODES,
  ANT_EDGES,
  ANT_NODE_POS,
  ANT_LABEL_OFFSETS,
} from '../../utils/antGenerator'
import {
  ANT_HARD_AIRCRAFT,
  ANT_HARD_FUEL,
  ANT_HARD_QUESTIONS,
  ANT_HARD_WEATHER,
  ANT_HARD_ROUNDS,
  ANT_HARD_ROUND_TIME,
  ANT_HARD_CLOSE_BAND,
  buildRound,
  scoreAnswer,
  solutionSteps,
  gradeForScore,
  formatHHMM,
  formatAnswer,
} from '../../utils/cbat/antHardGenerator'

const IS_TOUCH = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(hover: none) and (pointer: coarse)').matches

const ROUTE_COLOUR = '#5baaff'   // the aircraft the question is about
const PARTNER_COLOUR = '#f59e0b' // the second aircraft, late rounds only

// ── Objective box ────────────────────────────────────────────────────────────
// "Read the last line of the objective box first, because that tells you what's
// actually being asked." The ask is styled as the ask so a player learns to go
// straight to it, rather than being trained by us to skim from the top.
function ObjectiveBox({ round }) {
  const lines = round.objective
  const ask = lines[lines.length - 1]
  const context = lines.slice(0, -1)
  return (
    <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 mb-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Objective</p>
        <p className="text-[10px] text-slate-500 uppercase tracking-wide">{round.stage}</p>
      </div>
      <div className="space-y-1">
        {context.map((line, i) => (
          <p key={i} className="text-[13px] text-[#ddeaf8] leading-snug">{line}</p>
        ))}
      </div>
      <p className="mt-2 pt-2 border-t border-[#1a3a5c] text-sm font-bold text-brand-600 leading-snug">
        {ask}
      </p>
    </div>
  )
}

// ── Map ──────────────────────────────────────────────────────────────────────
function RouteLegs({ flight, colour, dashed, show, offset = 0 }) {
  return flight.legs.map((leg, i) => {
    const pa = ANT_NODE_POS[leg.from]
    const pb = ANT_NODE_POS[leg.to]
    const mx = (pa.x + pb.x) / 2
    const my = (pa.y + pb.y) / 2 + offset
    const w = ANT_HARD_WEATHER[leg.weather]
    return (
      <g key={`${flight.aircraftId}-${i}`}>
        <line
          x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
          stroke={colour} strokeWidth={3}
          strokeDasharray={dashed ? '8 5' : ''}
        />
        {show && (
          <>
            <rect
              x={mx - 34} y={my - 16} width={68} height={32} rx={5}
              fill="#0a1628" stroke={colour} strokeWidth={1.5}
            />
            <text x={mx} y={my + 9} textAnchor="middle" fontSize="24" fontFamily="monospace" fill={colour} fontWeight="bold">
              {leg.miles}
            </text>
          </>
        )}
        {w.icon && (
          <text
            x={mx} y={my - 22} textAnchor="middle" fontSize="26"
            aria-label={w.label}
          >
            {w.icon}
          </text>
        )}
      </g>
    )
  })
}

function AntHardMap({ round }) {
  const f = round.flight
  const p = round.partner
  const onPath = new Set([...f.route, ...(p ? p.route : [])])

  return (
    <svg viewBox="-50 0 580 420" preserveAspectRatio="xMidYMid meet" className="w-full h-auto" aria-label="Route map">
      {/* The whole network stays drawn. The route you fly is spelled out in the
          objective, so a busier picture is background, never a puzzle. */}
      {ANT_EDGES.map(([a, b]) => {
        const pa = ANT_NODE_POS[a]
        const pb = ANT_NODE_POS[b]
        return (
          <line
            key={[a, b].sort().join('-')}
            x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke="#2a4058" strokeWidth={1.25} strokeDasharray="3 3"
          />
        )
      })}

      <RouteLegs flight={f} colour={ROUTE_COLOUR} dashed={false} show={round.show.legMiles} />
      {p && <RouteLegs flight={p} colour={PARTNER_COLOUR} dashed show={round.show.legMiles} offset={26} />}

      {ANT_NODES.map(name => {
        const pos = ANT_NODE_POS[name]
        const off = ANT_LABEL_OFFSETS[name]
        const active = onPath.has(name)
        const isOrigin = name === f.route[0] || (p && name === p.route[0])
        const isDest = name === f.route[f.route.length - 1]
        return (
          <g key={name}>
            <circle
              cx={pos.x} cy={pos.y} r={26}
              fill={active ? '#102040' : '#17293f'}
              stroke={isDest ? '#ef4444' : isOrigin ? '#22c55e' : active ? ROUTE_COLOUR : '#3d5a7a'}
              strokeWidth={active ? 3.5 : 2}
            />
            <text
              x={pos.x} y={pos.y + 9} textAnchor="middle"
              fontSize="26" fontFamily="monospace" fontWeight="bold"
              fill={active ? '#ddeaf8' : '#8fa4bd'}
            >
              {name[0]}
            </text>
            <text
              x={pos.x + off.dx} y={pos.y + off.dy} textAnchor={off.anchor}
              fontSize="24" fontFamily="monospace" fontWeight="bold"
              fill={active ? '#ddeaf8' : '#8fa4bd'}
            >
              {name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Reference charts ─────────────────────────────────────────────────────────
// Plain bar charts with whole numbers, as described on the day. The active row
// is lit, but every other bar stays readable — you are meant to read a chart,
// not be handed the one figure you need.
function BarChart({ rows, valueKey, labelKey, unit, activeLabel, colour = ROUTE_COLOUR }) {
  const max = Math.max(...rows.map(r => r[valueKey]))
  return (
    <div className="space-y-1">
      {rows.map(row => {
        const active = row[labelKey] === activeLabel
        return (
          <div key={row[labelKey]} className="flex items-center gap-2">
            <span className={`w-10 shrink-0 text-right text-[11px] font-mono ${active ? 'text-brand-600 font-bold' : 'text-slate-500'}`}>
              {row[labelKey]}
            </span>
            <div className="flex-1 h-3.5 bg-[#0a1628] rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${(row[valueKey] / max) * 100}%`,
                  background: active ? colour : '#25405e',
                }}
              />
            </div>
            <span className={`w-14 shrink-0 text-[11px] font-mono ${active ? 'text-brand-600 font-bold' : 'text-slate-500'}`}>
              {row[valueKey]} {unit}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const REF_TABS = [
  { key: 'brief', label: 'Brief' },
  { key: 'load',  label: 'Load' },
  { key: 'fuel',  label: 'Fuel' },
]

function ReferencePanel({ round }) {
  const [tab, setTab] = useState('load')
  const f = round.flight
  const p = round.partner
  // On a speed round the manifest is missing, so lighting a row would answer
  // the question the player is being asked.
  const activeWeight = round.show.weight ? f.weightRow : null
  const activeMpm = round.show.weight ? f.mpm : null

  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg overflow-hidden">
      <div className="flex border-b border-[#1a3a5c] bg-[#0a1628]">
        {REF_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${
              tab === t.key ? 'text-brand-600 border-b-2 border-brand-600' : 'text-slate-500 hover:text-[#ddeaf8]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-2.5">
        {tab === 'brief' && (
          <div className="space-y-1.5 text-[11px] text-[#ddeaf8] leading-snug">
            <p>Round and estimate. Close answers still score.</p>
            <p><span className="text-brand-600 font-bold">Weight gives you speed</span> on the aircraft&apos;s own Load chart. The chart steps in hundreds, so read the nearest row.</p>
            <p><span className="text-brand-600 font-bold">Speed gives you economy</span> on the Fuel chart. Fuel = distance divided by miles per gallon.</p>
            <p>A weather leg&apos;s revised speed is <span className="text-brand-600 font-bold">given to you</span> in the flight data. Look it up, do not work it out.</p>
            <p className="text-slate-400">Press Enter to commit an answer. The clock runs whether or not you have submitted.</p>
          </div>
        )}

        {tab === 'load' && (
          <div className="space-y-2.5">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                {ANT_HARD_AIRCRAFT[f.aircraftId].name} · kg to miles/min
              </p>
              <BarChart
                rows={ANT_HARD_AIRCRAFT[f.aircraftId].loads}
                labelKey="weight" valueKey="mpm" unit="mi/min"
                activeLabel={activeWeight}
              />
            </div>
            {p && (
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                  {ANT_HARD_AIRCRAFT[p.aircraftId].name} · kg to miles/min
                </p>
                <BarChart
                  rows={ANT_HARD_AIRCRAFT[p.aircraftId].loads}
                  labelKey="weight" valueKey="mpm" unit="mi/min"
                  activeLabel={p.weightRow}
                  colour={PARTNER_COLOUR}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'fuel' && (
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Miles/min to miles per gallon</p>
            <BarChart
              rows={ANT_HARD_FUEL}
              labelKey="mpm" valueKey="mpg" unit="mpg"
              activeLabel={activeMpm}
            />
            <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">
              Economy follows speed, not weight. A slower leg is a thriftier one.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Flight data ──────────────────────────────────────────────────────────────
function FlightTable({ flight, round, partner = false }) {
  const colour = partner ? 'text-amber-300' : 'text-brand-600'
  const hideDepart = partner ? !round.show.partnerDepart : !round.show.departTime
  const hideArrive = !partner && !round.show.arriveTime
  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg overflow-hidden">
      <div className="flex items-baseline justify-between px-2 py-1 border-b border-[#1a3a5c] bg-[#0a1628]">
        <p className={`text-[11px] font-bold uppercase tracking-wide ${colour}`}>{flight.name}</p>
        <p className="text-[10px] text-slate-500 font-mono">
          {round.show.weight || partner
            ? `${flight.weightStated} kg`
            : <span className="text-amber-400">manifest missing</span>}
        </p>
      </div>

      <table className="w-full text-[11px] font-mono">
        <thead className="text-slate-500">
          <tr>
            <th className="px-2 py-1 text-left font-normal">Leg</th>
            <th className="px-2 py-1 text-right font-normal">Miles</th>
            <th className="px-2 py-1 text-left font-normal">Weather</th>
            <th className="px-2 py-1 text-right font-normal">Speed</th>
          </tr>
        </thead>
        <tbody className="text-[#ddeaf8]">
          {flight.legs.map((leg, i) => {
            const w = ANT_HARD_WEATHER[leg.weather]
            return (
              <tr key={i} className="border-t border-[#12283f]">
                <td className="px-2 py-1">{leg.from.slice(0, 3).toUpperCase()}–{leg.to.slice(0, 3).toUpperCase()}</td>
                <td className="px-2 py-1 text-right">
                  {round.show.legMiles ? leg.miles : <span className="text-amber-400">?</span>}
                </td>
                <td className={`px-2 py-1 ${leg.weather === 'storm' ? 'text-red-300' : leg.weather === 'tailwind' ? 'text-green-300' : 'text-slate-500'}`}>
                  {w.icon ? `${w.icon} ${w.label}` : w.label}
                </td>
                <td className="px-2 py-1 text-right">
                  {round.show.legSpeed || partner
                    ? <span className={leg.weather === 'clear' ? '' : 'text-brand-600 font-bold'}>{leg.mpm} mi/min</span>
                    : <span className="text-amber-400">?</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-2 py-1 border-t border-[#1a3a5c] bg-[#0a1628] text-[11px] font-mono">
        <span className="text-slate-500">
          Depart <span className="text-[#ddeaf8]">
            {hideDepart || flight.departMin == null ? <span className="text-amber-400">?</span> : formatHHMM(flight.departMin)}
          </span>
        </span>
        {!partner && (
          <span className="text-slate-500">
            Arrive <span className="text-[#ddeaf8]">
              {hideArrive ? <span className="text-amber-400">?</span> : formatHHMM(flight.arriveMin)}
            </span>
          </span>
        )}
        {!partner && round.show.fuelOnBoard && (
          <span className="text-slate-500">
            Fuel on board <span className="text-[#ddeaf8]">{flight.fuelOnBoard} gal</span>
          </span>
        )}
      </div>
    </div>
  )
}

// ── Worked solution ──────────────────────────────────────────────────────────
function SolutionBreakdown({ round }) {
  const steps = solutionSteps(round)
  return (
    <div className="w-full mt-3 bg-[#060e1a]/70 border border-[#1a3a5c] rounded-lg p-2.5 text-left">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">How it&apos;s worked out</p>
      <ol className="space-y-2">
        {steps.map(step => (
          <li key={step.n}>
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-mono">
              <span className="text-slate-500 shrink-0">{step.n}.</span>
              <span className="text-slate-500 w-[6.5rem] shrink-0">{step.label}</span>
              {step.tokens.map((tok, j) => (
                <span key={j} className="px-1 text-brand-600 font-bold">{tok}</span>
              ))}
              <span className="text-slate-500">=</span>
              <span className="text-[#ddeaf8] font-bold">{step.result}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug ml-[1.15rem] mt-0.5">{step.note}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Results ──────────────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime, totalScore }) {
  const exact = answers.filter(a => a.exact).length
  const partial = answers.filter(a => a.partial).length
  const miss = answers.length - exact - partial
  const grade = gradeForScore(totalScore)
  const pct = Math.round((totalScore / (ANT_HARD_ROUNDS * 10)) * 100)
  const gradeStyle =
    grade === 'Outstanding' ? { emoji: '🎖️', color: 'text-green-400' }
    : grade === 'Good' ? { emoji: '✈️', color: 'text-brand-600' }
    : grade === 'Needs Work' ? { emoji: '🔧', color: 'text-amber-400' }
    : { emoji: '💥', color: 'text-red-400' }

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{gradeStyle.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${gradeStyle.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-6">ANT (Hard) Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-4">
        <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{pct}%</p>
        <p className="text-sm text-slate-400">accuracy</p>
        <p className="text-xs text-slate-500 mt-3">
          Exact <span className="text-green-400 font-mono">{exact}</span>
          <span className="text-slate-600 mx-2">·</span>
          Close <span className="text-amber-400 font-mono">{partial}</span>
          <span className="text-slate-600 mx-2">·</span>
          Miss <span className="text-red-400 font-mono">{miss}</span>
          <span className="text-slate-600 mx-2">·</span>
          Total <span className="text-brand-600 font-mono">{totalTime.toFixed(1)}s</span>
        </p>
      </div>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-h-56 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Round Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => {
            const color = a.exact ? 'text-green-400' : a.partial ? 'text-amber-400' : 'text-red-400'
            const icon = a.exact ? '✓' : a.partial ? '∼' : '✗'
            return (
              <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${color}`}>
                <span className="text-slate-500 w-6 shrink-0 text-left">#{i + 1}</span>
                <span className="w-20 shrink-0 text-left">{ANT_HARD_QUESTIONS[a.type].short}</span>
                <span className="shrink-0">{icon}</span>
                <span className="flex-1 min-w-0 font-mono text-[11px] text-right truncate">
                  <span className="text-slate-400">{a.userInput || '—'}</span>
                  <span className="text-slate-600 mx-1">→</span>
                  <span className="text-brand-600">{a.correctText}</span>
                </span>
                <span className="font-mono text-slate-500 w-12 shrink-0 text-right">
                  {a.points} pt{a.points === 1 ? '' : 's'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── The run ──────────────────────────────────────────────────────────────────
export default function AntHardGame({ tuning, onExit }) {
  const { apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  const [phase, setPhase] = useState('playing')  // playing | feedback | results
  const [round, setRound] = useState(null)
  const [roundIndex, setRoundIndex] = useState(0)
  const [answers, setAnswers] = useState([])
  const [answerInput, setAnswerInput] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [roundElapsed, setRoundElapsed] = useState(0)
  const [totalElapsed, setTotalElapsed] = useState(0)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  const answersRef = useRef([])
  const roundIndexRef = useRef(0)
  const roundStartRef = useRef(0)
  const tickRef = useRef(null)
  const inputRef = useRef(null)
  const nextRef = useRef(null)
  // The round clock fires from an interval set up when the round started, so it
  // can only see the answer box as it was then. Mirror the live value and the
  // live submit handler into refs, or a timeout scores a typed answer as blank.
  const answerRef = useRef('')
  const submitRef = useRef(null)

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { roundIndexRef.current = roundIndex }, [roundIndex])
  useEffect(() => { answerRef.current = answerInput }, [answerInput])

  const fetchBest = useCallback(() => {
    apiFetch(`${API}/api/games/cbat/${tuning.gameKey}/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [apiFetch, API, tuning.gameKey])

  const startRound = useCallback((idx) => {
    setRound(buildRound(idx + 1))
    setAnswerInput('')
    answerRef.current = ''
    setFeedback(null)
    setRoundIndex(idx)
    roundIndexRef.current = idx
    setRoundElapsed(0)
    roundStartRef.current = Date.now()
    setPhase('playing')
    if (!IS_TOUCH) setTimeout(() => { inputRef.current?.focus() }, 50)
  }, [])

  // First round on mount — the difficulty card already pressed Start.
  useEffect(() => {
    startTracking(tuning.gameKey)
    fetchBest()
    startRound(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'playing') { clearInterval(tickRef.current); return }
    tickRef.current = setInterval(() => {
      const el = (Date.now() - roundStartRef.current) / 1000
      setRoundElapsed(el)
      if (el >= ANT_HARD_ROUND_TIME) {
        clearInterval(tickRef.current)
        submitRef.current?.(true)
      }
    }, 100)
    return () => clearInterval(tickRef.current)
  }, [phase])

  useEffect(() => () => clearInterval(tickRef.current), [])

  const submitScore = useCallback((finalAnswers, finalTime) => {
    const totalScore = finalAnswers.reduce((s, a) => s + a.points, 0)
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: totalScore })
    submitCbatResult(tuning.gameKey, {
      totalScore,
      exactCount: finalAnswers.filter(a => a.exact).length,
      partialCount: finalAnswers.filter(a => a.partial).length,
      missCount: finalAnswers.filter(a => !a.exact && !a.partial).length,
      roundsPlayed: finalAnswers.length,
      totalTime: finalTime,
      grade: gradeForScore(totalScore),
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchBest()
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted, tuning.gameKey, fetchBest])

  const endGame = useCallback((finalAnswers) => {
    clearInterval(tickRef.current)
    const total = finalAnswers.reduce((s, a) => s + a.roundTime, 0)
    submitScore(finalAnswers, total)
    setTotalElapsed(total)
    setPhase('results')
  }, [submitScore])

  const handleSubmit = useCallback((timedOut = false) => {
    if (phase !== 'playing' || !round) return
    const typed = timedOut ? answerRef.current : answerInput
    if (!timedOut && typed.trim() === '') return
    clearInterval(tickRef.current)
    const roundTime = Math.min((Date.now() - roundStartRef.current) / 1000, ANT_HARD_ROUND_TIME)
    const result = scoreAnswer(round, typed)

    const updated = [...answersRef.current, {
      type: round.type,
      userInput: typed,
      correctText: formatAnswer(round),
      roundTime,
      ...result,
    }]
    setAnswers(updated)
    answersRef.current = updated
    setFeedback({ ...result, type: round.type, user: typed, timedOut })
    setPhase('feedback')
  }, [phase, round, answerInput])

  useEffect(() => { submitRef.current = handleSubmit }, [handleSubmit])

  const advanceRound = useCallback(() => {
    const next = roundIndexRef.current + 1
    if (next >= ANT_HARD_ROUNDS) endGame(answersRef.current)
    else startRound(next)
  }, [startRound, endGame])

  const playAgain = useCallback(() => {
    setAnswers([])
    answersRef.current = []
    setTotalElapsed(0)
    setScoreSaved(false)
    startTracking(tuning.gameKey)
    startRound(0)
  }, [startRound, startTracking, tuning.gameKey])

  const reviewing = phase === 'feedback' && !!feedback && !!round

  // Focus the continue button so a keyboard player carries on with Enter —
  // delayed so the Enter that submitted the answer can't skip the debrief.
  useEffect(() => {
    if (!reviewing || IS_TOUCH) return
    const t = setTimeout(() => nextRef.current?.focus(), 150)
    return () => clearTimeout(t)
  }, [reviewing])

  const timeLeft = Math.max(0, ANT_HARD_ROUND_TIME - roundElapsed)
  const timePct = (timeLeft / ANT_HARD_ROUND_TIME) * 100
  const scoreSoFar = answers.reduce((s, a) => s + a.points, 0)

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <CbatQuitButton onConfirm={onExit} confirmNeeded={phase !== 'results'} />
        <h1 className="text-sm font-extrabold text-slate-900">ANT</h1>
        <ModeMarker mode={tuning} />
      </div>

      <div className="flex flex-col items-center">
        {phase === 'results' ? (
          <CbatGameOver
            gameKey={tuning.gameKey}
            score={scoreSoFar}
            time={totalElapsed}
            scoreSaved={scoreSaved}
            queued={queued}
            personalBest={personalBest}
            onPlayAgain={playAgain}
          >
            <ResultsScreen answers={answers} totalTime={totalElapsed} totalScore={scoreSoFar} />
          </CbatGameOver>
        ) : round && (
          <div className="w-full max-w-5xl">
            {/* HUD */}
            <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
              <span className="text-slate-400">
                Round <span className="text-brand-600">{roundIndex + 1}</span>/{ANT_HARD_ROUNDS}
              </span>
              <span className="text-slate-400">
                Score <span className="text-brand-600">{scoreSoFar}</span>
              </span>
              <span className="text-slate-400">
                {reviewing
                  ? <span className="text-brand-600">Reviewing — clock paused</span>
                  : <>⏱ <span className={timeLeft < 10 ? 'text-red-400' : 'text-brand-600'}>{timeLeft.toFixed(1)}s</span></>}
              </span>
            </div>

            <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${reviewing ? 'bg-brand-600/40' : timeLeft < 10 ? 'bg-red-500' : 'bg-brand-600'}`}
                initial={false}
                animate={{ width: `${reviewing ? 100 : timePct}%` }}
                transition={{ duration: 0.1, ease: 'linear' }}
              />
            </div>

            <ObjectiveBox round={round} />

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="md:col-span-2 bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Map</p>
                <AntHardMap round={round} />
              </div>

              <div className="md:col-span-3 flex flex-col gap-3">
                <FlightTable flight={round.flight} round={round} />
                {round.partner && <FlightTable flight={round.partner} round={round} partner />}

                <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Solve For</p>
                  <p className="text-lg font-bold text-brand-600">
                    {ANT_HARD_QUESTIONS[round.type].label}
                    <span className="text-xs text-slate-500 font-mono font-normal ml-2">
                      ({ANT_HARD_QUESTIONS[round.type].unit})
                    </span>
                  </p>
                </div>

                <ReferencePanel round={round} />

                <div className="min-h-[9rem] sm:min-h-[5.25rem] flex">
                  {reviewing ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={`flex-1 rounded-xl border p-3 flex flex-col items-center ${
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
                          ? `✓ Exact  +${feedback.points} pts`
                          : feedback.partial
                          ? `∼ Close (${ANT_HARD_CLOSE_BAND[feedback.type]?.label})  +${feedback.points} pts`
                          : feedback.timedOut
                          ? '⏱ Time up'
                          : '✗ Off'}
                      </p>
                      <p className="text-xs font-mono text-slate-300 mt-1">
                        Correct: <span className="text-brand-600 font-bold">{formatAnswer(round)}</span>
                        {feedback.user && (
                          <>
                            <span className="text-slate-600 mx-2">·</span>
                            You: <span className={feedback.exact ? 'text-green-300' : 'text-slate-400'}>{feedback.user}</span>
                          </>
                        )}
                      </p>

                      <SolutionBreakdown round={round} />

                      <button
                        ref={nextRef}
                        onClick={advanceRound}
                        className="mt-3 w-full sm:w-auto px-8 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
                      >
                        {roundIndex + 1 >= ANT_HARD_ROUNDS ? 'See Results →' : 'Next Round →'}
                      </button>
                    </motion.div>
                  ) : (
                    <div className="flex-1 bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Answer</p>
                      <div className="flex items-center gap-2">
                        <input
                          ref={inputRef}
                          type="text"
                          inputMode="numeric"
                          autoFocus={!IS_TOUCH}
                          value={answerInput}
                          onChange={(e) => setAnswerInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(false) }}
                          placeholder={ANT_HARD_QUESTIONS[round.type].unit}
                          className="flex-1 min-w-0 bg-[#060e1a] border border-[#1a3a5c] rounded-lg px-3 py-2 text-white font-mono text-lg focus:outline-none focus:border-brand-400"
                        />
                        <button
                          onClick={() => handleSubmit(false)}
                          className="shrink-0 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
