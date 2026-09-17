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

// System — hydraulic pressure band + comms-code entry.
export const PRESS_LOW = 90
export const PRESS_HIGH = 110
// The comms code appears in Message this far ahead of its close — the keypad is
// live the whole time (key the digits in early), but OK only accepts in the
// final CODE_SUBMIT_WINDOW before it closes.
export const CODE_WINDOW = 30_000
export const CODE_SUBMIT_WINDOW = 15_000

// ── Mission display ──────────────────────────────────────────────────────────
// Modelled on the real test's Mission display (screenshot on the RAF CBAT TMI
// guide, confirmed by sitters): a Load Drop Interface (Time / Latitude /
// Longitude), a Load Drop Dispenser (six lights and RELEASE) and a Video
// Recording Interface (Magnification / Latitude / Longitude / Duration).
//
// A load drop is three orders through Message, one value each — latitude,
// longitude, then a Clock time — typed into the interface and confirmed. The
// dispenser arms (all six lights green) once the three values are in, and the
// load is RELEASED as the Clock reaches the ordered time: early is a fault,
// and the window after it is short. Two sitters described it exactly this way
// (enter the three boxes, then drop at the time said, watching the clock).
// Video values are ordered one at a time as separate tasks. This is the
// Mission display under BOTH themes: it began as the Real CBAT variant, and a
// sitter confirmed the three-station drop it replaced was the one place
// SkyWatch's CUT differed from the real thing, so the stations went
// (2026-09-16).
//
// ── Real CBAT variant (account theme 'cbat') ─────────────────────────────────
// Two smaller fidelity points are still keyed on `sim.cbat`: camera orders
// carry a Clock time and must not be pressed early, and a comms code's timer
// reaching zero brings up a button that has to be pressed straight away.
export const MISSION_FIELDS = [
  { key: 'loadTime', panel: 'load',  label: 'Time',          digits: 6, order: 'load drop time' },
  { key: 'loadLat',  panel: 'load',  label: 'Latitude',      digits: 6, order: 'load drop latitude' },
  { key: 'loadLon',  panel: 'load',  label: 'Longitude',     digits: 6, order: 'load drop longitude' },
  { key: 'vidMag',   panel: 'video', label: 'Magnification', digits: 1, order: 'video magnification' },
  { key: 'vidLat',   panel: 'video', label: 'Latitude',      digits: 6, order: 'video latitude' },
  { key: 'vidLon',   panel: 'video', label: 'Longitude',     digits: 6, order: 'video longitude' },
  { key: 'vidDur',   panel: 'video', label: 'Duration',      digits: 2, order: 'video duration' },
]
export const MISSION_FIELD_BY_KEY = Object.fromEntries(MISSION_FIELDS.map(f => [f.key, f]))
export const LOAD_FIELDS = MISSION_FIELDS.filter(f => f.panel === 'load')
export const VIDEO_FIELDS = MISSION_FIELDS.filter(f => f.panel === 'video')
// The order a drop's three values are asked for: the time comes last, so the
// countdown only starts once the rest is in.
export const LOAD_ORDER = ['loadLat', 'loadLon', 'loadTime']
export const FIELD_WINDOW = 30_000       // confirm an ordered video value within this
export const DISPENSER_LIGHTS = 6
export const LIGHTS_PER_LOAD_FIELD = DISPENSER_LIGHTS / LOAD_FIELDS.length
export const RELEASE_WINDOW = 10_000     // press RELEASE within this of the ordered second
export const RELEASE_EARLY_TOL = 500     // a press this close before it still counts
export const CAMERA_WINDOW = 6_000       // press the ordered camera within this of its time
export const CAMERA_EARLY_TOL = 1_000    // a press this close before the time still counts
export const CODE_ACK_WINDOW = 8_000     // press the button that appears at zero within this

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
  camera: 15, cameraWrong: -3,
  field: 25, fieldSpeedBonus: 10, fieldWrong: -3, fieldMissed: -8,
  // A release scores `release` on the ordered second, falling straight down
  // to `releaseLate` by the end of RELEASE_WINDOW.
  release: 50, releaseLate: 10, releasePremature: -3, releaseMissed: -8,
  // Real CBAT variant only.
  cameraEarly: -3, cameraMissed: -5,
  codeAck: 8, codeAckSpeedBonus: 4, codeAckMissed: -5,
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

// A value for a Mission field, as a bare digit string of the field's length.
// Times are HH MM SS; latitudes/longitudes are DD MM SS (two-digit boxes, like
// the real interface); magnification is one digit 1–9; duration two digits.
const p2 = (n) => String(n).padStart(2, '0')
export function fieldValue(field) {
  switch (field.key) {
    case 'loadTime': return `${p2(rand(24))}${p2(rand(60))}${p2(rand(60))}`
    case 'vidMag':   return String(1 + rand(9))
    case 'vidDur':   return String(randRange(10, 59))
    default:         return `${p2(rand(90))}${p2(rand(60))}${p2(rand(60))}`
  }
}
// Digits as the field shows them: six-digit fields read HH:MM:SS / DD:MM:SS.
export function fmtFieldValue(field, digits) {
  if (field.digits !== 6) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`
}

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

// Order a value for one Mission field through Message. Returns the id of the
// Message line, so a caller can point at it.
export function orderField(sim, field, value, dueAt) {
  const state = sim.mission.fields[field.key]
  state.order = value
  state.orderedAt = sim.elapsedMs
  state.dueAt = dueAt
  pushMessage(sim, `MISSION: set ${field.order} to ${fmtFieldValue(field, value)}`)
  state.messageId = sim.messages[sim.messages.length - 1].id
  return state.messageId
}

// Order a value for one video field that has no order outstanding. Returns the
// field, or null if every video field is already waiting on a value (then
// nothing is ordered this time round).
export function orderMissionField(sim, windowMs = sim.tuning.fieldWindowMs) {
  const free = VIDEO_FIELDS.filter(f => !sim.mission.fields[f.key].order)
  if (!free.length) return null
  const field = pick(free)
  orderField(sim, field, fieldValue(field), sim.elapsedMs + windowMs)
  return field
}

// Begin a load drop due `leadMs` from now, on a whole Clock second: the order
// names HH:MM:SS, and the press is judged against the moment the Clock shows
// it, not some point inside that second. Its three orders follow through
// orderLoadField, the first straight away.
export function startDrop(sim, leadMs) {
  const dueAt = Math.ceil((sim.elapsedMs + leadMs) / 1000) * 1000
  sim.mission.drop = { dueAt, issued: 0, nextOrderAt: sim.elapsedMs, timeMessageId: null }
  return sim.mission.drop
}

// Order the drop's next value (latitude, longitude, then the time). Every load
// value is wanted by the drop time itself. Returns the field ordered.
export function orderLoadField(sim) {
  const drop = sim.mission.drop
  const field = MISSION_FIELD_BY_KEY[LOAD_ORDER[drop.issued]]
  const value = field.key === 'loadTime'
    ? clockAt(sim, drop.dueAt).replace(/:/g, '')
    : fieldValue(field)
  const messageId = orderField(sim, field, value, drop.dueAt)
  if (field.key === 'loadTime') drop.timeMessageId = messageId
  drop.issued += 1
  return field
}

// How many dispenser lights are lit: two per load value on the interface. All
// six is "armed", and only then is RELEASE live.
export function dispenserLights(sim) {
  return LOAD_FIELDS.filter(f => sim.mission.fields[f.key].value).length * LIGHTS_PER_LOAD_FIELD
}
export const dispenserArmed = (sim) => dispenserLights(sim) >= DISPENSER_LIGHTS

// The drop is over (released or missed): withdraw any load order still
// standing, clear the interface so the dispenser disarms, and book the next.
export function clearDrop(sim, gapMs) {
  for (const f of LOAD_FIELDS) Object.assign(sim.mission.fields[f.key], { entry: '', value: '', order: null })
  sim.mission.drop = null
  sim.mission.nextDropAt = sim.elapsedMs + gapMs
}

// Real CBAT variant — a camera order names the camera AND the Clock time to
// press it at. Always the camera that isn't live, as under SkyWatch.
export function orderCamera(sim, leadMs) {
  sim.requiredCamera = sim.camera === 'Alpha' ? 'Bravo' : 'Alpha'
  sim.cameraDueAt = sim.elapsedMs + leadMs
  pushMessage(sim, `SENSOR: select camera ${sim.requiredCamera} at ${clockAt(sim, sim.cameraDueAt)}`)
  sim.cameraMessageId = sim.messages[sim.messages.length - 1].id
}

function freshMissionFields() {
  return Object.fromEntries(MISSION_FIELDS.map(f => [f.key, {
    entry: '',        // digits typed, not yet confirmed
    value: '',        // last confirmed digits (stays on the interface)
    order: null,      // digits Message asked for, until confirmed or expired
    orderedAt: 0,
    dueAt: 0,
    messageId: null,
  }]))
}

// Fresh simulation state.
// Fresh simulation state at a given difficulty (see cutDifficulty.js). The
// tuning rides on the sim so advanceSim stays a pure function of (sim, dt) —
// nothing else has to be told which difficulty is running.
export function makeSim(difficulty, { cbat = false } = {}) {
  const tuning = cutTuning(difficulty)
  const requiredSpeed = randRange(360, 480)
  const clockStartSec = randRange(0, 86_399)   // in-game wall-clock start
  return {
    tuning,
    // Real CBAT variant (account theme). Fixed for the life of the sim.
    cbat,
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
    cameraDueAt: null,     // cbat: the Clock time the order is for
    nextCameraAt: randRange(...tuning.cameraFirstMs),
    airDueAt: AIR_INTERVAL,
    groundDueAt: GROUND_INTERVAL,

    // Mission — the load drop in progress (null between drops) + video orders.
    mission: {
      fields: freshMissionFields(),
      drop: null,          // { dueAt, issued, nextOrderAt, timeMessageId }
      nextDropAt: tuning.firstDropMs,
      nextOrderAt: tuning.fieldFirstMs,
    },

    // System — hydraulic pressure + comms code
    pressure: 100,
    pump: false,
    code: null,          // { digits, dueAt, entered }
    codeEntry: '',
    codeAck: null,       // cbat: { since } — the button that appears at zero
    nextCodeAt: tuning.firstCodeMs,

    messages: [
      { id: mid(), t: 0, wall: fmtWall(clockStartSec), text: 'MISSION: hold all systems in tolerance. Keep the warning panel clear.' },
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
    sim.nextCameraAt = sim.elapsedMs + randRange(...tuning.cameraNextMs)
    if (sim.cbat) {
      orderCamera(sim, randRange(...tuning.cameraLeadMs))
    } else {
      sim.requiredCamera = sim.camera === 'Alpha' ? 'Bravo' : 'Alpha'
      pushMessage(sim, `SENSOR: select camera ${sim.requiredCamera}`)
    }
  }
  // cbat: an order not pressed by its time (plus the window) is a fault.
  if (sim.cbat && sim.requiredCamera && sim.elapsedMs > sim.cameraDueAt + CAMERA_WINDOW) {
    award(sim, SCORE.cameraMissed, `camera ${sim.requiredCamera} not selected at ${clockAt(sim, sim.cameraDueAt)}`)
    sim.tasksMissed += 1
    pushMessage(sim, `SENSOR: camera ${sim.requiredCamera} order missed`)
    sim.requiredCamera = null
    sim.cameraDueAt = null
  }

  // Mission — a load drop is ordered a value at a time (latitude, longitude,
  // then the time), the load values lapsing at the drop time itself; the
  // RELEASE press is expected as the Clock reaches it, within RELEASE_WINDOW.
  // Video values are ordered on their own cadence and lapse after FIELD_WINDOW.
  const m = sim.mission
  if (!m.drop && sim.elapsedMs >= m.nextDropAt) {
    // Never issue a drop whose full release window could run past the round.
    // Include rounding to the next whole Clock second in the time budget.
    const latestDueAt = Math.ceil((sim.elapsedMs + tuning.dropLeadMs[1]) / 1000) * 1000
    if (latestDueAt + RELEASE_WINDOW < tuning.gameMs) {
      startDrop(sim, randRange(...tuning.dropLeadMs))
    } else {
      m.nextDropAt = Infinity
    }
  }
  if (m.drop && m.drop.issued < LOAD_ORDER.length && sim.elapsedMs >= m.drop.nextOrderAt) {
    orderLoadField(sim)
    m.drop.nextOrderAt = sim.elapsedMs + randRange(...tuning.dropOrderGapMs)
  }
  if (m.drop && sim.elapsedMs > m.drop.dueAt + RELEASE_WINDOW) {
    award(sim, SCORE.releaseMissed, `load drop at ${clockAt(sim, m.drop.dueAt)} missed`)
    sim.tasksMissed += 1
    pushMessage(sim, `MISSION: load drop at ${clockAt(sim, m.drop.dueAt)} missed`)
    clearDrop(sim, randRange(...tuning.dropGapMs))
  }
  if (sim.elapsedMs >= m.nextOrderAt) {
    orderMissionField(sim)
    m.nextOrderAt = sim.elapsedMs + randRange(...tuning.fieldGapMs)
  }
  for (const f of MISSION_FIELDS) {
    const st = m.fields[f.key]
    if (st.order && sim.elapsedMs > st.dueAt) {
      award(sim, SCORE.fieldMissed, `${f.order} not set`)
      sim.tasksMissed += 1
      pushMessage(sim, `MISSION: ${f.order} order missed`)
      st.order = null
    }
  }

  // System — hydraulic pressure drifts with pump state.
  sim.pressure += (sim.pump ? tuning.pressRisePerSec : -tuning.pressDropPerSec) * secs
  sim.pressure = Math.max(60, Math.min(140, sim.pressure))

  // System — comms code lifecycle.
  if (!sim.code && sim.elapsedMs >= sim.nextCodeAt) {
    sim.code = { digits: code3(), dueAt: sim.elapsedMs + tuning.codeWindowMs }
    sim.codeEntry = ''
    pushMessage(sim, `COMMS: code ${sim.code.digits} — enter in System, submit in the final ${tuning.codeSubmitWindowMs / 1000}s`)
  }
  if (sim.code && sim.elapsedMs > sim.code.dueAt) {
    // cbat: a correctly entered code stays on the panel until its timer runs
    // out (`entered`), so reaching zero is not a miss for it.
    if (!sim.code.entered) {
      award(sim, SCORE.codeMissed, 'comms code window missed')
      sim.tasksMissed += 1
      pushMessage(sim, 'COMMS: code entry window missed')
    }
    // cbat: the timer reaching zero brings up the button, entered or not.
    if (sim.cbat) sim.codeAck = { since: sim.code.dueAt }
    sim.code = null
    sim.codeEntry = ''
    sim.nextCodeAt = sim.elapsedMs + randRange(...tuning.codeGapMs)
  }
  if (sim.codeAck && sim.elapsedMs > sim.codeAck.since + CODE_ACK_WINDOW) {
    award(sim, SCORE.codeAckMissed, 'comms button not pressed')
    sim.tasksMissed += 1
    sim.codeAck = null
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
