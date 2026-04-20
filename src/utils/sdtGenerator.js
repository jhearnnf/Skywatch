// ── CBAT Speed-Distance-Time round generator ─────────────────────────────────
// Pure helpers: generate randomised journey rounds, grade user answers.
// Kept side-effect free so it can be tested in isolation.

export const SDT_NODES = ['Victor', 'Xray', 'Yankee', 'Zulu', 'Whiskey', 'Tango', 'Romeo', 'Papa']

// Undirected edges — every node has at least two neighbours so start→via→dest works.
export const SDT_EDGES = [
  ['Victor', 'Xray'],
  ['Victor', 'Yankee'],
  ['Victor', 'Whiskey'],
  ['Xray', 'Yankee'],
  ['Xray', 'Whiskey'],
  ['Yankee', 'Zulu'],
  ['Whiskey', 'Zulu'],
  ['Tango', 'Victor'],
  ['Tango', 'Xray'],
  ['Romeo', 'Victor'],
  ['Romeo', 'Yankee'],
  ['Papa', 'Whiskey'],
  ['Papa', 'Zulu'],
]

// Fixed screen coordinates for the map (viewBox -50 0 580 420).
// Positions are spaced to leave a clear gap between every distance pill and every
// place-name label, at the sizes used in CbatSpeedDistanceTime.jsx.
export const SDT_NODE_POS = {
  Tango:   { x: 84,  y: 60 },
  Victor:  { x: 252, y: 60 },
  Romeo:   { x: 420, y: 60 },
  Xray:    { x: 48,  y: 180 },
  Yankee:  { x: 456, y: 180 },
  Whiskey: { x: 114, y: 288 },
  Papa:    { x: 270, y: 342 },
  Zulu:    { x: 390, y: 288 },
}

// Per-node label placement — keeps text out of distance-pill zones.
//   top row (Tango/Victor/Romeo): label above the circle
//   middle row sides (Xray/Yankee/Whiskey/Zulu): label beside the circle (outward)
//   centre bottom (Papa):        label below the circle
export const SDT_LABEL_OFFSETS = {
  Tango:   { dx: 0,   dy: -36, anchor: 'middle' },
  Victor:  { dx: 0,   dy: -36, anchor: 'middle' },
  Romeo:   { dx: 0,   dy: -36, anchor: 'middle' },
  Xray:    { dx: -34, dy: 8,   anchor: 'end' },
  Yankee:  { dx: 34,  dy: 8,   anchor: 'start' },
  Whiskey: { dx: -34, dy: 8,   anchor: 'end' },
  Zulu:    { dx: 34,  dy: 8,   anchor: 'start' },
  Papa:    { dx: 0,   dy: 46,  anchor: 'middle' },
}

const adj = Object.fromEntries(SDT_NODES.map(n => [n, []]))
SDT_EDGES.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a) })
export const SDT_ADJ = adj

// Weight (kg) → miles-per-minute & gallons-per-hour
export const WEIGHT_TABLE = [
  { weight: 100, mpm: 7, gph: 4 },
  { weight: 200, mpm: 6, gph: 5 },
  { weight: 300, mpm: 5, gph: 6 },
  { weight: 400, mpm: 4, gph: 7 },
  { weight: 500, mpm: 3, gph: 8 },
  { weight: 600, mpm: 2, gph: 9 },
  { weight: 700, mpm: 1, gph: 10 },
]

export const QUESTION_TYPES = ['arrival', 'distance', 'fuel', 'speed']

export const QUESTION_META = {
  arrival:  { label: 'Arrival Time',       unit: 'HHMM',    short: 'Arrival' },
  distance: { label: 'Total Distance',     unit: 'miles',   short: 'Distance' },
  fuel:     { label: 'Fuel Consumption',   unit: 'gallons', short: 'Fuel' },
  speed:    { label: 'Speed',              unit: 'mph',     short: 'Speed' },
}

// ── helpers ───────────────────────────────────────────────────────────────────
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Half-up rounding: ≥0.5 round up, ≤0.49 round down.
export function roundHalfUp(n) {
  return Math.floor(n + 0.5)
}

// Minutes-since-midnight → "HHMM" (zero padded).
export function formatHHMM(minutes) {
  const m = ((Math.round(minutes)) % 1440 + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return String(h).padStart(2, '0') + String(mm).padStart(2, '0')
}

// "HHMM" or "H:MM" or "HH:MM" → minutes since midnight. NaN if invalid.
export function parseHHMM(str) {
  if (str == null) return NaN
  const s = String(str).trim().replace(':', '')
  if (!/^\d{1,4}$/.test(s)) return NaN
  const padded = s.padStart(4, '0')
  const h = parseInt(padded.slice(0, 2), 10)
  const mm = parseInt(padded.slice(2, 4), 10)
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return NaN
  return h * 60 + mm
}

// ── round builder ─────────────────────────────────────────────────────────────
export function buildRound(forceType = null) {
  const start = pick(SDT_NODES)
  const via = pick(SDT_ADJ[start])
  const destOptions = SDT_ADJ[via].filter(n => n !== start)
  const destination = pick(destOptions)

  const seg1 = randInt(30, 120)
  const seg2 = randInt(30, 120)
  const totalDistance = seg1 + seg2

  const { weight, mpm, gph } = pick(WEIGHT_TABLE)

  // Time now between 06:00 and 18:00 in 5-minute steps
  const timeNowMin = randInt(6 * 12, 18 * 12) * 5
  const rawTravelMin = totalDistance / mpm
  const arrivalMin = Math.round(timeNowMin + rawTravelMin)
  const displayedTravel = arrivalMin - timeNowMin

  const type = forceType || pick(QUESTION_TYPES)

  // Defaults — what's visible to the player.
  const show = {
    segments: true,
    timeNow: true,
    arrivalTime: true,
    weight: true,
    parcel: true,
  }

  let correctAnswer

  if (type === 'arrival') {
    correctAnswer = arrivalMin
    show.arrivalTime = false
  } else if (type === 'distance') {
    correctAnswer = displayedTravel * mpm
    show.segments = false
  } else if (type === 'fuel') {
    correctAnswer = roundHalfUp((displayedTravel / 60) * gph)
  } else if (type === 'speed') {
    correctAnswer = roundHalfUp((totalDistance * 60) / displayedTravel)
    show.weight = false
    show.parcel = false
  }

  return {
    start, via, destination,
    seg1, seg2, totalDistance,
    weight, mpm, gph,
    timeNowMin, arrivalMin,
    type, correctAnswer,
    show,
  }
}

// ── scoring ───────────────────────────────────────────────────────────────────
// Returns { points, exact, partial }
//   exact:   +10
//   within 5%: +5
//   else:    +0
export function scoreAnswer(round, raw) {
  const empty = raw == null || String(raw).trim() === ''
  if (empty) return { points: 0, exact: false, partial: false }

  let userVal
  if (round.type === 'arrival') {
    userVal = parseHHMM(raw)
  } else {
    userVal = parseFloat(String(raw).replace(/[^\d.\-]/g, ''))
  }
  if (!Number.isFinite(userVal)) return { points: 0, exact: false, partial: false }

  const correct = round.correctAnswer
  const diff = Math.abs(userVal - correct)
  if (diff === 0) return { points: 10, exact: true, partial: false }

  // 5% tolerance — for arrival, measured against travel time (minutes-since-midnight
  // is too large a base and would make the tolerance absurdly generous).
  let tolerance
  if (round.type === 'arrival') {
    const travel = round.arrivalMin - round.timeNowMin
    tolerance = Math.max(1, travel * 0.05)
  } else {
    tolerance = Math.max(1, Math.abs(correct) * 0.05)
  }

  if (diff <= tolerance) return { points: 0 + 5, exact: false, partial: true }
  return { points: 0, exact: false, partial: false }
}

// ── grade for final result ────────────────────────────────────────────────────
// 8 rounds × max 10 pts = 80. Tiers mirror other CBAT games.
export function gradeForScore(score) {
  if (score >= 70) return 'Outstanding'
  if (score >= 45) return 'Good'
  if (score >= 20) return 'Needs Work'
  return 'Failed'
}
