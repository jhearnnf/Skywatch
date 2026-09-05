import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import { generateSatSituation, SAT_GRID, ALL_AIRCRAFT_FIELDS } from '../utils/cbat/satGenerator'
import { buildSatCards, satObserveMs } from '../utils/cbat/satCards'
import { speak, stopSpeech, primeSpeech } from '../utils/cbat/satSpeech'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import { DifficultyButton, DifficultyMarker } from '../components/CbatDifficultySelect'
import {
  SAT_DIFFICULTIES, SAT_LAUNCH_MS, satTuning, satTotalQuestions, computeGrade,
  readStoredSatDifficulty, storeSatDifficulty,
} from '../utils/cbat/satDifficulty'
import { initialDifficulty } from '../utils/cbat/difficultyParam'
import { useCbatDemo } from '../utils/cbat/demoMode'

// ── Constants ────────────────────────────────────────────────────────────────
// Situation count, question count, how many units and aircraft appear, how often
// a support call comes in and how long each card holds are all per-difficulty —
// see satDifficulty.js. The recall clock below is shared.
const PER_QUESTION_MS = 22000 // recall timer per question

// The observe phase plays a queue of single-fact cards: one contact, or one
// aircraft field, or one radio call, and nothing else on screen. How long the
// whole window runs is therefore derived from the queue, not fixed — see
// satCards.js.
function buildSituations(tuning) {
  const out = []
  for (let i = 0; i < tuning.situations; i++) {
    const sit = generateSatSituation({
      questionCount: tuning.questionsPerSituation,
      unitRange: tuning.unitRange,
      aircraftRange: tuning.aircraftRange,
      aircraftFields: tuning.aircraftFields,
      supportChance: tuning.supportChance,
    })
    out.push({ ...sit, cards: buildSatCards(sit, tuning.aircraftFields) })
  }
  return out
}

// ── Map rendering ──────────────────────────────────────────────────────────
const ALLEGIANCE_COLOR = { friendly: '#fbbf24', hostile: '#ef4444', unknown: '#e5e7eb' }
const TYPE_LETTER = { tank: 'T', helicopter: 'H', jet: 'J' }
const TYPE_LABEL = { tank: 'Tank', helicopter: 'Helicopter', jet: 'Jet' }
const HEADING_VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] } // SVG y points down

// Travel-direction arrow as a small triangle pointing `dir`, centred at (cx,cy).
function arrowPoints(cx, cy, dir, s) {
  const [vx, vy] = HEADING_VEC[dir]
  const px = -vy, py = vx // perpendicular
  const tip = [cx + vx * s, cy + vy * s]
  const b1 = [cx - vx * s + px * s * 0.75, cy - vy * s + py * s * 0.75]
  const b2 = [cx - vx * s - px * s * 0.75, cy - vy * s - py * s * 0.75]
  return [tip, b1, b2].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
}

// The 10×10 tactical grid: columns 0–9 along the top, rows A–J down the left.
function SatGrid({ units }) {
  const { COLS, ROWS } = SAT_GRID
  const N = 10
  const cell = 46
  const gx = 22, gy = 22 // label gutters
  const W = gx + N * cell
  const H = gy + N * cell
  const r = 14

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Tactical grid of units">
      <rect x="0" y="0" width={W} height={H} fill="#060e1a" />

      {/* gridlines */}
      {Array.from({ length: N + 1 }).map((_, i) => (
        <line key={`v${i}`} x1={gx + i * cell} y1={gy} x2={gx + i * cell} y2={H} stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1" />
      ))}
      {Array.from({ length: N + 1 }).map((_, i) => (
        <line key={`h${i}`} x1={gx} y1={gy + i * cell} x2={W} y2={gy + i * cell} stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1" />
      ))}

      {/* column labels 0–9, along the top */}
      {COLS.map((c, i) => (
        <text key={`c${c}`} x={gx + i * cell + cell / 2} y={gy - 7} fill="#9fb4d0" fontSize="16" fontWeight="bold" textAnchor="middle">{c}</text>
      ))}
      {/* row labels A–J, down the left */}
      {ROWS.map((rw, i) => (
        <text key={`r${rw}`} x={gx - 11} y={gy + i * cell + cell / 2 + 5} fill="#9fb4d0" fontSize="16" fontWeight="bold" textAnchor="middle">{rw}</text>
      ))}

      {/* units — caller passes only the currently-revealed one */}
      {units.filter(Boolean).map(u => {
        const colIdx = COLS.indexOf(u.col)
        const rowIdx = ROWS.indexOf(u.row)
        const cx = gx + colIdx * cell + cell / 2
        const cy = gy + rowIdx * cell + cell / 2
        const color = ALLEGIANCE_COLOR[u.allegiance]
        return (
          <g key={u.id}>
            <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity="0.18" stroke={color} strokeWidth="2.2" />
            <text x={cx} y={cy + 6} fill={color} fontSize="18" fontWeight="bold" textAnchor="middle">{TYPE_LETTER[u.type]}</text>
            {/* count badge, top-right of the marker */}
            <text x={cx + r + 2} y={cy - r + 4} fill="#ddeaf8" fontSize="15" fontWeight="bold" textAnchor="middle">{u.count}</text>
            {/* travel-direction arrow, offset from the marker on the heading side */}
            <polygon
              points={arrowPoints(cx + HEADING_VEC[u.heading][0] * (r + 6), cy + HEADING_VEC[u.heading][1] * (r + 6), u.heading, 5)}
              fill={color}
            />
          </g>
        )
      })}
    </svg>
  )
}

function GridLegend() {
  return (
    <div className="mt-2 text-xs text-slate-400 leading-relaxed">
      <p className="mb-0.5">Each cell = <span className="text-slate-300">2 km</span> · letters next to a marker show how many · arrow shows heading.</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span><span style={{ color: ALLEGIANCE_COLOR.friendly }}>■</span> Yellow = Friendly</span>
        <span><span style={{ color: ALLEGIANCE_COLOR.hostile }}>■</span> Red = Hostile</span>
        <span><span style={{ color: ALLEGIANCE_COLOR.unknown }}>■</span> White = Unknown</span>
      </div>
      <p className="mt-1 text-slate-500">Marker letter: T = Tank · H = Helicopter · J = Jet</p>
    </div>
  )
}

const WAYPOINT_ARROW = { N: '↑', S: '↓', E: '→', W: '←' }

// Each callsign owns a colour so the panel reads at a glance when it switches:
// York blue, Leeds red, Hull yellow.
const CALLSIGN_THEME = {
  York: { panel: '#0a1628', field: '#060e1a', border: '#1a3a5c', dot: '#5baaff', text: 'text-brand-600' },
  Leeds: { panel: '#1c0d12', field: '#120709', border: '#5c1f2a', dot: '#ff7b8a', text: 'text-red-300' },
  Hull: { panel: '#1a1405', field: '#120d03', border: '#5c4a12', dot: '#fbbf24', text: 'text-amber-300' },
}
const DEFAULT_THEME = CALLSIGN_THEME.York

function AircraftField({ label, children, theme = DEFAULT_THEME }) {
  return (
    <div
      className="border rounded-lg px-3 py-2.5"
      style={{ backgroundColor: theme.field, borderColor: theme.border }}
    >
      <dt className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-lg text-[#ddeaf8] font-mono">{children}</dd>
    </div>
  )
}

// One callsign at a time fills the whole panel (matching the real SAT), with a
// dots indicator showing which of the aircraft is currently displayed. The
// panel auto-switches between callsigns during the observe window.
//
// `fields` is the difficulty's aircraftFields — Easier shows altitude and comms
// channel only. It must stay in step with what the generator asks about and what
// the radio says, or the player gets questioned on something never displayed.
function AircraftPanel({ aircraft, activeIdx, fields = ALL_AIRCRAFT_FIELDS }) {
  const ac = aircraft[activeIdx % aircraft.length]
  if (!ac) return null
  const theme = CALLSIGN_THEME[ac.callsign] || DEFAULT_THEME
  return (
    <div
      className="border rounded-lg p-3 h-full flex flex-col"
      style={{ backgroundColor: theme.panel, borderColor: theme.border }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className={`text-2xl font-extrabold tracking-wide ${theme.text}`}>{ac.callsign}</p>
        <div className="flex gap-1.5">
          {aircraft.map((a, i) => (
            <span
              key={a.callsign}
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: i === activeIdx % aircraft.length ? theme.dot : theme.border }}
            />
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2 flex-1">
        {fields.includes('waypoint') && (
          <AircraftField label="Next Waypoint" theme={theme}>
            <span className="text-green-400 text-6xl font-bold leading-none align-middle mr-2">{WAYPOINT_ARROW[ac.waypointDir]}</span>
            <span className="align-middle">{ac.waypointRef}</span>
          </AircraftField>
        )}
        {fields.includes('waypointAt') && <AircraftField label="Next Waypoint At" theme={theme}>{ac.waypointAt}s</AircraftField>}
        {fields.includes('altitude') && <AircraftField label="Altitude" theme={theme}>FL{ac.altitude}</AircraftField>}
        {fields.includes('channel') && <AircraftField label="Comms Channel" theme={theme}>{ac.channel}</AircraftField>}
      </dl>
    </div>
  )
}

// ── Observe presentation ─────────────────────────────────────────────────────
// Both difficulties deliver the situation one fact at a time (see satCards.js).
// They differ in how much of the console is around that fact — the difficulty's
// `layout`:
//
//   • 'card' (Easier) — the fact fills the screen on its own. Nothing to search,
//     nothing to ignore; the only job is to remember it.
//   • 'panels' (Hard) — the whole console is on screen the whole time, grid,
//     aircraft panel and radio ticker together, but only the panel holding the
//     current fact is live. The other two sit there dimmed, showing dashes.
//     That is the real test's console: every panel visible, one datum at a time
//     inside it, so you also have to notice WHERE the new information landed.
//
// Three kinds of fact either way: a single contact on the grid, a single field
// of one controller aircraft, or a single radio call.

const FIELD_LABEL = {
  waypoint: 'Next Waypoint',
  waypointAt: 'Next Waypoint At',
  altitude: 'Altitude',
  channel: 'Comms Channel',
}

// `arrowClass` sizes the waypoint chevron. The panel layout keeps every field
// box on screen whether or not it holds a value, so its arrow has to fit the
// same height as a dash — a 6xl one there would make the panel jump every time
// the waypoint came up.
function FieldValue({ ac, field, arrowClass = 'text-6xl' }) {
  if (field === 'waypoint') return (
    <>
      <span className={`text-green-400 ${arrowClass} font-bold leading-none align-middle mr-2`}>{WAYPOINT_ARROW[ac.waypointDir]}</span>
      <span className="align-middle">{ac.waypointRef}</span>
    </>
  )
  if (field === 'waypointAt') return <>{ac.waypointAt}s</>
  if (field === 'altitude') return <>FL{ac.altitude}</>
  return <>{ac.channel}</>
}

function ObserveCard({ card }) {
  if (!card) return null

  if (card.kind === 'unit') {
    return (
      <div className="w-full max-w-sm">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 text-center">Contact — grid {card.unit.ref}</p>
        <SatGrid units={[card.unit]} />
        <GridLegend />
      </div>
    )
  }

  if (card.kind === 'field') {
    const theme = CALLSIGN_THEME[card.callsign] || DEFAULT_THEME
    return (
      <div
        className="w-full max-w-sm border rounded-xl p-5 text-center"
        style={{ backgroundColor: theme.panel, borderColor: theme.border }}
      >
        <p className={`text-3xl font-extrabold tracking-wide mb-4 ${theme.text}`}>{card.callsign}</p>
        <div className="border rounded-lg px-4 py-5" style={{ backgroundColor: theme.field, borderColor: theme.border }}>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{FIELD_LABEL[card.field]}</p>
          <p className="text-3xl text-[#ddeaf8] font-mono font-bold">
            <FieldValue ac={card.aircraft} field={card.field} />
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5 text-center">
      <p className="text-4xl mb-3">🔊</p>
      <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Radio</p>
      <p className="text-base sm:text-lg leading-snug text-green-300 font-mono break-words">{card.comm.text}</p>
    </div>
  )
}

// ── Panel layout (Hard) ──────────────────────────────────────────────────────
// The full console, always on screen. Exactly one panel is live at a time — the
// one holding the current fact — and the other two are dimmed with their values
// replaced by dashes, so a glance tells you both what the fact is and which
// instrument it arrived on.

// Dimming rather than hiding is deliberate: an idle panel has to keep its size
// and its labels, or the console reflows every 2.5s and finding the live one
// becomes a layout puzzle instead of a scanning one.
function panelChrome(live) {
  return live
    ? { className: 'border-brand-400', style: { boxShadow: '0 0 0 1px rgba(91,170,255,0.35)' } }
    : { className: 'border-[#1a3a5c] opacity-40', style: undefined }
}

function AircraftPanelSerial({ aircraft, fields, card }) {
  const live = card?.kind === 'field' ? card : null
  const theme = (live && CALLSIGN_THEME[live.callsign]) || DEFAULT_THEME
  return (
    <div
      className="border rounded-lg p-3 h-full flex flex-col"
      style={{ backgroundColor: theme.panel, borderColor: theme.border }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className={`text-2xl font-extrabold tracking-wide ${live ? theme.text : 'text-slate-600'}`}>
          {live ? live.callsign : '—'}
        </p>
        {/* One dot per aircraft in the situation. How many there are is itself a
            fact worth holding, so the dots stay lit even when the panel is idle. */}
        <div className="flex gap-1.5">
          {aircraft.map(a => (
            <span
              key={a.callsign}
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: live?.callsign === a.callsign ? theme.dot : theme.border }}
            />
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2 flex-1">
        {fields.map(f => {
          const on = live?.field === f
          return (
            <div
              key={f}
              className="border rounded-lg px-3 py-2.5"
              style={{ backgroundColor: theme.field, borderColor: on ? theme.dot : theme.border, opacity: on ? 1 : 0.35 }}
            >
              <dt className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">{FIELD_LABEL[f]}</dt>
              <dd className="text-lg text-[#ddeaf8] font-mono min-h-[1.75rem] flex items-center">
                {on ? <FieldValue ac={live.aircraft} field={f} arrowClass="text-2xl" /> : '—'}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function ObservePanels({ situation, card, fields }) {
  const gridLive = card?.kind === 'unit'
  const acLive = card?.kind === 'field'
  const radioLive = card?.kind === 'radio'
  const grid = panelChrome(gridLive)
  const radio = panelChrome(radioLive)

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <div className={`sm:flex-[3] bg-[#0a1628] border rounded-lg p-3 ${grid.className}`} style={grid.style}>
          {/* No grid ref in the header: reading "D4" off a label is much easier
              to hold than locating a dot, and locating it is what's being
              tested. Easier's card layout does print it — it's the intro. */}
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 px-0.5">Contacts</p>
          {/* SatGrid drops falsy entries, so an empty list draws the bare grid —
              the console never loses its map, it just has nothing plotted on it. */}
          <SatGrid units={gridLive ? [card.unit] : []} />
          <GridLegend />
        </div>
        <div className={`sm:flex-[2] flex flex-col ${acLive ? '' : 'opacity-40'}`}>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 px-1">Controller Aircraft</p>
          <div className={`flex-1 rounded-lg ${acLive ? 'ring-1 ring-brand-400' : ''}`}>
            <AircraftPanelSerial aircraft={situation.aircraft} fields={fields} card={card} />
          </div>
        </div>
      </div>

      <div
        className={`bg-[#0a1628] border rounded-lg px-3 py-2 mb-2 flex flex-col sm:flex-row sm:items-center gap-x-2 gap-y-1 ${radio.className}`}
        style={radio.style}
      >
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base">{radioLive ? '🔊' : '📻'}</span>
          <span className="text-xs text-slate-500 uppercase tracking-wide">Radio</span>
        </div>
        <p data-radio-line className="text-[11px] sm:text-sm leading-snug text-green-300 font-mono break-words flex-1 min-w-0">
          {radioLive ? card.comm.text : '—'}
        </p>
      </div>
    </>
  )
}

// ── Results screen (embedded inside CbatGameOver) ────────────────────────────
const GRADE_STYLE = {
  Outstanding: { emoji: '🎖️', color: 'text-green-400' },
  Good:        { emoji: '🗺️', color: 'text-brand-600' },
  'Needs Work':{ emoji: '🔧', color: 'text-amber-400' },
  Failed:      { emoji: '💥', color: 'text-red-400' },
}

function ResultsScreen({ answers, totalTime, tuning }) {
  const total = satTotalQuestions(tuning)
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / total) * 100)

  const label = computeGrade(pct, tuning)
  const grade = { label, ...GRADE_STYLE[label] }

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Situational Awareness Test Complete</p>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-5 mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Overall Score</p>
        <div className="flex justify-center gap-8 items-end">
          <div>
            <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{correct}/{total}</p>
            <p className="text-sm text-slate-400">{pct}% correct</p>
          </div>
          <div className="w-px h-12 bg-[#1a3a5c]" />
          <div>
            <p className="text-4xl font-mono font-bold text-brand-600 mb-1">{totalTime.toFixed(1)}s</p>
            <p className="text-sm text-slate-400">total time</p>
          </div>
        </div>
      </div>

      {/* Answer review — scrollable */}
      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 max-h-48 overflow-y-auto">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2 sticky top-0 bg-[#060e1a]">Answer Review</p>
        <div className="space-y-1">
          {answers.map((a, i) => (
            <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${a.correct ? 'text-green-400' : 'text-red-400'}`}>
              <span className="text-slate-500 w-6 shrink-0 text-left">#{i + 1}</span>
              <span className="shrink-0">{a.correct ? '✓' : '✗'}</span>
              <span className="font-mono shrink-0">{a.answer}</span>
              <span className="text-slate-500 truncate text-left flex-1">{a.picked === null ? 'timeout' : `you: ${a.picked}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Guided practice tutorial ─────────────────────────────────────────────────
// A step-by-step walkthrough modelled on the CBAT Target practice mode: a coach
// card with prev/next navigation sits above a fixed (seeded) practice picture.
// Each step pulses the panel it's teaching; the final step hides the picture and
// has the user answer one recall question before completing.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SAT_TUTORIAL_STEPS = [
  {
    focus: 'grid',
    title: 'Read the grid',
    body: (
      <>
        Units sit on a <b className="text-brand-600">10×10 grid</b> (columns 0–9 on top, rows A–J on the left).
        Each marker's <b className="text-brand-600">colour</b> is its allegiance — <span style={{ color: ALLEGIANCE_COLOR.friendly }}>yellow friendly</span>,{' '}
        <span style={{ color: ALLEGIANCE_COLOR.hostile }}>red hostile</span>, <span style={{ color: ALLEGIANCE_COLOR.unknown }}>white unknown</span>.
        The <b className="text-brand-600">letter</b> is the type (T/H/J), the <b className="text-brand-600">number</b> is how many, and the <b className="text-brand-600">arrow</b> is its heading.
        All three are shown together here so you can learn them. In the game you get <b className="text-brand-600">one contact at a time</b>.
      </>
    ),
  },
  {
    focus: 'aircraft',
    title: 'The controller aircraft',
    body: (
      <>
        Two or three controller aircraft (callsigns <b className="text-brand-600">York</b>, <b className="text-brand-600">Leeds</b>, <b className="text-brand-600">Hull</b>) each have a
        <b className="text-brand-600"> Next Waypoint</b>, time to it, <b className="text-brand-600">Altitude</b> and <b className="text-brand-600">Comms Channel</b>.
        The whole panel is filled in together here. In the game you only ever get <b className="text-brand-600">one field of one aircraft</b> at a time, so York's altitude and York's channel arrive separately. On Hard the panel stays on screen with its other boxes dashed out; on Easier the field gets the screen to itself.
      </>
    ),
  },
  {
    focus: 'radio',
    title: 'Listen to the radio',
    body: (
      <>
        Some details only come over the <b className="text-brand-600">radio</b> — and you're asked which callsign was given which instruction.
        Keep your sound on; the caption here is a fallback. Remember who was told what.
        Occasionally a unit on the grid <b className="text-brand-600">calls for support</b> and one aircraft is sent to respond —
        note the grid cell and what was sitting in it.
      </>
    ),
  },
  {
    focus: 'recall',
    title: 'Now recall it',
    body: (
      <>
        Nothing comes back. Once the last card has gone you answer multiple-choice questions <b className="text-brand-600">from memory</b>. Try one below.
      </>
    ),
  },
]

function makeTutorialRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `tut_${Math.random().toString(36).slice(2, 10)}`
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
      <p className="text-sm text-slate-400 mb-6">You've got the basics — observe, then recall.</p>
      <button
        onClick={onExit}
        className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
      >
        Back to Briefing
      </button>
    </motion.div>
  )
}

function SatTutorial({ onExit, onProgress }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [picked, setPicked] = useState(null)
  const [runId] = useState(makeTutorialRunId)
  // Fixed, seeded practice situation so the coach copy always matches the picture.
  const [sit] = useState(() => generateSatSituation({ unitCount: 3, aircraftCount: 2, questionCount: 1 }, mulberry32(20260620)))
  const step = SAT_TUTORIAL_STEPS[stepIdx]
  const sampleQ = sit.questions[0]

  // Report progress for the admin Reports per-step drop-off funnel.
  useEffect(() => {
    onProgress?.({ clientRunId: runId, furthestStep: stepIdx, totalSteps: SAT_TUTORIAL_STEPS.length, completed: false })
  }, [stepIdx]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (done) onProgress?.({ clientRunId: runId, furthestStep: SAT_TUTORIAL_STEPS.length - 1, totalSteps: SAT_TUTORIAL_STEPS.length, completed: true })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  // Speak the sample radio call when the radio step is reached.
  useEffect(() => {
    if (step.focus === 'radio' && sit.comms[0]) speak(sit.comms[0].speech, true)
    return () => stopSpeech()
  }, [step.focus]) // eslint-disable-line react-hooks/exhaustive-deps

  const goToStep = (i) => { if (i >= 0 && i < SAT_TUTORIAL_STEPS.length) { setStepIdx(i); stopSpeech() } }
  const pulse = (f) => (step.focus === f ? ' cbat-tutorial-pulse' : '')

  if (done) return <div className="flex flex-col items-center"><TutorialComplete onExit={onExit} /></div>

  return (
    <div className="w-full max-w-2xl">
      {/* Coach card */}
      <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide text-brand-600 font-bold">Practice Mode</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => goToStep(stepIdx - 1)} disabled={stepIdx === 0} aria-label="Previous section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer">‹</button>
            <span className="text-[10px] text-slate-500 tabular-nums">{stepIdx + 1} / {SAT_TUTORIAL_STEPS.length}</span>
            <button onClick={() => goToStep(stepIdx + 1)} disabled={stepIdx === SAT_TUTORIAL_STEPS.length - 1} aria-label="Next section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer">›</button>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={stepIdx} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <h2 className="text-base font-extrabold text-white mb-1">{step.title}</h2>
            <p className="text-sm text-[#ddeaf8] leading-relaxed">{step.body}</p>
          </motion.div>
        </AnimatePresence>
        <div className="mt-4">
          <button onClick={onExit} className="text-xs text-slate-500 hover:text-slate-300 transition-colors bg-transparent border-0 cursor-pointer">Exit practice</button>
        </div>
      </div>

      {/* Steps 1–3: study the picture (all units shown at once for learning) */}
      {step.focus !== 'recall' ? (
        <div>
          <div className={`bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-3 mb-2${pulse('grid')}`}>
            <SatGrid units={sit.units} />
            <GridLegend />
          </div>
          {/* The tutorial teaches the whole game, so it always shows the full
              four-field panel regardless of the difficulty selected behind it —
              the coach copy for this step describes all four. */}
          <div className={`bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-1 mb-2${pulse('aircraft')}`}>
            <AircraftPanel aircraft={sit.aircraft} activeIdx={0} fields={ALL_AIRCRAFT_FIELDS} />
          </div>
          <div className={`bg-[#0a1628] border border-[#1a3a5c] rounded-lg px-3 py-2 mb-3 flex flex-col sm:flex-row sm:items-center gap-x-2 gap-y-1${pulse('radio')}`}>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-base">🔊</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">Radio</span>
              {step.focus === 'radio' && (
                <button onClick={() => speak(sit.comms[0]?.speech, true)} className="sm:hidden ml-auto shrink-0 text-[10px] text-brand-600 hover:text-brand-700 bg-transparent border-0 cursor-pointer">Play again</button>
              )}
            </div>
            <p className="text-[11px] sm:text-xs leading-snug text-green-300 font-mono break-words flex-1 min-w-0">{sit.comms[0]?.text || '—'}</p>
            {step.focus === 'radio' && (
              <button onClick={() => speak(sit.comms[0]?.speech, true)} className="hidden sm:inline shrink-0 text-[10px] text-brand-600 hover:text-brand-700 bg-transparent border-0 cursor-pointer">Play again</button>
            )}
          </div>
          <div className="text-center">
            <button onClick={() => goToStep(stepIdx + 1)}
              className="px-8 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm">
              Next →
            </button>
          </div>
        </div>
      ) : (
        /* Step 4: recall — picture hidden, answer one sample question */
        <div className="max-w-md mx-auto">
          <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5 mb-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Recall — from memory</p>
            <p className="text-base sm:text-lg text-[#ddeaf8] leading-relaxed">{sampleQ.prompt}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {sampleQ.options.map(opt => {
              let cls = 'bg-[#0a1628] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240] cursor-pointer'
              if (picked !== null) {
                if (String(opt) === String(sampleQ.answer)) cls = 'bg-green-500/15 border-green-500/50 text-green-400'
                else if (String(opt) === String(picked)) cls = 'bg-red-500/15 border-red-500/50 text-red-400'
                else cls = 'bg-[#0a1628] border-[#1a3a5c] text-[#5a6a80]'
              }
              return (
                <button key={String(opt)} type="button" onClick={() => picked === null && setPicked(opt)} disabled={picked !== null}
                  className={`py-4 px-2 rounded-lg border-2 font-mono font-bold text-base transition-all ${cls}`}>
                  {opt}
                </button>
              )
            })}
          </div>
          <AnimatePresence>
            {picked !== null && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3">
                <div className={`text-center text-sm font-bold mb-2 ${String(picked) === String(sampleQ.answer) ? 'text-green-400' : 'text-red-400'}`}>
                  {String(picked) === String(sampleQ.answer) ? '✓ Correct' : `✗ The answer was ${sampleQ.answer}`}
                </div>
                <button onClick={() => setDone(true)}
                  className="w-full px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm">
                  Finish Tutorial
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CbatSat() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()

  const [phase, setPhase] = useState('intro') // intro | tutorial | launching | observe | playing | feedback | results
  const isDemo = !!useCbatDemo()

  // The difficulty the instructions card is set to. Persisted, so the card opens
  // on whatever was played last.
  const [difficulty, setDifficulty] = useState(() => initialDifficulty(readStoredSatDifficulty))
  const tuning = satTuning(difficulty)
  // The difficulty the run on screen is being played at. Pinned at launch so
  // flipping the card's selection mid-run could never redirect a finished score.
  // The ref is what the game logic reads; the state is what the render tree
  // reads (reading a ref during render trips react-hooks/refs).
  const runTuningRef = useRef(tuning)
  const [runDifficulty, setRunDifficulty] = useState(difficulty)
  const runTuning = satTuning(runDifficulty)
  const runTotalQuestions = satTotalQuestions(runTuning)

  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'tutorial' || phase === 'observe' || phase === 'playing' || phase === 'feedback') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Fire-and-forget tutorial usage tracking (admin Reports per-step drop-off).
  // Online-only by design — a learning aid, not a score, so no offline outbox.
  const reportTutorialProgress = useCallback((body) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/sat/tutorial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  }, [user, apiFetch, API])

  const [situations, setSituations] = useState([])
  const [situationIdx, setSituationIdx] = useState(0)
  const [questionIdx, setQuestionIdx] = useState(0)
  const [answers, setAnswers] = useState([])
  const [feedback, setFeedback] = useState(null) // { correct, picked, answer }
  const [observeRemainingMs, setObserveRemainingMs] = useState(0)
  const [qRemainingMs, setQRemainingMs] = useState(PER_QUESTION_MS)
  const [totalElapsedMs, setTotalElapsedMs] = useState(0)
  const [cardIdx, setCardIdx] = useState(0)
  const [audioOn, setAudioOn] = useState(true)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)

  const qStartRef = useRef(null)
  const tickRef = useRef(null)
  const answersRef = useRef([])
  const totalElapsedRef = useRef(0)
  const audioOnRef = useRef(true)

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { totalElapsedRef.current = totalElapsedMs }, [totalElapsedMs])
  useEffect(() => { audioOnRef.current = audioOn }, [audioOn])

  const currentSituation = situations[situationIdx] || null
  const currentQuestion = currentSituation?.questions[questionIdx] || null

  // Fetch personal best. Per-difficulty (separate collections), so this refetches
  // on every switch.
  const fetchPB = useCallback((gameKey) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/${gameKey}/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user, apiFetch, API])

  useEffect(() => { fetchPB(tuning.gameKey) }, [fetchPB, tuning.gameKey])

  // Stop any speech when the component unmounts.
  useEffect(() => () => stopSpeech(), [])

  // Submit score to backend
  const submitScore = useCallback((finalAnswers, finalTotalMs) => {
    const playedTuning = runTuningRef.current
    const totalQuestions = satTotalQuestions(playedTuning)
    const correctCount = finalAnswers.filter(a => a.correct).length
    const totalTime = finalTotalMs / 1000
    const avgTimePerQuestionMs = Math.round(finalTotalMs / totalQuestions)

    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correctCount })
    submitCbatResult(playedTuning.gameKey, {
        correctCount,
        totalQuestions,
        totalTime,
        avgTimePerQuestionMs,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchPB(playedTuning.gameKey)
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted, fetchPB])

  // Observe phase — walk the card queue, one fact at a time. Each card holds for
  // the run difficulty's cardMs and is then replaced; when the queue runs out the
  // picture is gone and the recall questions begin. There is no skip-ahead: with
  // everything on screen at once "I'm Ready" was fair, but skipping a serial
  // queue would mean being asked about facts that were never shown.
  useEffect(() => {
    if (phase !== 'observe' || !currentSituation) return
    stopSpeech()
    setCardIdx(0)
    const cards = currentSituation.cards
    const cardMs = runTuningRef.current.cardMs
    const totalMs = satObserveMs(cards, cardMs)
    setObserveRemainingMs(totalMs)
    const start = Date.now()
    if (cards[0]?.kind === 'radio') speak(cards[0].comm.speech, audioOnRef.current)

    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      setObserveRemainingMs(Math.max(0, totalMs - elapsed))
      const idx = Math.min(cards.length - 1, Math.floor(elapsed / cardMs))
      setCardIdx(prev => {
        // Speak on arrival only — re-speaking every tick would stack utterances.
        if (idx !== prev && cards[idx]?.kind === 'radio') speak(cards[idx].comm.speech, audioOnRef.current)
        return idx
      })
      if (elapsed >= totalMs) {
        clearInterval(interval)
        beginQuestions()
      }
    }, 100)
    return () => { clearInterval(interval); stopSpeech() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, situationIdx])

  function beginQuestions() {
    stopSpeech()
    setQuestionIdx(0)
    setPhase('playing')
  }

  // Per-question countdown — runs only during 'playing'. On timeout, record a
  // wrong answer (picked = null) and move to the reveal.
  useEffect(() => {
    if (phase !== 'playing' || !currentQuestion) return
    qStartRef.current = Date.now()
    setQRemainingMs(PER_QUESTION_MS)
    tickRef.current = setInterval(() => {
      const remaining = Math.max(0, PER_QUESTION_MS - (Date.now() - qStartRef.current))
      setQRemainingMs(remaining)
      if (remaining === 0) {
        clearInterval(tickRef.current)
        recordAnswer(null, PER_QUESTION_MS)
      }
    }, 100)
    return () => clearInterval(tickRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, situationIdx, questionIdx])

  function recordAnswer(picked, elapsedMs) {
    if (!currentQuestion) return
    const correct = picked !== null && String(picked) === String(currentQuestion.answer)
    const entry = {
      prompt: currentQuestion.prompt,
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
    recordAnswer(option, Date.now() - qStartRef.current)
  }

  function goNext() {
    setFeedback(null)
    const nextQ = questionIdx + 1
    if (nextQ < (currentSituation?.questions.length || 0)) {
      setQuestionIdx(nextQ)
      setPhase('playing')
      return
    }
    const nextS = situationIdx + 1
    if (nextS < runTuningRef.current.situations) {
      setSituationIdx(nextS)
      setQuestionIdx(0)
      setPhase('observe')
      return
    }
    submitScore(answersRef.current, totalElapsedRef.current)
    setPhase('results')
  }

  const startGame = useCallback(() => {
    startTracking(runTuningRef.current.gameKey)
    setSituations(buildSituations(runTuningRef.current))
    setSituationIdx(0)
    setQuestionIdx(0)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setPhase('observe')
  }, [startTracking])

  // Pressing Start doesn't drop straight into the game: the chosen difficulty
  // button flashes on a greyed-out card for SAT_LAUNCH_MS first. A demo tile on
  // the landing wall skips the flash — its driver clicks Start the moment the
  // card mounts, so a dimmed card is all anyone would ever see of it.
  const beginLaunch = useCallback(() => {
    // primeSpeech must happen synchronously in the click handler: iOS Safari
    // only allows speech that was unlocked by a user gesture, and the first
    // radio call is fired later by the observe timer.
    primeSpeech()
    runTuningRef.current = tuning
    setRunDifficulty(tuning.key)
    if (isDemo) { startGame(); return }
    setPhase('launching')
  }, [tuning, isDemo, startGame])

  useEffect(() => {
    if (phase !== 'launching') return
    const t = setTimeout(() => startGame(), SAT_LAUNCH_MS)
    return () => clearTimeout(t)
  }, [phase, startGame])

  const chooseDifficulty = useCallback((key) => {
    setDifficulty(key)
    storeSatDifficulty(key)
    // The old board's best belongs to the difficulty being left.
    setPersonalBest(null)
  }, [])

  const goToIntro = useCallback(() => {
    clearInterval(tickRef.current)
    stopSpeech()
    setPhase('intro')
    setSituations([])
    setSituationIdx(0)
    setQuestionIdx(0)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setScoreSaved(false)
  }, [])

  const correctSoFar = answers.filter(a => a.correct).length
  const globalQ = situationIdx * runTuning.questionsPerSituation + questionIdx + 1
  const observeSec = (observeRemainingMs / 1000).toFixed(0)
  const cardCount = currentSituation?.cards?.length || 0
  const remainingSec = (qRemainingMs / 1000).toFixed(0)
  const launching = phase === 'launching'
  // During the launch flash everything on the card except the chosen difficulty
  // button greys out, so the flashing button is the only thing left alive.
  const dim = launching ? ' cbat-launch-dim' : ''

  return (
    <div className="cbat-sat-page">
      <SEO title="Situational Awareness Test — CBAT" description="Observe a tactical picture of units, aircraft and radio calls, then recall the details from memory." />

      {/* Header */}
      <div className={`flex items-center gap-2 mb-2${dim}`}>
        {phase === 'intro' || launching
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={['observe', 'playing', 'feedback'].includes(phase)} />
        }
        <h1 className="text-sm font-extrabold text-slate-900">Situational Awareness Test</h1>
        {['observe', 'playing', 'feedback'].includes(phase) && <DifficultyMarker tuning={runTuning} />}
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

      {user && (
        <div className="flex flex-col items-center">

          {/* Intro screen */}
          {(phase === 'intro' || launching) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className={`text-4xl mb-3${dim}`}>🗺️</p>

              {/* SAT_DIFFICULTIES is ordered [easier, hard], so the easier option
                  lands left of the title and hard lands right of it. The title is
                  too long to sit between them on a phone, so it goes above and
                  the pair sits under it. */}
              <p className={`text-xl font-extrabold text-white mb-2${dim}`}>Situational Awareness Test</p>
              <div className="flex items-center justify-center gap-3 mb-1">
                {SAT_DIFFICULTIES.map(t => (
                  <DifficultyButton
                    key={t.key}
                    tuning={t}
                    selected={difficulty === t.key}
                    onSelect={chooseDifficulty}
                    flashing={launching && difficulty === t.key}
                    dimmed={launching && difficulty !== t.key}
                  />
                ))}
              </div>
              <p className={`text-[11px] text-brand-600 mb-3${dim}`}>{tuning.blurb}</p>

              <p className={`text-base text-slate-400 mb-5${dim}`}>
                Build and hold a mental picture of a changing battlefield. Each situation feeds you one piece of information at a time — a contact on the grid, one field of a controller aircraft, or a call over the <span className="text-brand-600">radio</span>. Each one vanishes before the next arrives, then you answer from memory.
              </p>

              <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-base text-[#ddeaf8]${dim}`}>
                <div className="flex items-start gap-2">
                  <span className="text-brand-600 font-bold shrink-0">1.</span>
                  <span>Observe — contacts (type, count, allegiance, heading), aircraft data, and radio calls, one at a time.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-600 font-bold shrink-0">2.</span>
                  <span>Each one holds for {tuning.cardMs / 1000}s, then it's gone for good. Answer multiple-choice recall questions.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-600 font-bold shrink-0">3.</span>
                  <span>{tuning.situations} situations · {satTotalQuestions(tuning)} questions total.</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-[#8a9bb5] pt-1">
                  <span className="shrink-0">⏱</span>
                  <span>{PER_QUESTION_MS / 1000}s per question — running out counts as wrong. 🔊 Turn your sound on for the radio calls.</span>
                </div>
              </div>

              {personalBest && (
                <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-center${dim}`}>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
                  <p className="text-lg font-mono font-bold text-brand-600">
                    {personalBest.bestScore}/{satTotalQuestions(tuning)}
                    <span className="text-slate-500 mx-1">·</span>
                    {personalBest.bestTime.toFixed(1)}s
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                </div>
              )}

              <div className={`text-center mb-4${dim}`}>
                <Link to={`/cbat/${tuning.gameKey}/leaderboard`} className="text-sm text-brand-600 hover:text-brand-700 transition-colors">
                  View Leaderboard →
                </Link>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={beginLaunch}
                  disabled={launching}
                  data-demo-start
                  className={`px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-[#1a3a5c] disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer disabled:cursor-not-allowed${dim}`}
                >
                  Start
                </button>
                <button
                  onClick={() => { primeSpeech(); setPhase('tutorial') }}
                  disabled={launching}
                  className={`px-6 py-3 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] font-bold rounded-lg transition-colors text-sm${dim}`}
                >
                  Tutorial
                </button>
              </div>
            </motion.div>
          )}

          {/* Guided practice tutorial */}
          {phase === 'tutorial' && (
            <SatTutorial onExit={() => setPhase('intro')} onProgress={reportTutorialProgress} />
          )}

          {/* Observe phase — one fact at a time, then it's gone */}
          {phase === 'observe' && currentSituation && (
            <motion.div
              key={`obs-${situationIdx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full max-w-2xl"
            >
              {/* Instruction + progress + timer */}
              <div className="flex items-stretch gap-2 mb-2">
                <div className="flex-1 bg-[#0a1628] border border-[#1a3a5c] rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Situation {situationIdx + 1}/{runTuning.situations} — Memorise the picture</p>
                    <button
                      onClick={() => { setAudioOn(v => { if (v) stopSpeech(); return !v }) }}
                      className="shrink-0 text-base bg-transparent border-0 cursor-pointer p-0"
                      title={audioOn ? 'Mute radio' : 'Unmute radio'}
                      aria-label={audioOn ? 'Mute radio' : 'Unmute radio'}
                    >
                      {audioOn ? '🔊' : '🔇'}
                    </button>
                  </div>
                  <p className="text-sm text-[#ddeaf8]">Each fact shows once, then vanishes. Nothing comes back.</p>
                </div>
                <div className="w-20 bg-[#0a1628] border border-[#1a3a5c] rounded-lg flex flex-col items-center justify-center">
                  <p className="text-[11px] text-slate-500 uppercase">Time</p>
                  <p className={`text-2xl font-mono font-bold ${observeRemainingMs < 5000 ? 'text-red-400' : 'text-brand-600'}`}>{observeSec}s</p>
                </div>
              </div>

              {/* The picture. Easier gives the fact a screen to itself; Hard puts
                  the whole console up and lights only the panel it landed in. */}
              {runTuning.layout === 'panels' ? (
                <ObservePanels
                  situation={currentSituation}
                  card={currentSituation.cards[cardIdx]}
                  fields={runTuning.aircraftFields}
                />
              ) : (
                <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-3 mb-2">
                  <div className="min-h-[26rem] flex items-center justify-center">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={cardIdx}
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                        className="w-full flex justify-center"
                      >
                        <ObserveCard card={currentSituation.cards[cardIdx]} />
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Progress through the queue, under the picture on both layouts. */}
              <div className="flex items-center gap-3 px-1">
                <p className="text-xs text-slate-500 uppercase tracking-wide shrink-0">
                  Fact {Math.min(cardIdx + 1, cardCount)} / {cardCount}
                </p>
                <div className="h-1 flex-1 rounded-full bg-[#1a3a5c] overflow-hidden">
                  <div
                    className="h-full bg-brand-400"
                    style={{ width: `${Math.round(((cardIdx + 1) / Math.max(1, cardCount)) * 100)}%` }}
                  />
                </div>
              </div>

            </motion.div>
          )}

          {/* Playing / Feedback — recall questions (picture hidden) */}
          {(phase === 'playing' || phase === 'feedback') && currentQuestion && (
            <div className="w-full max-w-md">
              {/* HUD */}
              <div className="flex items-center justify-between text-sm font-mono mb-2 px-1">
                <span className="text-slate-400">Q <span className="text-brand-600">{globalQ}</span>/{runTotalQuestions}</span>
                <span className="text-slate-400">✓ <span className="text-green-400">{correctSoFar}</span></span>
                <span className="text-slate-400">⏱ <span className={qRemainingMs < 6000 ? 'text-red-400' : 'text-brand-600'}>{remainingSec}s</span></span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${(answers.length / runTotalQuestions) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Question */}
              <motion.div
                key={`${situationIdx}-${questionIdx}`}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-5 mb-3"
              >
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Recall — Situation {situationIdx + 1}</p>
                <p className="text-lg sm:text-xl text-[#ddeaf8] leading-relaxed">{currentQuestion.prompt}</p>
              </motion.div>

              {/* Options */}
              <div className="grid grid-cols-2 gap-2">
                {currentQuestion.options.map(opt => {
                  let cls = 'bg-[#0a1628] border-[#1a3a5c] text-[#ddeaf8] hover:border-brand-400 hover:bg-[#0f2240] cursor-pointer'
                  if (phase === 'feedback') {
                    if (String(opt) === String(feedback?.answer)) cls = 'bg-green-500/15 border-green-500/50 text-green-400'
                    else if (String(opt) === String(feedback?.picked)) cls = 'bg-red-500/15 border-red-500/50 text-red-400'
                    else cls = 'bg-[#0a1628] border-[#1a3a5c] text-[#5a6a80]'
                  }
                  return (
                    <button
                      key={String(opt)}
                      type="button"
                      onClick={() => handlePick(opt)}
                      disabled={phase === 'feedback'}
                      className={`py-4 px-2 rounded-lg border-2 font-mono font-bold text-lg transition-all ${cls}`}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>

              {/* Reveal */}
              <AnimatePresence>
                {phase === 'feedback' && feedback && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3">
                    <div className={`text-center text-base font-bold mb-2 ${feedback.correct ? 'text-green-400' : 'text-red-400'}`}>
                      {feedback.correct
                        ? '✓ Correct'
                        : feedback.picked === null
                          ? `⏱ Timeout — the answer was ${feedback.answer}`
                          : `✗ The answer was ${feedback.answer}`}
                    </div>
                    <button
                      onClick={goNext}
                      className="w-full px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
                    >
                      {globalQ >= runTotalQuestions
                        ? 'See Results'
                        : questionIdx + 1 >= (currentSituation?.questions.length || 0)
                          ? 'Next Situation →'
                          : 'Next'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <CbatGameOver
              gameKey={runTuning.gameKey}
              score={answers.filter(a => a.correct).length}
              time={totalElapsedMs / 1000}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
            >
              <ResultsScreen answers={answers} totalTime={totalElapsedMs / 1000} tuning={runTuning} />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
