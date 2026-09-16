import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import { CbatGameHeader } from '../components/cbat/CbatTestChrome'
import { useCbatTheme } from '../hooks/useCbatTheme'
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
  makeSim, advanceSim, computeWarnings, scheduleNextLoad, pushMessage, rand, randRange, code3, fmtWall, fmtClock,
  FUEL_MAX_SPREAD, SPEED_TOL, SPEED_STEP, SENSOR_ARM_WINDOW,
  AIR_INTERVAL, GROUND_INTERVAL, LOAD_RELEASE_WINDOW, LOAD_POINTS, stationName,
  PRESS_LOW, PRESS_HIGH, CODE_WINDOW, CODE_SUBMIT_WINDOW,
  MISSION_FIELDS, MISSION_FIELD_BY_KEY, DISPENSER_LIGHTS, RELEASE_WINDOW,
  CAMERA_WINDOW, CAMERA_EARLY_TOL, CODE_ACK_WINDOW,
  orderMissionField, orderCamera, resetDispenser, fmtFieldValue,
} from '../utils/cbat/cutSim'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import { useCbatDemo } from '../utils/cbat/demoMode'
import GuideArrow, { GuideOk } from '../components/cbat/GuideArrow'

// ── Panels ───────────────────────────────────────────────────────────────────
function Panel({ title, accent = 'var(--color-game-accent)', children, pad = true }) {
  return (
    <div className="w-full h-full flex flex-col bg-game-panel border border-game-line rounded-lg overflow-hidden">
      <div className="shrink-0 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider border-b border-game-line"
        style={{ color: accent }}>
        {title}
      </div>
      {/* `cbat-panel-body` is a hook for the tutorial, which lets these overflow
          so a guide arrow hanging above a top-row control is not clipped. */}
      <div className={`cbat-panel-body flex-1 min-h-0 overflow-auto ${pad ? 'p-2' : ''}`}>{children}</div>
    </div>
  )
}

// The Message feed reads bottom-up like a comms log: newest message at the
// BOTTOM, older ones scrolling off the top, and the timestamp beside each line
// is the in-game Clock (HH:MM:SS) at the moment it arrived. `mt-auto` keeps the
// list pinned to the bottom (so a short list fills from the bottom rather than
// leaving a gap), and we auto-scroll to the newest whenever one lands.
//
// `litId` / `arrowId` / `emphasis` are tutorial-only: the line to light up, the
// line to point at, and which token of the lit line to call out — 'time' for
// its HH:MM:SS, 'station' for its "Station N". All default off, so a run
// renders exactly as before.
const EMPHASIS_RE = { time: /(\d{2}:\d{2}:\d{2})/, station: /(Station \d)/, code: /(\b\d{3}\b)/, value: /(\S+)$/ }

function emphasise(text, emphasis) {
  const re = EMPHASIS_RE[emphasis]
  if (!re) return text
  // split on a capturing group keeps the token as its own part.
  return text.split(re).map((part, i) =>
    re.test(part) ? <strong key={i} className="cbat-tutorial-emph">{part}</strong> : part)
}

function MessagePanel({ messages, litId = null, arrowId = null, emphasis = null }) {
  const scrollRef = useRef(null)
  const lastId = messages.length ? messages[messages.length - 1].id : null
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])
  return (
    <div className="w-full h-full flex flex-col bg-game-panel border border-game-line rounded-lg overflow-hidden">
      <div className="shrink-0 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider border-b border-game-line" style={{ color: 'var(--color-game-accent)' }}>
        Message
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col">
        <ul className="mt-auto space-y-1">
          {messages.map(m => (
            <li key={m.id} className="text-[11px] leading-snug text-game-text flex gap-2 items-baseline">
              {m.id === arrowId && <GuideArrow dir="right" inline />}
              <span className="text-slate-500 font-mono shrink-0">{m.wall}</span>
              <span className={m.id === litId ? 'cbat-word-lit font-bold' : ''}>
                {m.id === litId ? emphasise(m.text, emphasis) : m.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// `arrowTank` / `arrowUrgent` are tutorial-only and default off.
function EnginePanel({ fuel, onToggle, arrowTank = null, arrowUrgent = false }) {
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
              <div className="relative flex-1 min-h-0 w-10 bg-game-arena border border-game-line rounded overflow-hidden">
                <div className="absolute bottom-0 left-0 right-0 transition-[height] duration-100"
                  style={{ height: `${pct}%`, background: f.on ? '#22c55e' : low ? '#ef4444' : 'var(--color-game-accent)' }} />
              </div>
              <p className={`shrink-0 text-base font-mono font-bold mt-1 ${low ? 'text-red-400' : 'text-game-text'}`}>
                {Math.round(f.level)}<span className="text-[10px] font-normal text-slate-500 ml-0.5">L</span>
              </p>
              <button
                onClick={() => onToggle(i)}
                data-demo-answer
                data-on={f.on}
                className={`cbat-pill relative mt-1 w-10 shrink-0 px-1 py-3 text-xs font-bold rounded transition-colors cursor-pointer ${
                  f.on ? 'bg-green-600 text-white' : 'bg-game-fill text-game-text hover:bg-game-fill-strong'
                }`}
              >
                {i === arrowTank && <GuideArrow dir="right" urgent={arrowUrgent} />}
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

// `arrowPlus` / `arrowMinus` / `holdOk` / `arrowUrgent` are tutorial-only and
// default off. `holdOk` is the "you are on the number, leave it" mark.
function NavigationPanel({ speed, requiredSpeed, onAdjust, arrowPlus = false, arrowMinus = false, holdOk = false, arrowUrgent = false }) {
  const diff = speed - requiredSpeed
  const ok = Math.abs(diff) <= SPEED_TOL
  return (
    <Panel title="Navigation">
      <div className="flex flex-col items-center justify-center gap-2 h-full">
        <div className="flex gap-6 items-end">
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">Current</p>
            <p className={`text-3xl font-mono font-bold flex items-center justify-center ${ok ? 'text-green-400' : 'text-red-400'}`}>
              {holdOk && <GuideOk />}
              {Math.round(speed)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">Required</p>
            <p className="text-3xl font-mono font-bold text-red-400">{requiredSpeed}</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-400">Hold within ±{SPEED_TOL} kts (aim for required + {SPEED_TOL})</p>
        <div className="flex gap-3">
          <button onClick={() => onAdjust(-SPEED_STEP)} className="cbat-pill relative px-4 py-2 bg-game-fill hover:bg-game-fill-strong text-white text-lg font-bold rounded cursor-pointer">
            {arrowMinus && <GuideArrow dir="up" urgent={arrowUrgent} />}
            −
          </button>
          <button onClick={() => onAdjust(SPEED_STEP)} className="cbat-pill relative px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-lg font-bold rounded cursor-pointer">
            {arrowPlus && <GuideArrow dir="up" urgent={arrowUrgent} />}
            +
          </button>
        </div>
      </div>
    </Panel>
  )
}

// Hoisted (never define a component inside another's render — it remounts the
// subtree each render; see the numpad regression in project memory).
// `arrow` / `urgent` are tutorial-only and default off.
function SensorRow({ label, rem, kind, onActivate, arrow = false, urgent = false }) {
  const overdue = rem < 0
  const armed = rem <= SENSOR_ARM_WINDOW / 1000
  return (
    <div className="flex items-center justify-between gap-2 bg-game-arena border border-game-line rounded px-2 py-1.5">
      <span className="text-[11px] text-game-text">{label}</span>
      <span className={`text-[11px] font-mono ${overdue ? 'text-red-400 font-bold' : armed ? 'text-amber-400' : 'text-slate-400'}`}>
        {overdue ? 'OVERDUE' : `${Math.ceil(rem)}s`}
      </span>
      <button onClick={() => onActivate(kind)} data-demo-answer data-on={armed || overdue}
        className={`cbat-pill relative px-2 py-1 text-[10px] font-bold rounded cursor-pointer transition-colors ${
          armed || overdue ? 'bg-brand-600 hover:bg-brand-700 text-white' : 'bg-game-fill text-game-text hover:bg-game-fill-strong'
        }`}>
        {arrow && <GuideArrow dir="down" urgent={urgent} />}
        Activate
      </button>
    </div>
  )
}

// `arrowCamera` / `arrowSensor` / `arrowUrgent` are tutorial-only and default off.
// `hideOrder` is the Real CBAT variant: the order names a camera AND a Clock
// time, and the panel shows neither — like the drop order, it lives in Message.
function SensorPanel({ elapsedMs, camera, requiredCamera, airDueAt, groundDueAt, onCamera, onActivate, hideOrder = false, arrowCamera = null, arrowSensor = null, arrowUrgent = false }) {
  const airRem = (airDueAt - elapsedMs) / 1000
  const groundRem = (groundDueAt - elapsedMs) / 1000
  return (
    <Panel title="Sensor">
      <div className="space-y-2">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">Camera {requiredCamera && !hideOrder && <span className="text-amber-400">— order: {requiredCamera}</span>}</p>
          <div className="flex gap-2">
            {['Alpha', 'Bravo'].map(c => (
              <button key={c} onClick={() => onCamera(c)} data-demo-answer data-on={camera === c}
                className={`cbat-pill relative flex-1 px-2 py-1.5 text-[11px] font-bold rounded cursor-pointer transition-colors ${
                  camera === c ? 'bg-green-600 text-white' : 'bg-game-fill text-game-text hover:bg-game-fill-strong'
                }`}>
                {c === arrowCamera && <GuideArrow dir="down" urgent={arrowUrgent} />}
                {c}
              </button>
            ))}
          </div>
        </div>
        <SensorRow label="Air sensor (every 45s)" rem={airRem} kind="air" onActivate={onActivate} arrow={arrowSensor === 'air'} urgent={arrowUrgent} />
        <SensorRow label="Ground sensor (every 90s)" rem={groundRem} kind="ground" onActivate={onActivate} arrow={arrowSensor === 'ground'} urgent={arrowUrgent} />
      </div>
    </Panel>
  )
}

// `litStation` / `arrowStation` are tutorial-only and default off. A run must
// never light a station — the panel giving nothing away is the whole task, and
// CbatCut.mission.test.jsx holds it to that.
function MissionPanel({ onRelease, litStation = null, arrowStation = null }) {
  return (
    <Panel title="Mission">
      <div className="flex flex-col items-center justify-center gap-3 h-full">
        <p className="text-[10px] text-slate-400 text-center">
          Release the <b className="text-game-text">package</b> at its scheduled time — read the ordered station in Message and watch the Clock.
        </p>
        {/* Three drop stations — the panel says neither which one nor when. Both
            the station and its time live only in Message, so the release is a
            pure memory-updating task with no cue on the panel itself. */}
        <div className="flex gap-2">
          {/* No wrapper element: a run's panel must contain the three buttons and
              nothing else, and the mission test counts. The arrow, when there is
              one, lives inside the button it points at. */}
          {Array.from({ length: LOAD_POINTS }, (_, i) => (
            <button key={i} onClick={() => onRelease(i)} data-demo-answer
              className={`relative px-4 py-3 text-xs font-extrabold rounded cursor-pointer transition-colors bg-game-fill text-game-text hover:bg-game-fill-strong${i === litStation ? ' cbat-triple-pulse' : ''}`}>
              {i === arrowStation && <GuideArrow dir="down" urgent />}
              {stationName(i)}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  )
}

// ── Real CBAT Mission display ────────────────────────────────────────────────
// The real test's Mission display, per the TMI screenshot: a Load Drop
// Interface (Time / Latitude / Longitude), the Load Drop Dispenser (six lights
// and RELEASE) and a Video Recording Interface (Magnification / Latitude /
// Longitude / Duration). Each field is a row of digit boxes with a confirm
// button beside it; Message orders one value at a time. Nothing on the panel
// says which field is wanted or what goes in it.
//
// A field is a real (visually hidden) numeric input under the boxes, so a
// phone brings up its number keyboard and a desktop types straight in, and the
// boxes render from its digits. Enter confirms, as does the button.
//
// `arrowField` / `arrowRelease` / `arrowUrgent` are tutorial-only, default off.
function MissionField({ field, state, onType, onConfirm, arrow = false, urgent = false }) {
  const inputRef = useRef(null)
  const digits = state.entry
  // Boxes read HH:MM:SS for six-digit fields, plain digits otherwise.
  const groups = field.digits === 6 ? [2, 2, 2] : [field.digits]
  let idx = 0
  return (
    <div className="flex items-center gap-1.5 min-w-0" data-cbat-field={field.key}>
      <span className="w-[5.2rem] shrink-0 text-[10px] text-game-text truncate">{field.label}</span>
      <div className="relative flex items-center gap-0.5 cursor-text" onClick={() => inputRef.current?.focus()}>
        {groups.map((n, g) => (
          <span key={g} className="flex items-center gap-0.5">
            {g > 0 && <span className="text-[10px] text-game-muted px-px">:</span>}
            {Array.from({ length: n }, () => {
              const i = idx++
              return (
                <span key={i} className="w-4 h-5 flex items-center justify-center bg-game-arena border border-game-line text-[11px] font-mono text-game-text">
                  {digits[i] ?? ''}
                </span>
              )
            })}
          </span>
        ))}
        <input
          ref={inputRef}
          aria-label={field.order}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={digits}
          onChange={(e) => onType(field.key, e.target.value.replace(/\D/g, '').slice(0, field.digits))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onConfirm(field.key) } }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        />
      </div>
      <button
        onClick={() => onConfirm(field.key)}
        aria-label={`Confirm ${field.order}`}
        data-demo-answer
        className={`cbat-confirm relative shrink-0 w-5 h-5 rounded-full border border-game-line-strong bg-brand-600 hover:bg-brand-700 cursor-pointer${arrow ? ' cbat-triple-pulse' : ''}`}
      >
        {arrow && <GuideArrow dir="down" urgent={urgent} />}
      </button>
    </div>
  )
}

function CbatMissionPanel({ mission, onType, onConfirm, onRelease, arrowField = null, arrowRelease = false, arrowUrgent = false }) {
  const full = mission.lights >= DISPENSER_LIGHTS
  const section = (title, keys) => (
    <div className="bg-game-panel border border-game-line rounded p-1.5">
      <p className="text-[9px] uppercase tracking-wide text-game-accent mb-1">{title}</p>
      <div className="space-y-1">
        {keys.map(k => (
          <MissionField key={k} field={MISSION_FIELD_BY_KEY[k]} state={mission.fields[k]}
            onType={onType} onConfirm={onConfirm} arrow={arrowField === k} urgent={arrowUrgent} />
        ))}
      </div>
    </div>
  )
  return (
    <Panel title="Mission">
      <div className="space-y-1.5" data-cbat-mission>
        {section('Load Drop Interface', ['loadTime', 'loadLat', 'loadLon'])}
        <div className="bg-game-panel border border-game-line rounded p-1.5 flex items-center gap-2">
          <p className="text-[9px] uppercase tracking-wide text-game-accent shrink-0">Load Drop Dispenser</p>
          <div className="flex items-center gap-1 ml-auto" aria-label={`${mission.lights} of ${DISPENSER_LIGHTS} lights`}>
            {Array.from({ length: DISPENSER_LIGHTS }, (_, i) => (
              <span key={i} data-light={i < mission.lights ? 'on' : 'off'}
                className={`w-3 h-3 rounded-full border ${i < mission.lights ? 'bg-green-500 border-green-300' : 'bg-game-arena border-game-line'}`} />
            ))}
          </div>
          <button onClick={onRelease} data-demo-answer disabled={!full}
            className={`cbat-key cbat-round relative shrink-0 px-2 py-1 text-[10px] font-extrabold rounded cursor-pointer transition-colors disabled:cursor-not-allowed ${
              full ? 'bg-brand-600 hover:bg-brand-700 text-white' : 'bg-game-fill text-game-muted'
            }${arrowRelease ? ' cbat-triple-pulse' : ''}`}>
            {arrowRelease && <GuideArrow dir="down" urgent={arrowUrgent} />}
            RELEASE
          </button>
        </div>
        {section('Video Recording Interface', ['vidMag', 'vidLat', 'vidLon', 'vidDur'])}
      </div>
    </Panel>
  )
}

// `arrowPump` / `arrowKey` / `holdOk` / `arrowUrgent` are tutorial-only and
// default off. `arrowKey` is a digit, 'CLR' or 'OK'; the key also pulses, since
// an arrow hanging above a keypad key overlaps the key above it and the pulse
// is what says which one is meant. `holdOk` marks pressure as fine where it is.
// `waitHint` is the moment between the last digit and OK going live: the arrow
// moves to the countdown and it says so in words, or a disabled OK looks broken.
// `codeAck` / `onAckCode` are the Real CBAT variant's button at zero: when the
// countdown runs out a button appears where it was and has to be pressed at
// once. `code.entered` (same variant) is a code already accepted whose timer is
// still running down — the keypad locks and the countdown keeps going.
// `pumpPair` (Real CBAT variant) draws the pump as the real ON | OFF pair with
// the live state lit, instead of one toggle showing its state.
function SystemPanel({ pressure, pump, code, codeEntry, codeAck = null, elapsedMs, onPump, onDigit, onClearCode, onSubmitCode, onAckCode, pumpPair = false, arrowPump = false, arrowKey = null, holdOk = false, waitHint = false, arrowUrgent = false }) {
  const keyCls = (k) => (arrowKey === k ? ' cbat-triple-pulse' : '')
  const keysLive = !!code && !code.entered
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
          <div className="relative flex-1 w-8 my-1 bg-game-arena border border-game-line rounded overflow-hidden">
            {/* correct band, tinted behind the fill */}
            <div className="absolute left-0 right-0 bg-green-500/20"
              style={{ bottom: `${gaugePct(PRESS_LOW)}%`, height: `${gaugePct(PRESS_HIGH) - gaugePct(PRESS_LOW)}%` }} />
            <div className="absolute bottom-0 left-0 right-0 transition-[height] duration-100"
              style={{ height: `${fillPct}%`, background: zone === 'CORRECT' ? '#22c55e' : '#ef4444' }} />
            {/* band limits drawn over the fill so the target range stays readable at any level */}
            <div className="absolute left-0 right-0 h-px bg-green-200" style={{ bottom: `${gaugePct(PRESS_LOW)}%` }} />
            <div className="absolute left-0 right-0 h-px bg-green-200" style={{ bottom: `${gaugePct(PRESS_HIGH)}%` }} />
          </div>
          <p className={`text-base font-mono font-bold flex items-center ${zoneCol}`}>
            {holdOk && <GuideOk />}
            {Math.round(pressure)}
          </p>
          <p className="text-[10px] font-mono text-slate-500">{PRESS_LOW}–{PRESS_HIGH}</p>
          <p className={`text-[9px] font-bold ${zoneCol}`}>{zone}</p>
          {pumpPair ? (
            <div className="mt-1 flex gap-1">
              {[true, false].map(on => (
                <button key={String(on)} onClick={() => { if (pump !== on) onPump() }} data-demo-answer data-on={pump === on}
                  aria-label={`Pump ${on ? 'ON' : 'OFF'}`}
                  className={`cbat-pill relative px-2 py-1 text-[10px] font-bold rounded cursor-pointer transition-colors ${
                    pump === on ? 'bg-green-600 text-white' : 'bg-game-fill text-game-text hover:bg-game-fill-strong'
                  }`}>
                  {/* The arrow sits on the state to press, never the live one. */}
                  {arrowPump && pump !== on && <GuideArrow dir="down" urgent={arrowUrgent} />}
                  {on ? 'ON' : 'OFF'}
                </button>
              ))}
            </div>
          ) : (
          <button onClick={onPump} data-demo-answer data-on={pump}
            className={`cbat-pill relative mt-1 px-3 py-1 text-[10px] font-bold rounded cursor-pointer transition-colors ${
              pump ? 'bg-green-600 text-white' : 'bg-game-fill text-game-text hover:bg-game-fill-strong'
            }`}>
            {arrowPump && <GuideArrow dir="down" urgent={arrowUrgent} />}
            Pump {pump ? 'ON' : 'OFF'}
          </button>
          )}
        </div>
        {/* Comms code keypad — fills the panel height so the keys are thumb-sized */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <p className="text-[9px] uppercase tracking-wide text-slate-500">Comms Code</p>
          <div className="flex items-center justify-between mb-1">
            <span className="cbat-code-cells font-mono text-lg text-game-text tracking-widest">{codeEntry.padEnd(3, '·')}</span>
            {codeAck
              ? <button onClick={onAckCode} data-demo-answer
                  className={`cbat-key relative px-2 py-0.5 text-[10px] font-extrabold rounded bg-brand-600 hover:bg-brand-700 text-white cursor-pointer${keyCls('ACK')}`}>
                  {arrowKey === 'ACK' && <GuideArrow dir="down" urgent={arrowUrgent} />}
                  Confirm
                </button>
              : code
              ? code.entered
                ? <span className="text-[10px] font-mono text-green-400">accepted · {codeRem}s</span>
              : submitOpen
                ? <span className={`text-[10px] font-mono ${codeRem <= 5 ? 'text-red-400' : 'text-amber-400'}`}>{codeRem}s</span>
                : waitHint
                  ? <span className="flex items-center text-[10px] font-mono text-amber-400 font-bold" data-guide-wait>
                      <GuideArrow dir="right" inline />
                      wait, OK in {armRem}s
                    </span>
                  : <span className="text-[10px] font-mono text-slate-400">submit in {armRem}s</span>
              : <span className="text-[10px] text-slate-600">no code</span>}
          </div>
          {/* Keypad is inert until a code is actually issued. */}
          {/* Below sm the keys grow to a chunky 4:3 tile; sm+ keeps the original
              flat keypad. The keys are never stretched to fill the panel. */}
          <div className={`grid grid-cols-3 gap-1 ${keysLive ? '' : 'opacity-40 pointer-events-none'}`} aria-disabled={!keysLive}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button key={d} onClick={() => onDigit(d)} disabled={!keysLive} className={`cbat-key relative aspect-[4/3] sm:aspect-auto sm:py-1 bg-game-raised hover:bg-[#163055] text-game-text font-mono text-base sm:text-sm rounded cursor-pointer disabled:cursor-not-allowed${keyCls(d)}`}>
                {arrowKey === d && <GuideArrow dir="down" urgent={arrowUrgent} />}
                {d}
              </button>
            ))}
            <button onClick={onClearCode} disabled={!keysLive} className={`cbat-key relative aspect-[4/3] sm:aspect-auto sm:py-1 bg-game-fill hover:bg-game-fill-strong text-game-text text-[11px] sm:text-[10px] font-bold rounded cursor-pointer disabled:cursor-not-allowed${keyCls('CLR')}`}>
              {arrowKey === 'CLR' && <GuideArrow dir="down" urgent={arrowUrgent} />}
              CLR
            </button>
            <button onClick={() => onDigit('0')} disabled={!keysLive} className={`cbat-key relative aspect-[4/3] sm:aspect-auto sm:py-1 bg-game-raised hover:bg-[#163055] text-game-text font-mono text-base sm:text-sm rounded cursor-pointer disabled:cursor-not-allowed${keyCls('0')}`}>
              {arrowKey === '0' && <GuideArrow dir="down" urgent={arrowUrgent} />}
              0
            </button>
            <button onClick={onSubmitCode} disabled={!submitOpen || !keysLive} className={`cbat-key relative aspect-[4/3] sm:aspect-auto sm:py-1 bg-brand-600 hover:bg-brand-700 text-white text-[11px] sm:text-[10px] font-bold rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-40${keyCls('OK')}`}>
              {arrowKey === 'OK' && <GuideArrow dir="down" urgent={arrowUrgent} />}
              OK
            </button>
          </div>
        </div>
      </div>
    </Panel>
  )
}

// Six-button multifunction index for one display stack. A label too wide for its
// key is clipped at the right edge rather than wrapped or shrunk — half of
// "NAVIGATION" still reads as Navigation, and every key stays the same size.
//
// `arrowActive` is tutorial-only and defaults off: hang a guide arrow under the
// selected key, pointing up at it. Buttons are overflow-hidden to clip their
// labels, so the arrow lives in a wrapper around each one instead of inside it.
//
// `boxed` is the Real CBAT variant: on lg+ the row becomes the real
// "Multifunction Display Index" — a titled box with the six keys in two rows
// of three, the title bar red on the left display and green on the right
// (`stack`). Below lg it stays a single row; the title is hidden. The rules
// live in main.css under the theme, so nothing changes under SkyWatch.
function NavButtons({ active, onSelect, arrowActive = false, boxed = false, stack = 1 }) {
  return (
    <div className={`cbat-mfd-index w-full h-full flex gap-1${boxed ? ' cbat-mfd-boxed' : ''}`} data-stack={stack}>
      {boxed && <div className="cbat-mfd-title hidden">Multifunction Display Index</div>}
      {SYSTEMS.map(k => (
        // Swapping displays is the game — a demo card that never presses these
        // shows the same two panels for its whole run.
        <span key={k} className="relative flex-1 min-w-0 flex">
          {arrowActive && active === k && <GuideArrow dir="up" />}
          <button onClick={() => onSelect(k)} data-demo-answer data-on={active === k}
            className={`cbat-pill w-full min-w-0 overflow-hidden rounded px-1 text-left text-[10px] sm:text-[11px] font-bold uppercase tracking-tight sm:tracking-wide whitespace-nowrap transition-colors cursor-pointer ${
              active === k ? 'bg-green-600 text-white' : 'bg-game-raised text-game-text hover:bg-[#163055] hover:text-white'
            }`}>
            {SYSTEM_LABELS[k]}
          </button>
        </span>
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
          className="w-8 h-full flex flex-col items-center gap-2 pt-2 bg-game-panel border border-game-line rounded-lg text-slate-400 hover:text-brand-600 cursor-pointer">
          <span className="text-xs">◀</span>
          <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ writingMode: 'vertical-rl' }}>Commentary</span>
        </button>
      </aside>
    )
  }
  return (
    <aside className="hidden lg:block lg:w-[300px] lg:shrink-0 lg:sticky lg:top-2" style={ARENA_STYLE}>
      <div className="w-full h-full flex flex-col bg-game-panel border border-game-line rounded-lg overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-game-line">
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
                <span className="text-game-text min-w-0">{e.text}</span>
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
    <div className="bg-game-arena rounded-lg border border-game-line p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-mono font-bold text-brand-600">{val}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
  return (
    <div className="w-full bg-game-panel border border-game-line rounded-xl p-6 text-center">
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
// A walkthrough of the real board, one display at a time. CUT has the steepest
// learning curve of any game on the roster (measured across players with 5+
// runs, mean score by run number runs 298, 403, 460, 552, 623, 645, 708 against
// a population median of 604), and almost all of that climb is learning where
// things are rather than getting better at the underlying task. This exists to
// take that first slice off, so an early score says something about the player
// instead of about how many times they have seen the layout.
//
// These are the real panels reading a real sim state, not mock-ups that can
// drift away from the game they are teaching. But the sim is not driven by
// `advanceSim`: that moves everything at once, and a board that has been
// decaying for the three minutes someone spends reading eight cards is a mess
// by the end, with warnings from displays they have not reached yet. Instead
// `tickTutorial` moves ONLY the display the current step is about — fuel drains
// on the Engine step, airspeed drifts on Navigation, pressure on System — and
// `resetForStep` puts everything back in tolerance on every step change. The
// clock always runs. So each step shows exactly one thing happening, it is the
// thing the card is describing, and ignoring it long enough produces the same
// warning it would in a run, which is the lesson.
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

// On the Sensor step the two countdowns start short, so the user sees one arm
// (amber) and can press Activate within the time it takes to read the card,
// rather than staring at "45s" for a step that lasts fifteen.
const TUTORIAL_AIR_DUE_MS = 8_000
const TUTORIAL_GROUND_DUE_MS = 20_000
// On the Mission step a drop is ordered this far out: long enough to read the
// card and find the clock, short enough that the moment actually arrives.
const TUTORIAL_LOAD_DUE_MS = 15_000
// The Mission step walks the eye through the order in three moves: the arrow
// sits on the Message line for this long, then moves to the clock until the
// drop is due, then jumps to the ordered station and gets urgent.
const TUTORIAL_READ_MS = 5_000

// Real CBAT variant: a camera order on the Sensor step is for this far ahead;
// a field order on the Mission step has this long; the dispenser lights come
// on this far apart, so RELEASE arrives while the step is still on screen.
const TUTORIAL_CAMERA_DUE_MS = 8_000
const TUTORIAL_FIELD_WINDOW_MS = 40_000
const TUTORIAL_LIGHT_MS = 2_000

// On the System step the first comms code arrives this long after entry, so the
// pump has the board to itself for a moment before the second job starts.
const TUTORIAL_CODE_AT_MS = 6_000
// Pressure is seeded this close to the bottom of the band with the pump off, so
// the first thing the step asks for is the pump, within seconds.
const TUTORIAL_PRESSURE_START = 93
// A calm pump prompt this far inside the band, in the direction pressure is
// moving: "it is about to go, toggle now" rather than waiting for the warning.
const TUTORIAL_PRESSURE_MARGIN = 3

const tutorialClockAt = (sim, ms) => fmtWall(sim.clockStartSec + ms / 1000)

// Issue a comms code the way a run does: through Message, with a full window,
// so the keypad is live at once but OK is not until the final 15 seconds. The
// line's id is kept so the step can point at it and call out the digits.
function issueTutorialCode(sim) {
  sim.code = { digits: code3(), dueAt: sim.elapsedMs + CODE_WINDOW }
  sim.codeEntry = ''
  sim.codeOrderedAt = sim.elapsedMs
  pushMessage(sim, `COMMS: code ${sim.code.digits}. Enter it in System`)
  sim.codeMessageId = sim.messages[sim.messages.length - 1].id
}

// Order a drop for the Mission step, through Message, the way a run would. The
// step's whole point is that the order lives in Message and nowhere else, so
// the demonstration has to put it there rather than describe it.
function scheduleTutorialLoad(sim) {
  sim.loadOrderedAt = sim.elapsedMs
  sim.loadDueAt = sim.elapsedMs + TUTORIAL_LOAD_DUE_MS
  sim.loadTarget = rand(LOAD_POINTS)
  sim.loadArmed = true
  sim.loadReady = false
  pushMessage(sim, `MISSION: drop ${stationName(sim.loadTarget)} at ${tutorialClockAt(sim, sim.loadDueAt)}`)
  // So the Mission step can light this exact line and point at it.
  sim.loadMessageId = sim.messages[sim.messages.length - 1].id
}

// Put every display back in tolerance, then arm the one this step teaches.
//
// Called on every step change, which is what keeps the steps independent: fuel
// that drained on the Engine step does not carry an ENGINE warning into the
// Message step, and a step can be revisited and looks the same each time. Two
// states are seeded that a board at rest would never show — a standing camera
// order, and a live comms code with its OK already armed — because without them
// the Sensor and System steps would be teaching greyed-out controls.
function resetForStep(sim, focus) {
  // Lets a step sequence its own guidance ("point here first, then there").
  sim.stepEnteredAt = sim.elapsedMs
  // On the Engine step the feed starts on the LOWEST tank, still inside the
  // spread, so the first thing the step asks for is the switch itself — the
  // habit being taught is "always feed from the fullest", and arriving with
  // that already true would show a board with nothing to do.
  sim.fuel = focus === 'engine'
    ? [
      { level: 380, on: true },
      { level: 420, on: false },
      { level: 400, on: false },
    ]
    : [
      { level: 420, on: true },
      { level: 400, on: false },
      { level: 385, on: false },
    ]
  sim.speed = sim.requiredSpeed + SPEED_TOL
  sim.pressure = focus === 'system' ? TUTORIAL_PRESSURE_START : 100
  sim.pump = false
  sim.camera = 'Alpha'
  // cbat: a camera order carries a time, so it is only issued on the Sensor
  // step, through Message, rather than standing on every step.
  sim.requiredCamera = sim.cbat ? null : 'Bravo'
  sim.cameraDueAt = null
  if (sim.cbat && focus === 'sensor') orderCamera(sim, TUTORIAL_CAMERA_DUE_MS)
  sim.airDueAt = sim.elapsedMs + (focus === 'sensor' ? TUTORIAL_AIR_DUE_MS : AIR_INTERVAL)
  sim.groundDueAt = sim.elapsedMs + (focus === 'sensor' ? TUTORIAL_GROUND_DUE_MS : GROUND_INTERVAL)
  // No code until the System step issues one through Message. Seeding a live
  // code silently left the keypad pointing at digits nobody had been told.
  sim.code = null
  sim.codeEntry = ''
  sim.codeAck = null
  sim.nextCodeAt = sim.elapsedMs + TUTORIAL_CODE_AT_MS
  sim.warnings = []
  // cbat: the Mission display's orders and dispenser only run on its own step.
  if (sim.cbat) {
    for (const f of MISSION_FIELDS) Object.assign(sim.mission.fields[f.key], { entry: '', order: null })
    sim.mission.lights = 0
    sim.mission.fullAt = null
    sim.mission.nextLightAt = focus === 'mission' ? sim.elapsedMs + TUTORIAL_LIGHT_MS : Infinity
    if (focus === 'mission') orderMissionField(sim, TUTORIAL_FIELD_WINDOW_MS)
  }
  // A drop is only ever live on the Mission step. The one makeSim scheduled is
  // discarded: its time was fixed at t=0 and may already have passed by the time
  // the user gets here, which would leave a step that asks for a press nothing
  // can ever answer.
  sim.loadArmed = false
  sim.loadReady = false
  if (focus === 'mission') scheduleTutorialLoad(sim)
}

function makeTutorialSim(cbat = false) {
  const sim = makeSim('easier', { cbat })
  // cbat: the Message step points at an order in the log, and this variant's
  // sim starts without one. Put a sample there, then withdraw it, so the log
  // shows what an order looks like without a field waiting on it.
  if (cbat) {
    const field = orderMissionField(sim, Infinity)
    if (field) sim.mission.fields[field.key].order = null
  }
  resetForStep(sim, CUT_TUTORIAL_STEPS[0].focus)
  return sim
}

// One tick of the tutorial board. The clock always runs; beyond that only the
// display `focus` names is allowed to move, at the same rates a run would use.
// Nothing here scores, schedules new orders or expires anything — the sim is a
// demonstration, and a card that reads "the pump raises pressure" should have a
// gauge in front of it that does exactly that and nothing else.
function tickTutorial(sim, dt, focus) {
  const secs = dt / 1000
  const t = sim.tuning
  sim.elapsedMs += dt

  if (focus === 'engine') {
    const feed = sim.fuel.find(f => f.on)
    if (feed) feed.level = Math.max(0, feed.level - t.fuelDrainPerSec * secs)
  }
  if (focus === 'navigation') {
    sim.speed = Math.max(0, sim.speed - t.speedDriftPerSec * secs)
  }
  if (focus === 'system') {
    sim.pressure += (sim.pump ? t.pressRisePerSec : -t.pressDropPerSec) * secs
    sim.pressure = Math.max(60, Math.min(140, sim.pressure))
    if (!sim.code && !sim.codeAck && sim.elapsedMs >= sim.nextCodeAt) issueTutorialCode(sim)
    // Let it lapse and a run would penalise it; here it says so and issues
    // another, so the keypad never sits dead for the rest of the step.
    if (sim.code && sim.elapsedMs > sim.code.dueAt) {
      if (sim.cbat) {
        // Zero brings up the button whether the code went in or not; the next
        // code waits until it has been pressed (or given up on).
        if (!sim.code.entered) pushMessage(sim, 'COMMS: code window missed. Press Confirm now the timer has run out')
        sim.codeAck = { since: sim.code.dueAt }
        sim.code = null
        sim.codeEntry = ''
      } else {
        pushMessage(sim, 'COMMS: code window missed. A new code is on its way')
        issueTutorialCode(sim)
      }
    }
    if (sim.codeAck && sim.elapsedMs > sim.codeAck.since + CODE_ACK_WINDOW) {
      pushMessage(sim, 'COMMS: button not pressed. A new code is on its way')
      sim.codeAck = null
      issueTutorialCode(sim)
    }
  }
  if (focus === 'sensor' && sim.cbat && sim.requiredCamera && sim.elapsedMs > sim.cameraDueAt + CAMERA_WINDOW) {
    pushMessage(sim, `SENSOR: camera ${sim.requiredCamera} order missed. New order on its way`)
    orderCamera(sim, TUTORIAL_CAMERA_DUE_MS)
  }
  if (focus === 'mission' && sim.cbat) {
    const m = sim.mission
    for (const f of MISSION_FIELDS) {
      const st = m.fields[f.key]
      if (st.order && sim.elapsedMs > st.dueAt) {
        pushMessage(sim, `MISSION: ${f.order} order missed. New order on its way`)
        st.order = null
        orderMissionField(sim, TUTORIAL_FIELD_WINDOW_MS)
      }
    }
    if (m.lights < DISPENSER_LIGHTS) {
      if (sim.elapsedMs >= m.nextLightAt) {
        m.lights += 1
        m.nextLightAt = sim.elapsedMs + TUTORIAL_LIGHT_MS
        if (m.lights === DISPENSER_LIGHTS) m.fullAt = sim.elapsedMs
      }
    } else if (sim.elapsedMs > m.fullAt + RELEASE_WINDOW) {
      pushMessage(sim, 'MISSION: release window missed. The dispenser is filling again')
      resetDispenser(sim, TUTORIAL_LIGHT_MS)
    }
  }
  if (focus === 'mission' && sim.loadArmed) {
    sim.loadReady = sim.elapsedMs >= sim.loadDueAt
    // Missed it: say so in Message, where a run would, and order another so
    // the step keeps offering the moment rather than going quiet.
    if (sim.elapsedMs > sim.loadDueAt + LOAD_RELEASE_WINDOW) {
      pushMessage(sim, `MISSION: ${stationName(sim.loadTarget)} drop at ${tutorialClockAt(sim, sim.loadDueAt)} missed. New drop ordered`)
      scheduleTutorialLoad(sim)
    }
  }
  // The Sensor countdowns read elapsedMs directly, so they tick on their own.

  // Real warnings from the real rule, so ignoring the taught display long
  // enough shows the same strip a run would.
  sim.warnings = computeWarnings(sim)
}

const CUT_TUTORIAL_STEPS = [
  {
    focus: 'nav',
    title: 'Two windows, six displays',
    body: 'Six displays run at once but you only get two windows to show them in. These six buttons above each window choose what that window shows. You will be pressing these constantly, because a display you are not looking at is one you cannot fix.',
  },
  {
    focus: 'strip',
    title: 'Warnings and the clock',
    body: 'Any system that is out of tolerance is listed on the left, and you lose points for every second a warning is showing. Keeping this strip empty is the main job. On the right is the aircraft clock. It is not a countdown, it is the time of day, and the Mission drop is scheduled to it.',
  },
  {
    focus: 'message',
    title: 'Message',
    body: 'Every order arrives here and nowhere else. There is nothing to click, you just read it. The one to watch for is the drop order, which gives you a station and a time. The Mission display never shows it, so this log is the only place you can check it.',
    bodyCbat: 'Every order arrives here and nowhere else. There is nothing to click, you just read it. Mission orders name one field and the value to put in it. The Mission display never repeats them, so this log is the only place you can check what was asked.',
  },
  {
    focus: 'engine',
    title: 'Engine',
    body: 'Three fuel tanks, and only the one switched ON is draining. Keep all three within 50 litres of each other by switching the feed to whichever tank is fullest. Try tapping a tank button now.',
  },
  {
    focus: 'navigation',
    title: 'Navigation',
    body: 'Airspeed drops on its own the whole time. The minus and plus buttons move it 2 knots a tap, and you need to stay within 10 knots of Required. A new Required speed comes through on Message every so often.',
  },
  {
    focus: 'sensor',
    title: 'Sensor',
    body: 'Three jobs on one display. A camera order tells you to switch to Alpha or Bravo. The air sensor needs re-activating every 45 seconds and the ground sensor every 90. Each one shows a countdown to when it is next due.',
    bodyCbat: 'Three jobs on one display. A camera order in Message names a camera and a Clock time. Do not press it until the clock reaches that time. The air sensor needs re-activating every 45 seconds and the ground sensor every 90. Each one shows a countdown to when it is next due.',
  },
  {
    focus: 'mission',
    title: 'Mission',
    body: 'The panel never says which station or when. A drop order has just arrived in Message, open in your other window, giving a station and a time. Watch the clock and press that station when the time comes. In a run you will usually have to remember it, because that window is needed elsewhere.',
    bodyCbat: 'Three jobs on one display. Message orders one value at a time, such as a latitude for the load drop or a magnification for the video. An order has just arrived in your other window: type the value into that field and press the button beside it. The dispenser lights fill from left to right on their own. The moment all six are green, press RELEASE.',
  },
  {
    focus: 'system',
    title: 'System',
    body: 'Two jobs again. The pump holds hydraulic pressure between 90 and 110: on to raise it, off to let it fall. Comms codes arrive in Message. Type the 3 digits on the keypad as soon as you see one, then press OK when it lights up, which is only in the last 15 seconds.',
    bodyCbat: 'Two jobs again. The pump holds hydraulic pressure between 90 and 110: on to raise it, off to let it fall. Comms codes arrive in Message. Type the 3 digits on the keypad as soon as you see one, then press OK when it lights up, which is only in the last 15 seconds. When the timer reaches zero a Confirm button appears. Press it straight away.',
  },
]

// Shorter than the live arena because the coach card sits above it.
const TUTORIAL_ARENA_STYLE = { height: '62vh', minHeight: 400 }

function TutorialComplete({ onExit }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md bg-game-panel border border-game-line rounded-xl p-6 text-center"
    >
      <p className="text-5xl mb-3">✅</p>
      <p className="text-2xl font-extrabold text-white mb-1">Tutorial Complete</p>
      <p className="text-sm text-slate-400 mb-6">That is every display. A full run lasts 3 minutes, and all six displays keep changing at the same time.</p>
      <button
        onClick={onExit}
        className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
      >
        Back to Instructions
      </button>
    </motion.div>
  )
}

// `cbat` is the Real CBAT variant: the board it walks is that variant's board
// (field-entry Mission display, timed camera orders, the button at zero).
function CutTutorial({ onExit, onProgress, cbat = false }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [runId] = useState(makeTutorialRunId)

  // Same simRef + snapshot split the live game uses, minus the tick loop. The
  // tick loop is `tickTutorial` rather than `advanceSim` — see the header.
  const [initialSim] = useState(() => makeTutorialSim(cbat))
  const simRef = useRef(initialSim)
  const [view, setView] = useState(initialSim)
  const sync = useCallback(() => setView({ ...simRef.current }), [])

  const step = CUT_TUTORIAL_STEPS[stepIdx]
  const focusIsPanel = SYSTEMS.includes(step.focus)

  // Fixed dt rather than performance.now() deltas: a tutorial has no tab-blur
  // catch-up to worry about, and a constant step keeps it deterministic.
  useEffect(() => {
    if (done) return
    const focus = CUT_TUTORIAL_STEPS[stepIdx].focus
    const id = setInterval(() => {
      tickTutorial(simRef.current, TICK_MS, focus)
      sync()
    }, TICK_MS)
    return () => clearInterval(id)
  }, [stepIdx, done, sync])

  // Every step change goes through here so the board is reset BEFORE the new
  // card is shown, in the same handler — not in an effect chasing the index.
  const goToStep = (idx) => {
    resetForStep(simRef.current, CUT_TUTORIAL_STEPS[idx].focus)
    sync()
    setStepIdx(idx)
  }

  // A step about one display puts it in the left window, so the thing being
  // described is the thing on screen. The user can still swap either window,
  // and that choice is stamped with the step it was made on so it clears itself
  // when the step moves — derived, rather than a state resync in an effect.
  const [pick1, setPick1] = useState(null)
  const [pick2, setPick2] = useState(null)
  const sel1 = pick1?.step === stepIdx ? pick1.key
    : focusIsPanel ? step.focus
    : 'message'
  // Steps that answer back do so through Message, the way a run would, so on
  // those the other window shows Message and stays readable. On the Mission
  // step that is also where the order itself lives.
  const feedbackStep = step.focus === 'sensor' || step.focus === 'mission' || step.focus === 'system'
  const sel2 = pick2?.step === stepIdx ? pick2.key
    : feedbackStep ? 'message'
    : 'engine'
  const setSel1 = (key) => setPick1({ step: stepIdx, key })
  const setSel2 = (key) => setPick2({ step: stepIdx, key })

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
  const onCamera = (c) => act(sim => {
    sim.camera = c
    if (sim.requiredCamera !== c) return
    if (sim.cbat && sim.elapsedMs < sim.cameraDueAt - CAMERA_EARLY_TOL) {
      pushMessage(sim, `SENSOR: too early. Camera ${c} is ordered for ${tutorialClockAt(sim, sim.cameraDueAt)}`)
      return
    }
    sim.requiredCamera = null
    sim.cameraDueAt = null
    pushMessage(sim, `SENSOR: camera ${c} selected. Well done`)
  })
  // Real CBAT Mission display. Nothing scores; a confirmed order is answered in
  // Message and another is issued, so the step keeps offering the moment.
  const onTypeField = (key, digits) => act(sim => { sim.mission.fields[key].entry = digits })
  const onConfirmField = (key) => act(sim => {
    const field = MISSION_FIELD_BY_KEY[key]
    const st = sim.mission.fields[key]
    if (!st.entry.length) return
    if (st.order) {
      if (st.entry === st.order) {
        pushMessage(sim, `MISSION: ${field.order} set. Well done`)
        st.order = null
        orderMissionField(sim, TUTORIAL_FIELD_WINDOW_MS)
      } else {
        pushMessage(sim, `MISSION: wrong ${field.order}. Check Message and try again`)
      }
    }
    st.value = st.entry
  })
  const onReleaseLoad = () => act(sim => {
    if (sim.mission.lights >= DISPENSER_LIGHTS) {
      pushMessage(sim, 'MISSION: load released. Well done')
      resetDispenser(sim, TUTORIAL_LIGHT_MS)
    } else {
      pushMessage(sim, 'MISSION: too early. Wait for all six lights')
    }
  })
  const onAckCode = () => act(sim => {
    if (!sim.codeAck) return
    sim.codeAck = null
    pushMessage(sim, 'COMMS: confirmed. Well done')
    issueTutorialCode(sim)
  })
  // Re-armed on the short tutorial intervals, so the moment comes round again
  // while the step is still on screen.
  const onActivate = (kind) => act(sim => {
    const dueKey = kind === 'air' ? 'airDueAt' : 'groundDueAt'
    const onTime = sim[dueKey] - sim.elapsedMs <= SENSOR_ARM_WINDOW
    if (onTime) pushMessage(sim, `SENSOR: ${kind} sensor activated on time. Well done`)
    sim[dueKey] = sim.elapsedMs + (kind === 'air' ? TUTORIAL_AIR_DUE_MS : TUTORIAL_GROUND_DUE_MS)
  })
  // The one tutorial handler that answers back. Nothing scores, but the result
  // goes to Message so the user sees whether they read the order right, in the
  // place a run would tell them.
  const onRelease = (station) => act(sim => {
    if (!sim.loadArmed) return
    if (sim.loadReady && sim.elapsedMs <= sim.loadDueAt + LOAD_RELEASE_WINDOW) {
      if (station === sim.loadTarget) {
        pushMessage(sim, `MISSION: ${stationName(station)} dropped on time. Well done`)
      } else {
        pushMessage(sim, `MISSION: wrong station. ${stationName(sim.loadTarget)} was ordered`)
      }
      scheduleTutorialLoad(sim)
    } else {
      pushMessage(sim, `MISSION: too early. ${stationName(sim.loadTarget)} is due at ${tutorialClockAt(sim, sim.loadDueAt)}`)
    }
  })
  const onDigit = (d) => act(sim => { if (sim.codeEntry.length < 3) sim.codeEntry += d })
  const onClearCode = () => act(sim => { sim.codeEntry = '' })
  const onSubmitCode = () => act(sim => {
    if (!sim.code) return
    if (sim.codeEntry === sim.code.digits) {
      if (sim.cbat) {
        // The timer runs on to zero, when the Confirm button appears.
        pushMessage(sim, `COMMS: code ${sim.code.digits} accepted. Press Confirm when the timer reaches zero`)
        sim.code.entered = true
        return
      }
      pushMessage(sim, `COMMS: code ${sim.code.digits} accepted. Well done`)
      issueTutorialCode(sim)
      return
    } else {
      pushMessage(sim, 'COMMS: wrong code. Check Message and try again')
    }
    sim.codeEntry = ''
  })

  // Where this step wants the eye RIGHT NOW, read off the sim so it moves as
  // the board does. Each step points at one concrete thing to look at or press;
  // `urgent` marks a press that will not wait. `lit` names the region whose
  // window carries the highlight, which follows the guide rather than the step:
  // on the Mission step that is Message while the order is being read, the
  // strip while the clock is being watched, and Mission only when it is time.
  const guide = (() => {
    const v = view
    const since = v.elapsedMs - (v.stepEnteredAt ?? 0)
    switch (step.focus) {
      case 'nav':
        return { lit: 'nav', nav: true }
      case 'strip':
        return since < TUTORIAL_READ_MS
          ? { lit: 'strip', warning: true }
          : { lit: 'strip', clock: true }
      case 'message': {
        // The latest order in the log — the line the card says to watch for.
        const prefix = v.cbat ? 'MISSION: set' : 'MISSION: drop'
        const order = [...v.messages].reverse().find(m => m.text.startsWith(prefix))
        return { lit: 'panel1', messageId: order?.id ?? null }
      }
      case 'engine': {
        // The fullest tank. If it is not the one feeding, that is the switch to make.
        let fullest = 0
        v.fuel.forEach((f, i) => { if (f.level > v.fuel[fullest].level) fullest = i })
        return { lit: 'panel1', tank: fullest, urgent: !v.fuel[fullest].on }
      }
      case 'navigation': {
        // Whichever button closes the gap. Above tolerance is possible too —
        // the user can overshoot with plus — and pointing at plus then is
        // telling them to make it worse.
        // Aim for the number itself. Over it by a step or more: minus. Under by
        // a step or more: plus. Urgent once outside the band. On the number:
        // nothing to press, hold and watch it. The panel's own "aim for
        // Required + 10" is a strategy note for a run; the step arrives 10 over
        // precisely so the first thing it teaches is bringing it back down.
        const diff = v.speed - v.requiredSpeed
        if (diff > SPEED_TOL) return { lit: 'panel1', minus: true, urgent: true }
        if (diff < -SPEED_TOL) return { lit: 'panel1', plus: true, urgent: true }
        if (diff >= SPEED_STEP) return { lit: 'panel1', minus: true }
        if (diff <= -SPEED_STEP) return { lit: 'panel1', plus: true }
        return { lit: 'panel1', ok: true }
      }
      case 'sensor': {
        // cbat: the order is for a time. Read it, watch the clock, then press.
        if (v.cbat && v.requiredCamera) {
          const line = { messageLit: v.cameraMessageId }
          if (v.elapsedMs < v.stepEnteredAt + TUTORIAL_READ_MS) return { lit: 'panel2', messageId: v.cameraMessageId, ...line, messageEmph: 'time' }
          if (v.elapsedMs < v.cameraDueAt - CAMERA_EARLY_TOL) return { lit: 'strip', clock: true, ...line, messageEmph: 'time' }
          return { lit: 'panel1', camera: v.requiredCamera, urgent: true, ...line }
        }
        if (v.requiredCamera) return { lit: 'panel1', camera: v.requiredCamera }
        const airRem = v.airDueAt - v.elapsedMs
        const groundRem = v.groundDueAt - v.elapsedMs
        const soonest = airRem <= groundRem ? 'air' : 'ground'
        const rem = Math.min(airRem, groundRem)
        // Its Activate once it is armed; until then the one due next, to watch.
        return { lit: 'panel1', sensor: soonest, urgent: rem <= SENSOR_ARM_WINDOW }
      }
      case 'mission': {
        if (v.cbat) {
          // RELEASE outranks an order: its window is short and it will not wait.
          if (v.mission.lights >= DISPENSER_LIGHTS) return { lit: 'panel1', release: true, urgent: true }
          const key = MISSION_FIELDS.map(f => f.key).find(k => v.mission.fields[k].order)
          if (!key) return { lit: 'panel1' }
          const st = v.mission.fields[key]
          const line = { messageLit: st.messageId, messageEmph: 'value' }
          if (v.elapsedMs < st.orderedAt + TUTORIAL_READ_MS) return { lit: 'panel2', messageId: st.messageId, ...line }
          return { lit: 'panel1', field: key, ...line }
        }
        if (!v.loadArmed) return { lit: 'panel1' }
        // The token called out in the order line follows the phase: the time
        // while the clock is being watched, the station once it is time to press.
        if (v.loadReady && v.elapsedMs <= v.loadDueAt + LOAD_RELEASE_WINDOW) {
          return { lit: 'panel1', mission: 'press', messageLit: v.loadMessageId, messageEmph: 'station' }
        }
        if (v.elapsedMs < v.loadOrderedAt + TUTORIAL_READ_MS) {
          return { lit: 'panel2', mission: 'read', messageLit: v.loadMessageId, messageId: v.loadMessageId }
        }
        return { lit: 'strip', mission: 'watch', messageLit: v.loadMessageId, clock: true, messageEmph: 'time' }
      }
      case 'system': {
        // Pressure outranks everything: out of band is a warning bleeding score.
        const out = v.pressure < PRESS_LOW || v.pressure > PRESS_HIGH
        if (out) return { lit: 'panel1', pump: true, urgent: true }
        // About to leave the band in the direction it is moving: toggle now.
        const nearEdge = (!v.pump && v.pressure <= PRESS_LOW + TUTORIAL_PRESSURE_MARGIN)
          || (v.pump && v.pressure >= PRESS_HIGH - TUTORIAL_PRESSURE_MARGIN)
        // cbat: the button at zero. Press it before anything else.
        if (v.codeAck) return { lit: 'panel1', key: 'ACK', urgent: true }
        if (!v.code) return nearEdge ? { lit: 'panel1', pump: true } : { lit: 'panel1', pressureOk: true }
        // cbat: a code already in — nothing to press until the timer hits zero.
        if (v.code.entered) return nearEdge ? { lit: 'panel1', pump: true } : { lit: 'panel1', pressureOk: true }
        // A code has arrived. Read it first: the line in Message, digits called out.
        const codeLine = { messageLit: v.codeMessageId, messageEmph: 'code' }
        if (v.elapsedMs < v.codeOrderedAt + TUTORIAL_READ_MS) {
          return { lit: 'panel2', messageId: v.codeMessageId, ...codeLine }
        }
        if (nearEdge) return { lit: 'panel1', pump: true, ...codeLine }
        // Then the keys, one at a time, then OK — urgent only once OK is live.
        const next = v.codeEntry.length < 3 ? v.code.digits[v.codeEntry.length] : 'OK'
        const submitOpen = v.elapsedMs >= v.code.dueAt - CODE_SUBMIT_WINDOW
        // Digits in, OK not yet live: nothing to press. Say "wait" at the countdown.
        if (next === 'OK' && !submitOpen) return { lit: 'panel1', wait: true, ...codeLine }
        return { lit: 'panel1', key: next, urgent: next === 'OK', ...codeLine }
      }
      default:
        return { lit: 'panel1' }
    }
  })()

  const renderPanel = (key) => {
    const sim = view
    switch (key) {
      case 'message':    return <MessagePanel messages={sim.messages} litId={guide.messageLit ?? guide.messageId ?? null} arrowId={guide.messageId ?? null} emphasis={guide.messageEmph ?? null} />
      case 'engine':     return <EnginePanel fuel={sim.fuel} onToggle={onToggleTank} arrowTank={guide.tank ?? null} arrowUrgent={!!guide.urgent} />
      case 'navigation': return <NavigationPanel speed={sim.speed} requiredSpeed={sim.requiredSpeed} onAdjust={onAdjustSpeed} arrowPlus={!!guide.plus} arrowMinus={!!guide.minus} holdOk={!!guide.ok} arrowUrgent={!!guide.urgent} />
      case 'sensor':     return <SensorPanel elapsedMs={sim.elapsedMs} camera={sim.camera} requiredCamera={sim.requiredCamera} airDueAt={sim.airDueAt} groundDueAt={sim.groundDueAt} onCamera={onCamera} onActivate={onActivate} hideOrder={sim.cbat} arrowCamera={guide.camera ?? null} arrowSensor={guide.sensor ?? null} arrowUrgent={!!guide.urgent} />
      case 'mission':    return sim.cbat
        ? <CbatMissionPanel mission={sim.mission} onType={onTypeField} onConfirm={onConfirmField} onRelease={onReleaseLoad} arrowField={guide.field ?? null} arrowRelease={!!guide.release} arrowUrgent={!!guide.urgent} />
        : <MissionPanel onRelease={onRelease} litStation={guide.mission === 'press' ? sim.loadTarget : null} arrowStation={guide.mission === 'press' ? sim.loadTarget : null} />
      case 'system':     return <SystemPanel pressure={sim.pressure} pump={sim.pump} code={sim.code} codeEntry={sim.codeEntry} codeAck={sim.codeAck} elapsedMs={sim.elapsedMs} onPump={onPump} onDigit={onDigit} onClearCode={onClearCode} onSubmitCode={onSubmitCode} onAckCode={onAckCode} pumpPair={sim.cbat} arrowPump={!!guide.pump} arrowKey={guide.key ?? null} holdOk={!!guide.pressureOk} waitHint={!!guide.wait} arrowUrgent={!!guide.urgent} />
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
  // One region carries the pulse — the one the guide is pointing into. Regions
  // the step still needs readable (Message and the strip on the Mission step)
  // stay plain; the rest dim. `.cbat-tutorial-dim` also blocks pointer events,
  // so only the part being taught is reachable — which is the point.
  const missionStep = step.focus === 'mission'
  const cls = (region, keepPlain = false) =>
    guide.lit === region ? ' cbat-tutorial-pulse' : keepPlain ? '' : ' cbat-tutorial-dim'
  const advance = () => {
    if (stepIdx === CUT_TUTORIAL_STEPS.length - 1) setDone(true)
    else goToStep(stepIdx + 1)
  }

  return (
    <div>
      <div className="w-full bg-game-panel border border-game-line rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide text-brand-600 font-bold">Tutorial</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => goToStep(Math.max(0, stepIdx - 1))}
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
            <p className="text-sm text-game-text leading-relaxed">{(cbat && step.bodyCbat) || step.body}</p>
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

      {/* The live arena. Same structure as the playing branch so what is taught
          here is laid out exactly where it will be during a run. */}
      <div className="cbat-tutorial-arena flex flex-col gap-1.5" style={TUTORIAL_ARENA_STYLE}>
        <div className={`flex gap-1.5${cls('strip', missionStep)}`} style={{ flex: '10 1 0', minHeight: 0 }}>
          <div style={{ width: '80%' }}>
            <div className="w-full h-full flex flex-col bg-game-panel border rounded-lg overflow-hidden"
              style={{ borderColor: sim.warnings.length ? '#ef4444' : 'var(--color-game-line)' }}>
              <div className="shrink-0 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] leading-none sm:leading-normal font-extrabold uppercase tracking-wider border-b border-game-line text-red-400">Warning</div>
              <div className="flex-1 min-h-0 overflow-auto px-2 py-0.5 sm:py-1 flex flex-wrap items-start sm:items-center content-start sm:content-center gap-x-3 sm:gap-y-0.5">
                {guide.warning && <GuideArrow dir="right" inline />}
                {sim.warnings.length === 0
                  ? <span className="text-[10px] sm:text-[11px] leading-[1.1] sm:leading-snug text-green-400 font-bold">All systems nominal</span>
                  : sim.warnings.map(w => <span key={w} className="text-[10px] sm:text-[11px] leading-[1.1] sm:leading-snug text-red-400 font-bold">⚠ {w}</span>)}
              </div>
            </div>
          </div>
          <div style={{ width: '20%' }}>
            <div className="w-full h-full flex flex-col bg-game-panel border border-game-line rounded-lg overflow-hidden">
              <div className="shrink-0 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] leading-none sm:leading-normal font-extrabold uppercase tracking-wider border-b border-game-line text-brand-500">Clock</div>
              <div className="flex-1 min-h-0 flex items-center justify-center px-1 overflow-hidden">
                {guide.clock && <GuideArrow dir="right" inline />}
                <span className={`font-mono font-bold leading-none text-game-text tabular-nums whitespace-nowrap${guide.clock || guide.mission === 'press' ? ' cbat-word-lit' : ''}`} style={{ fontSize: 'clamp(10px, 3.2vw, 20px)' }}>
                  {fmtWall(sim.clockStartSec + sim.elapsedMs / 1000)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-1.5" style={{ flex: '90 1 0', minHeight: 0 }}>
          <div className="flex flex-col gap-1.5 rounded-lg p-1.5" style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, background: 'rgba(91,170,255,0.06)', border: '1px solid rgba(91,170,255,0.18)' }}>
            <div className={`cbat-mfd-slot ${cls('nav').trim()}`} style={{ flex: '5 1 0', minHeight: 0 }}>
              <NavButtons active={sel1} onSelect={setSel1} arrowActive={!!guide.nav} boxed={sim.cbat} stack={1} />
            </div>
            <div className={cls('panel1', missionStep).trim()} style={{ flex: '40 1 0', minHeight: 0 }}>{renderPanel(sel1)}</div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg p-1.5" style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, background: 'rgba(250,204,21,0.05)', border: '1px solid rgba(250,204,21,0.16)' }}>
            <div className={`cbat-mfd-slot ${cls('nav').trim()}`} style={{ flex: '5 1 0', minHeight: 0 }}>
              <NavButtons active={sel2} onSelect={setSel2} arrowActive={!!guide.nav} boxed={sim.cbat} stack={2} />
            </div>
            <div className={cls('panel2', feedbackStep).trim()} style={{ flex: '40 1 0', minHeight: 0 }}>{renderPanel(sel2)}</div>
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
  const cbat = useCbatTheme()

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
  // The theme is read once per sim (startGame reads it again), so a run is
  // one variant from start to finish even if the account theme changes.
  const [initialSim] = useState(() => makeSim(initialDifficulty(readStoredCutDifficulty), { cbat }))
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
      // Which Mission display this was played on: the Real CBAT variant is a
      // different task (field entry + dispenser), and the leaderboard marks
      // each score with it.
      uiTheme: sim.cbat ? 'cbat' : 'skywatch',
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

  const cbatRef = useRef(cbat)
  useEffect(() => { cbatRef.current = cbat })
  const startGame = useCallback(() => {
    simRef.current = makeSim(runTuningRef.current.key, { cbat: cbatRef.current })
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
    if (!sim.requiredCamera) return
    if (c !== sim.requiredCamera) {
      award(sim, SCORE.cameraWrong, 'wrong camera selected')
      return
    }
    // cbat: the order is for a Clock time. Early is a fault and the order
    // stands (press it again when the time comes); the sim expires it late.
    if (sim.cbat && sim.elapsedMs < sim.cameraDueAt - CAMERA_EARLY_TOL) {
      award(sim, SCORE.cameraEarly, `camera ${c} selected before its time`)
      return
    }
    award(sim, SCORE.camera, sim.cbat ? `camera ${c} selected on time` : `camera ${c} selected`)
    sim.tasksCompleted += 1
    sim.requiredCamera = null
    sim.cameraDueAt = null
  })

  // Real CBAT Mission display — typing into a field, confirming it, RELEASE.
  const onTypeField = (key, digits) => act(sim => { sim.mission.fields[key].entry = digits })
  const onConfirmField = (key) => act(sim => {
    const field = MISSION_FIELD_BY_KEY[key]
    const st = sim.mission.fields[key]
    if (!st.entry.length) return
    if (st.order) {
      if (st.entry === st.order) {
        const bonus = Math.max(0, Math.round(SCORE.fieldSpeedBonus * (st.dueAt - sim.elapsedMs) / (st.dueAt - st.orderedAt)))
        award(sim, SCORE.field + bonus, `${field.order} set to ${fmtFieldValue(field, st.entry)}`)
        sim.tasksCompleted += 1
        st.order = null
      } else {
        award(sim, SCORE.fieldWrong, `wrong ${field.order}`)
      }
    }
    // Confirmed digits stay on the interface either way, like the real one.
    st.value = st.entry
  })
  const onReleaseLoad = () => act(sim => {
    const m = sim.mission
    if (m.lights >= DISPENSER_LIGHTS) {
      const bonus = Math.max(0, Math.round(SCORE.releaseSpeedBonus * (1 - Math.min(1, (sim.elapsedMs - m.fullAt) / RELEASE_WINDOW))))
      award(sim, SCORE.release + bonus, 'load released')
      sim.tasksCompleted += 1
      resetDispenser(sim, randRange(...sim.tuning.dispenserGapMs))
    } else {
      award(sim, SCORE.releasePremature, 'release pressed before the lights were full')
    }
  })
  const onAckCode = () => act(sim => {
    if (!sim.codeAck) return
    const bonus = Math.max(0, Math.round(SCORE.codeAckSpeedBonus * (1 - Math.min(1, (sim.elapsedMs - sim.codeAck.since) / CODE_ACK_WINDOW))))
    award(sim, SCORE.codeAck + bonus, 'comms button pressed')
    sim.tasksCompleted += 1
    sim.codeAck = null
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
      if (sim.cbat) {
        // The timer keeps running to zero, when the button appears (advanceSim).
        sim.code.entered = true
      } else {
        sim.code = null
        sim.codeEntry = ''
        sim.nextCodeAt = sim.elapsedMs + randRange(...sim.tuning.codeGapMs)
      }
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
      case 'sensor':     return <SensorPanel elapsedMs={sim.elapsedMs} camera={sim.camera} requiredCamera={sim.requiredCamera} airDueAt={sim.airDueAt} groundDueAt={sim.groundDueAt} onCamera={onCamera} onActivate={onActivate} hideOrder={sim.cbat} />
      case 'mission':    return sim.cbat
        ? <CbatMissionPanel mission={sim.mission} onType={onTypeField} onConfirm={onConfirmField} onRelease={onReleaseLoad} />
        : <MissionPanel onRelease={onRelease} />
      case 'system':     return <SystemPanel pressure={sim.pressure} pump={sim.pump} code={sim.code} codeEntry={sim.codeEntry} codeAck={sim.codeAck} elapsedMs={sim.elapsedMs} onPump={onPump} onDigit={onDigit} onClearCode={onClearCode} onSubmitCode={onSubmitCode} onAckCode={onAckCode} pumpPair={sim.cbat} />
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
          <CbatGameHeader
            title="Cognitive Updating Test"
            intro={phase === 'intro' || phase === 'launching'}
            // Backing out of the tutorial counts as having been offered it,
            // same as the Skip button — otherwise it would reopen by itself
            // on the next visit.
            onQuit={phase === 'tutorial' ? () => closeTutorial('skipped') : goToIntro}
            confirmNeeded={phase === 'playing'}
            className={phase === 'launching' ? 'cbat-launch-dim' : ''}
            test={phase === 'playing' ? {
              stage: 'Testing',
              timeFrac: remainingMs / GAME_MS,
              progressFrac: 1 - remainingMs / GAME_MS,
            } : phase === 'tutorial' ? { stage: 'Instructions' } : null}
          >
            {phase === 'playing' && <ModeMarker mode={runTuning} />}
            {phase === 'playing' && !cbat && (
              <span className="ml-auto font-mono text-xs text-slate-500 flex gap-3">
                <span>⏱ <span className={remainingMs < 20000 ? 'text-red-500' : 'text-slate-600'}>{fmtClock(remainingMs)}</span></span>
                <span>Score: <span className={sim.score >= 0 ? 'text-brand-500' : 'text-red-500'}>{Math.round(sim.score)}</span></span>
              </span>
            )}
          </CbatGameHeader>

          {/* Intro */}
          {(phase === 'intro' || phase === 'launching') && (
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md lg:max-w-2xl bg-game-panel border border-game-line rounded-xl p-6 lg:p-9 text-center"
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

                <div className={`bg-game-arena rounded-lg border border-game-line p-4 lg:p-6 mb-5 lg:mb-7 text-left space-y-2 lg:space-y-3 text-sm lg:text-base text-game-text${dim}`}>
                  <div className="flex items-start gap-3"><CbatIntroLabel>Engine</CbatIntroLabel><span className="pt-0.5">keep the three fuel tanks within {FUEL_MAX_SPREAD} L</span></div>
                  <div className="flex items-start gap-3"><CbatIntroLabel>Nav</CbatIntroLabel><span className="pt-0.5">hold airspeed within ±{SPEED_TOL} kts of required</span></div>
                  <div className="flex items-start gap-3"><CbatIntroLabel>Sensor</CbatIntroLabel><span className="pt-0.5">{cbat ? 're-activate Air & Ground sensors on time; select the ordered camera at its Clock time' : 're-activate Air & Ground sensors on time; select the ordered camera'}</span></div>
                  <div className="flex items-start gap-3"><CbatIntroLabel>Mission</CbatIntroLabel><span className="pt-0.5">{cbat ? 'enter the load drop and video values ordered in Message; press RELEASE when all six dispenser lights are green' : 'drop the ordered station at its scheduled Clock time (from Message)'}</span></div>
                  <div className="flex items-start gap-3"><CbatIntroLabel>System</CbatIntroLabel><span className="pt-0.5">{cbat ? 'keep hydraulic pressure 90–110; enter comms codes in the last 15s, then press Confirm when the timer hits zero' : 'keep hydraulic pressure 90–110; enter comms codes in 15s'}</span></div>
                  <div className="flex items-start gap-3 text-xs lg:text-sm text-game-muted border-t border-game-line pt-2 lg:pt-3 mt-1"><span className="shrink-0 w-8 text-center lg:text-lg" aria-hidden>{'🕑'}</span><span className="pt-0.5">The Clock shows in-game time — some tasks are scheduled to it</span></div>
                  <div className="flex items-start gap-3 text-xs lg:text-sm text-game-muted"><span className="shrink-0 w-8 text-center lg:text-lg" aria-hidden>{'⏱'}</span><span className="pt-0.5">3 minutes — the Message display feeds every task</span></div>
                </div>

                <CbatPersonalBest label={tuning.label} best={personalBest} loading={bestLoading} className={dim}>
                  {best => best.bestScore}
                </CbatPersonalBest>

                <div className={`text-center mb-4${dim}`}>
                  <Link to={`/cbat/${tuning.gameKey}/leaderboard`} className="text-xs lg:text-sm text-brand-600 hover:text-brand-700 transition-colors">View Leaderboard →</Link>
                </div>

                <div className="flex flex-wrap gap-3 justify-center">
                  <button onClick={openTutorial} disabled={launching} className={`px-6 py-3 lg:px-8 lg:py-3.5 bg-game-fill hover:bg-game-fill-strong disabled:text-slate-500 text-game-text font-bold rounded-lg transition-colors text-sm lg:text-base cursor-pointer disabled:cursor-not-allowed${dim}`}>Tutorial</button>
                  <button onClick={beginLaunch} disabled={launching} data-demo-start className={`px-8 py-3 lg:px-10 lg:py-3.5 bg-brand-600 hover:bg-brand-700 disabled:bg-game-fill disabled:text-slate-500 text-white font-bold rounded-lg transition-colors text-sm lg:text-base cursor-pointer disabled:cursor-not-allowed${dim}`}>Start</button>
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
                  <div className="w-full h-full flex flex-col bg-game-panel border rounded-lg overflow-hidden"
                    style={{ borderColor: sim.warnings.length ? '#ef4444' : 'var(--color-game-line)' }}>
                    {/* Below sm the header and rows tighten up so four wrapped
                        warning lines still fit the strip; sm+ keeps the original
                        sizing, which already had the room. */}
                    <div className="shrink-0 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] leading-none sm:leading-normal font-extrabold uppercase tracking-wider border-b border-game-line text-red-400">Warning</div>
                    <div className="flex-1 min-h-0 overflow-auto px-2 py-0.5 sm:py-1 flex flex-wrap items-start sm:items-center content-start sm:content-center gap-x-3 sm:gap-y-0.5">
                      {sim.warnings.length === 0
                        ? <span className="text-[10px] sm:text-[11px] leading-[1.1] sm:leading-snug text-green-400 font-bold">All systems nominal</span>
                        : sim.warnings.map(w => <span key={w} className="text-[10px] sm:text-[11px] leading-[1.1] sm:leading-snug text-red-400 font-bold">⚠ {w}</span>)}
                    </div>
                  </div>
                </div>
                <div style={{ width: '20%' }}>
                  <div className="w-full h-full flex flex-col bg-game-panel border border-game-line rounded-lg overflow-hidden">
                    <div className="shrink-0 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] leading-none sm:leading-normal font-extrabold uppercase tracking-wider border-b border-game-line text-brand-500">Clock</div>
                    <div className="flex-1 min-h-0 flex items-center justify-center px-1 overflow-hidden">
                      {/* Fluid so HH:MM:SS always fits this narrow panel; capped at
                          the old 20px so desktop is unchanged. */}
                      <span className="font-mono font-bold leading-none text-game-text tabular-nums whitespace-nowrap"
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
                  <div className="cbat-mfd-slot" style={{ flex: '5 1 0', minHeight: 0 }}><NavButtons active={sel1} onSelect={setSel1} boxed={sim.cbat} stack={1} /></div>
                  <div style={{ flex: '40 1 0', minHeight: 0 }}>{renderPanel(sel1)}</div>
                </div>

                {/* Display 2 — nav (5%) + selected panel (40%) */}
                <div className="flex flex-col gap-1.5 rounded-lg p-1.5" style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, background: 'rgba(250,204,21,0.05)', border: '1px solid rgba(250,204,21,0.16)' }}>
                  <div className="cbat-mfd-slot" style={{ flex: '5 1 0', minHeight: 0 }}><NavButtons active={sel2} onSelect={setSel2} boxed={sim.cbat} stack={2} /></div>
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
            <CutTutorial onExit={closeTutorial} onProgress={reportTutorialProgress} cbat={cbat} />
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
