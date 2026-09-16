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

// ── Real CBAT variant (account theme 'cbat') ─────────────────────────────────
// Modelled on the real test's Mission display (screenshot on the RAF CBAT TMI
// guide, confirmed by sitters): a Load Drop Interface (Time / Latitude /
// Longitude), a Load Drop Dispenser (six lights that turn green one at a time
// over a random interval, then RELEASE) and a Video Recording Interface
// (Magnification / Latitude / Longitude / Duration). Message orders ONE field
// value at a time ("set video magnification to 6"); the player types it into
// that field and confirms it. Under the SkyWatch theme none of this exists —
// the Mission display is the three-station drop — so every branch below is
// keyed on `sim.cbat`.
//
// Two smaller fidelity points ride on the same flag: camera orders carry a
// Clock time and must not be pressed early, and a comms code's timer reaching
// zero brings up a button that has to be pressed straight away.
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
export const FIELD_WINDOW = 30_000       // confirm an ordered value within this
export const DISPENSER_LIGHTS = 6
export const RELEASE_WINDOW = 6_000      // press RELEASE within this of the sixth light
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
  load: 40, loadPremature: -3, loadWrong: -5, loadMissed: -8,
  camera: 15, cameraWrong: -3,
  // Real CBAT variant only.
  field: 25, fieldSpeedBonus: 10, fieldWrong: -3, fieldMissed: -8,
  release: 30, releaseSpeedBonus: 10, releasePremature: -3, releaseMissed: -8,
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

// Schedule the next load drop — a station + an in-game clock time — and announce
// it. The panel never shows the station/time, so the order lives only in Message.
export function scheduleNextLoad(sim) {
  sim.loadDueAt = sim.elapsedMs + randRange(...sim.tuning.loadGapMs)
  sim.loadTarget = rand(LOAD_POINTS)
  sim.loadArmed = true
  sim.loadReady = false
  pushMessage(sim, `MISSION: drop ${stationName(sim.loadTarget)} at ${clockAt(sim, sim.loadDueAt)}`)
}

// Real CBAT variant — order a value for one Mission field that has no order
// outstanding, through Message. Returns the field, or null if every field is
// already waiting on a value (then nothing is ordered this time round).
export function orderMissionField(sim, windowMs = FIELD_WINDOW) {
  const free = MISSION_FIELDS.filter(f => !sim.mission.fields[f.key].order)
  if (!free.length) return null
  const field = pick(free)
  const state = sim.mission.fields[field.key]
  state.order = fieldValue(field)
  state.orderedAt = sim.elapsedMs
  state.dueAt = sim.elapsedMs + windowMs
  pushMessage(sim, `MISSION: set ${field.order} to ${fmtFieldValue(field, state.order)}`)
  state.messageId = sim.messages[sim.messages.length - 1].id
  return field
}

// Real CBAT variant — a camera order names the camera AND the Clock time to
// press it at. Always the camera that isn't live, as in the SkyWatch variant.
export function orderCamera(sim, leadMs) {
  sim.requiredCamera = sim.camera === 'Alpha' ? 'Bravo' : 'Alpha'
  sim.cameraDueAt = sim.elapsedMs + leadMs
  pushMessage(sim, `SENSOR: select camera ${sim.requiredCamera} at ${clockAt(sim, sim.cameraDueAt)}`)
  sim.cameraMessageId = sim.messages[sim.messages.length - 1].id
}

// Real CBAT variant — empty the dispenser and start the next slow fill.
export function resetDispenser(sim, gapMs) {
  sim.mission.lights = 0
  sim.mission.fullAt = null
  sim.mission.nextLightAt = sim.elapsedMs + gapMs
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
  const loadDueAt = tuning.firstLoadMs          // first scheduled load drop (elapsed ms)
  const loadTarget = rand(LOAD_POINTS)          // which station the first drop wants
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

    // Mission — load drop scheduled to an in-game clock time (announced via Message)
    loadDueAt,
    loadTarget,
    loadArmed: !cbat,
    loadReady: false,

    // Mission — Real CBAT variant: field orders + the dispenser.
    mission: {
      fields: freshMissionFields(),
      nextOrderAt: tuning.fieldFirstMs,
      lights: 0,
      nextLightAt: randRange(...tuning.lightGapMs),
      fullAt: null,        // when the sixth light came on (RELEASE live)
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
      ...(cbat ? [] : [{ id: mid(), t: 0, wall: fmtWall(clockStartSec), text: `MISSION: drop ${stationName(loadTarget)} at ${fmtWall(clockStartSec + loadDueAt / 1000)}` }]),
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

  // Mission — Real CBAT variant. One field value is ordered at a time through
  // Message; an unconfirmed order lapses after FIELD_WINDOW. The dispenser
  // lights come on one by one at random intervals; once all six are lit the
  // RELEASE press is expected within RELEASE_WINDOW.
  if (sim.cbat) {
    const m = sim.mission
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
    if (m.lights < DISPENSER_LIGHTS) {
      if (sim.elapsedMs >= m.nextLightAt) {
        m.lights += 1
        m.nextLightAt = sim.elapsedMs + randRange(...tuning.lightGapMs)
        if (m.lights === DISPENSER_LIGHTS) m.fullAt = sim.elapsedMs
      }
    } else if (sim.elapsedMs > m.fullAt + RELEASE_WINDOW) {
      award(sim, SCORE.releaseMissed, 'load not released')
      sim.tasksMissed += 1
      pushMessage(sim, 'MISSION: release window missed')
      resetDispenser(sim, randRange(...tuning.dispenserGapMs))
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
