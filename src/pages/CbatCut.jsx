import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import { DifficultyButton, DifficultyMarker } from '../components/CbatDifficultySelect'
import {
  CUT_DIFFICULTIES, CUT_LAUNCH_MS, cutTuning,
  readStoredCutDifficulty, storeCutDifficulty,
} from '../utils/cbat/cutDifficulty'
import { initialDifficulty } from '../utils/cbat/difficultyParam'
import {
  GAME_MS, TICK_MS, SYSTEMS, SYSTEM_LABELS, SCORE, grade, award,
  makeSim, advanceSim, scheduleNextLoad, pushMessage, randRange, fmtWall, fmtClock,
  FUEL_MAX_SPREAD, SPEED_TOL, SPEED_STEP, SENSOR_ARM_WINDOW,
  AIR_INTERVAL, GROUND_INTERVAL, LOAD_RELEASE_WINDOW, LOAD_POINTS, stationName,
  PRESS_LOW, PRESS_HIGH, CODE_SUBMIT_WINDOW,
} from '../utils/cbat/cutSim'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import { useCbatDemo } from '../utils/cbat/demoMode'

// ── Panels ───────────────────────────────────────────────────────────────────
function Panel({ title, accent = '#5baaff', children, pad = true }) {
  return (
    <div className="w-full h-full flex flex-col bg-[#0a1628] border border-[#1a3a5c] rounded-lg overflow-hidden">
      <div className="shrink-0 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider border-b border-[#1a3a5c]"
        style={{ color: accent }}>
        {title}
      </div>
      <div className={`flex-1 min-h-0 overflow-auto ${pad ? 'p-2' : ''}`}>{children}</div>
    </div>
  )
}

// The Message feed reads bottom-up like a comms log: newest message at the
// BOTTOM, older ones scrolling off the top, and the timestamp beside each line
// is the in-game Clock (HH:MM:SS) at the moment it arrived. `mt-auto` keeps the
// list pinned to the bottom (so a short list fills from the bottom rather than
// leaving a gap), and we auto-scroll to the newest whenever one lands.
function MessagePanel({ messages }) {
  const scrollRef = useRef(null)
  const lastId = messages.length ? messages[messages.length - 1].id : null
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])
  return (
    <div className="w-full h-full flex flex-col bg-[#0a1628] border border-[#1a3a5c] rounded-lg overflow-hidden">
      <div className="shrink-0 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider border-b border-[#1a3a5c]" style={{ color: '#5baaff' }}>
        Message
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col">
        <ul className="mt-auto space-y-1">
          {messages.map(m => (
            <li key={m.id} className="text-[11px] leading-snug text-[#ddeaf8] flex gap-2">
              <span className="text-slate-500 font-mono shrink-0">{m.wall}</span>
              <span>{m.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function EnginePanel({ fuel, onToggle }) {
  const levels = fuel.map(f => f.level)
  const maxLevel = Math.max(...levels)
  const spread = maxLevel - Math.min(...levels)
  const bad = spread > FUEL_MAX_SPREAD
  // Every tank has to stay within FUEL_MAX_SPREAD of the fullest one.
  const floor = maxLevel - FUEL_MAX_SPREAD
  return (
    <Panel title="Engine">
      <p className="text-[10px] text-slate-400 mb-2">
        One tank feeds at a time (it drains). Keep all tanks within {FUEL_MAX_SPREAD} L — switch the feed to the fullest tank.
      </p>
      <div className="flex items-end justify-around gap-2 h-[62%] min-h-[150px]">
        {fuel.map((f, i) => {
          const pct = Math.max(0, Math.min(100, (f.level / 500) * 100))
          const low = f.level < floor
          return (
            <div key={i} className="flex-1 flex flex-col items-center h-full">
              <div className="relative flex-1 min-h-0 w-10 bg-[#060e1a] border border-[#1a3a5c] rounded overflow-hidden">
                <div className="absolute bottom-0 left-0 right-0 transition-[height] duration-100"
                  style={{ height: `${pct}%`, background: f.on ? '#22c55e' : low ? '#ef4444' : '#5baaff' }} />
              </div>
              <p className={`shrink-0 text-base font-mono font-bold mt-1 ${low ? 'text-red-400' : 'text-[#ddeaf8]'}`}>
                {Math.round(f.level)}<span className="text-[10px] font-normal text-slate-500 ml-0.5">L</span>
              </p>
              <button
                onClick={() => onToggle(i)}
                data-demo-answer
                className={`mt-1 w-10 shrink-0 px-1 py-3 text-xs font-bold rounded transition-colors cursor-pointer ${
                  f.on ? 'bg-green-600 text-white' : 'bg-[#1a3a5c] text-[#ddeaf8] hover:bg-[#254a6e]'
                }`}
              >
                {f.on ? 'ON' : 'OFF'}
              </button>
            </div>
          )
        })}
      </div>
      <p className={`text-[11px] font-bold mt-2 ${bad ? 'text-red-400' : 'text-green-400'}`}>
        Spread: {Math.round(spread)} L {bad ? '— imbalance!' : '— OK'}
      </p>
    </Panel>
  )
}

function NavigationPanel({ speed, requiredSpeed, onAdjust }) {
  const diff = speed - requiredSpeed
  const ok = Math.abs(diff) <= SPEED_TOL
  return (
    <Panel title="Navigation">
      <div className="flex flex-col items-center justify-center gap-2 h-full">
        <div className="flex gap-6 items-end">
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">Current</p>
            <p className={`text-3xl font-mono font-bold ${ok ? 'text-green-400' : 'text-red-400'}`}>{Math.round(speed)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">Required</p>
            <p className="text-3xl font-mono font-bold text-red-400">{requiredSpeed}</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-400">Hold within ±{SPEED_TOL} kts (aim for required + {SPEED_TOL})</p>
        <div className="flex gap-3">
          <button onClick={() => onAdjust(-SPEED_STEP)} className="px-4 py-2 bg-[#1a3a5c] hover:bg-[#254a6e] text-white text-lg font-bold rounded cursor-pointer">−</button>
          <button onClick={() => onAdjust(SPEED_STEP)} className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-lg font-bold rounded cursor-pointer">+</button>
        </div>
      </div>
    </Panel>
  )
}

// Hoisted (never define a component inside another's render — it remounts the
// subtree each render; see the numpad regression in project memory).
function SensorRow({ label, rem, kind, onActivate }) {
  const overdue = rem < 0
  const armed = rem <= SENSOR_ARM_WINDOW / 1000
  return (
    <div className="flex items-center justify-between gap-2 bg-[#060e1a] border border-[#1a3a5c] rounded px-2 py-1.5">
      <span className="text-[11px] text-[#ddeaf8]">{label}</span>
      <span className={`text-[11px] font-mono ${overdue ? 'text-red-400 font-bold' : armed ? 'text-amber-400' : 'text-slate-400'}`}>
        {overdue ? 'OVERDUE' : `${Math.ceil(rem)}s`}
      </span>
      <button onClick={() => onActivate(kind)} data-demo-answer
        className={`px-2 py-1 text-[10px] font-bold rounded cursor-pointer transition-colors ${
          armed || overdue ? 'bg-brand-600 hover:bg-brand-700 text-white' : 'bg-[#1a3a5c] text-[#ddeaf8] hover:bg-[#254a6e]'
        }`}>
        Activate
      </button>
    </div>
  )
}

function SensorPanel({ elapsedMs, camera, requiredCamera, airDueAt, groundDueAt, onCamera, onActivate }) {
  const airRem = (airDueAt - elapsedMs) / 1000
  const groundRem = (groundDueAt - elapsedMs) / 1000
  return (
    <Panel title="Sensor">
      <div className="space-y-2">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">Camera {requiredCamera && <span className="text-amber-400">— order: {requiredCamera}</span>}</p>
          <div className="flex gap-2">
            {['Alpha', 'Bravo'].map(c => (
              <button key={c} onClick={() => onCamera(c)} data-demo-answer
                className={`flex-1 px-2 py-1.5 text-[11px] font-bold rounded cursor-pointer transition-colors ${
                  camera === c ? 'bg-green-600 text-white' : 'bg-[#1a3a5c] text-[#ddeaf8] hover:bg-[#254a6e]'
                }`}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <SensorRow label="Air sensor (every 45s)" rem={airRem} kind="air" onActivate={onActivate} />
        <SensorRow label="Ground sensor (every 90s)" rem={groundRem} kind="ground" onActivate={onActivate} />
      </div>
    </Panel>
  )
}

function MissionPanel({ onRelease }) {
  return (
    <Panel title="Mission">
      <div className="flex flex-col items-center justify-center gap-3 h-full">
        <p className="text-[10px] text-slate-400 text-center">
          Release the <b className="text-[#ddeaf8]">package</b> at its scheduled time — read the ordered station in Message and watch the Clock.
        </p>
        {/* Three drop stations — the panel says neither which one nor when. Both
            the station and its time live only in Message, so the release is a
            pure memory-updating task with no cue on the panel itself. */}
        <div className="flex gap-2">
          {Array.from({ length: LOAD_POINTS }, (_, i) => (
            <button key={i} onClick={() => onRelease(i)} data-demo-answer
              className="px-4 py-3 text-xs font-extrabold rounded cursor-pointer transition-colors bg-[#1a3a5c] text-[#ddeaf8] hover:bg-[#254a6e]">
              {stationName(i)}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  )
}

function SystemPanel({ pressure, pump, code, codeEntry, elapsedMs, onPump, onDigit, onClearCode, onSubmitCode }) {
  const zone = pressure < PRESS_LOW ? 'LOW' : pressure > PRESS_HIGH ? 'HIGH' : 'CORRECT'
  const zoneCol = zone === 'CORRECT' ? 'text-green-400' : 'text-red-400'
  // Gauge fill 60–140 mapped to 0–100%.
  const gaugePct = (v) => Math.max(0, Math.min(100, ((v - 60) / 80) * 100))
  const fillPct = gaugePct(pressure)
  const codeRem = code ? Math.ceil((code.dueAt - elapsedMs) / 1000) : null
  // OK only accepts in the final CODE_SUBMIT_WINDOW; before that, count down to it.
  const submitOpen = !!code && elapsedMs >= code.dueAt - CODE_SUBMIT_WINDOW
  const armRem = code ? Math.ceil((code.dueAt - CODE_SUBMIT_WINDOW - elapsedMs) / 1000) : null
  return (
    <Panel title="System">
      <div className="flex gap-2 sm:gap-3 h-full min-h-0">
        {/* Hydraulic pressure — narrower on small screens so the keypad can grow;
            the gauge itself is a thin bar, so it loses nothing. */}
        <div className="flex flex-col items-center justify-between shrink-0 w-[38%] sm:w-1/2">
          <p className="text-[9px] uppercase tracking-wide text-slate-500">Hydraulic Pressure</p>
          <div className="relative flex-1 w-8 my-1 bg-[#060e1a] border border-[#1a3a5c] rounded overflow-hidden">
            {/* correct band, tinted behind the fill */}
            <div className="absolute left-0 right-0 bg-green-500/20"
              style={{ bottom: `${gaugePct(PRESS_LOW)}%`, height: `${gaugePct(PRESS_HIGH) - gaugePct(PRESS_LOW)}%` }} />
            <div className="absolute bottom-0 left-0 right-0 transition-[height] duration-100"
              style={{ height: `${fillPct}%`, background: zone === 'CORRECT' ? '#22c55e' : '#ef4444' }} />
            {/* band limits drawn over the fill so the target range stays readable at any level */}
            <div className="absolute left-0 right-0 h-px bg-green-200" style={{ bottom: `${gaugePct(PRESS_LOW)}%` }} />
            <div className="absolute left-0 right-0 h-px bg-green-200" style={{ bottom: `${gaugePct(PRESS_HIGH)}%` }} />
          </div>
          <p className={`text-base font-mono font-bold ${zoneCol}`}>{Math.round(pressure)}</p>
          <p className="text-[10px] font-mono text-slate-500">{PRESS_LOW}–{PRESS_HIGH}</p>
          <p className={`text-[9px] font-bold ${zoneCol}`}>{zone}</p>
          <button onClick={onPump} data-demo-answer
            className={`mt-1 px-3 py-1 text-[10px] font-bold rounded cursor-pointer transition-colors ${
              pump ? 'bg-green-600 text-white' : 'bg-[#1a3a5c] text-[#ddeaf8] hover:bg-[#254a6e]'
            }`}>
            Pump {pump ? 'ON' : 'OFF'}
          </button>
        </div>
        {/* Comms code keypad — fills the panel height so the keys are thumb-sized */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <p className="text-[9px] uppercase tracking-wide text-slate-500">Comms Code</p>
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-lg text-[#ddeaf8] tracking-widest">{codeEntry.padEnd(3, '·')}</span>
            {code
              ? submitOpen
                ? <span className={`text-[10px] font-mono ${codeRem <= 5 ? 'text-red-400' : 'text-amber-400'}`}>{codeRem}s</span>
                : <span className="text-[10px] font-mono text-slate-400">submit in {armRem}s</span>
              : <span className="text-[10px] text-slate-600">no code</span>}
          </div>
          {/* Keypad is inert until a code is actually issued. */}
          {/* Below sm the keys grow to a chunky 4:3 tile; sm+ keeps the original
              flat keypad. The keys are never stretched to fill the panel. */}
          <div className={`grid grid-cols-3 gap-1 ${code ? '' : 'opacity-40 pointer-events-none'}`} aria-disabled={!code}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button key={d} onClick={() => onDigit(d)} disabled={!code} className="aspect-[4/3] sm:aspect-auto sm:py-1 bg-[#0f2240] hover:bg-[#163055] text-[#ddeaf8] font-mono text-base sm:text-sm rounded cursor-pointer disabled:cursor-not-allowed">{d}</button>
            ))}
            <button onClick={onClearCode} disabled={!code} className="aspect-[4/3] sm:aspect-auto sm:py-1 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-[11px] sm:text-[10px] font-bold rounded cursor-pointer disabled:cursor-not-allowed">CLR</button>
            <button onClick={() => onDigit('0')} disabled={!code} className="aspect-[4/3] sm:aspect-auto sm:py-1 bg-[#0f2240] hover:bg-[#163055] text-[#ddeaf8] font-mono text-base sm:text-sm rounded cursor-pointer disabled:cursor-not-allowed">0</button>
            <button onClick={onSubmitCode} disabled={!submitOpen} className="aspect-[4/3] sm:aspect-auto sm:py-1 bg-brand-600 hover:bg-brand-700 text-white text-[11px] sm:text-[10px] font-bold rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-40">OK</button>
          </div>
        </div>
      </div>
    </Panel>
  )
}

// Six-button multifunction index for one display stack. A label too wide for its
// key is clipped at the right edge rather than wrapped or shrunk — half of
// "NAVIGATION" still reads as Navigation, and every key stays the same size.
function NavButtons({ active, onSelect }) {
  return (
    <div className="w-full h-full flex gap-1">
      {SYSTEMS.map(k => (
        // Swapping displays is the game — a demo card that never presses these
        // shows the same two panels for its whole run.
        <button key={k} onClick={() => onSelect(k)} data-demo-answer
          className={`flex-1 min-w-0 overflow-hidden rounded px-1 text-left text-[10px] sm:text-[11px] font-bold uppercase tracking-tight sm:tracking-wide whitespace-nowrap transition-colors cursor-pointer ${
            active === k ? 'bg-green-600 text-white' : 'bg-[#0f2240] text-[#ddeaf8] hover:bg-[#163055] hover:text-white'
          }`}>
          {SYSTEM_LABELS[k]}
        </button>
      ))}
    </div>
  )
}

// ── Commentary column (desktop only) ─────────────────────────────────────────
// A full-height, collapsible running log of every score change, off to the right
// so it never sits over the gameplay panels. Mirrors the Recent Scores aside on
// the CBAT hub — lg+ only. When minimised it collapses to a slim reopen tab.
const ARENA_STYLE = { height: '84vh', minHeight: 600 }

function CommentaryPanel({ log, open, onToggle }) {
  if (!open) {
    return (
      <aside className="hidden lg:block lg:shrink-0 lg:sticky lg:top-2" style={ARENA_STYLE}>
        <button onClick={onToggle} title="Show commentary"
          className="w-8 h-full flex flex-col items-center gap-2 pt-2 bg-[#0a1628] border border-[#1a3a5c] rounded-lg text-slate-400 hover:text-brand-600 cursor-pointer">
          <span className="text-xs">◀</span>
          <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ writingMode: 'vertical-rl' }}>Commentary</span>
        </button>
      </aside>
    )
  }
  return (
    <aside className="hidden lg:block lg:w-[300px] lg:shrink-0 lg:sticky lg:top-2" style={ARENA_STYLE}>
      <div className="w-full h-full flex flex-col bg-[#0a1628] border border-[#1a3a5c] rounded-lg overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-[#1a3a5c]">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-500">Commentary</span>
          <button onClick={onToggle} title="Minimise"
            className="text-slate-400 hover:text-brand-600 text-[10px] font-bold uppercase tracking-wide px-1 cursor-pointer">
            Hide ▶
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1">
          {log.length === 0
            ? <p className="text-[11px] text-slate-600 italic">Score events will appear here…</p>
            : log.map(e => (
              <div key={e.id} className="flex items-baseline gap-2 text-[11px] leading-snug">
                <span className="text-slate-600 font-mono shrink-0">{fmtClock(e.t)}</span>
                <span className={`font-mono font-bold shrink-0 ${e.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {e.delta >= 0 ? `+${e.delta}` : e.delta}
                </span>
                <span className="text-[#ddeaf8] min-w-0">{e.text}</span>
              </div>
            ))}
        </div>
      </div>
    </aside>
  )
}


// ── Results ──────────────────────────────────────────────────────────────────
function ResultsScreen({ stats, tuning }) {
  const g = grade(stats.totalScore, tuning)
  const row = (label, val, sub) => (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-mono font-bold text-brand-600">{val}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center">
      <p className="text-4xl mb-2">{g.emoji}</p>
      <p className={`text-xl font-extrabold mb-1 ${g.color}`}>{g.label}</p>
      <p className="text-sm text-slate-400 mb-4">Cognitive Updating Test Complete</p>
      <div className="grid grid-cols-2 gap-2">
        {row('Score', stats.totalScore)}
        {row('Time in warning', `${stats.warningSeconds}s`)}
        {row('Tasks completed', stats.tasksCompleted)}
        {row('Tasks missed', stats.tasksMissed)}
      </div>

      <p className="text-[10px] text-slate-500 mt-3 uppercase tracking-wide">{tuning.label} difficulty</p>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CbatCut() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const { enterImmersive, exitImmersive } = useGameChrome()
  const isDemo = !!useCbatDemo()

  const [phase, setPhase] = useState('intro') // intro | launching | playing | results
  // Defaults to 'easier'; a user who switches gets their most recent choice
  // back on the next visit.
  const [difficulty, setDifficulty] = useState(() => initialDifficulty(readStoredCutDifficulty))
  const tuning = cutTuning(difficulty)
  // The difficulty the run on screen is being played at. Pinned at launch so a
  // mid-results switch can't relabel or misfile a finished run. Held twice on
  // purpose: the ref is what the tick loop and handlers read, the state is what
  // the render tree reads.
  const runTuningRef = useRef(tuning)
  const [runDifficulty, setRunDifficulty] = useState(difficulty)
  const runTuning = cutTuning(runDifficulty)
  const [sel1, setSel1] = useState('message')
  const [sel2, setSel2] = useState('engine')
  // Commentary column open/minimised — persisted so the choice sticks. A demo
  // tile starts it minimised whatever the visitor's own preference is: the
  // column is a fixed 300px of a 900px stage, and a landing card has better
  // uses for that width than a scrolling score log nobody can read at tile
  // size.
  const [commentaryOpen, setCommentaryOpen] = useState(() => {
    if (isDemo) return false
    try { return localStorage.getItem('cbat:cut:commentary') !== '0' } catch { return true }
  })
  const toggleCommentary = useCallback(() => {
    setCommentaryOpen(o => {
      const next = !o
      try { localStorage.setItem('cbat:cut:commentary', next ? '1' : '0') } catch { /* storage unavailable */ }
      return next
    })
  }, [])
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved] = useState(false)
  const [queued, setQueued] = useState(false)
  const [finalStats, setFinalStats] = useState(null)

  // One stable initial sim seeds both the mutable ref and the render snapshot.
  const [initialSim] = useState(() => makeSim(initialDifficulty(readStoredCutDifficulty)))
  const simRef = useRef(initialSim)
  const lastTsRef = useRef(0)
  // Render from an immutable snapshot of the sim, never the live ref (reading a
  // ref during render is disallowed by react-hooks/refs). Each tick and each
  // handler clones the ref into state to trigger a re-render with fresh values.
  const [view, setView] = useState(initialSim)
  const sync = useCallback(() => setView({ ...simRef.current }), [])

  useEffect(() => {
    if (phase === 'playing') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // While playing, widen the app-shell content on lg+ so the commentary column
  // has room beside the arena (mirrors the cbat-recent-wide pattern on the hub).
  useGameBodyClass('cbat-cut-wide', phase === 'playing')

  // Personal best
  // Per-difficulty (separate collections), so this refetches on every switch.
  const fetchPB = useCallback((gameKey) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/${gameKey}/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user, apiFetch, API])
  useEffect(() => { fetchPB(tuning.gameKey) }, [fetchPB, tuning.gameKey])

  const doFinish = useCallback(() => {
    const sim = simRef.current
    // The ref, not the runTuning state — this is the tuning the finished run was
    // actually played under.
    const playedTuning = runTuningRef.current
    const stats = {
      totalScore: Math.round(sim.score),
      tasksCompleted: sim.tasksCompleted,
      tasksMissed: sim.tasksMissed,
      warningSeconds: Math.round(sim.warningMs / 1000),
    }
    setFinalStats(stats)
    setScoreSaved(false)
    setQueued(false)
    markGameCompleted({ score: stats.totalScore })
    submitCbatResult(playedTuning.gameKey, {
      totalScore: stats.totalScore,
      totalTime: GAME_MS / 1000,
      tasksCompleted: stats.tasksCompleted,
      tasksMissed: stats.tasksMissed,
      warningSeconds: stats.warningSeconds,
    }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        fetchPB(playedTuning.gameKey)
      })
      .catch(() => {})
    setPhase('results')
  }, [apiFetch, API, markGameCompleted, fetchPB])

  // Main tick loop
  useEffect(() => {
    if (phase !== 'playing') return
    lastTsRef.current = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const dt = Math.min(250, now - lastTsRef.current)  // clamp long gaps (tab blur)
      lastTsRef.current = now
      advanceSim(simRef.current, dt)
      if (simRef.current.elapsedMs >= GAME_MS) {
        clearInterval(id)
        doFinish()
        return
      }
      sync()
    }, TICK_MS)
    return () => clearInterval(id)
  }, [phase, doFinish, sync])

  const startGame = useCallback(() => {
    simRef.current = makeSim(runTuningRef.current.key)
    setView(simRef.current)
    setSel1('message')
    setSel2('engine')
    setFinalStats(null)
    setScoreSaved(false)
    startTracking(runTuningRef.current.gameKey)
    setPhase('playing')
  }, [startTracking])

  // Pressing Start doesn't drop straight into the game: the chosen difficulty
  // button flashes on a greyed-out card for CUT_LAUNCH_MS first. A demo tile
  // skips it — the landing wall drives the Start button and shouldn't sit on a
  // dimmed card for a second of its short loop.
  const beginLaunch = useCallback(() => {
    runTuningRef.current = tuning
    setRunDifficulty(tuning.key)
    if (isDemo) startGame()
    else setPhase('launching')
  }, [tuning, isDemo, startGame])

  useEffect(() => {
    if (phase !== 'launching') return
    const t = setTimeout(() => startGame(), CUT_LAUNCH_MS)
    return () => clearTimeout(t)
  }, [phase, startGame])

  const chooseDifficulty = useCallback((key) => {
    setDifficulty(key)
    storeCutDifficulty(key)
    // The old board's best belongs to the difficulty being left.
    setPersonalBest(null)
  }, [])

  const goToIntro = useCallback(() => { setPhase('intro') }, [])

  // ── Handlers (mutate simRef, then re-render) ───────────────────────────────
  const act = (fn) => { fn(simRef.current); sync() }

  const onToggleTank = (i) => act(sim => sim.fuel.forEach((f, j) => { f.on = j === i }))
  const onAdjustSpeed = (d) => act(sim => { sim.speed = Math.max(0, sim.speed + d) })
  const onPump = () => act(sim => { sim.pump = !sim.pump })

  const onCamera = (c) => act(sim => {
    sim.camera = c
    if (sim.requiredCamera && c === sim.requiredCamera) {
      award(sim, SCORE.camera, `camera ${c} selected`)
      sim.tasksCompleted += 1
      sim.requiredCamera = null
    } else if (sim.requiredCamera && c !== sim.requiredCamera) {
      award(sim, SCORE.cameraWrong, 'wrong camera selected')
    }
  })

  const onActivate = (kind) => act(sim => {
    const dueKey = kind === 'air' ? 'airDueAt' : 'groundDueAt'
    const interval = kind === 'air' ? AIR_INTERVAL : GROUND_INTERVAL
    const rem = sim[dueKey] - sim.elapsedMs
    // Reward activating when due (or overdue); early activation just resets it.
    if (rem <= SENSOR_ARM_WINDOW) {
      award(sim, kind === 'air' ? SCORE.sensor : SCORE.sensorGround, `${kind} sensor activated on time`)
      sim.tasksCompleted += 1
    }
    sim[dueKey] = sim.elapsedMs + interval
  })

  const onRelease = (station) => act(sim => {
    if (!sim.loadArmed) return
    if (sim.loadReady && sim.elapsedMs <= sim.loadDueAt + LOAD_RELEASE_WINDOW) {
      if (station === sim.loadTarget) {
        // Right station, on time — bonus for hitting close to the scheduled second.
        const off = Math.abs(sim.elapsedMs - sim.loadDueAt)
        const bonus = Math.max(0, Math.round(10 * (1 - Math.min(1, off / LOAD_RELEASE_WINDOW))))
        award(sim, SCORE.load + bonus, `${stationName(station)} dropped on time`)
        sim.tasksCompleted += 1
        scheduleNextLoad(sim)
      } else {
        // Wrong station — the drop is consumed, no second chance. Same as a
        // successful release: schedule the next drop so the stations go inactive
        // until then (loadReady false), rather than leaving this one pending.
        award(sim, SCORE.loadWrong, `wrong station (${stationName(station)})`)
        sim.tasksMissed += 1
        pushMessage(sim, `MISSION: wrong station — ${stationName(sim.loadTarget)} drop lost`)
        scheduleNextLoad(sim)
      }
    } else {
      // Released before the scheduled drop time — the load is still pending.
      award(sim, SCORE.loadPremature, `${stationName(station)} released early`)
    }
  })

  const onDigit = (d) => act(sim => { if (sim.codeEntry.length < 3) sim.codeEntry += d })
  const onClearCode = () => act(sim => { sim.codeEntry = '' })
  const onSubmitCode = () => act(sim => {
    if (!sim.code) return
    // OK only accepts once the submission window has opened (final 15s).
    if (sim.elapsedMs < sim.code.dueAt - CODE_SUBMIT_WINDOW) return
    if (sim.codeEntry === sim.code.digits) {
      const speedBonus = Math.max(0, Math.round(SCORE.codeSpeedBonus * (sim.code.dueAt - sim.elapsedMs) / CODE_SUBMIT_WINDOW))
      award(sim, SCORE.code + speedBonus, 'comms code entered correctly')
      sim.tasksCompleted += 1
      sim.code = null
      sim.codeEntry = ''
      sim.nextCodeAt = sim.elapsedMs + randRange(...sim.tuning.codeGapMs)
    } else {
      award(sim, SCORE.codeWrong, 'wrong comms code')
      sim.codeEntry = ''
    }
  })

  // Render one system panel by key (shared by both stacks). Reads the snapshot.
  const renderPanel = (key) => {
    const sim = view
    switch (key) {
      case 'message':    return <MessagePanel messages={sim.messages} />
      case 'engine':     return <EnginePanel fuel={sim.fuel} onToggle={onToggleTank} />
      case 'navigation': return <NavigationPanel speed={sim.speed} requiredSpeed={sim.requiredSpeed} onAdjust={onAdjustSpeed} />
      case 'sensor':     return <SensorPanel elapsedMs={sim.elapsedMs} camera={sim.camera} requiredCamera={sim.requiredCamera} airDueAt={sim.airDueAt} groundDueAt={sim.groundDueAt} onCamera={onCamera} onActivate={onActivate} />
      case 'mission':    return <MissionPanel onRelease={onRelease} />
      case 'system':     return <SystemPanel pressure={sim.pressure} pump={sim.pump} code={sim.code} codeEntry={sim.codeEntry} elapsedMs={sim.elapsedMs} onPump={onPump} onDigit={onDigit} onClearCode={onClearCode} onSubmitCode={onSubmitCode} />
      default:           return null
    }
  }

  const sim = view
  const remainingMs = Math.max(0, GAME_MS - sim.elapsedMs)
  const launching = phase === 'launching'
  // During the launch flash everything on the card except the chosen difficulty
  // button greys out, so the flashing button is the only thing left alive.
  const dim = launching ? ' cbat-launch-dim' : ''

  return (
    <div className="cbat-cut-page">
      <SEO title="Cognitive Updating Test — CBAT" description="Juggle six aircraft displays at once — keep every system in tolerance while the warnings pile up." />

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
        <>
          {/* Header */}
          <div className={`flex items-center gap-2 mb-2${phase === 'launching' ? ' cbat-launch-dim' : ''}`}>
            {phase === 'intro' || phase === 'launching'
              ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
              : <CbatQuitButton onConfirm={goToIntro} confirmNeeded={phase === 'playing'} />
            }
            <h1 className="text-sm font-extrabold text-slate-900">Cognitive Updating Test</h1>
            {phase === 'playing' && <DifficultyMarker tuning={runTuning} />}
            {phase === 'playing' && (
              <span className="ml-auto font-mono text-xs text-slate-500 flex gap-3">
                <span>⏱ <span className={remainingMs < 20000 ? 'text-red-500' : 'text-slate-600'}>{fmtClock(remainingMs)}</span></span>
                <span>Score: <span className={sim.score >= 0 ? 'text-brand-500' : 'text-red-500'}>{Math.round(sim.score)}</span></span>
              </span>
            )}
          </div>

          {/* Intro */}
          {(phase === 'intro' || phase === 'launching') && (
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
              >
                <p className={`text-4xl mb-3${dim}`}>🖥️</p>

                {/* CUT_DIFFICULTIES is ordered [easier, hard], so the easier
                    option lands left of the title and hard lands right of it.
                    The title is too long to sit between them on a phone, so it
                    goes above and the pair sits under it. */}
                <p className={`text-xl font-extrabold text-white mb-2${dim}`}>Cognitive Updating Test</p>
                <div className="flex items-center justify-center gap-3 mb-1">
                  <DifficultyButton
                    tuning={CUT_DIFFICULTIES[0]}
                    selected={difficulty === CUT_DIFFICULTIES[0].key}
                    onSelect={chooseDifficulty}
                    flashing={launching && difficulty === CUT_DIFFICULTIES[0].key}
                    dimmed={launching && difficulty !== CUT_DIFFICULTIES[0].key}
                  />
                  <DifficultyButton
                    tuning={CUT_DIFFICULTIES[1]}
                    selected={difficulty === CUT_DIFFICULTIES[1].key}
                    onSelect={chooseDifficulty}
                    flashing={launching && difficulty === CUT_DIFFICULTIES[1].key}
                    dimmed={launching && difficulty !== CUT_DIFFICULTIES[1].key}
                  />
                </div>
                <p className={`text-[11px] text-brand-600 mb-3${dim}`}>{tuning.blurb}</p>

                <p className={`text-sm text-slate-400 mb-5${dim}`}>
                  Six aircraft displays run at once, but you can only view two at a time. Keep every system in
                  tolerance and react to scheduled tasks — the goal is to keep the <span className="text-red-400">Warning panel</span> empty.
                </p>

                <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2 text-sm text-[#ddeaf8]${dim}`}>
                  <div className="flex items-start gap-2"><span className="text-brand-600 font-bold shrink-0">Engine</span><span>keep the three fuel tanks within {FUEL_MAX_SPREAD} L</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-600 font-bold shrink-0">Nav</span><span>hold airspeed within ±{SPEED_TOL} kts of required</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-600 font-bold shrink-0">Sensor</span><span>re-activate Air &amp; Ground sensors on time; select the ordered camera</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-600 font-bold shrink-0">Mission</span><span>drop the ordered station at its scheduled Clock time (from Message)</span></div>
                  <div className="flex items-start gap-2"><span className="text-brand-600 font-bold shrink-0">System</span><span>keep hydraulic pressure 90–110; enter comms codes in 15s</span></div>
                  <div className="flex items-start gap-2 text-xs text-[#8a9bb5] pt-1"><span className="shrink-0">🕑</span><span>The Clock shows in-game time — some tasks are scheduled to it</span></div>
                  <div className="flex items-start gap-2 text-xs text-[#8a9bb5]"><span className="shrink-0">⏱</span><span>3 minutes — the Message display feeds every task</span></div>
                </div>

                {personalBest && (
                  <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4${dim}`}>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best · {tuning.label}</p>
                    <p className="text-lg font-mono font-bold text-brand-600">{personalBest.bestScore}</p>
                    <p className="text-[10px] text-slate-500">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
                  </div>
                )}

                <div className={`text-center mb-4${dim}`}>
                  <Link to={`/cbat/${tuning.gameKey}/leaderboard`} className="text-xs text-brand-600 hover:text-brand-700 transition-colors">View Leaderboard →</Link>
                </div>

                <button onClick={beginLaunch} disabled={launching} data-demo-start className={`px-8 py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-[#1a3a5c] disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer disabled:cursor-not-allowed${dim}`}>Start</button>
              </motion.div>
            </div>
          )}

          {/* Playing — the exact 10 / 5 / 40 / 5 / 40 split */}
          {phase === 'playing' && (
            <div className="lg:flex lg:gap-3 lg:items-start">
              <div className="lg:flex-1 lg:min-w-0 flex flex-col gap-1.5" style={ARENA_STYLE}>
              {/* Warning strip — 10% */}
              <div className="flex gap-1.5" style={{ flex: '10 1 0', minHeight: 0 }}>
                <div style={{ width: '80%' }}>
                  <div className="w-full h-full flex flex-col bg-[#0a1628] border rounded-lg overflow-hidden"
                    style={{ borderColor: sim.warnings.length ? '#ef4444' : '#1a3a5c' }}>
                    {/* Below sm the header and rows tighten up so four wrapped
                        warning lines still fit the strip; sm+ keeps the original
                        sizing, which already had the room. */}
                    <div className="shrink-0 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] leading-none sm:leading-normal font-extrabold uppercase tracking-wider border-b border-[#1a3a5c] text-red-400">Warning</div>
                    <div className="flex-1 min-h-0 overflow-auto px-2 py-0.5 sm:py-1 flex flex-wrap items-start sm:items-center content-start sm:content-center gap-x-3 sm:gap-y-0.5">
                      {sim.warnings.length === 0
                        ? <span className="text-[10px] sm:text-[11px] leading-[1.1] sm:leading-snug text-green-400 font-bold">All systems nominal</span>
                        : sim.warnings.map(w => <span key={w} className="text-[10px] sm:text-[11px] leading-[1.1] sm:leading-snug text-red-400 font-bold">⚠ {w}</span>)}
                    </div>
                  </div>
                </div>
                <div style={{ width: '20%' }}>
                  <div className="w-full h-full flex flex-col bg-[#0a1628] border border-[#1a3a5c] rounded-lg overflow-hidden">
                    <div className="shrink-0 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] leading-none sm:leading-normal font-extrabold uppercase tracking-wider border-b border-[#1a3a5c] text-brand-500">Clock</div>
                    <div className="flex-1 min-h-0 flex items-center justify-center px-1 overflow-hidden">
                      {/* Fluid so HH:MM:SS always fits this narrow panel; capped at
                          the old 20px so desktop is unchanged. */}
                      <span className="font-mono font-bold leading-none text-[#ddeaf8] tabular-nums whitespace-nowrap"
                        style={{ fontSize: 'clamp(10px, 3.2vw, 20px)' }}>
                        {fmtWall(sim.clockStartSec + sim.elapsedMs / 1000)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Displays — stacked (each 45% tall) on small screens; side by side
                  (each 50% wide, full height) on desktop. The two share the 90% of
                  arena height below the warning strip either way. */}
              <div className="flex flex-col lg:flex-row gap-1.5" style={{ flex: '90 1 0', minHeight: 0 }}>
                {/* Display 1 — nav (5%) + selected panel (40%) */}
                <div className="flex flex-col gap-1.5 rounded-lg p-1.5" style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, background: 'rgba(91,170,255,0.06)', border: '1px solid rgba(91,170,255,0.18)' }}>
                  <div style={{ flex: '5 1 0', minHeight: 0 }}><NavButtons active={sel1} onSelect={setSel1} /></div>
                  <div style={{ flex: '40 1 0', minHeight: 0 }}>{renderPanel(sel1)}</div>
                </div>

                {/* Display 2 — nav (5%) + selected panel (40%) */}
                <div className="flex flex-col gap-1.5 rounded-lg p-1.5" style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, background: 'rgba(250,204,21,0.05)', border: '1px solid rgba(250,204,21,0.16)' }}>
                  <div style={{ flex: '5 1 0', minHeight: 0 }}><NavButtons active={sel2} onSelect={setSel2} /></div>
                  <div style={{ flex: '40 1 0', minHeight: 0 }}>{renderPanel(sel2)}</div>
                </div>
              </div>
              </div>

              {/* Running score commentary — desktop only, collapsible */}
              <CommentaryPanel log={sim.log} open={commentaryOpen} onToggle={toggleCommentary} />
            </div>
          )}

          {/* Results */}
          {phase === 'results' && finalStats && (
            <div className="flex flex-col items-center">
              <CbatGameOver
                gameKey={runTuning.gameKey}
                score={finalStats.totalScore}
                scoreSaved={scoreSaved}
                queued={queued}
                personalBest={personalBest}
                onPlayAgain={() => { setScoreSaved(false); startGame() }}
              >
                <ResultsScreen stats={finalStats} tuning={runTuning} />
              </CbatGameOver>
            </div>
          )}
        </>
      )}
    </div>
  )
}
