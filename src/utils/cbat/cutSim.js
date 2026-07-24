// Pure simulation + shared constants for the CBAT Cognitive Updating Test (CUT).
// Split out of CbatCut.jsx so that file only exports its component (react-refresh)
// and so the sim logic (scoring, warnings, scheduling) is unit-testable in isolation.
//
// CUT is a fixed-length real-time multitasking sim. Six aircraft "displays" run
// continuously; the player views only two at a time and keeps every system in
// tolerance while reacting to scheduled tasks and warnings. Cadences are scaled
// down from the real test (Air 2min / Ground 4min) so several cycles fit 180s.

export const GAME_MS = 180_000
export const TICK_MS = 100

export const SYSTEMS = ['message', 'engine', 'navigation', 'sensor', 'mission', 'system']
export const SYSTEM_LABELS = {
  message: 'Message', engine: 'Engine', navigation: 'Navigation',
  sensor: 'Sensor', mission: 'Mission', system: 'System',
}

// Engine — one tank feeds (drains) at a time; keep all within 50 L.
export const FUEL_DRAIN_PER_SEC = 6
export const FUEL_MAX_SPREAD = 50

// Navigation — current airspeed drifts down; hold within ±10 of required.
export const SPEED_DRIFT_PER_SEC = 1.0
export const SPEED_TOL = 10
export const SPEED_STEP = 5

// Sensor — re-activation intervals (scaled) + camera orders.
export const AIR_INTERVAL = 45_000
export const GROUND_INTERVAL = 90_000
export const SENSOR_ARM_WINDOW = 6_000   // activating within this of due earns points

// Mission — dispenser lights fill over the lead-in, then a release window opens.
// Each drop names one of three stations; the player must release the ORDERED
// station (read from Message) at the scheduled Clock time — nothing on the panel
// reveals which/when, so it's a genuine memory-updating task.
export const LOAD_FILL_MS = 9_000
export const LOAD_RELEASE_WINDOW = 6_000
export const LOAD_POINTS = 3
export const stationName = (i) => `Station ${i + 1}`

// System — hydraulic pressure band + comms-code entry.
export const PRESS_RISE_PER_SEC = 1      // pump ON — very gentle (band lasts ~20s)
export const PRESS_DROP_PER_SEC = 0.7    // pump OFF
export const PRESS_LOW = 90
export const PRESS_HIGH = 110
export const CODE_WINDOW = 15_000

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

export function grade(score) {
  if (score >= 1100) return { label: 'Outstanding', emoji: '🎖️', color: 'text-green-400' }
  if (score >= 700) return { label: 'Good', emoji: '🖥️', color: 'text-brand-300' }
  if (score >= 350) return { label: 'Needs Work', emoji: '🔧', color: 'text-amber-400' }
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
  sim.loadDueAt = sim.elapsedMs + randRange(18_000, 26_000)
  sim.loadTarget = rand(LOAD_POINTS)
  sim.loadArmed = true
  sim.loadLights = 0
  sim.loadReady = false
  pushMessage(sim, `MISSION: drop ${stationName(sim.loadTarget)} at ${clockAt(sim, sim.loadDueAt)}`)
}

// Fresh simulation state.
export function makeSim() {
  const requiredSpeed = randRange(360, 480)
  const clockStartSec = randRange(0, 86_399)   // in-game wall-clock start
  const loadDueAt = 22_000                      // first scheduled load drop (elapsed ms)
  const loadTarget = rand(LOAD_POINTS)          // which station the first drop wants
  return {
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
    nextSpeedAt: randRange(32_000, 42_000),

    // Sensor
    camera: 'Alpha',
    requiredCamera: null,
    nextCameraAt: randRange(40_000, 55_000),
    airDueAt: AIR_INTERVAL,
    groundDueAt: GROUND_INTERVAL,

    // Mission — load drop scheduled to an in-game clock time (announced via Message)
    loadDueAt,
    loadTarget,
    loadArmed: true,
    loadLights: 0,
    loadReady: false,

    // System — hydraulic pressure + comms code
    pressure: 100,
    pump: false,
    code: null,          // { digits, dueAt }
    codeEntry: '',
    nextCodeAt: 10_000,

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
  sim.elapsedMs += dt

  // Engine — the feeding tank drains.
  const feed = sim.fuel.find(f => f.on)
  if (feed) feed.level = Math.max(0, feed.level - FUEL_DRAIN_PER_SEC * secs)

  // Navigation — current airspeed bleeds off; required changes periodically.
  sim.speed = Math.max(0, sim.speed - SPEED_DRIFT_PER_SEC * secs)
  if (sim.elapsedMs >= sim.nextSpeedAt) {
    sim.requiredSpeed = randRange(360, 480)
    sim.nextSpeedAt = sim.elapsedMs + randRange(32_000, 42_000)
    pushMessage(sim, `NAV: set airspeed to ${sim.requiredSpeed} kts (±${SPEED_TOL})`)
  }

  // Sensor — camera orders.
  if (sim.elapsedMs >= sim.nextCameraAt) {
    sim.requiredCamera = pick(['Alpha', 'Bravo'])
    sim.nextCameraAt = sim.elapsedMs + randRange(40_000, 60_000)
    pushMessage(sim, `SENSOR: select camera ${sim.requiredCamera}`)
  }

  // Mission — dispenser lights fill over the lead-in to the scheduled drop time;
  // the release window opens at the drop time. Miss it and it's a fault.
  if (sim.loadArmed) {
    const leadStart = sim.loadDueAt - LOAD_FILL_MS
    sim.loadLights = Math.max(0, Math.min(6, Math.floor((sim.elapsedMs - leadStart) / (LOAD_FILL_MS / 6))))
    sim.loadReady = sim.elapsedMs >= sim.loadDueAt
    if (sim.elapsedMs > sim.loadDueAt + LOAD_RELEASE_WINDOW) {
      award(sim, SCORE.loadMissed, `${stationName(sim.loadTarget)} load drop missed`)
      sim.tasksMissed += 1
      pushMessage(sim, `MISSION: ${stationName(sim.loadTarget)} drop at ${clockAt(sim, sim.loadDueAt)} missed`)
      scheduleNextLoad(sim)
    }
  }

  // System — hydraulic pressure drifts with pump state.
  sim.pressure += (sim.pump ? PRESS_RISE_PER_SEC : -PRESS_DROP_PER_SEC) * secs
  sim.pressure = Math.max(60, Math.min(140, sim.pressure))

  // System — comms code lifecycle.
  if (!sim.code && sim.elapsedMs >= sim.nextCodeAt) {
    sim.code = { digits: code3(), dueAt: sim.elapsedMs + CODE_WINDOW }
    sim.codeEntry = ''
    pushMessage(sim, `COMMS: enter code ${sim.code.digits} in System (${CODE_WINDOW / 1000}s)`)
  }
  if (sim.code && sim.elapsedMs > sim.code.dueAt) {
    award(sim, SCORE.codeMissed, 'comms code window missed')
    sim.tasksMissed += 1
    sim.code = null
    sim.codeEntry = ''
    sim.nextCodeAt = sim.elapsedMs + randRange(8_000, 14_000)
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
