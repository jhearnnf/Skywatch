// ── CBAT Airborne Numerical Test (ANT) round generator ───────────────────────
// Pure helpers: generate randomised journey rounds, grade user answers.
// Kept side-effect free so it can be tested in isolation.
// Game content covers speed, distance and time calculations.

export const ANT_NODES = ['Victor', 'Xray', 'Yankee', 'Zulu', 'Whiskey', 'Tango', 'Romeo', 'Papa']

// Undirected edges — every node has at least two neighbours so start→via→dest works.
export const ANT_EDGES = [
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
// place-name label, at the sizes used in CbatAnt.jsx.
export const ANT_NODE_POS = {
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
export const ANT_LABEL_OFFSETS = {
  Tango:   { dx: 0,   dy: -36, anchor: 'middle' },
  Victor:  { dx: 0,   dy: -36, anchor: 'middle' },
  Romeo:   { dx: 0,   dy: -36, anchor: 'middle' },
  Xray:    { dx: -34, dy: 8,   anchor: 'end' },
  Yankee:  { dx: 34,  dy: 8,   anchor: 'start' },
  Whiskey: { dx: -34, dy: 8,   anchor: 'end' },
  Zulu:    { dx: 34,  dy: 8,   anchor: 'start' },
  Papa:    { dx: 0,   dy: 46,  anchor: 'middle' },
}

const adj = Object.fromEntries(ANT_NODES.map(n => [n, []]))
ANT_EDGES.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a) })
export const ANT_ADJ = adj

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
export const MIN_LEG = 30
export const MAX_LEG = 120

// Journeys whose every answer lands on a whole number, like the real test.
// Two conditions:
//   • the total must divide evenly by miles-per-minute, so the flight is a
//     whole number of minutes — otherwise the arrival time gets rounded and
//     the distance, arrival and speed answers all drift off the honest figure
//     (a 400 kg speed round grading 239 mph instead of 240);
//   • on a fuel round those minutes must also divide evenly into gallons, so
//     nobody is asked to round 0.67 up to 1 and call it correct.
export function wholeAnswerDistances(mpm, gph = null) {
  const out = []
  for (let d = MIN_LEG * 2; d <= MAX_LEG * 2; d++) {
    if (d % mpm !== 0) continue
    if (gph != null && ((d / mpm) * gph) % 60 !== 0) continue
    out.push(d)
  }
  return out
}

export function buildRound(forceType = null) {
  const start = pick(ANT_NODES)
  const via = pick(ANT_ADJ[start])
  const destOptions = ANT_ADJ[via].filter(n => n !== start)
  const destination = pick(destOptions)

  const type = forceType || pick(QUESTION_TYPES)

  // Fuel rounds constrain the journey hard, and a parcel with only one legal
  // journey would be the same question every time — skip those weights rather
  // than hand the player a freebie to memorise.
  const parcels = type === 'fuel'
    ? WEIGHT_TABLE.filter(w => wholeAnswerDistances(w.mpm, w.gph).length > 1)
    : WEIGHT_TABLE
  const { weight, mpm, gph } = pick(parcels)

  const totalDistance = pick(wholeAnswerDistances(mpm, type === 'fuel' ? gph : null))
  const seg1 = randInt(
    Math.max(MIN_LEG, totalDistance - MAX_LEG),
    Math.min(MAX_LEG, totalDistance - MIN_LEG),
  )
  const seg2 = totalDistance - seg1

  // Time now between 06:00 and 18:00 in 5-minute steps
  const timeNowMin = randInt(6 * 12, 18 * 12) * 5
  const displayedTravel = totalDistance / mpm    // whole minutes by construction
  const arrivalMin = timeNowMin + displayedTravel

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
    correctAnswer = (displayedTravel * gph) / 60
  } else if (type === 'speed') {
    correctAnswer = mpm * 60
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

// ── worked solution (post-round debrief) ──────────────────────────────────────
// Each step is one line of maths. Tokens carrying an `anchor` name a value that
// is visible on the game board, so the debrief can pulse that value in place
// while the player reads the line that uses it. Anchor names match the
// `data-anchor` attributes stamped on the panels in CbatAnt.jsx.
//
// Every figure here is exact: buildRound guarantees the total distance divides
// evenly by miles-per-minute, so flight time is a whole number of minutes and
// no step has to hand-wave a rounding.
export function solutionSteps(round) {
  const travel = round.arrivalMin - round.timeNowMin
  const v = (text, anchor) => ({ text: String(text), anchor })
  const now = v(formatHHMM(round.timeNowMin), 'now')
  const arrive = v(formatHHMM(round.arrivalMin), 'arrive')
  const mpm = v(round.mpm, 'mpm')
  const gph = v(round.gph, 'gph')
  const seg1 = v(round.seg1, 'seg1')
  const seg2 = v(round.seg2, 'seg2')
  const kg = `${round.weight} kg`

  const flightTime = {
    label: 'Flight time',
    tokens: [arrive, '−', now],
    result: `${travel} min`,
    note: 'Arrive minus Now, both read straight off the Timings panel.',
  }
  const legsTotal = {
    label: 'Total distance',
    tokens: [seg1, '+', seg2],
    result: `${round.totalDistance} miles`,
    note: 'The two leg distances on the map, added together.',
  }

  let steps
  if (round.type === 'distance') {
    steps = [
      flightTime,
      {
        label: 'Distance',
        tokens: [`${travel} min`, '×', mpm, 'mi/min'],
        result: `${round.correctAnswer} miles`,
        note: `The flight time from step 1, times your speed — ${kg} is ${round.mpm} miles/min in the parcel table.`,
      },
    ]
  } else if (round.type === 'arrival') {
    steps = [
      legsTotal,
      {
        label: 'Flight time',
        tokens: [`${round.totalDistance} miles`, '÷', mpm, 'mi/min'],
        result: `${travel} min`,
        note: `The distance from step 1, divided by your speed — ${kg} is ${round.mpm} miles/min in the parcel table.`,
      },
      {
        label: 'Arrival',
        tokens: [now, '+', `${travel} min`],
        result: formatHHMM(round.correctAnswer),
        note: 'Now, from the Timings panel, plus the flight time from step 2.',
      },
    ]
  } else if (round.type === 'fuel') {
    steps = [
      flightTime,
      {
        label: 'Fuel',
        tokens: [gph, 'gal/hr', '×', `${travel} min`, '÷', '60'],
        result: `${round.correctAnswer} gallons`,
        note: `${kg} burns ${round.gph} gallons an hour (parcel table), and you flew ${travel} of the 60 minutes in an hour — so divide by 60.`,
      },
    ]
  } else {
    // speed — no parcel this round, so it comes from the map and the clock only
    steps = [
      legsTotal,
      flightTime,
      {
        label: 'Speed',
        tokens: [`${round.totalDistance} miles`, '×', '60', '÷', `${travel} min`],
        result: `${round.correctAnswer} mph`,
        note: 'The distance from step 1 over the time from step 2, times 60 to turn miles-per-minute into miles-per-hour.',
      },
    ]
  }
  return steps.map((s, i) => ({ ...s, n: i + 1 }))
}

// Every board value a solution refers to — what the debrief pulses in place.
export function solutionAnchors(round) {
  const anchors = new Set()
  solutionSteps(round).forEach(step => {
    // Objects only — a plain string token would answer to `.anchor` via the
    // legacy String.prototype.anchor method and smuggle a function in here.
    step.tokens.forEach(t => { if (t && typeof t === 'object' && t.anchor) anchors.add(t.anchor) })
  })
  return anchors
}

// ── scoring ───────────────────────────────────────────────────────────────────
// Half credit is defined in the answer's own units, not as a percentage. A flat
// 5% meant nothing on a small answer — a 3-gallon question had a ±0.15 band, so
// only the exact answer could ever land in it — while a 240-mile question got a
// ±12 cushion. Fuel has no band at all: a gallon is a gallon.
export const CLOSE_BAND = {
  distance: { within: 5,  label: 'within 5 miles' },
  speed:    { within: 10, label: 'within 10 mph' },
  arrival:  { within: 2,  label: 'within 2 min' },
  fuel:     null,
}

// Returns { points, exact, partial }
//   exact: +10
//   close: +5  (see CLOSE_BAND)
//   else:  +0
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

  // Arrival answers are minutes since midnight, so the difference is already in
  // minutes — the same unit the band is written in.
  const band = CLOSE_BAND[round.type]
  if (band && diff <= band.within) return { points: 5, exact: false, partial: true }
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
