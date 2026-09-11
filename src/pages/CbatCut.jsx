import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import CbatQuitButton from '../components/CbatQuitButton'
import CbatGameOver from '../components/CbatGameOver'
import { CbatModeRow, ModeMarker } from '../components/CbatModeSelector'
import CbatPersonalBest from '../components/CbatPersonalBest'
import CbatIntroLabel from '../components/cbat/CbatIntroLabel'
import { useCbatPersonalBest } from '../hooks/useCbatPersonalBest'
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

// ── Tutorial ─────────────────────────────────────────────────────────────────
// A walkthrough of a FROZEN board. CUT has the steepest learning curve of any
// game on the roster (measured across players with 5+ runs, mean score by run
// number runs 298, 403, 460, 552, 623, 645, 708 against a population median of
// 604), and almost all of that climb is learning where things are rather than
// getting better at the underlying task. This exists to take that first slice
// off, so an early score says something about the player instead of about how
// many times they have seen the layout.
//
// It costs almost nothing to run because `advanceSim(sim, dt)` is a pure
// function of an explicit dt: not calling it IS the pause. So these are the
// real panels reading a real sim state, not mock-ups that can drift away from
// the game they are teaching.
//
// Per-playthrough id for tutorial usage tracking. Stamped once per mount; the
// backend dedupes/upserts on it so repeated progress reports for the same
// playthrough never create a second row.
function makeTutorialRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `tut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

// A fresh sim, plus the two states a board frozen at t=0 would never show on its
// own: a standing camera order, and a live comms code with its OK already armed.
// Without them the Sensor and System steps would be teaching greyed-out controls.
function makeTutorialSim() {
  const sim = makeSim('easier')
  sim.requiredCamera = 'Bravo'
  // dueAt exactly one submit window out, so `elapsedMs >= dueAt - CODE_SUBMIT_WINDOW`
  // is true at t=0 and the keypad shows its live state rather than "submit in Ns".
  sim.code = { digits: '472', dueAt: CODE_SUBMIT_WINDOW }
  return sim
}

const CUT_TUTORIAL_STEPS = [
  {
    focus: 'nav',
    title: 'Two windows, six displays',
    body: 'Six displays run at once but you only get two windows to show them in. These six buttons above each window choose what that window shows. Swapping between them is the whole game, so get used to reaching for them.',
  },
  {
    focus: 'strip',
    title: 'Warnings and the clock',
    body: 'Anything left out of tolerance is listed on the left, and your score drops for every second a warning sits there. Keeping this strip clear is the main job. On the right is the time inside the aircraft, not the time you have left. One task is scheduled against that clock.',
  },
  {
    focus: 'message',
    title: 'Message',
    body: 'Every order arrives here and nowhere else. There is nothing to click, you just read it. The drop order matters most, because it is said once and never repeated.',
  },
  {
    focus: 'engine',
    title: 'Engine',
    body: 'Three fuel tanks, and only the one switched ON is draining. Keep all three within 50 litres of each other by switching the feed to whichever tank is fullest. Try tapping a tank button now.',
  },
  {
    focus: 'navigation',
    title: 'Navigation',
    body: 'Airspeed bleeds away on its own the whole time. The minus and plus buttons move it 2 knots a tap, and you need to stay within 10 knots of Required. A new Required speed comes through on Message every so often.',
  },
  {
    focus: 'sensor',
    title: 'Sensor',
    body: 'Three jobs on one display. A camera order tells you to switch to Alpha or Bravo. The air sensor needs re-activating every 45 seconds and the ground sensor every 90. Both count down in front of you.',
  },
  {
    focus: 'mission',
    title: 'Mission',
    body: 'This is the memory one. The panel never tells you which station to drop or when, because that came through on Message and you have to hold it in your head. Watch the clock and press the right station when its time arrives.',
  },
  {
    focus: 'system',
    title: 'System',
    body: 'Two jobs again. The pump holds hydraulic pressure between 90 and 110, on to raise it and off to let it fall. The keypad takes 3 digit comms codes, and OK only wakes up for the last 15 seconds of a code, so enter the digits early and wait.',
  },
]

// Shorter than the live arena because the coach card sits above it.
const TUTORIAL_ARENA_STYLE = { height: '62vh', minHeight: 400 }

function TutorialComplete({ onExit }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-5xl mb-3">✅</p>
      <p className="text-2xl font-extrabold text-white mb-1">Tutorial Complete</p>
      <p className="text-sm text-slate-400 mb-6">That is every display. The real thing runs for 3 minutes and nothing waits for you.</p>
      <button
        onClick={onExit}
        className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
      >
        Back to Briefing
      </button>
    </motion.div>
  )
}

function CutTutorial({ onExit, onProgress }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [runId] = useState(makeTutorialRunId)

  // Same simRef + snapshot split the live game uses, minus the tick loop. The
  // sim only ever changes when the user presses something.
  const [initialSim] = useState(makeTutorialSim)
  const simRef = useRef(initialSim)
  const [view, setView] = useState(initialSim)
  const sync = useCallback(() => setView({ ...simRef.current }), [])

  const step = CUT_TUTORIAL_STEPS[stepIdx]
  const focusIsPanel = SYSTEMS.includes(step.focus)

  // A step about one display puts it in the left window, so the thing being
  // described is the thing on screen. The user can still swap either window,
  // and that choice is stamped with the step it was made on so it clears itself
  // when the step moves — derived, rather than a state resync in an effect.
  const [pick1, setPick1] = useState(null)
  const [sel2, setSel2] = useState('engine')
  const sel1 = pick1?.step === stepIdx ? pick1.key
    : focusIsPanel ? step.focus
    : 'message'
  const setSel1 = (key) => setPick1({ step: stepIdx, key })

  useEffect(() => {
    onProgress?.({ clientRunId: runId, furthestStep: stepIdx, totalSteps: CUT_TUTORIAL_STEPS.length, completed: false })
  }, [stepIdx, runId, onProgress])
  useEffect(() => {
    if (done) onProgress?.({ clientRunId: runId, furthestStep: CUT_TUTORIAL_STEPS.length - 1, totalSteps: CUT_TUTORIAL_STEPS.length, completed: true })
  }, [done, runId, onProgress])

  // Deliberately non-scoring copies of the live handlers: pressing things should
  // show what the control does, not bank points on a board nobody is timing.
  const act = (fn) => { fn(simRef.current); sync() }
  const onToggleTank = (i) => act(sim => sim.fuel.forEach((f, j) => { f.on = j === i }))
  const onAdjustSpeed = (d) => act(sim => { sim.speed = Math.max(0, sim.speed + d) })
  const onPump = () => act(sim => { sim.pump = !sim.pump })
  const onCamera = (c) => act(sim => { sim.camera = c })
  const onActivate = (kind) => act(sim => {
    sim[kind === 'air' ? 'airDueAt' : 'groundDueAt'] =
      sim.elapsedMs + (kind === 'air' ? AIR_INTERVAL : GROUND_INTERVAL)
  })
  const onRelease = () => {}
  const onDigit = (d) => act(sim => { if (sim.codeEntry.length < 3) sim.codeEntry += d })
  const onClearCode = () => act(sim => { sim.codeEntry = '' })
  const onSubmitCode = () => act(sim => { sim.codeEntry = '' })

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

  if (done) {
    return (
      <div className="flex flex-col items-center">
        {/* 'viewed' vs the Skip button's 'skipped'. Both stop the auto-open, but
            the difference is the only record of whether it landed. */}
        <TutorialComplete onExit={() => onExit('viewed')} />
      </div>
    )
  }

  const sim = view
  // Lit or dimmed. `.cbat-tutorial-dim` also blocks pointer events, so only the
  // part being taught is reachable — which is the point of a spotlight.
  const cls = (lit) => (lit ? ' cbat-tutorial-pulse' : ' cbat-tutorial-dim')
  const advance = () => {
    if (stepIdx === CUT_TUTORIAL_STEPS.length - 1) setDone(true)
    else setStepIdx(i => i + 1)
  }

  return (
    <div>
      <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide text-brand-600 font-bold">Tutorial</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setStepIdx(i => Math.max(0, i - 1))}
              disabled={stepIdx === 0}
              aria-label="Previous section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 cursor-pointer"
            >
              {'‹'}
            </button>
            <span className="text-[10px] text-slate-500 tabular-nums">{stepIdx + 1} / {CUT_TUTORIAL_STEPS.length}</span>
            <button
              onClick={advance}
              aria-label="Next section"
              className="px-1.5 py-0.5 text-base leading-none text-slate-400 hover:text-brand-600 bg-transparent border-0 cursor-pointer"
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
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => onExit('skipped')}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors bg-transparent border-0 cursor-pointer"
          >
            Skip tutorial
          </button>
          <button
            onClick={advance}
            className="ml-auto px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-xs cursor-pointer"
          >
            {stepIdx === CUT_TUTORIAL_STEPS.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>

      {/* The live arena, frozen. Same structure as the playing branch so what is
          taught here is laid out exactly where it will be during a run. */}
      <div className="flex flex-col gap-1.5" style={TUTORIAL_ARENA_STYLE}>
        <div className={`flex gap-1.5${cls(step.focus === 'strip')}`} style={{ flex: '10 1 0', minHeight: 0 }}>
          <div style={{ width: '80%' }}>
            <div className="w-full h-full flex flex-col bg-[#0a1628] border border-[#1a3a5c] rounded-lg overflow-hidden">
              <div className="shrink-0 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] leading-none sm:leading-normal font-extrabold uppercase tracking-wider border-b border-[#1a3a5c] text-red-400">Warning</div>
              <div className="flex-1 min-h-0 overflow-auto px-2 py-0.5 sm:py-1 flex flex-wrap items-start sm:items-center content-start sm:content-center gap-x-3 sm:gap-y-0.5">
                <span className="text-[10px] sm:text-[11px] leading-[1.1] sm:leading-snug text-green-400 font-bold">All systems nominal</span>
              </div>
            </div>
          </div>
          <div style={{ width: '20%' }}>
            <div className="w-full h-full flex flex-col bg-[#0a1628] border border-[#1a3a5c] rounded-lg overflow-hidden">
              <div className="shrink-0 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] leading-none sm:leading-normal font-extrabold uppercase tracking-wider border-b border-[#1a3a5c] text-brand-500">Clock</div>
              <div className="flex-1 min-h-0 flex items-center justify-center px-1 overflow-hidden">
                <span className="font-mono font-bold leading-none text-[#ddeaf8] tabular-nums whitespace-nowrap" style={{ fontSize: 'clamp(10px, 3.2vw, 20px)' }}>
                  {fmtWall(sim.clockStartSec + sim.elapsedMs / 1000)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-1.5" style={{ flex: '90 1 0', minHeight: 0 }}>
          <div className="flex flex-col gap-1.5 rounded-lg p-1.5" style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, background: 'rgba(91,170,255,0.06)', border: '1px solid rgba(91,170,255,0.18)' }}>
            <div className={cls(step.focus === 'nav').trim()} style={{ flex: '5 1 0', minHeight: 0 }}><NavButtons active={sel1} onSelect={setSel1} /></div>
            <div className={cls(focusIsPanel).trim()} style={{ flex: '40 1 0', minHeight: 0 }}>{renderPanel(sel1)}</div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg p-1.5" style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, background: 'rgba(250,204,21,0.05)', border: '1px solid rgba(250,204,21,0.16)' }}>
            <div className={cls(step.focus === 'nav').trim()} style={{ flex: '5 1 0', minHeight: 0 }}><NavButtons active={sel2} onSelect={setSel2} /></div>
            <div className="cbat-tutorial-dim" style={{ flex: '40 1 0', minHeight: 0 }}>{renderPanel(sel2)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CbatCut() {
  const { user, setUser, apiFetch, API } = useAuth()
  const { start: startTracking, markCompleted: markGameCompleted } = useCbatTracking()
  const { enterImmersive, exitImmersive } = useGameChrome()
  const isDemo = !!useCbatDemo()

  const [phaseState, setPhase] = useState('intro') // intro | launching | playing | tutorial | results
  // Defaults to 'easier'; a user who switches gets their most recent choice
  // back on the next visit.
  const [difficulty, setDifficulty] = useState(() => initialDifficulty(readStoredCutDifficulty))
  const tuning = cutTuning(difficulty)

  // Keyed by board, so flipping mode never shows one board's score under
  // another's name and never blanks the panel while the new one loads.
  const { best: personalBest, loading: bestLoading, refresh: fetchPB } =
    useCbatPersonalBest(tuning.gameKey, { user, apiFetch, API })

  // The tutorial opens itself the first time someone lands on CUT, because the
  // players it is for are exactly the ones who would never go looking for it.
  // Gated on never having been offered it AND having no score on this board, so
  // it cannot interrupt somebody already partway through learning the game.
  //
  // DERIVED rather than pushed into state from an effect, because a personal
  // best arrives asynchronously and an effect would be racing it.
  //
  // `tutorialDismissed` is the local half and it is load-bearing, not a
  // belt-and-braces extra. Closing the tutorial also patches `user.tutorials`,
  // but that patch can fail or be swallowed, and if the only thing suppressing
  // this were the patched user then a failed write would put the player back in
  // a walkthrough they had just closed, with no way out. Getting out has to work
  // whether or not the network does.
  const [tutorialDismissed, setTutorialDismissed] = useState(false)
  const autoOfferTutorial = !tutorialDismissed
    && !isDemo && !!user && phaseState === 'intro'
    && !bestLoading && !personalBest
    && (user.tutorials?.cbat_cut ?? 'unseen') === 'unseen'
  const phase = autoOfferTutorial ? 'tutorial' : phaseState
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
    // Hide the nav chrome during the live game and the tutorial alike — the
    // tutorial lays the board out exactly where the run will put it.
    if (phase === 'playing' || phase === 'tutorial') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Fire-and-forget tutorial usage tracking (admin Reports per-step drop-off).
  // Online-only by design — a learning aid, not a score, so no offline outbox.
  const reportTutorialProgress = useCallback((body) => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/cut/tutorial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  }, [user, apiFetch, API])

  // Remember that this player has been offered the tutorial, so the auto-open
  // below fires once and never again. Patched locally as well as on the server
  // because the effect reads the in-memory user, not a refetch.
  const markTutorialSeen = useCallback((status) => {
    setUser?.(u => (u ? { ...u, tutorials: { ...(u.tutorials ?? {}), cbat_cut: status } } : u))
    apiFetch(`${API}/api/users/me/tutorials`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorialId: 'cbat_cut', status }),
    }).catch(() => {})
  }, [setUser, apiFetch, API])

  const openTutorial = useCallback(() => setPhase('tutorial'), [])
  const closeTutorial = useCallback((status) => {
    setTutorialDismissed(true)
    markTutorialSeen(status)
    setPhase('intro')
  }, [markTutorialSeen])

  // While playing, widen the app-shell content on lg+ so the commentary column
  // has room beside the arena (mirrors the cbat-recent-wide pattern on the hub).
  useGameBodyClass('cbat-cut-wide', phase === 'playing')

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

  // Keyed to `phase` alone. Depending on startGame meant any re-render
  // that changed its identity cleared the pending timeout and started a
  // fresh one, so an unrelated render could quietly extend the flash.
  const startGameRef = useRef(startGame)
  useEffect(() => { startGameRef.current = startGame })
  useEffect(() => {
    if (phase !== 'launching') return
    const t = setTimeout(() => startGameRef.current(), CUT_LAUNCH_MS)
    return () => clearTimeout(t)
  }, [phase])

  const chooseDifficulty = useCallback((key) => {
    setDifficulty(key)
    storeCutDifficulty(key)
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
              : <CbatQuitButton
                  // Backing out of the tutorial counts as having been offered it,
                  // same as the Skip button — otherwise it would reopen by itself
                  // on the next visit.
                  onConfirm={phase === 'tutorial' ? () => closeTutorial('skipped') : goToIntro}
                  confirmNeeded={phase === 'playing'}
                />
            }
            <h1 className="text-sm font-extrabold text-slate-900">Cognitive Updating Test</h1>
            {phase === 'playing' && <ModeMarker mode={runTuning} />}
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
                className="w-full max-w-md lg:max-w-2xl bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 lg:p-9 text-center"
              >
                <p className={`text-4xl lg:text-5xl mb-3${dim}`}>🖥️</p>

                {/* CUT_DIFFICULTIES is ordered [easier, hard], so the easier
                    option lands left of the title and hard lands right of it.
                    The title is too long to sit between them on a phone, so it
                    goes above and the pair sits under it. */}
                <p className={`text-xl lg:text-2xl font-extrabold text-white mb-2${dim}`}>Cognitive Updating Test</p>
                <CbatModeRow
                  modes={CUT_DIFFICULTIES}
                  value={difficulty}
                  onSelect={chooseDifficulty}
                  launching={launching}
                />
                <p className={`text-[11px] text-brand-600 mb-3${dim}`}>{tuning.blurb}</p>

                <p className={`text-sm lg:text-base text-slate-400 mb-5 lg:mb-7 lg:max-w-lg lg:mx-auto${dim}`}>
                  Six aircraft displays run at once, but you can only view two at a time. Keep every system in
                  tolerance and react to scheduled tasks — the goal is to keep the <span className="text-red-400">Warning panel</span> empty.
                </p>

                <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 lg:p-6 mb-5 lg:mb-7 text-left space-y-2 lg:space-y-3 text-sm lg:text-base text-[#ddeaf8]${dim}`}>
                  <div className="flex items-start gap-3"><CbatIntroLabel>Engine</CbatIntroLabel><span className="pt-0.5">keep the three fuel tanks within {FUEL_MAX_SPREAD} L</span></div>
                  <div className="flex items-start gap-3"><CbatIntroLabel>Nav</CbatIntroLabel><span className="pt-0.5">hold airspeed within ±{SPEED_TOL} kts of required</span></div>
                  <div className="flex items-start gap-3"><CbatIntroLabel>Sensor</CbatIntroLabel><span className="pt-0.5">re-activate Air &amp; Ground sensors on time; select the ordered camera</span></div>
                  <div className="flex items-start gap-3"><CbatIntroLabel>Mission</CbatIntroLabel><span className="pt-0.5">drop the ordered station at its scheduled Clock time (from Message)</span></div>
                  <div className="flex items-start gap-3"><CbatIntroLabel>System</CbatIntroLabel><span className="pt-0.5">keep hydraulic pressure 90–110; enter comms codes in 15s</span></div>
                  <div className="flex items-start gap-3 text-xs lg:text-sm text-[#8a9bb5] border-t border-[#1a3a5c] pt-2 lg:pt-3 mt-1"><span className="shrink-0 w-8 text-center lg:text-lg" aria-hidden>{'🕑'}</span><span className="pt-0.5">The Clock shows in-game time — some tasks are scheduled to it</span></div>
                  <div className="flex items-start gap-3 text-xs lg:text-sm text-[#8a9bb5]"><span className="shrink-0 w-8 text-center lg:text-lg" aria-hidden>{'⏱'}</span><span className="pt-0.5">3 minutes — the Message display feeds every task</span></div>
                </div>

                <CbatPersonalBest label={tuning.label} best={personalBest} loading={bestLoading} className={dim}>
                  {best => best.bestScore}
                </CbatPersonalBest>

                <div className={`text-center mb-4${dim}`}>
                  <Link to={`/cbat/${tuning.gameKey}/leaderboard`} className="text-xs lg:text-sm text-brand-600 hover:text-brand-700 transition-colors">View Leaderboard →</Link>
                </div>

                <div className="flex flex-wrap gap-3 justify-center">
                  <button onClick={beginLaunch} disabled={launching} data-demo-start className={`px-8 py-3 lg:px-10 lg:py-3.5 bg-brand-600 hover:bg-brand-700 disabled:bg-[#1a3a5c] disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm lg:text-base cursor-pointer disabled:cursor-not-allowed${dim}`}>Start</button>
                  <button onClick={openTutorial} disabled={launching} className={`px-6 py-3 lg:px-8 lg:py-3.5 bg-[#1a3a5c] hover:bg-[#254a6e] disabled:text-slate-500 text-[#ddeaf8] font-bold rounded-lg transition-colors text-sm lg:text-base cursor-pointer disabled:cursor-not-allowed${dim}`}>Tutorial</button>
                </div>
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

          {/* Tutorial — a frozen board, walked through one display at a time.
              Always exits back to the briefing rather than straight into a run,
              so starting a scored game is still a deliberate press. */}
          {phase === 'tutorial' && (
            <CutTutorial onExit={closeTutorial} onProgress={reportTutorialProgress} />
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
