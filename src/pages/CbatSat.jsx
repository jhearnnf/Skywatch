import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import { generateSatSituation, SAT_GRID } from '../utils/cbat/satGenerator'
import SEO from '../components/SEO'
import CbatGameOver from '../components/CbatGameOver'

// ── Constants ────────────────────────────────────────────────────────────────
const SITUATIONS = 3
const QUESTIONS_PER_SITUATION = 6
const TOTAL_QUESTIONS = SITUATIONS * QUESTIONS_PER_SITUATION
const OBSERVE_MS = 28000      // study window per situation
const PER_QUESTION_MS = 22000 // recall timer per question
const AIRCRAFT_SLOT_MS = 5000 // panel 4 shows one callsign at a time, switching on this cadence
const UNIT_SLOT_MS = 4000     // grid shows one unit at a time, switching on this cadence

function buildSituations() {
  const out = []
  for (let i = 0; i < SITUATIONS; i++) out.push(generateSatSituation({ questionCount: QUESTIONS_PER_SITUATION }))
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
        <text key={`c${c}`} x={gx + i * cell + cell / 2} y={gy - 7} fill="#9fb4d0" fontSize="13" fontWeight="bold" textAnchor="middle">{c}</text>
      ))}
      {/* row labels A–J, down the left */}
      {ROWS.map((rw, i) => (
        <text key={`r${rw}`} x={gx - 11} y={gy + i * cell + cell / 2 + 4} fill="#9fb4d0" fontSize="13" fontWeight="bold" textAnchor="middle">{rw}</text>
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
            <text x={cx} y={cy + 4.5} fill={color} fontSize="14" fontWeight="bold" textAnchor="middle">{TYPE_LETTER[u.type]}</text>
            {/* count badge, top-right of the marker */}
            <text x={cx + r + 1} y={cy - r + 4} fill="#ddeaf8" fontSize="12" fontWeight="bold" textAnchor="middle">{u.count}</text>
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
    <div className="mt-2 text-[10px] text-slate-400 leading-relaxed">
      <p className="mb-0.5">Each cell = <span className="text-slate-300">2 km</span> · letters next to a marker show how many · arrow shows heading.</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span><span style={{ color: ALLEGIANCE_COLOR.friendly }}>■</span> Yellow = Friendly</span>
        <span><span style={{ color: ALLEGIANCE_COLOR.hostile }}>■</span> Red = Hostile</span>
        <span><span style={{ color: ALLEGIANCE_COLOR.unknown }}>■</span> White = Unknown</span>
      </div>
      <p className="mt-0.5 text-slate-500">Marker letter: T = Tank · H = Helicopter · J = Jet</p>
    </div>
  )
}

const WAYPOINT_ARROW = { N: '↑', S: '↓', E: '→', W: '←' }

function AircraftField({ label, children }) {
  return (
    <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg px-3 py-2.5">
      <dt className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-base text-[#ddeaf8] font-mono">{children}</dd>
    </div>
  )
}

// One callsign at a time fills the whole panel (matching the real SAT), with a
// dots indicator showing which of the aircraft is currently displayed. The
// panel auto-switches between callsigns during the observe window.
function AircraftPanel({ aircraft, activeIdx }) {
  const ac = aircraft[activeIdx % aircraft.length]
  if (!ac) return null
  return (
    <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-3 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <p className="text-2xl font-extrabold text-brand-300 tracking-wide">{ac.callsign}</p>
        <div className="flex gap-1.5">
          {aircraft.map((a, i) => (
            <span
              key={a.callsign}
              className={`w-2 h-2 rounded-full ${i === activeIdx % aircraft.length ? 'bg-brand-400' : 'bg-[#1a3a5c]'}`}
            />
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2 flex-1">
        <AircraftField label="Next Waypoint">
          <span className="text-green-400">{WAYPOINT_ARROW[ac.waypointDir]}</span> {ac.waypointRef}
        </AircraftField>
        <AircraftField label="Next Waypoint At">{ac.waypointAt}s</AircraftField>
        <AircraftField label="Altitude">FL{ac.altitude}</AircraftField>
        <AircraftField label="Comms Channel">{ac.channel}</AircraftField>
      </dl>
    </div>
  )
}

// ── Results screen (embedded inside CbatGameOver) ────────────────────────────
function ResultsScreen({ answers, totalTime }) {
  const correct = answers.filter(a => a.correct).length
  const pct = Math.round((correct / TOTAL_QUESTIONS) * 100)

  const grade = pct >= 90 ? { label: 'Outstanding', emoji: '🎖️', color: 'text-green-400' }
    : pct >= 70 ? { label: 'Good', emoji: '🗺️', color: 'text-brand-300' }
    : pct >= 50 ? { label: 'Needs Work', emoji: '🔧', color: 'text-amber-400' }
    : { label: 'Failed', emoji: '💥', color: 'text-red-400' }

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
      <p className="text-5xl mb-3">{grade.emoji}</p>
      <p className={`text-2xl font-extrabold mb-1 ${grade.color}`}>{grade.label}</p>
      <p className="text-sm text-slate-400 mb-6">Situational Awareness Test Complete</p>

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

// ── Comms playback (Web Speech API, with caption fallback) ───────────────────
function speak(text, enabled) {
  if (!enabled) return
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.0
    u.pitch = 1.0
    window.speechSynthesis.speak(u)
  } catch { /* TTS unavailable — caption fallback still shows */ }
}
function stopSpeech() {
  try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel() } catch { /* noop */ }
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
        Units sit on a <b className="text-brand-300">10×10 grid</b> (columns 0–9 on top, rows A–J on the left).
        Each marker's <b className="text-brand-300">colour</b> is its allegiance — <span style={{ color: ALLEGIANCE_COLOR.friendly }}>yellow friendly</span>,{' '}
        <span style={{ color: ALLEGIANCE_COLOR.hostile }}>red hostile</span>, <span style={{ color: ALLEGIANCE_COLOR.unknown }}>white unknown</span>.
        The <b className="text-brand-300">letter</b> is the type (T/H/J), the <b className="text-brand-300">number</b> is how many, and the <b className="text-brand-300">arrow</b> is its heading. In the real test they appear one at a time.
      </>
    ),
  },
  {
    focus: 'aircraft',
    title: 'The controller aircraft',
    body: (
      <>
        Two or three controller aircraft (callsigns <b className="text-brand-300">York</b>, <b className="text-brand-300">Leeds</b>, <b className="text-brand-300">Hull</b>) each show a
        <b className="text-brand-300"> Next Waypoint</b>, time to it, <b className="text-brand-300">Altitude</b> and <b className="text-brand-300">Comms Channel</b>.
        The panel shows one callsign at a time and switches between them — note each one's details.
      </>
    ),
  },
  {
    focus: 'radio',
    title: 'Listen to the radio',
    body: (
      <>
        Some details only come over the <b className="text-brand-300">radio</b> — and you're asked which callsign was given which instruction.
        Keep your sound on; the caption here is a fallback. Remember who was told what.
      </>
    ),
  },
  {
    focus: 'recall',
    title: 'Now recall it',
    body: (
      <>
        The picture disappears and you answer multiple-choice questions <b className="text-brand-300">from memory</b>. Try one below.
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
          <span className="text-[10px] uppercase tracking-wide text-brand-300 font-bold">Practice Mode</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => goToStep(stepIdx - 1)} disabled={stepIdx === 0} aria-label="Previous section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-300 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer">‹</button>
            <span className="text-[10px] text-slate-500 tabular-nums">{stepIdx + 1} / {SAT_TUTORIAL_STEPS.length}</span>
            <button onClick={() => goToStep(stepIdx + 1)} disabled={stepIdx === SAT_TUTORIAL_STEPS.length - 1} aria-label="Next section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-300 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer">›</button>
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
          <div className={`bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-1 mb-2${pulse('aircraft')}`}>
            <AircraftPanel aircraft={sit.aircraft} activeIdx={0} />
          </div>
          <div className={`bg-[#0a1628] border border-[#1a3a5c] rounded-lg px-3 py-2 mb-3 flex items-center gap-2${pulse('radio')}`}>
            <span className="shrink-0 text-base">🔊</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide shrink-0">Radio</span>
            <p className="text-xs text-green-300 font-mono truncate flex-1">{sit.comms[0]?.text || '—'}</p>
            {step.focus === 'radio' && (
              <button onClick={() => speak(sit.comms[0]?.speech, true)} className="shrink-0 text-[10px] text-brand-300 hover:text-brand-200 bg-transparent border-0 cursor-pointer">Play again</button>
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

  const [phase, setPhase] = useState('intro') // intro | tutorial | observe | playing | feedback | results
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
  const [observeRemainingMs, setObserveRemainingMs] = useState(OBSERVE_MS)
  const [qRemainingMs, setQRemainingMs] = useState(PER_QUESTION_MS)
  const [totalElapsedMs, setTotalElapsedMs] = useState(0)
  const [activeComm, setActiveComm] = useState(0)
  const [activeAircraft, setActiveAircraft] = useState(0)
  const [activeUnit, setActiveUnit] = useState(0)
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

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/sat/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any speech when the component unmounts.
  useEffect(() => () => stopSpeech(), [])

  // Submit score to backend
  const submitScore = useCallback((finalAnswers, finalTotalMs) => {
    const correctCount = finalAnswers.filter(a => a.correct).length
    const totalTime = finalTotalMs / 1000
    const avgTimePerQuestionMs = Math.round(finalTotalMs / TOTAL_QUESTIONS)

    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: correctCount })
    submitCbatResult('sat', {
        correctCount,
        totalQuestions: TOTAL_QUESTIONS,
        totalTime,
        avgTimePerQuestionMs,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/sat/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [apiFetch, API, markGameCompleted])

  // Observe phase — countdown + sequential radio comms. When it ends (or the
  // user clicks Ready), units/aircraft disappear and the recall questions begin.
  useEffect(() => {
    if (phase !== 'observe' || !currentSituation) return
    stopSpeech()
    setActiveComm(0)
    setActiveAircraft(0)
    setActiveUnit(0)
    setObserveRemainingMs(OBSERVE_MS)
    const start = Date.now()
    const comms = currentSituation.comms
    const aircraftCount = currentSituation.aircraft.length
    const unitCount = currentSituation.units.length
    if (comms.length) speak(comms[0].speech, audioOnRef.current)
    const slot = OBSERVE_MS / Math.max(1, comms.length)

    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      setObserveRemainingMs(Math.max(0, OBSERVE_MS - elapsed))
      const idx = Math.min(comms.length - 1, Math.floor(elapsed / slot))
      setActiveComm(prev => {
        if (idx !== prev && comms[idx]) speak(comms[idx].speech, audioOnRef.current)
        return idx
      })
      // Panel 4 cycles through the callsigns, and the grid reveals one unit at a
      // time — both shown one at a time, matching the real SAT.
      if (aircraftCount) setActiveAircraft(Math.floor(elapsed / AIRCRAFT_SLOT_MS) % aircraftCount)
      if (unitCount) setActiveUnit(Math.floor(elapsed / UNIT_SLOT_MS) % unitCount)
      if (elapsed >= OBSERVE_MS) {
        clearInterval(interval)
        beginQuestions()
      }
    }, 150)
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
    if (nextS < SITUATIONS) {
      setSituationIdx(nextS)
      setQuestionIdx(0)
      setPhase('observe')
      return
    }
    submitScore(answersRef.current, totalElapsedRef.current)
    setPhase('results')
  }

  const startGame = useCallback(() => {
    startTracking('sat')
    setSituations(buildSituations())
    setSituationIdx(0)
    setQuestionIdx(0)
    setAnswers([])
    answersRef.current = []
    setFeedback(null)
    setTotalElapsedMs(0)
    totalElapsedRef.current = 0
    setPhase('observe')
  }, [startTracking])

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
  const globalQ = situationIdx * QUESTIONS_PER_SITUATION + questionIdx + 1
  const observeSec = (observeRemainingMs / 1000).toFixed(0)
  const remainingSec = (qRemainingMs / 1000).toFixed(0)

  return (
    <div className="cbat-sat-page">
      <SEO title="Situational Awareness Test — CBAT" description="Observe a tactical picture of units, aircraft and radio calls, then recall the details from memory." />

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <button onClick={goToIntro} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
        }
        <h1 className="text-sm font-extrabold text-slate-900">Situational Awareness Test</h1>
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
          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
            >
              <p className="text-4xl mb-3">🗺️</p>
              <p className="text-xl font-extrabold text-white mb-2">Situational Awareness Test</p>
              <p className="text-sm text-slate-400 mb-5">
                Build and hold a mental picture of a changing battlefield. Each situation shows units on a grid and controller aircraft, with some details called in over the <span className="text-brand-300">radio</span>. It all disappears — then you answer from memory.
              </p>

              <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]">
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">1.</span>
                  <span>Observe — units (type, count, allegiance, heading), aircraft data, and radio calls.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">2.</span>
                  <span>It vanishes after {OBSERVE_MS / 1000}s. Answer multiple-choice recall questions.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-brand-300 font-bold shrink-0">3.</span>
                  <span>{SITUATIONS} situations · {TOTAL_QUESTIONS} questions total.</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1">
                  <span className="shrink-0">⏱</span>
                  <span>{PER_QUESTION_MS / 1000}s per question — running out counts as wrong. 🔊 Turn your sound on for the radio calls.</span>
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
                <Link to="/cbat/sat/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
                  View Leaderboard →
                </Link>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={startGame}
                  className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
                >
                  Start
                </button>
                <button
                  onClick={() => setPhase('tutorial')}
                  className="px-6 py-3 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] font-bold rounded-lg transition-colors text-sm"
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

          {/* Observe phase — the five-panel tactical picture */}
          {phase === 'observe' && currentSituation && (
            <motion.div
              key={`obs-${situationIdx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full max-w-2xl"
            >
              {/* Panel 1 (instruction) + Panel 2 (timer) */}
              <div className="flex items-stretch gap-2 mb-2">
                <div className="flex-1 bg-[#0a1628] border border-[#1a3a5c] rounded-lg px-3 py-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Situation {situationIdx + 1}/{SITUATIONS} — Memorise the picture</p>
                  <p className="text-xs text-[#ddeaf8]">Units, aircraft data and radio calls. It disappears when the timer ends.</p>
                </div>
                <div className="w-20 bg-[#0a1628] border border-[#1a3a5c] rounded-lg flex flex-col items-center justify-center">
                  <p className="text-[9px] text-slate-500 uppercase">Time</p>
                  <p className={`text-xl font-mono font-bold ${observeRemainingMs < 5000 ? 'text-red-400' : 'text-brand-300'}`}>{observeSec}s</p>
                </div>
              </div>

              {/* Panel 3 (grid) + Panel 4 (aircraft) */}
              <div className="flex flex-col sm:flex-row gap-2 mb-2">
                <div className="sm:flex-[3] bg-[#0a1628] border border-[#1a3a5c] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1 px-0.5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                      Contact {(activeUnit % currentSituation.units.length) + 1} / {currentSituation.units.length}
                    </p>
                    <div className="flex gap-1.5">
                      {currentSituation.units.map((u, i) => (
                        <span key={u.id} className={`w-2 h-2 rounded-full ${i === activeUnit % currentSituation.units.length ? 'bg-brand-400' : 'bg-[#1a3a5c]'}`} />
                      ))}
                    </div>
                  </div>
                  <SatGrid units={[currentSituation.units[activeUnit % currentSituation.units.length]]} />
                  <GridLegend />
                </div>
                <div className="sm:flex-[2] flex flex-col">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 px-1">Controller Aircraft</p>
                  <div className="flex-1">
                    <AircraftPanel aircraft={currentSituation.aircraft} activeIdx={activeAircraft} />
                  </div>
                </div>
              </div>

              {/* Panel 5 (comms ticker) */}
              <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
                <button
                  onClick={() => { setAudioOn(v => { if (v) stopSpeech(); return !v }) }}
                  className="shrink-0 text-base bg-transparent border-0 cursor-pointer p-0"
                  title={audioOn ? 'Mute radio' : 'Unmute radio'}
                  aria-label={audioOn ? 'Mute radio' : 'Unmute radio'}
                >
                  {audioOn ? '🔊' : '🔇'}
                </button>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide shrink-0">Radio</span>
                <p className="text-xs text-green-300 font-mono truncate flex-1">
                  {currentSituation.comms[activeComm]?.text || '—'}
                </p>
              </div>

              <div className="text-center">
                <button
                  onClick={beginQuestions}
                  className="px-6 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] font-bold rounded-lg transition-colors text-sm"
                >
                  I'm Ready →
                </button>
              </div>
            </motion.div>
          )}

          {/* Playing / Feedback — recall questions (picture hidden) */}
          {(phase === 'playing' || phase === 'feedback') && currentQuestion && (
            <div className="w-full max-w-md">
              {/* HUD */}
              <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
                <span className="text-slate-400">Q <span className="text-brand-300">{globalQ}</span>/{TOTAL_QUESTIONS}</span>
                <span className="text-slate-400">✓ <span className="text-green-400">{correctSoFar}</span></span>
                <span className="text-slate-400">⏱ <span className={qRemainingMs < 6000 ? 'text-red-400' : 'text-brand-300'}>{remainingSec}s</span></span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 bg-[#1a3a5c] rounded-full mb-3 overflow-hidden">
                <motion.div
                  className="h-full bg-brand-600 rounded-full"
                  initial={false}
                  animate={{ width: `${(answers.length / TOTAL_QUESTIONS) * 100}%` }}
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
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Recall — Situation {situationIdx + 1}</p>
                <p className="text-base sm:text-lg text-[#ddeaf8] leading-relaxed">{currentQuestion.prompt}</p>
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
                      className={`py-4 px-2 rounded-lg border-2 font-mono font-bold text-base transition-all ${cls}`}
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
                    <div className={`text-center text-sm font-bold mb-2 ${feedback.correct ? 'text-green-400' : 'text-red-400'}`}>
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
                      {globalQ >= TOTAL_QUESTIONS
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
              gameKey="sat"
              score={answers.filter(a => a.correct).length}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={() => { setScoreSaved(false); startGame() }}
            >
              <ResultsScreen answers={answers} totalTime={totalElapsedMs / 1000} />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}
