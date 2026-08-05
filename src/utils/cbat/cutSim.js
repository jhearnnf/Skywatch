// Pure simulation + shared constants for the CBAT Cognitive Updating Test (CUT).
// Split out of CbatCut.jsx so that file only exports its component (react-refresh)
// and so the sim logic (scoring, warnings, scheduling) is unit-testable in isolation.
//
// CUT is a fixed-length real-time multitasking sim. Six aircraft "displays" run
// continuously; the player views only two at a time and keeps every system in
// tolerance while reacting to scheduled tasks and warnings. Cadences are scaled
// down from the real test (Air 2min / Ground 4min) so several cycles fit 180s.

import { cutTuning } from './cutDifficulty'

export const GAME_MS = 180_000
export const TICK_MS = 100

export const SYSTEMS = ['message', 'engine', 'navigation', 'sensor', 'mission', 'system']
export const SYSTEM_LABELS = {
  message: 'Message', engine: 'Engine', navigation: 'Navigation',
  sensor: 'Sensor', mission: 'Mission', system: 'System',
}

// Engine — one tank feeds (drains) at a time; keep all within 50 L.
// The drain/drift/pressure RATES and the task cadences are difficulty-scaled:
// each sim carries its own tuning (see cutDifficulty.js) and advanceSim reads
// them off `sim.tuning`. The constants below are Hard's values, kept as the
// documented defaults. Tolerances are shared — only the rates differ.
export const FUEL_MAX_SPREAD = 50

// Navigation — current airspeed drifts down; hold within ±10 of required.
export const SPEED_TOL = 10
export const SPEED_STEP = 2

// Sensor — re-activation intervals (scaled) + camera orders.
export const AIR_INTERVAL = 45_000
export const GROUND_INTERVAL = 90_000
export const SENSOR_ARM_WINDOW = 6_000   // activating within this of due earns points

// Mission — a release window opens at the scheduled time. Each drop names one of
// three stations; the player must release the ORDERED station (read from Message)
// at the scheduled Clock time. The Mission panel gives no cue at all — neither
// which station nor when — so it's a genuine memory-updating task.
export const LOAD_RELEASE_WINDOW = 6_000
export const LOAD_POINTS = 3
export const stationName = (i) => `Station ${i + 1}`

// System — hydraulic pressure band + comms-code entry.
export const PRESS_LOW = 90
export const PRESS_HIGH = 110
// The comms code appears in Message this far ahead of its close — the keypad is
// live the whole time (key the digits in early), but OK only accepts in the
// final CODE_SUBMIT_WINDOW before it closes.
export const CODE_WINDOW = 30_000
export const CODE_SUBMIT_WINDOW = 15_000

// The five monitored tolerance checks (the breach conditions in computeWarnings):
// engine spread, airspeed, air sensor, ground sensor, hydraulic pressure. Each one
// that is currently IN tolerance earns a steady trickle, so keeping most systems
// green pays even while one is briefly out — scores tend positive when things go
// well, and only sustained neglect (several breaches at once) goes net-negative.
export const MONITORED_SYSTEMS = 5

// Scoring — rewards deliberately outweigh penalties so a competent run stays well
// positive; only sustained multi-system neglect drags a score down.
export const SCORE = {
  code: 25, codeSpeedBonus: 10, codeWrong: -3, codeMissed: -10,
  sensor: 15, sensorGround: 20,
  load: 40, loadPremature: -3, loadWrong: -5, loadMissed: -8,
  camera: 15, cameraWrong: -3,
  greenPerSec: 0.4,      // per system currently IN tolerance, per second
  warnBleedPerSec: 1,    // per active warning, per second
}

export function grade(score, tuning = cutTuning('hard')) {
  const g = tuning.grades
  if (score >= g.outstanding) return { label: 'Outstanding', emoji: '🎖️', color: 'text-green-400' }
  if (score >= g.good) return { label: 'Good', emoji: '🖥️', color: 'text-brand-300' }
  if (score >= g.needsWork) return { label: 'Needs Work', emoji: '🔧', color: 'text-amber-400' }
  return { label: 'Failed', emoji: '💥', color: 'text-red-400' }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
export const rand = (n) => Math.floor(Math.random() * n)
export const pick = (arr) => arr[rand(arr.length)]
export const randRange = (lo, hi) => lo + rand(hi - lo + 1)
let _mid = 0
export const mid = () => `m${++_mid}`
export const code3 = () => `${rand(10)}${rand(10)}${rand(10)}`

// How many messages to retain. Kept high (comfortably more than fills the
// panel) so the Message display stays full once the feed gets going, oldest
// scrolling off the top. `wall` is the in-game Clock (HH:MM:SS) at the moment
// the message arrived — the same value shown in the Clock panel.
export const MESSAGE_CAP = 60
export function pushMessage(sim, text) {
  sim.messages.push({ id: mid(), t: sim.elapsedMs, wall: clockAt(sim, sim.elapsedMs), text })
  if (sim.messages.length > MESSAGE_CAP) sim.messages.shift()
}

// Running score commentary. pushLog records a line without touching the score
// (used for the continuous warning bleed, already applied per tick); award both
// applies a discrete delta AND logs it with a reason.
export function pushLog(sim, delta, text) {
  sim.log.unshift({ id: mid(), t: sim.elapsedMs, delta, text })
  if (sim.log.length > 80) sim.log.length = 80
}
export function award(sim, delta, text) {
  sim.score += delta
  pushLog(sim, delta, text)
}

// Mission-elapsed stamp used in the Message log — M:SS from game start.
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// In-game wall clock — HH:MM:SS from a total seconds count (wraps at 24h).
export function fmtWall(totalSec) {
  const s = ((Math.floor(totalSec) % 86_400) + 86_400) % 86_400
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const p = (n) => String(n).padStart(2, '0')
  return `${p(hh)}:${p(mm)}:${p(ss)}`
}
// The in-game clock time a given elapsed offset maps to.
export const clockAt = (sim, elapsedMs) => fmtWall(sim.clockStartSec + elapsedMs / 1000)

// Schedule the next load drop — a station + an in-game clock time — and announce
// it. The panel never shows the station/time, so the order lives only in Message.
export function scheduleNextLoad(sim) {
  sim.loadDueAt = sim.elapsedMs + randRange(...sim.tuning.loadGapMs)
  sim.loadTarget = rand(LOAD_POINTS)
  sim.loadArmed = true
  sim.loadReady = false
  pushMessage(sim, `MISSION: drop ${stationName(sim.loadTarget)} at ${clockAt(sim, sim.loadDueAt)}`)
}

// Fresh simulation state.
// Fresh simulation state at a given difficulty (see cutDifficulty.js). The
// tuning rides on the sim so advanceSim stays a pure function of (sim, dt) —
// nothing else has to be told which difficulty is running.
export function makeSim(difficulty) {
  const tuning = cutTuning(difficulty)
  const requiredSpeed = randRange(360, 480)
  const clockStartSec = randRange(0, 86_399)   // in-game wall-clock start
  const loadDueAt = tuning.firstLoadMs          // first scheduled load drop (elapsed ms)
  const loadTarget = rand(LOAD_POINTS)          // which station the first drop wants
  return {
    tuning,
    elapsedMs: 0,
    clockStartSec,
    score: 0,
    tasksCompleted: 0,
    tasksMissed: 0,
    warningMs: 0,
    log: [],
    lastBleedSec: -1,

    // Engine — 3 tanks, tank 0 feeds first. Levels start within tolerance.
    fuel: [
      { level: 420, on: true },
      { level: 400, on: false },
      { level: 385, on: false },
    ],

    // Navigation
    speed: requiredSpeed + SPEED_TOL,   // start at the safe ceiling
    requiredSpeed,
    nextSpeedAt: randRange(...tuning.speedChangeMs),

    // Sensor
    camera: 'Alpha',
    requiredCamera: null,
    nextCameraAt: randRange(...tuning.cameraFirstMs),
    airDueAt: AIR_INTERVAL,
    groundDueAt: GROUND_INTERVAL,

    // Mission — load drop scheduled to an in-game clock time (announced via Message)
    loadDueAt,
    loadTarget,
    loadArmed: true,
    loadReady: false,

    // System — hydraulic pressure + comms code
    pressure: 100,
    pump: false,
    code: null,          // { digits, dueAt }
    codeEntry: '',
    nextCodeAt: tuning.firstCodeMs,

    messages: [
      { id: mid(), t: 0, wall: fmtWall(clockStartSec), text: 'MISSION: hold all systems in tolerance. Keep the warning panel clear.' },
      { id: mid(), t: 0, wall: fmtWall(clockStartSec), text: `MISSION: drop ${stationName(loadTarget)} at ${fmtWall(clockStartSec + loadDueAt / 1000)}` },
    ],
    warnings: [],
  }
}

// Compute the list of active-breach strings for the current sim state.
export function computeWarnings(sim) {
  const w = []
  const levels = sim.fuel.map(f => f.level)
  if (Math.max(...levels) - Math.min(...levels) > FUEL_MAX_SPREAD) w.push('ENGINE: fuel imbalance')
  if (Math.abs(sim.speed - sim.requiredSpeed) > SPEED_TOL) w.push('NAVIGATION: airspeed out of tolerance')
  if (sim.elapsedMs > sim.airDueAt) w.push('SENSOR: air sensor overdue')
  if (sim.elapsedMs > sim.groundDueAt) w.push('SENSOR: ground sensor overdue')
  if (sim.pressure < PRESS_LOW || sim.pressure > PRESS_HIGH) w.push('SYSTEM: hydraulic pressure')
  return w
}

// Advance the whole simulation by `dt` ms. Mutates `sim`.
export function advanceSim(sim, dt) {
  const secs = dt / 1000
  const tuning = sim.tuning
  sim.elapsedMs += dt

  // Engine — the feeding tank drains.
  const feed = sim.fuel.find(f => f.on)
  if (feed) feed.level = Math.max(0, feed.level - tuning.fuelDrainPerSec * secs)

  // Navigation — current airspeed bleeds off; required changes periodically.
  sim.speed = Math.max(0, sim.speed - tuning.speedDriftPerSec * secs)
  if (sim.elapsedMs >= sim.nextSpeedAt) {
    sim.requiredSpeed = randRange(360, 480)
    // Current airspeed catches up to the new setting (safe ceiling), then drifts
    // down again so the player has to keep re-trimming it — same as game start.
    sim.speed = sim.requiredSpeed + SPEED_TOL
    sim.nextSpeedAt = sim.elapsedMs + randRange(...tuning.speedChangeMs)
    pushMessage(sim, `NAV: set airspeed to ${sim.requiredSpeed} kts (±${SPEED_TOL})`)
  }

  // Sensor — camera orders. Always the camera that isn't already selected; an
  // order to re-select the live camera would be a no-op.
  if (sim.elapsedMs >= sim.nextCameraAt) {
    sim.requiredCamera = sim.camera === 'Alpha' ? 'Bravo' : 'Alpha'
    sim.nextCameraAt = sim.elapsedMs + randRange(...tuning.cameraNextMs)
    pushMessage(sim, `SENSOR: select camera ${sim.requiredCamera}`)
  }

  // Mission — the release window opens at the scheduled drop time. Nothing on
  // the panel announces it; the player has to be watching the Clock. Miss the
  // window and it's a fault.
  if (sim.loadArmed) {
    sim.loadReady = sim.elapsedMs >= sim.loadDueAt
    if (sim.elapsedMs > sim.loadDueAt + LOAD_RELEASE_WINDOW) {
      award(sim, SCORE.loadMissed, `${stationName(sim.loadTarget)} load drop missed`)
      sim.tasksMissed += 1
      pushMessage(sim, `MISSION: ${stationName(sim.loadTarget)} drop at ${clockAt(sim, sim.loadDueAt)} missed`)
      scheduleNextLoad(sim)
    }
  }

  // System — hydraulic pressure drifts with pump state.
  sim.pressure += (sim.pump ? tuning.pressRisePerSec : -tuning.pressDropPerSec) * secs
  sim.pressure = Math.max(60, Math.min(140, sim.pressure))

  // System — comms code lifecycle.
  if (!sim.code && sim.elapsedMs >= sim.nextCodeAt) {
    sim.code = { digits: code3(), dueAt: sim.elapsedMs + CODE_WINDOW }
    sim.codeEntry = ''
    pushMessage(sim, `COMMS: code ${sim.code.digits} — enter in System, submit in the final ${CODE_SUBMIT_WINDOW / 1000}s`)
  }
  if (sim.code && sim.elapsedMs > sim.code.dueAt) {
    award(sim, SCORE.codeMissed, 'comms code window missed')
    sim.tasksMissed += 1
    sim.code = null
    sim.codeEntry = ''
    sim.nextCodeAt = sim.elapsedMs + randRange(...tuning.codeGapMs)
    pushMessage(sim, 'COMMS: code entry window missed')
  }

  // Warnings + score. Every system currently in tolerance earns a steady
  // trickle; each active breach bleeds a smaller amount. Net effect stays
  // positive while most systems are green, so a competent run trends upward.
  sim.warnings = computeWarnings(sim)
  const nominal = Math.max(0, MONITORED_SYSTEMS - sim.warnings.length)
  sim.score += nominal * SCORE.greenPerSec * secs
  if (sim.warnings.length) {
    sim.score -= SCORE.warnBleedPerSec * sim.warnings.length * secs
    sim.warningMs += dt
    // Log the bleed once per whole game-second, one line per active breach, so
    // the commentary shows what's costing points without spamming every tick.
    const sec = Math.floor(sim.elapsedMs / 1000)
    if (sec > sim.lastBleedSec) {
      for (const w of sim.warnings) pushLog(sim, -SCORE.warnBleedPerSec, w)
      sim.lastBleedSec = sec
    }
  }
}
