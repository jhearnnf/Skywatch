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
import {
  buildRound,
  scoreAnswer,
  CLOSE_BAND,
  solutionSteps,
  solutionAnchors,
  gradeForScore,
  formatHHMM,
  ANT_NODES,
  ANT_EDGES,
  ANT_NODE_POS,
  ANT_LABEL_OFFSETS,
  WEIGHT_TABLE,
  QUESTION_META,
} from '../utils/antGenerator'

const ROUND_COUNT = 8
const ROUND_TIME = 60            // seconds per round

const IS_TOUCH = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(hover: none) and (pointer: coarse)').matches

// ── Map ───────────────────────────────────────────────────────────────────────
function JourneyMap({ round, pillAnchor, reveal = false, highlight = null }) {
  const activeEdges = new Set([
    [round.start, round.via].sort().join('-'),
    [round.via, round.destination].sort().join('-'),
  ])

  return (
    <svg viewBox="-50 0 580 420" preserveAspectRatio="xMidYMid meet" className="w-full h-auto md:h-full md:flex-1 md:min-h-0" aria-label="Journey map">
      {/* Edges */}
      {ANT_EDGES.map(([a, b]) => {
        const key = [a, b].sort().join('-')
        const active = activeEdges.has(key)
        const pa = ANT_NODE_POS[a]
        const pb = ANT_NODE_POS[b]
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

      {/* Distance labels — only on active segments. Hidden legs come back in the
          post-round debrief so the player can see where the answer came from. */}
      {(round.show.segments || reveal) && (
        <>
          <DistanceLabel
            a={round.start} b={round.via} miles={round.seg1}
            anchor={pillAnchor || 'seg1'} flash={!!highlight?.has('seg1')}
          />
          <DistanceLabel
            a={round.via} b={round.destination} miles={round.seg2}
            anchor={pillAnchor || 'seg2'} flash={!!highlight?.has('seg2')}
          />
        </>
      )}

      {/* Nodes */}
      {ANT_NODES.map(name => {
        const p = ANT_NODE_POS[name]
        const off = ANT_LABEL_OFFSETS[name]
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

function DistanceLabel({ a, b, miles, anchor, flash = false }) {
  const pa = ANT_NODE_POS[a]
  const pb = ANT_NODE_POS[b]
  const mx = (pa.x + pb.x) / 2
  const my = (pa.y + pb.y) / 2
  return (
    <g>
      <rect
        x={mx - 31} y={my - 16} width={62} height={32} rx={5}
        fill="#0a1628" stroke="#5baaff" strokeWidth={1.5}
        className={flash ? 'cbat-pill-flash' : undefined}
        data-anchor={anchor || undefined}
      />
      <text x={mx} y={my + 9} textAnchor="middle" fontSize="26" fontFamily="monospace" fill="#5baaff" fontWeight="bold">
        {miles}
      </text>
    </g>
  )
}

// ── Weight reference table ────────────────────────────────────────────────────
function WeightTable({ currentWeight, flashActive = false, cueAnchors = false, highlight = null }) {
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
              <tr key={row.weight} className={active ? `bg-[#102040] text-brand-300 font-bold${flashActive ? ' cbat-cell-flash' : ''}` : 'text-[#ddeaf8]'}>
                <td className="px-2 py-0.5">{row.weight}</td>
                <td
                  className={`px-2 py-0.5 text-right${active && highlight?.has('mpm') ? ' cbat-cell-flash' : ''}`}
                  data-anchor={cueAnchors && active ? 'mpm' : undefined}
                >
                  {row.mpm}
                </td>
                <td
                  className={`px-2 py-0.5 text-right${active && highlight?.has('gph') ? ' cbat-cell-flash' : ''}`}
                  data-anchor={cueAnchors && active ? 'gph' : undefined}
                >
                  {row.gph}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Data table ────────────────────────────────────────────────────────────────
function DataTable({ round, flashWeight = false, cueAnchors = false, highlight = null, reveal = false }) {
  const hasParcel = round.show.parcel
  const hl = name => (highlight?.has(name) ? ' cbat-cell-flash' : '')
  const showArrival = round.show.arrivalTime || reveal
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
            <td className={`px-2 py-2 border-l border-[#1a3a5c]${hl('now')}`} data-anchor={cueAnchors && round.show.timeNow ? 'now' : undefined}>
              {round.show.timeNow ? formatHHMM(round.timeNowMin) : <span className="text-amber-400">?</span>}
            </td>
            <td className={`px-2 py-2${hl('arrive')}`} data-anchor={cueAnchors && round.show.arrivalTime ? 'arrive' : undefined}>
              {showArrival
                ? <span className={round.show.arrivalTime ? undefined : 'text-brand-300 font-bold'}>{formatHHMM(round.arrivalMin)}</span>
                : <span className="text-amber-400">?</span>}
            </td>
            <td className="px-2 py-2 border-l border-[#1a3a5c]">
              {hasParcel ? 'Y' : 'N'}
            </td>
            <td className="px-2 py-2" data-anchor={cueAnchors && hasParcel && round.show.weight ? 'weightkg' : undefined}>
              {hasParcel && round.show.weight
                ? (flashWeight
                    ? <span className="cbat-cell-flash inline-block px-1.5 font-bold text-brand-300">{round.weight}</span>
                    : round.weight)
                : <span className="text-slate-600">—</span>}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Worked solution ───────────────────────────────────────────────────────────
// The debrief line-by-line. Values that live on the board carry the same pulse
// as the cell they came from (see solutionAnchors → cbat-cell-flash), so the
// player can follow a number from the sum back to where it was read.
function SolutionBreakdown({ round }) {
  const steps = solutionSteps(round)
  return (
    <div className="w-full mt-3 bg-[#060e1a]/70 border border-[#1a3a5c] rounded-lg p-2.5 text-left">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">How it's worked out</p>
      <ol className="space-y-2">
        {steps.map(step => (
          <li key={step.n}>
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-mono">
              <span className="text-slate-500 shrink-0">{step.n}.</span>
              <span className="text-slate-500 w-[5.5rem] shrink-0">{step.label}</span>
              {step.tokens.map((tok, j) => (
                typeof tok === 'string'
                  ? <span key={j} className="text-slate-400">{tok}</span>
                  : <span key={j} className="px-1 text-brand-300 font-bold cbat-cell-flash">{tok.text}</span>
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

// ── Results screen ────────────────────────────────────────────────────────────
function ResultsScreen({ answers, totalTime, totalScore }) {
  const exact = answers.filter(a => a.exact).length
  const partial = answers.filter(a => a.partial).length
  const miss = answers.length - exact - partial
  const grade = gradeForScore(totalScore)
  const maxScore = ROUND_COUNT * 10
  const pct = Math.round((totalScore / maxScore) * 100)
  const gradeStyle =
    grade === 'Outstanding' ? { emoji: '\u{1F396}️', color: 'text-green-400' }
    : grade === 'Good' ? { emoji: '✈️', color: 'text-brand-300' }
    : grade === 'Needs Work' ? { emoji: '\u{1F527}', color: 'text-amber-400' }
    : { emoji: '\u{1F4A5}', color: 'text-red-400' }

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{gradeStyle.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${gradeStyle.color}`}>{grade}</p>
      <p className="text-sm text-slate-400 mb-6">ANT Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-4">
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-300 mb-1">{pct}%</p>
            <p className="text-sm text-slate-400">accuracy</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Exact <span className="text-green-400 font-mono">{exact}</span>
          <span className="text-slate-600 mx-2">{'·'}</span>
          Close <span className="text-amber-400 font-mono">{partial}</span>
          <span className="text-slate-600 mx-2">{'·'}</span>
          Miss <span className="text-red-400 font-mono">{miss}</span>
          <span className="text-slate-600 mx-2">{'·'}</span>
          Total <span className="text-brand-300 font-mono">{totalTime.toFixed(1)}s</span>
        </p>
      </div>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-h-56 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Round Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => {
            const label = QUESTION_META[a.type].short
            const color = a.exact ? 'text-green-400' : a.partial ? 'text-amber-400' : 'text-red-400'
            const icon = a.exact ? '✓' : a.partial ? '∼' : '✗'
            return (
              <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${color}`}>
                <span className="text-slate-500 w-6 shrink-0 text-left">#{i + 1}</span>
                <span className="w-14 shrink-0 text-left">{label}</span>
                <span className="shrink-0">{icon}</span>
                <span className="flex-1 min-w-0 font-mono text-[11px] text-right truncate">
                  <span className="text-slate-400">{a.userInput || '—'}</span>
                  <span className="text-slate-600 mx-1">{'→'}</span>
                  <span className="text-brand-300">
                    {a.type === 'arrival' ? formatHHMM(a.correctAnswer) : a.correctAnswer}
                  </span>
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

// ── Tutorial / practice mode ──────────────────────────────────────────────────
// Progressive walkthrough modelled on the CBAT Target practice mode: a coach card
// with prev/next navigation sits above a fixed practice arena that mirrors the
// live layout. Each step lights only the panels it's teaching and dims/locks the
// rest. The two orientation steps advance via a Next button; the four solve steps
// grade the typed answer (via the live scoreAnswer) and auto-advance on a match.
//
// One fixed journey underlies every step so the coaching copy always matches the
// on-screen numbers: Tango → Victor → Romeo, 72 + 72 miles, 200 kg parcel
// (6 mi/min, 5 gal/hr), depart 1000 arrive 1024 (24-minute flight). Like every
// live round, the journey is chosen so all four answers are whole numbers —
// 1024, 144 miles, 2 gallons, 360 mph.
const TUT_BASE = {
  start: 'Tango', via: 'Victor', destination: 'Romeo',
  seg1: 72, seg2: 72, totalDistance: 144,
  weight: 200, mpm: 6, gph: 5,
  timeNowMin: 600, arrivalMin: 624,
}
const TUT_FULL_SHOW = { segments: true, timeNow: true, arrivalTime: true, weight: true, parcel: true }
const TUT_TRAVEL = TUT_BASE.arrivalMin - TUT_BASE.timeNowMin // 20 minutes

// Derive a solve round for one question type, hiding the same fields the live
// buildRound() hides so the practice picture matches the real game exactly.
function tutorialRound(type) {
  const show = { ...TUT_FULL_SHOW }
  let correctAnswer = 0
  if (type === 'arrival') {
    correctAnswer = TUT_BASE.arrivalMin
    show.arrivalTime = false
  } else if (type === 'distance') {
    correctAnswer = TUT_TRAVEL * TUT_BASE.mpm
    show.segments = false
  } else if (type === 'fuel') {
    correctAnswer = (TUT_TRAVEL * TUT_BASE.gph) / 60
  } else if (type === 'speed') {
    correctAnswer = TUT_BASE.mpm * 60
    show.weight = false
    show.parcel = false
  }
  return { ...TUT_BASE, type, correctAnswer, show }
}
// A fully-revealed round for the reading steps (nothing hidden).
const TUT_READING_ROUND = { ...TUT_BASE, type: 'speed', correctAnswer: 0, show: { ...TUT_FULL_SHOW } }

const ALL_PANELS = { map: true, data: true, solve: true, weight: true, answer: true }

// A number in the coaching copy that a connector line links to its on-screen
// source. `id` must match a `data-anchor` stamped on the panel value it comes
// from; the overlay draws a line only when a matching visible anchor exists.
function Cue({ id, children }) {
  return <b data-cue={id} className="cbat-cue text-brand-300 font-bold">{children}</b>
}

const ANT_TUTORIAL_STEPS = [
  {
    enabled: { map: true },
    focus: ['map'],
    title: 'Read the route',
    body: (
      <>
        Every round you fly a parcel across the network. The <b className="text-green-400">green</b> node
        is your <b className="text-brand-300">start</b>, the <b className="text-amber-400">amber</b> node is
        the <b className="text-brand-300">via</b> point you route through, and the <b className="text-red-400">red</b> node
        is the <b className="text-brand-300">destination</b>. The two active legs are drawn in blue, each with
        a <b className="text-brand-300">distance pill</b> — here 72 and 72, so the whole trip is 144 miles.
      </>
    ),
  },
  {
    enabled: { map: true, data: true, weight: true },
    focus: ['data', 'weight'],
    dim: ['map'],
    flashParcel: true,
    title: 'Read the flight data',
    body: (
      <>
        The <b className="text-brand-300">Journey</b> columns repeat the route. <b className="text-brand-300">Timings</b> give
        the current time (<b className="text-brand-300">Now</b>) and <b className="text-brand-300">Arrive</b> time in 24-hour
        HHMM. <b className="text-brand-300">Parcel</b> shows its weight in kg — and that weight sets your pace.
        Read it off the <b className="text-brand-300">Weight Reference</b>: 200 kg means <b className="text-brand-300">6 miles/min</b> and{' '}
        <b className="text-brand-300">5 gal/hr</b> (the matching row is highlighted).
      </>
    ),
  },
  {
    solve: 'arrival',
    enabled: ALL_PANELS,
    focus: ['solve', 'answer'],
    title: 'Solve: Arrival Time',
    body: (
      <>
        Find the <b className="text-brand-300">Arrival Time</b>. First the flight time: distance ÷ speed ={' '}
        <Cue id="distance">144</Cue> ÷ <Cue id="mpm">6</Cue> = 24 min. Add that to <b className="text-brand-300">Now</b>{' '}
        (<Cue id="now">1000</Cue>) and enter the result as <b className="text-brand-300">HHMM</b>.
      </>
    ),
  },
  {
    solve: 'distance',
    enabled: ALL_PANELS,
    focus: ['solve', 'answer'],
    title: 'Solve: Total Distance',
    body: (
      <>
        The leg distances are <b className="text-amber-400">hidden</b> this time — work back from the clock.
        Flight time = Arrive − Now = <Cue id="arrive">1024</Cue> − <Cue id="now">1000</Cue> = 24 min. Distance ={' '}
        flight time × speed = 24 × <Cue id="mpm">6</Cue>. Enter it in <b className="text-brand-300">miles</b>.
      </>
    ),
  },
  {
    solve: 'fuel',
    enabled: ALL_PANELS,
    focus: ['solve', 'answer'],
    title: 'Solve: Fuel',
    body: (
      <>
        Fuel burn uses <b className="text-brand-300">gal/hr</b>, not miles. <Cue id="weightkg">200</Cue> kg burns{' '}
        <Cue id="gph">5</Cue> gal/hr, and you're in the air 24 of the 60 minutes in an hour. So fuel =
        5 × 24 ÷ 60. Enter it in <b className="text-brand-300">gallons</b> — journeys are always set so this
        lands on a whole number.
      </>
    ),
  },
  {
    solve: 'speed',
    enabled: ALL_PANELS,
    focus: ['solve', 'answer'],
    title: 'Solve: Speed',
    body: (
      <>
        No parcel this round, so no weight table — you're given the distances instead. Speed ={' '}
        total distance × 60 ÷ flight-time minutes. Total = 72 + 72 = <Cue id="distance">144</Cue>,
        flight time = <b className="text-brand-300">24 min</b>. Enter the speed in <b className="text-brand-300">mph</b>.
      </>
    ),
  },
]

// Per-playthrough id for tutorial usage tracking; the backend dedupes on it.
function makeTutorialRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `tut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function LockedPanel({ label, className = '' }) {
  return (
    <div className={`cbat-tutorial-disabled w-full h-full bg-[#0a1628] border border-[#15293f] rounded-lg flex items-center justify-center select-none ${className}`}>
      <span className="text-[10px] uppercase tracking-wide text-slate-600 flex items-center gap-1">
        {'\u{1F512}'} {label}
      </span>
    </div>
  )
}

function TutorialComplete({ onExit }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-5xl mb-3">✅</p>
      <p className="text-2xl font-extrabold text-white mb-1">Tutorial Complete</p>
      <p className="text-sm text-slate-400 mb-6">You've got the four calculations down — now try it for real.</p>
      <button
        onClick={onExit}
        className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
      >
        Back to Instructions
      </button>
    </motion.div>
  )
}

function AntTutorial({ onExit, onProgress }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [runId] = useState(makeTutorialRunId)
  const [answerInput, setAnswerInput] = useState('')
  const [flash, setFlash] = useState(null) // 'ok' | 'miss' | null
  const inputRef = useRef(null)

  // Connector overlay — draws a line from each instruction number (a [data-cue])
  // to its on-screen source (a matching [data-anchor]). Recomputed on step change
  // and on resize once the layout settles.
  const containerRef = useRef(null)
  const [links, setLinks] = useState([])
  const [overlaySize, setOverlaySize] = useState({ w: 0, h: 0 })
  const measureLinks = useCallback(() => {
    const root = containerRef.current
    if (!root) return
    const base = root.getBoundingClientRect()
    const out = []
    root.querySelectorAll('[data-cue]').forEach(cueEl => {
      const id = cueEl.getAttribute('data-cue')
      const anchors = root.querySelectorAll(`[data-anchor="${id}"]`)
      if (!anchors.length) return
      const cr = cueEl.getBoundingClientRect()
      const cx = cr.left + cr.width / 2 - base.left
      const cy = cr.bottom - base.top
      anchors.forEach((aEl, i) => {
        const ar = aEl.getBoundingClientRect()
        if (ar.width === 0 && ar.height === 0) return
        // Target box (relative to container), padded so the arrow stops just
        // outside the digits rather than landing on top of them.
        const pad = 4
        const rx = ar.left - base.left
        const ry = ar.top - base.top
        const ax = rx + ar.width / 2
        const ay = ry + ar.height / 2
        const hw = ar.width / 2 + pad
        const hh = ar.height / 2 + pad
        // Walk back from the box centre toward the cue until we hit the padded
        // boundary — that intersection is where the arrowhead lands.
        const dx = cx - ax
        const dy = cy - ay
        const t = Math.min(hw / (Math.abs(dx) || 1e-3), hh / (Math.abs(dy) || 1e-3))
        out.push({
          key: `${id}-${i}`,
          x1: cx, y1: cy,
          x2: ax + dx * t, y2: ay + dy * t,
          box: { x: rx - pad, y: ry - pad, w: ar.width + 2 * pad, h: ar.height + 2 * pad },
        })
      })
    })
    setOverlaySize({ w: base.width, h: base.height })
    setLinks(out)
  }, [])

  // Report tutorial usage for the admin Reports per-step drop-off funnel. Fires on
  // entry and on every section change (forward, backward, or completion).
  useEffect(() => {
    onProgress?.({ clientRunId: runId, furthestStep: stepIdx, totalSteps: ANT_TUTORIAL_STEPS.length, completed: false })
  }, [stepIdx, runId, onProgress])
  useEffect(() => {
    if (done) onProgress?.({ clientRunId: runId, furthestStep: ANT_TUTORIAL_STEPS.length - 1, totalSteps: ANT_TUTORIAL_STEPS.length, completed: true })
  }, [done, runId, onProgress])

  const step = ANT_TUTORIAL_STEPS[stepIdx]
  const enabled = step.enabled
  const isSolve = !!step.solve
  const round = isSolve ? tutorialRound(step.solve) : TUT_READING_ROUND

  // Fresh input each time the section changes; focus it on solve steps (desktop).
  useEffect(() => {
    setAnswerInput('')
    setFlash(null)
    if (isSolve && !IS_TOUCH) setTimeout(() => inputRef.current?.focus(), 50)
  }, [stepIdx, isSolve])

  // Remeasure connectors after the section copy has settled (it animates in over
  // ~0.2s), and whenever the viewport resizes.
  useEffect(() => {
    setLinks([])
    const raf = requestAnimationFrame(measureLinks)
    const t = setTimeout(measureLinks, 340)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [stepIdx, measureLinks])
  useEffect(() => {
    const onResize = () => measureLinks()
    window.addEventListener('resize', onResize)
    let ro
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize)
      ro.observe(containerRef.current)
    }
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect() }
  }, [measureLinks])

  const focusSet = new Set(step.focus || [])
  const dimSet = new Set(step.dim || [])
  const pulse = (p) => (focusSet.has(p) ? ' cbat-tutorial-pulse' : '')
  const dim = (p) => (dimSet.has(p) ? ' cbat-tutorial-dim' : '')

  const advance = () => {
    if (stepIdx < ANT_TUTORIAL_STEPS.length - 1) setStepIdx(stepIdx + 1)
    else setDone(true)
  }
  const goToStep = (i) => { if (i >= 0 && i < ANT_TUTORIAL_STEPS.length) setStepIdx(i) }

  const submitAnswer = () => {
    if (!isSolve) return
    const res = scoreAnswer(round, answerInput)
    if (res.exact || res.partial) {
      setFlash('ok')
      setTimeout(advance, 550)
    } else {
      // Leave the miss message up until the user edits the answer (cleared in the
      // input's onChange) rather than on a timer, so it doesn't vanish instantly.
      setFlash('miss')
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center">
        <TutorialComplete onExit={onExit} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-5xl">
      {/* Connector overlay — instruction numbers → their on-screen sources */}
      {links.length > 0 && (
        <svg
          width={overlaySize.w}
          height={overlaySize.h}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 40, overflow: 'visible' }}
          aria-hidden
        >
          <defs>
            <marker id="cbatCueHead" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M0,0 L7,4.5 L0,9 Z" fill="#5baaff" />
            </marker>
          </defs>
          {links.map(l => {
            const dy = l.y2 - l.y1
            const d = `M${l.x1},${l.y1} C ${l.x1},${l.y1 + dy * 0.45} ${l.x2},${l.y2 - dy * 0.45} ${l.x2},${l.y2}`
            return (
              <g key={l.key}>
                <rect
                  x={l.box.x} y={l.box.y} width={l.box.w} height={l.box.h} rx={4}
                  className="cbat-cue-target"
                />
                <path d={d} className="cbat-cue-line" markerEnd="url(#cbatCueHead)" />
              </g>
            )
          })}
        </svg>
      )}

      {/* Coach card */}
      <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide text-brand-300 font-bold">Practice Mode</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => goToStep(stepIdx - 1)}
              disabled={stepIdx === 0}
              aria-label="Previous section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-300 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer"
            >
              {'‹'}
            </button>
            <span className="text-[10px] text-slate-500 tabular-nums">{stepIdx + 1} / {ANT_TUTORIAL_STEPS.length}</span>
            <button
              onClick={() => goToStep(stepIdx + 1)}
              disabled={stepIdx === ANT_TUTORIAL_STEPS.length - 1}
              aria-label="Next section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-300 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer"
            >
              {'›'}
            </button>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stepIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <h2 className="text-base font-extrabold text-white mb-1">{step.title}</h2>
            <p className="text-sm text-[#ddeaf8] leading-relaxed">{step.body}</p>
          </motion.div>
        </AnimatePresence>
        <div className="mt-4">
          <button onClick={onExit} className="text-xs text-slate-500 hover:text-slate-300 transition-colors bg-transparent border-0 cursor-pointer">
            Exit practice
          </button>
        </div>
      </div>

      {/* Practice arena — mirrors the live playing layout; locked panels greyed out */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {/* Left column — map */}
        <div className={`md:col-span-2 bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 flex flex-col md:min-h-0${pulse('map')}${dim('map')}`}>
          {enabled.map ? (
            <>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Map</p>
              <JourneyMap round={round} pillAnchor="distance" />
              {!round.show.segments && (
                <p className="text-[10px] text-amber-400 text-center mt-2">Distances hidden — compute total distance</p>
              )}
            </>
          ) : (
            <LockedPanel label="Map" className="min-h-[220px] md:min-h-[300px]" />
          )}
        </div>

        {/* Right column — data + tables + answer */}
        <div className="md:col-span-3 flex flex-col gap-3">
          <div className={`${pulse('data').trim()}${dim('data')}`.trim()}>
            {enabled.data ? <DataTable round={round} flashWeight={!!step.flashParcel} cueAnchors={isSolve} /> : <LockedPanel label="Journey Data" className="min-h-[72px]" />}
          </div>

          {/* Ask */}
          <div className={`bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3${pulse('solve')}${dim('solve')}`}>
            {enabled.solve ? (
              <>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Solve For</p>
                <p className="text-lg font-bold text-brand-300">
                  {QUESTION_META[round.type].label}
                  <span className="text-xs text-slate-500 font-mono font-normal ml-2">
                    ({QUESTION_META[round.type].unit})
                  </span>
                </p>
              </>
            ) : (
              <LockedPanel label="Solve For" className="min-h-[40px]" />
            )}
          </div>

          {/* Matches the live board: no parcel this round means no weight table,
              which is exactly what the speed step's copy tells the player. */}
          {round.show.parcel && (
            <div className={`${pulse('weight').trim()}${dim('weight')}`.trim()}>
              {enabled.weight
                ? <WeightTable currentWeight={round.show.weight ? round.weight : null} flashActive={!!step.flashParcel} cueAnchors={isSolve} />
                : <LockedPanel label="Weight Reference" className="min-h-[120px]" />}
            </div>
          )}

          {/* Answer */}
          <div className={`${pulse('answer').trim()}${dim('answer')}`.trim()}>
            {enabled.answer ? (
              <div className={`bg-[#0a1628] border rounded-xl p-3 transition-colors ${
                flash === 'ok' ? 'border-green-500 bg-green-500/10'
                : flash === 'miss' ? 'border-red-500'
                : 'border-[#1a3a5c]'
              }`}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Answer</p>
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    value={answerInput}
                    onChange={(e) => { setAnswerInput(e.target.value); if (flash === 'miss') setFlash(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitAnswer() }}
                    placeholder={QUESTION_META[round.type].unit}
                    className="flex-1 min-w-0 bg-[#060e1a] border border-[#1a3a5c] rounded-lg px-3 py-2 text-white font-mono text-lg focus:outline-none focus:border-brand-400"
                  />
                  <button
                    onClick={submitAnswer}
                    className="shrink-0 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors cbat-btn-flash"
                  >
                    Submit
                  </button>
                </div>
                {/* Fixed-height slot so feedback never reflows the grid (which
                    would resize the map). */}
                <div className="mt-2 min-h-[1.25rem] text-[11px] leading-tight">
                  {flash === 'miss' && (
                    <p className="text-red-400">Not quite — check the working above and try again.</p>
                  )}
                  {flash === 'ok' && (
                    <p className="text-green-400">✓ Correct</p>
                  )}
                </div>
              </div>
            ) : (
              <LockedPanel label="Answer" className="min-h-[64px]" />
            )}
          </div>
        </div>
      </div>

      {/* Reading steps advance with an explicit Next button; solve steps advance
          automatically once the typed answer is correct. */}
      {!isSolve && (
        <div className="text-center mt-4">
          <button
            onClick={advance}
            className="px-8 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CbatAnt() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  const [phase, setPhase] = useState('intro') // intro | tutorial | playing | feedback | results
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    // Hide the nav chrome during the live game and the practice tutorial.
    if (phase === 'playing' || phase === 'feedback' || phase === 'tutorial') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Fire-and-forget tutorial usage tracking (admin Reports per-step drop-off).
  // Online-only by design — a learning aid, not a score, so no offline outbox.
  const reportTutorialProgress = useCallback((body) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/ant/tutorial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  }, [user, apiFetch, API])
  const [round, setRound] = useState(null)
  const [answers, setAnswers] = useState([])
  const [roundIndex, setRoundIndex] = useState(0)
  const [roundElapsed, setRoundElapsed] = useState(0)
  const [totalElapsed, setTotalElapsed] = useState(0)
  const [answerInput, setAnswerInput] = useState('')
  const [feedback, setFeedback] = useState(null) // { points, exact, partial, correct, user }
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
  // can only see the answer box as it was then — empty. Mirror the live value
  // (and the live submit handler) into refs, or a timeout throws away whatever
  // the player had typed and scores it as a blank.
  const answerRef = useRef('')
  const submitRef = useRef(null)

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { roundIndexRef.current = roundIndex }, [roundIndex])
  useEffect(() => { answerRef.current = answerInput }, [answerInput])

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/ant/personal-best`)
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
    setQueued(false)
    markGameCompleted({ score: totalScore })
    submitCbatResult(`ant`, {
        totalScore,
        exactCount,
        partialCount,
        missCount,
        roundsPlayed: finalAnswers.length,
        totalTime: finalTime,
        grade,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/ant/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted])

  const endGame = useCallback((finalAnswers) => {
    clearInterval(tickRef.current)
    const total = finalAnswers.reduce((s, a) => s + a.roundTime, 0)
    submitScore(finalAnswers, total)
    setTotalElapsed(total)
    setPhase('results')
  }, [submitScore])

  const startRound = useCallback((idx) => {
    const r = buildRound()
    setRound(r)
    setAnswerInput('')
    answerRef.current = ''
    setFeedback(null)
    setRoundIndex(idx)
    roundIndexRef.current = idx
    setRoundElapsed(0)
    roundStartRef.current = Date.now()
    setPhase('playing')
    if (!IS_TOUCH) {
      setTimeout(() => { inputRef.current?.focus() }, 50)
    }
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
        submitRef.current?.(true)
      }
    }, 100)
    return () => clearInterval(tickRef.current)
  }, [phase])

  useEffect(() => {
    return () => clearInterval(tickRef.current)
  }, [])

  const handleSubmit = useCallback((timedOut = false) => {
    if (phase !== 'playing' || !round) return
    // Read the box, not the closure: on a timeout this handler may be older
    // than the last keystroke.
    const typed = timedOut ? answerRef.current : answerInput
    // A stray tap on Submit shouldn't burn the round.
    if (!timedOut && typed.trim() === '') return
    clearInterval(tickRef.current)
    const roundTime = Math.min((Date.now() - roundStartRef.current) / 1000, ROUND_TIME)
    const result = scoreAnswer(round, typed)

    const newAnswer = {
      type: round.type,
      userInput: typed,
      correctAnswer: round.correctAnswer,
      roundTime,
      ...result,
    }
    const updated = [...answersRef.current, newAnswer]
    setAnswers(updated)
    answersRef.current = updated
    setFeedback({ ...result, correct: round.correctAnswer, user: typed, type: round.type, timedOut })
    setPhase('feedback')
  }, [phase, round, answerInput])

  useEffect(() => { submitRef.current = handleSubmit }, [handleSubmit])

  // The debrief stays up until the player says they're ready — no auto-advance.
  const advanceRound = useCallback(() => {
    const nextIdx = roundIndexRef.current + 1
    if (nextIdx >= ROUND_COUNT) endGame(answersRef.current)
    else startRound(nextIdx)
  }, [startRound, endGame])

  const startGame = useCallback(() => {
    startTracking('ant')
    setAnswers([])
    answersRef.current = []
    setTotalElapsed(0)
    setScoreSaved(false)
    startRound(0)
  }, [startRound, startTracking])

  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    setPhase('intro')
    setRound(null)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setAnswerInput('')
    setScoreSaved(false)
  }, [])

  const timeLeft = Math.max(0, ROUND_TIME - roundElapsed)
  const timePct = (timeLeft / ROUND_TIME) * 100

  // Debrief state: the round is over but the player hasn't asked for the next
  // one yet, so the board stays up with the solution lit on it.
  const reviewing = phase === 'feedback' && !!feedback && !!round
  const solutionHighlight = reviewing ? solutionAnchors(round) : null

  // Focus the continue button so a keyboard player can carry on with Enter —
  // delayed so the Enter that submitted the answer can't skip the debrief.
  useEffect(() => {
    if (!reviewing || IS_TOUCH) return
    const t = setTimeout(() => nextRef.current?.focus(), 150)
    return () => clearTimeout(t)
  }, [reviewing])

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
    <div className="cbat-ant-page">
      <SEO title="ANT — CBAT" description="Airborne Numerical Test: speed, distance and time calculations under pressure." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={['playing', 'feedback'].includes(phase)} />
        }
        <h1 className="text-sm font-extrabold text-slate-900">ANT</h1>
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
              <p className="text-xl font-extrabold text-white mb-1">ANT</p>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Airborne Numerical Test</p>
              <p className="text-sm text-slate-400 mb-5">
                Speed, distance and time under pressure. Deliver a parcel across an eight-node network — each
                round one value is missing (Arrival Time, Total Distance, Fuel, or Speed). Calculate it from
                the data shown.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-4 text-left space-y-2">
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'⏱'}</span>
                  <span>{ROUND_COUNT} rounds, {ROUND_TIME} seconds each — the clock pauses while you review</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F9EE}'}</span>
                  <span>Speed = Distance / Time. Parcel weight sets miles/min and gal/hr.</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F3AF}'}</span>
                  <span>Exact = 10 pts, close = 5 pts, miss = 0 pts. Max score {ROUND_COUNT * 10}.</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
                  <span className="text-brand-300 font-bold shrink-0">{'\u{1F4CF}'}</span>
                  <span>
                    Every answer is a whole number. Close counts as within 5 miles, 10 mph or 2 minutes —
                    fuel must be exact. Times entered as HHMM (e.g. 1430).
                  </span>
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
                    <span className="text-slate-500 mx-1">{'·'}</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className="text-center mb-4">
                <Link to="/cbat/ant/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
                  {'View Leaderboard →'}
                </Link>
              </div>

              <div className="flex flex-wrap gap-3 justify-center">
                <button
                  onClick={() => setPhase('tutorial')}
                  className="px-6 py-3 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] font-bold rounded-lg transition-colors text-sm cursor-pointer"
                >
                  Tutorial
                </button>
                <button
                  onClick={startGame}
                  className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
                >
                  Start
                </button>
              </div>
            </motion.div>
          )}

          {/* Tutorial / practice mode */}
          {phase === 'tutorial' && (
            <AntTutorial onExit={() => setPhase('intro')} onProgress={reportTutorialProgress} />
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
                  {reviewing
                    ? <span className="text-brand-300">Reviewing — clock paused</span>
                    : <>{'⏱'} <span className={timeLeft < 10 ? 'text-red-400' : 'text-brand-300'}>{timeLeft.toFixed(1)}s</span></>}
                </span>
              </div>

              {/* Time bar */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${reviewing ? 'bg-brand-600/40' : timeLeft < 10 ? 'bg-red-500' : 'bg-brand-600'}`}
                  initial={false}
                  animate={{ width: `${reviewing ? 100 : timePct}%` }}
                  transition={{ duration: 0.1, ease: 'linear' }}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {/* Left column — map (2/5) */}
                <div className="md:col-span-2 bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-3 flex flex-col md:min-h-0">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Map</p>
                  <JourneyMap round={round} reveal={reviewing} highlight={solutionHighlight} />
                  {!round.show.segments && (
                    reviewing
                      ? <p className="text-[10px] text-brand-300 text-center mt-2">Distances now shown</p>
                      : <p className="text-[10px] text-amber-400 text-center mt-2">Distances hidden — compute total distance</p>
                  )}
                </div>

                {/* Right column — data + tables (3/5) */}
                <div className="md:col-span-3 flex flex-col gap-3">
                  <DataTable round={round} reveal={reviewing} highlight={solutionHighlight} />

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

                  {/* The parcel table is reference for the parcel you're carrying —
                      speed rounds don't have one, so showing it there just invites
                      players to solve the wrong question. */}
                  {round.show.parcel && (
                    <WeightTable currentWeight={round.show.weight ? round.weight : null} highlight={solutionHighlight} />
                  )}

                  {/* Answer input OR debrief — same fixed-height slot so the layout doesn't jump on submit */}
                  <div className="min-h-[9rem] sm:min-h-[5.25rem] flex">
                    {reviewing ? (
                      <motion.div
                        key="fb"
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
                            ? `∼ Close (${CLOSE_BAND[feedback.type]?.label})  +${feedback.points} pts`
                            : feedback.timedOut
                            ? `⏱ Time up`
                            : `✗ Off`}
                        </p>
                        <p className="text-xs font-mono text-slate-300 mt-1">
                          Correct: <span className="text-brand-300 font-bold">
                            {formatCorrect({ type: feedback.type, correctAnswer: feedback.correct })}
                          </span>
                          {feedback.user && (
                            <>
                              <span className="text-slate-600 mx-2">{'·'}</span>
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
                          {roundIndex + 1 >= ROUND_COUNT ? 'See Results →' : 'Next Round →'}
                        </button>
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
                              autoFocus={!IS_TOUCH}
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
            <CbatGameOver
              gameKey="ant"
              score={finalTotalScore}
              time={totalElapsed}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={startGame}
            >
              <ResultsScreen
                answers={answers}
                totalTime={totalElapsed}
                totalScore={finalTotalScore}
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
