// ── ANT (Hard) round generator ────────────────────────────────────────────────
// The realistic Airborne Numerical Test, rebuilt from the first-hand accounts in
// APPLICATION_INFO/chat_dumps. It is a different game from the original board in
// src/utils/antGenerator.js, not a re-tuning of it, so it lives on its own key
// and its own leaderboard.
//
// What the accounts say the real ANT does that the original board did not:
//
//   • It is a WORD PROBLEM. You get an objective box of prose and the last line
//     is the actual ask. "The maths isn't what fails people here. Misreading the
//     question is." Hence `objective` — lines of text, ask last.
//   • FUEL IS TWO LOOKUPS. Weight gives you speed; SPEED gives you miles per
//     gallon. The original board keyed gallons-per-hour straight off weight,
//     which collapses the second lookup and gets the units wrong.
//   • WEATHER IS A LOOKUP, NOT A PENALTY. A storm leg's reduced speed is handed
//     to you in the table. One wind case makes you FASTER, which is the trap.
//   • TWO AIRCRAFT AT THE END, with a chart each and different speeds. "What
//     time must the other leave so they arrive together" / "how much longer does
//     one take".
//   • BACKWARDS QUESTIONS. Latest departure to make a slot, not just arrival.
//   • PART JOURNEYS. "From the second checkpoint onwards", "to the halfway
//     point" — one word in the wording changes the sum.
//   • UNTIDY WEIGHTS. The chart steps in hundreds, the question says 220 kg, and
//     you round to the nearest row. There is nothing to interpolate.
//   • IT RAMPS. Simple legs, then weather, then fuel, then two aircraft — see
//     ANT_HARD_STAGES.
//
// Every answer is still a whole number: leg distances are chosen as multiples of
// the leg's effective speed (and of its miles-per-gallon on a fuel round), so no
// step ever asks the player to round and then grades them on the rounding.
//
// Pure and side-effect free. `rng` is injectable so tests can sweep seeds.

import {
  ANT_NODES,
  ANT_ADJ,
  formatHHMM,
  parseHHMM,
} from '../antGenerator'

export { ANT_NODES, ANT_ADJ, formatHHMM, parseHHMM }

// ── Aircraft ─────────────────────────────────────────────────────────────────
// Two transports with a load chart each. Named for real RAF types so they can
// never be mistaken for one of the phonetic waypoints on the map — the whole
// point of the two-aircraft stage is that you read the right chart, and
// "Victor" as both a checkpoint and a callsign would make that a trick rather
// than a test.
//
// Heavier is slower on both charts. The first-hand accounts agree on that
// direction (7 miles a minute carrying 200 kg, dropping as the load goes up),
// and the guide warns that some practice tools run the relationship backwards.
export const ANT_HARD_AIRCRAFT = {
  atlas: {
    id: 'atlas',
    name: 'ATLAS',
    loads: [
      { weight: 100, mpm: 8 },
      { weight: 200, mpm: 7 },
      { weight: 300, mpm: 6 },
      { weight: 400, mpm: 5 },
      { weight: 500, mpm: 4 },
      { weight: 600, mpm: 3 },
      { weight: 700, mpm: 2 },
    ],
  },
  voyager: {
    id: 'voyager',
    name: 'VOYAGER',
    loads: [
      { weight: 100, mpm: 6 },
      { weight: 200, mpm: 5 },
      { weight: 300, mpm: 4 },
      { weight: 400, mpm: 4 },
      { weight: 500, mpm: 3 },
      { weight: 600, mpm: 3 },
      { weight: 700, mpm: 2 },
    ],
  },
}

export const ANT_HARD_AIRCRAFT_IDS = ['atlas', 'voyager']

// Speed → miles per gallon. The second lookup: weight gives you speed on the
// aircraft's own load chart, then speed gives you economy here. Faster burns
// more, so a storm that slows you down also makes you thriftier — which is why
// a fuel question has to be worked in this order and not guessed at.
//
// One chart serves both aircraft. It is already aircraft-specific in effect,
// because the speed you bring to it came off that aircraft's own load chart.
export const ANT_HARD_FUEL = [
  { mpm: 2, mpg: 12 },
  { mpm: 3, mpg: 10 },
  { mpm: 4, mpg: 9 },
  { mpm: 5, mpg: 8 },
  { mpm: 6, mpg: 6 },
  { mpm: 7, mpg: 5 },
  { mpm: 8, mpg: 4 },
]

const MPG_BY_MPM = Object.fromEntries(ANT_HARD_FUEL.map(r => [r.mpm, r.mpg]))
export function mpgFor(mpm) { return MPG_BY_MPM[mpm] }

export const MIN_MPM = 2
export const MAX_MPM = 8

// ── Weather ──────────────────────────────────────────────────────────────────
// Flagged per leg with an icon, and the revised speed is STATED in the flight
// data — a lookup, never a penalty the player has to apply. Tailwind exists to
// break the reflex that any weather icon means "slower".
export const ANT_HARD_WEATHER = {
  clear:    { key: 'clear',    icon: '',       label: 'Clear',    delta:  0 },
  storm:    { key: 'storm',    icon: '⛈', label: 'Storm',    delta: -2 },
  tailwind: { key: 'tailwind', icon: '➤', label: 'Tailwind', delta: +2 },
}

// ── Question types ───────────────────────────────────────────────────────────
export const ANT_HARD_QUESTIONS = {
  arrival:       { label: 'Arrival Time',    unit: 'HHMM',    short: 'Arrival',    time: true },
  departure:     { label: 'Departure Time',  unit: 'HHMM',    short: 'Departure',  time: true },
  legTime:       { label: 'Flight Time',     unit: 'minutes', short: 'Part leg' },
  distance:      { label: 'Total Distance',  unit: 'miles',   short: 'Distance' },
  speed:         { label: 'Average Speed',   unit: 'mph',     short: 'Speed' },
  fuel:          { label: 'Fuel Required',   unit: 'gallons', short: 'Fuel' },
  fuelRemaining: { label: 'Fuel Remaining',  unit: 'gallons', short: 'Fuel left' },
  pairDeparture: { label: 'Departure Time',  unit: 'HHMM',    short: 'Rendezvous', time: true },
  pairGap:       { label: 'Time Difference', unit: 'minutes', short: 'Gap' },
}

export const ANT_HARD_TYPES = Object.keys(ANT_HARD_QUESTIONS)

// ── The ramp ─────────────────────────────────────────────────────────────────
// "The difficulty ramps up, it doesn't start high." Twelve rounds in four
// stages: plain legs, then weather and part journeys, then fuel, then the two
// aircraft that the accounts all place at the end of the real test.
//
// `legs: 3` is how the map gets busier late on. The route is always spelled out
// in the objective, exactly as the accounts describe — a longer route is more
// to read and more to add up, never a navigation puzzle.
export const ANT_HARD_STAGES = [
  { round: 1,  stage: 'Basics',       legs: 2, weather: false, types: ['arrival'] },
  { round: 2,  stage: 'Basics',       legs: 2, weather: false, types: ['distance', 'speed'] },
  { round: 3,  stage: 'Basics',       legs: 2, weather: false, types: ['departure'] },
  { round: 4,  stage: 'Weather',      legs: 2, weather: true,  types: ['arrival'] },
  { round: 5,  stage: 'Weather',      legs: 2, weather: true,  types: ['legTime'] },
  { round: 6,  stage: 'Weather',      legs: 3, weather: true,  types: ['departure', 'legTime'] },
  { round: 7,  stage: 'Fuel',         legs: 2, weather: false, types: ['fuel'] },
  { round: 8,  stage: 'Fuel',         legs: 3, weather: true,  types: ['fuel'] },
  { round: 9,  stage: 'Fuel',         legs: 3, weather: true,  types: ['fuelRemaining'] },
  { round: 10, stage: 'Two aircraft', legs: 2, weather: false, types: ['pairGap'] },
  { round: 11, stage: 'Two aircraft', legs: 2, weather: true,  types: ['pairDeparture'] },
  { round: 12, stage: 'Two aircraft', legs: 3, weather: true,  types: ['pairDeparture', 'pairGap'] },
]

export const ANT_HARD_ROUNDS = ANT_HARD_STAGES.length
export const ANT_HARD_ROUND_TIME = 60      // a full minute per question, as on the day
export const ANT_HARD_MAX_SCORE = ANT_HARD_ROUNDS * 10

export const MIN_LEG = 30
export const MAX_LEG = 120

// ── helpers ──────────────────────────────────────────────────────────────────
const defaultRng = () => Math.random()

function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)] }

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b) }
function lcm(a, b) { return (a * b) / gcd(a, b) }

function clampSpeed(mpm) { return Math.min(MAX_MPM, Math.max(MIN_MPM, mpm)) }

// Leg lengths that keep every answer whole: a multiple of the leg's effective
// speed so the leg takes a whole number of minutes, and on a fuel round also a
// multiple of its miles-per-gallon so the burn is a whole number of gallons.
export function legDistances(mpm, needFuel) {
  const step = needFuel ? lcm(mpm, mpgFor(mpm)) : mpm
  const out = []
  for (let d = Math.ceil(MIN_LEG / step) * step; d <= MAX_LEG; d += step) out.push(d)
  return out
}

// A route of `legs + 1` distinct waypoints through the network.
export function buildRoute(rng, legs, { start = null, end = null } = {}) {
  const first = start || pick(rng, ANT_NODES)
  // Depth-first with retries; the network is small and dense enough that a
  // random walk finds a simple path of 3 or 4 nodes almost immediately.
  for (let attempt = 0; attempt < 200; attempt++) {
    const route = [first]
    let ok = true
    for (let i = 0; i < legs; i++) {
      const last = route[route.length - 1]
      const isFinal = i === legs - 1
      let options = ANT_ADJ[last].filter(n => !route.includes(n))
      if (end) options = isFinal ? options.filter(n => n === end) : options.filter(n => n !== end)
      if (options.length === 0) { ok = false; break }
      route.push(pick(rng, options))
    }
    if (ok) return route
  }
  return null
}

// The chart row a stated weight rounds to. The chart steps in hundreds, the
// objective quotes something like 220 kg, and you read the nearest row off it.
export function nearestLoadRow(aircraft, statedWeight) {
  return aircraft.loads.reduce((best, row) => (
    Math.abs(row.weight - statedWeight) < Math.abs(best.weight - statedWeight) ? row : best
  ), aircraft.loads[0])
}

// A weight that does not sit on a chart row, and is never an exact halfway case
// between two rows (which would make "the nearest row" a coin toss).
function untidyWeight(rng, rowWeight) {
  const offset = pick(rng, [10, 20, 30, 40])
  const sign = rng() < 0.5 ? -1 : 1
  const w = rowWeight + sign * offset
  if (w < 60 || w > 740) return rowWeight - sign * offset
  return w
}

// ── flight builder ───────────────────────────────────────────────────────────
// One aircraft's whole trip: route, per-leg weather and effective speed, and
// distances chosen so the totals come out whole.
export function buildFlight(rng, {
  aircraftId,
  legs,
  weather,
  needFuel = false,
  untidy = true,
  start = null,
  end = null,
}) {
  const aircraft = ANT_HARD_AIRCRAFT[aircraftId]
  const route = buildRoute(rng, legs, { start, end })
  if (!route) return null

  const row = pick(rng, aircraft.loads)
  const statedWeight = untidy ? untidyWeight(rng, row.weight) : row.weight

  const built = []
  for (let i = 0; i < legs; i++) {
    // Weather is per leg and never blankets the whole route — an all-storm trip
    // is just a slower trip, and the point is noticing which leg is flagged.
    const w = weather && rng() < 0.5
      ? pick(rng, [ANT_HARD_WEATHER.storm, ANT_HARD_WEATHER.tailwind])
      : ANT_HARD_WEATHER.clear
    const speed = clampSpeed(row.mpm + w.delta)
    const miles = pick(rng, legDistances(speed, needFuel))
    built.push({
      from: route[i],
      to: route[i + 1],
      miles,
      baseMpm: row.mpm,
      mpm: speed,
      mpg: mpgFor(speed),
      weather: w.key,
      minutes: miles / speed,
      gallons: miles / mpgFor(speed),
    })
  }

  return {
    aircraftId,
    name: aircraft.name,
    route,
    legs: built,
    weightRow: row.weight,
    weightStated: statedWeight,
    mpm: row.mpm,
    totalDistance: built.reduce((s, l) => s + l.miles, 0),
    totalMinutes: built.reduce((s, l) => s + l.minutes, 0),
    fuelUsed: built.reduce((s, l) => s + l.gallons, 0),
    uniformSpeed: built.every(l => l.mpm === built[0].mpm),
  }
}

// An edge that exists on the map but is NOT on the route, with its own honest
// distance. The accounts name this trap directly: the prose quotes a figure the
// table does not, and people plug the wrong one in. Nothing here lies — the
// number is a real distance on a real leg you are simply not flying.
function buildDistractor(rng, flight) {
  const from = flight.route[0]
  const to = flight.route[flight.route.length - 1]
  if (!ANT_ADJ[from].includes(to)) return null
  return { from, to, miles: randInt(rng, 4, 11) * 10 }
}

// ── objective prose ──────────────────────────────────────────────────────────
const up = s => String(s).toUpperCase()

function routeText(route) { return route.map(up).join(' – ') }

function weatherText(flight) {
  const flagged = flight.legs.filter(l => l.weather !== 'clear')
  if (flagged.length === 0) return null
  const each = flagged.map(l => (
    l.weather === 'storm'
      ? `A storm is reported on the ${up(l.from)} – ${up(l.to)} leg.`
      : `A tailwind is running on the ${up(l.from)} – ${up(l.to)} leg.`
  )).join(' ')
  return `${each} Revised speeds are given in the flight data.`
}

// ── round builder ────────────────────────────────────────────────────────────
// `show` says what the board displays. Anything false is the thing the player is
// being asked to produce, or a figure that would short-circuit the work.
const FULL_SHOW = {
  legMiles: true,
  departTime: true,
  arriveTime: true,
  weight: true,
  legSpeed: true,
  fuelOnBoard: false,
  partnerDepart: true,
}

export function buildRound(roundNumber, rng = defaultRng) {
  const stage = ANT_HARD_STAGES.find(s => s.round === roundNumber) || ANT_HARD_STAGES[0]
  const type = pick(rng, stage.types)
  const isPair = type === 'pairDeparture' || type === 'pairGap'
  const needFuel = type === 'fuel' || type === 'fuelRemaining'

  // Distance and speed are recovered from the clock, which only works if one
  // speed held for the whole trip. Those two types therefore never fly weather,
  // and their stages are set that way — this is the belt to that braces.
  const weather = stage.weather && type !== 'distance' && type !== 'speed'

  let flight = null
  for (let attempt = 0; attempt < 50 && !flight; attempt++) {
    flight = buildFlight(rng, {
      aircraftId: isPair ? 'atlas' : pick(rng, ANT_HARD_AIRCRAFT_IDS),
      legs: stage.legs,
      weather,
      needFuel,
      // Speed rounds hide the load chart entirely, so an untidy weight would be
      // a number with nowhere to go.
      untidy: type !== 'speed',
    })
  }
  if (!flight) return buildRound(1, rng)

  const show = { ...FULL_SHOW }
  const round = {
    roundNumber,
    stage: stage.stage,
    type,
    flight,
    partner: null,
    show,
    distractor: null,
    objective: [],
    correctAnswer: 0,
  }

  // Times are on 5-minute steps between 0600 and 1800, so a departure question
  // always has a sensible clock answer.
  const departMin = randInt(rng, 6 * 12, 17 * 12) * 5
  flight.departMin = departMin
  flight.arriveMin = departMin + flight.totalMinutes

  const dest = up(flight.route[flight.route.length - 1])
  const origin = up(flight.route[0])
  const lines = []
  const weatherLine = weatherText(flight)

  if (isPair) {
    // Both aircraft converge on the same destination from different starts, so
    // the only thing that separates them is which chart you read.
    let partner = null
    for (let attempt = 0; attempt < 50 && !partner; attempt++) {
      const p = buildFlight(rng, {
        aircraftId: 'voyager',
        legs: stage.legs,
        weather,
        needFuel: false,
        untidy: true,
        end: flight.route[flight.route.length - 1],
      })
      if (p && p.route[0] !== flight.route[0]) partner = p
    }
    if (!partner) return buildRound(roundNumber, rng)
    round.partner = partner

    lines.push(
      `${flight.name} is at ${origin} with a ${flight.weightStated} kg parcel, routing ${routeText(flight.route)}.`,
      `${partner.name} is at ${up(partner.route[0])} with a ${partner.weightStated} kg parcel, routing ${routeText(partner.route)}.`,
    )
    if (weatherLine) lines.push(weatherLine)
    lines.push('Each aircraft has its own load chart. Check you are reading the right one.')

    if (type === 'pairGap') {
      lines.push(`How many minutes longer does ${partner.name} take to reach ${dest} than ${flight.name}?`)
      round.correctAnswer = Math.abs(partner.totalMinutes - flight.totalMinutes)
      round.gapAhead = partner.totalMinutes >= flight.totalMinutes ? flight.name : partner.name
    } else {
      partner.departMin = flight.arriveMin - partner.totalMinutes
      lines.push(`${flight.name} departs ${origin} at ${formatHHMM(departMin)}.`)
      lines.push(`Give the time ${partner.name} must depart ${up(partner.route[0])} for both to reach ${dest} together, in HHMM.`)
      round.correctAnswer = partner.departMin
      show.partnerDepart = false
    }
  } else {
    const distractor = rng() < 0.35 ? buildDistractor(rng, flight) : null
    round.distractor = distractor

    lines.push(`${flight.name} is at ${origin} with a ${flight.weightStated} kg parcel, routing ${routeText(flight.route)}.`)
    if (weatherLine) lines.push(weatherLine)
    if (distractor) {
      lines.push(`The direct ${up(distractor.from)} – ${up(distractor.to)} track is ${distractor.miles} miles, but that route is closed today.`)
    }

    if (type === 'arrival') {
      lines.push(`${flight.name} is wheels-up at ${formatHHMM(departMin)}.`)
      lines.push(`Give the arrival time at ${dest} in HHMM.`)
      round.correctAnswer = flight.arriveMin
      show.arriveTime = false
    } else if (type === 'departure') {
      lines.push(`${flight.name} must be on the ground at ${dest} by ${formatHHMM(flight.arriveMin)}.`)
      lines.push(`Give the latest time ${flight.name} can depart ${origin} in HHMM.`)
      round.correctAnswer = departMin
      show.departTime = false
    } else if (type === 'distance') {
      lines.push(`${flight.name} departs at ${formatHHMM(departMin)} and lands at ${dest} at ${formatHHMM(flight.arriveMin)}.`)
      lines.push('The leg distances have been redacted from the map.')
      lines.push('Give the total distance flown in miles.')
      round.correctAnswer = flight.totalDistance
      show.legMiles = false
    } else if (type === 'speed') {
      lines.push(`${flight.name} departs at ${formatHHMM(departMin)} and lands at ${dest} at ${formatHHMM(flight.arriveMin)}.`)
      lines.push('The parcel manifest is missing, so the load chart is no help to you.')
      lines.push('Give the average speed in mph.')
      round.correctAnswer = flight.mpm * 60
      show.weight = false
      show.legSpeed = false
    } else if (type === 'legTime') {
      // "Start at B instead of A" and "to the halfway point" are the two part
      // journeys the accounts name. Both are one word in the wording and both
      // change nothing about the method.
      const half = flight.legs.every(l => (l.miles / 2) % l.mpm === 0)
      const variants = ['fromCheckpoint', 'toCheckpoint']
      if (half) variants.push('halfway')
      const variant = pick(rng, variants)
      lines.push(`${flight.name} is wheels-up at ${formatHHMM(departMin)}.`)
      if (variant === 'halfway') {
        round.correctAnswer = flight.totalMinutes / 2
        round.partSpan = { kind: 'halfway' }
        lines.push(`Give the flying time from ${origin} to the halfway point of the route, in minutes.`)
      } else if (variant === 'fromCheckpoint') {
        const cut = randInt(rng, 1, flight.legs.length - 1)
        round.correctAnswer = flight.legs.slice(cut).reduce((s, l) => s + l.minutes, 0)
        round.partSpan = { kind: 'from', index: cut }
        lines.push(`Give the flying time from ${up(flight.route[cut])} onwards to ${dest}, in minutes.`)
      } else {
        const cut = randInt(rng, 1, flight.legs.length - 1)
        round.correctAnswer = flight.legs.slice(0, cut).reduce((s, l) => s + l.minutes, 0)
        round.partSpan = { kind: 'to', index: cut }
        lines.push(`Give the flying time from ${origin} as far as ${up(flight.route[cut])} only, in minutes.`)
      }
    } else if (type === 'fuel') {
      lines.push(`${flight.name} is wheels-up at ${formatHHMM(departMin)}.`)
      lines.push(`Give the fuel needed for ${origin} to ${dest} in gallons.`)
      round.correctAnswer = flight.fuelUsed
    } else if (type === 'fuelRemaining') {
      // Enough to finish, with a margin that is never so large the question
      // stops being about running the numbers.
      flight.fuelOnBoard = flight.fuelUsed + randInt(rng, 2, 14)
      show.fuelOnBoard = true
      lines.push(`${flight.name} is wheels-up at ${formatHHMM(departMin)} with ${flight.fuelOnBoard} gallons on board.`)
      lines.push(`Give the fuel remaining on landing at ${dest} in gallons.`)
      round.correctAnswer = flight.fuelOnBoard - flight.fuelUsed
    }
  }

  round.objective = lines
  return round
}

// ── worked solution ──────────────────────────────────────────────────────────
// One line of maths per step, in the order the accounts say to work it: read the
// ask, look up the speed, look up the economy, then add it up.
export function solutionSteps(round) {
  const f = round.flight
  const steps = []
  const legSum = legs => legs.map(l => `${l.miles} ÷ ${l.mpm}`).join(' + ')

  const lookup = flight => ({
    label: 'Speed',
    tokens: [`${flight.weightStated} kg`, '→', `${flight.weightRow} kg row`],
    result: `${flight.mpm} mi/min`,
    note: `The chart steps in hundreds, so ${flight.weightStated} kg reads off the ${flight.weightRow} kg row. There is nothing to interpolate.`,
  })

  const timeStep = (flight, legs, label = 'Flight time') => ({
    label,
    tokens: [legSum(legs)],
    result: `${legs.reduce((s, l) => s + l.minutes, 0)} min`,
    note: legs.some(l => l.weather !== 'clear')
      ? 'Each leg at its own revised speed, taken straight from the flight data. The weather figure is given to you, never worked out.'
      : 'Each leg distance divided by the speed for that leg.',
  })

  if (round.type === 'arrival') {
    steps.push(lookup(f), timeStep(f, f.legs), {
      label: 'Arrival',
      tokens: [formatHHMM(f.departMin), '+', `${f.totalMinutes} min`],
      result: formatHHMM(f.arriveMin),
      note: 'Departure time plus the flying time.',
    })
  } else if (round.type === 'departure') {
    steps.push(lookup(f), timeStep(f, f.legs), {
      label: 'Departure',
      tokens: [formatHHMM(f.arriveMin), '−', `${f.totalMinutes} min`],
      result: formatHHMM(f.departMin),
      note: 'Work backwards from the slot you have to make.',
    })
  } else if (round.type === 'distance') {
    steps.push(lookup(f), {
      label: 'Flight time',
      tokens: [formatHHMM(f.arriveMin), '−', formatHHMM(f.departMin)],
      result: `${f.totalMinutes} min`,
      note: 'Landing time minus departure time.',
    }, {
      label: 'Distance',
      tokens: [`${f.totalMinutes} min`, '×', `${f.mpm} mi/min`],
      result: `${f.totalDistance} miles`,
      note: 'One speed held for the whole route, so the time carries straight into distance.',
    })
  } else if (round.type === 'speed') {
    steps.push({
      label: 'Flight time',
      tokens: [formatHHMM(f.arriveMin), '−', formatHHMM(f.departMin)],
      result: `${f.totalMinutes} min`,
      note: 'Landing time minus departure time.',
    }, {
      label: 'Distance',
      tokens: [f.legs.map(l => l.miles).join(' + ')],
      result: `${f.totalDistance} miles`,
      note: 'The leg distances on the map, added together.',
    }, {
      label: 'Speed',
      tokens: [`${f.totalDistance}`, '×', '60', '÷', `${f.totalMinutes}`],
      result: `${round.correctAnswer} mph`,
      note: 'Miles per minute times 60 turns it into miles per hour.',
    })
  } else if (round.type === 'legTime') {
    const span = round.partSpan
    steps.push(lookup(f))
    if (span.kind === 'halfway') {
      steps.push(timeStep(f, f.legs), {
        label: 'Halfway',
        tokens: [`${f.totalMinutes} min`, '÷', '2'],
        result: `${round.correctAnswer} min`,
        note: 'The whole route, halved. The method never changes for a part journey, only how much of it you use.',
      })
    } else {
      const legs = span.kind === 'from' ? f.legs.slice(span.index) : f.legs.slice(0, span.index)
      steps.push({
        ...timeStep(f, legs, 'Part journey'),
        note: span.kind === 'from'
          ? `Only the legs from ${up(f.route[span.index])} onwards count. The legs before it are there to be left out.`
          : `Only the legs up to ${up(f.route[span.index])} count. The rest of the route is there to be left out.`,
      })
    }
  } else if (round.type === 'fuel' || round.type === 'fuelRemaining') {
    steps.push(lookup(f), {
      label: 'Economy',
      tokens: [f.legs.map(l => `${l.mpm} mi/min → ${l.mpg} mpg`).join(', ')],
      result: f.uniformSpeed ? `${f.legs[0].mpg} mpg` : 'per leg',
      note: 'Second lookup. Economy comes off SPEED, not off weight, and a storm leg is slower so it is also thriftier.',
    }, {
      label: 'Fuel used',
      tokens: [f.legs.map(l => `${l.miles} ÷ ${l.mpg}`).join(' + ')],
      result: `${f.fuelUsed} gallons`,
      note: 'Distance divided by miles-per-gallon, leg by leg.',
    })
    if (round.type === 'fuelRemaining') {
      steps.push({
        label: 'Remaining',
        tokens: [`${f.fuelOnBoard}`, '−', `${f.fuelUsed}`],
        result: `${round.correctAnswer} gallons`,
        note: 'What you took off with, less what the trip burns.',
      })
    }
  } else if (round.type === 'pairGap') {
    const p = round.partner
    steps.push(
      { ...timeStep(f, f.legs, `${f.name} time`), note: `${f.name} on its own chart: ${f.weightStated} kg reads the ${f.weightRow} kg row at ${f.mpm} mi/min.` },
      { ...timeStep(p, p.legs, `${p.name} time`), note: `${p.name} on ITS chart: ${p.weightStated} kg reads the ${p.weightRow} kg row at ${p.mpm} mi/min. Different aircraft, different chart.` },
      {
        label: 'Difference',
        tokens: [`${Math.max(f.totalMinutes, p.totalMinutes)}`, '−', `${Math.min(f.totalMinutes, p.totalMinutes)}`],
        result: `${round.correctAnswer} min`,
        note: `${round.gapAhead} gets there first.`,
      },
    )
  } else if (round.type === 'pairDeparture') {
    const p = round.partner
    steps.push(
      { ...timeStep(f, f.legs, `${f.name} time`), note: `${f.name} on its own chart at ${f.mpm} mi/min.` },
      {
        label: `${f.name} arrives`,
        tokens: [formatHHMM(f.departMin), '+', `${f.totalMinutes} min`],
        result: formatHHMM(f.arriveMin),
        note: 'That landing time is the appointment the other aircraft has to make.',
      },
      { ...timeStep(p, p.legs, `${p.name} time`), note: `${p.name} on ITS chart at ${p.mpm} mi/min. Reading the wrong chart here is where the marks go.` },
      {
        label: `${p.name} departs`,
        tokens: [formatHHMM(f.arriveMin), '−', `${p.totalMinutes} min`],
        result: formatHHMM(p.departMin),
        note: 'Work backwards from the shared arrival time.',
      },
    )
  }

  return steps.map((s, i) => ({ ...s, n: i + 1 }))
}

// ── scoring ──────────────────────────────────────────────────────────────────
// "Being two to six minutes out can score you zero on an app while earning
// partial credit on the day." The bands are wider than the original board's, and
// fuel gets one at all — on this board a fuel answer is three lookups deep, so
// a gallon out is a slip, not a different method.
export const ANT_HARD_CLOSE_BAND = {
  arrival:       { within: 3,  label: 'within 3 min' },
  departure:     { within: 3,  label: 'within 3 min' },
  pairDeparture: { within: 3,  label: 'within 3 min' },
  legTime:       { within: 3,  label: 'within 3 min' },
  pairGap:       { within: 3,  label: 'within 3 min' },
  distance:      { within: 5,  label: 'within 5 miles' },
  speed:         { within: 10, label: 'within 10 mph' },
  fuel:          { within: 1,  label: 'within 1 gallon' },
  fuelRemaining: { within: 1,  label: 'within 1 gallon' },
}

export function scoreAnswer(round, raw) {
  const empty = raw == null || String(raw).trim() === ''
  if (empty) return { points: 0, exact: false, partial: false }

  const meta = ANT_HARD_QUESTIONS[round.type]
  const userVal = meta.time
    ? parseHHMM(raw)
    : parseFloat(String(raw).replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(userVal)) return { points: 0, exact: false, partial: false }

  const diff = Math.abs(userVal - round.correctAnswer)
  if (diff === 0) return { points: 10, exact: true, partial: false }

  const band = ANT_HARD_CLOSE_BAND[round.type]
  if (band && diff <= band.within) return { points: 5, exact: false, partial: true }
  return { points: 0, exact: false, partial: false }
}

// ── grade ────────────────────────────────────────────────────────────────────
// Bands sit lower as a share of the ceiling than the original board's (100/70/35
// of 120 against 70/45/20 of 80) because a hard round can be lost to reading
// rather than to arithmetic, and a run that reads well throughout deserves
// Outstanding without needing twelve exact answers.
export const ANT_HARD_GRADES = { outstanding: 100, good: 70, needsWork: 35 }

export function gradeForScore(score) {
  if (score >= ANT_HARD_GRADES.outstanding) return 'Outstanding'
  if (score >= ANT_HARD_GRADES.good) return 'Good'
  if (score >= ANT_HARD_GRADES.needsWork) return 'Needs Work'
  return 'Failed'
}

// The formatted correct answer, for the debrief and the round review.
export function formatAnswer(round) {
  const meta = ANT_HARD_QUESTIONS[round.type]
  return meta.time ? formatHHMM(round.correctAnswer) : `${round.correctAnswer} ${meta.unit}`
}
