// ── ANT Practise — the stripped drill ────────────────────────────────────────
// The ANT game proper hands you a map, a timings panel and a parcel table, and
// half the work is finding the numbers on the board. This drills the other
// half: the same four calculations, stated as plain questions with the figures
// already pulled out.
//
// Every question in a run is on screen at once, so you can start with whichever
// you can already see how to do and come back to the rest. Nothing is graded
// until the whole sheet is handed in.
//
// Rounds come from the same `buildRound()` the real game uses, so every answer
// is still a whole number and the close-bands still mean what they mean. Only
// the presentation changes.

import {
  buildRound,
  QUESTION_TYPES,
  formatHHMM,
} from '../antGenerator'

// Eight questions is a sheet you can take in at a glance — two of each of the
// four calculations, so a run is still an even sample and two scores are always
// comparable. It also lands the run on the same 80 points the game itself is
// marked out of, which is why the grade below is the game's own.
export const PRACTISE_PER_TYPE = 2
export const PRACTISE_QUESTION_COUNT = QUESTION_TYPES.length * PRACTISE_PER_TYPE
export const PRACTISE_MAX_SCORE = PRACTISE_QUESTION_COUNT * 10

// Eight questions at 10 points is the same 80-point run the game is scored out
// of, so the drill grades on the game's own tiers rather than a rescaled copy.
export { gradeForScore as practiseGrade } from '../antGenerator'

// Fisher-Yates. Takes the source of randomness so tests can pin the order.
function shuffle(arr, rand = Math.random) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// A full run: PRACTISE_PER_TYPE of every question type, shuffled so the sheet
// doesn't come out in blocks of the same calculation.
export function buildPractiseRun(rand = Math.random) {
  const rounds = []
  QUESTION_TYPES.forEach(type => {
    for (let i = 0; i < PRACTISE_PER_TYPE; i++) rounds.push(buildRound(type))
  })
  return shuffle(rounds, rand)
}

// ── the question ─────────────────────────────────────────────────────────────
// Plain sentences, no route and no callsigns — the board is what the real game
// tests, and naming nodes here would only be scenery. Each question states
// exactly the figures its answer needs and no more: an arrival question never
// mentions the arrival time, a speed question never mentions the pace.
//
// Questions come back as `parts` so the screen can set the figures apart from
// the words around them. On a page of eight, a wall of identical prose is the
// thing that makes it hard to read; the numbers are what the eye is hunting
// for, so they are marked as values and everything else is plain text. Every
// sentence also ends on the question, so the eight cards scan down the page in
// the same shape.

const V = (text) => ({ v: String(text) })

export const PRACTISE_UNITS = {
  arrival:  { unit: 'HHMM',    placeholder: '0000' },
  distance: { unit: 'miles',   placeholder: '0' },
  fuel:     { unit: 'gallons', placeholder: '0' },
  speed:    { unit: 'mph',     placeholder: '0' },
}

export function practiseQuestion(round) {
  const now = formatHHMM(round.timeNowMin)
  const arrive = formatHHMM(round.arrivalMin)

  let parts
  if (round.type === 'arrival') {
    parts = [
      'You travel ', V(`${round.totalDistance} miles`),
      ' at ', V(`${round.mpm} miles per minute`),
      ', leaving at ', V(now),
      '. What time will you arrive?',
    ]
  } else if (round.type === 'distance') {
    parts = [
      'You leave at ', V(now),
      ' and arrive at ', V(arrive),
      ', travelling at ', V(`${round.mpm} miles per minute`),
      '. How far do you travel?',
    ]
  } else if (round.type === 'fuel') {
    parts = [
      'You travel ', V(`${round.totalDistance} miles`),
      ' at ', V(`${round.mpm} miles per minute`),
      ', burning ', V(`${round.gph} gallons per hour`),
      '. How much fuel will you use?',
    ]
  } else {
    parts = [
      'You travel ', V(`${round.totalDistance} miles`),
      ', leaving at ', V(now),
      ' and arriving at ', V(arrive),
      '. What is your speed in miles per hour?',
    ]
  }

  const text = parts.map(p => (typeof p === 'string' ? p : p.v)).join('')
  return { parts, text, ...PRACTISE_UNITS[round.type] }
}

// ── the worked answer ────────────────────────────────────────────────────────
// Deliberately not `solutionSteps()` from antGenerator: those steps talk about
// the Timings panel, the map and the parcel table, none of which are on screen
// here. These lines stand on the question's own figures.

export function practiseSolution(round) {
  const travel = round.arrivalMin - round.timeNowMin
  const now = formatHHMM(round.timeNowMin)
  const arrive = formatHHMM(round.arrivalMin)
  const d = round.totalDistance

  let steps
  if (round.type === 'arrival') {
    steps = [
      { label: 'Flight time', expr: `${d} miles ÷ ${round.mpm} miles/min`, result: `${travel} min` },
      { label: 'Arrival',     expr: `${now} + ${travel} min`,              result: formatHHMM(round.correctAnswer) },
    ]
  } else if (round.type === 'distance') {
    steps = [
      { label: 'Flight time', expr: `${arrive} − ${now}`,                       result: `${travel} min` },
      { label: 'Distance',    expr: `${travel} min × ${round.mpm} miles/min`,   result: `${round.correctAnswer} miles` },
    ]
  } else if (round.type === 'fuel') {
    steps = [
      { label: 'Flight time', expr: `${d} miles ÷ ${round.mpm} miles/min`,          result: `${travel} min` },
      // Gallons per hour against a flight measured in minutes — the ÷ 60 is the
      // step people drop, so it gets its own line rather than being folded in.
      { label: 'Fuel',        expr: `${round.gph} gal/hr × ${travel} min ÷ 60`,     result: `${round.correctAnswer} gallons` },
    ]
  } else {
    steps = [
      { label: 'Flight time', expr: `${arrive} − ${now}`,                   result: `${travel} min` },
      { label: 'Speed',       expr: `${d} miles × 60 ÷ ${travel} min`,      result: `${round.correctAnswer} mph` },
    ]
  }
  return steps.map((s, i) => ({ ...s, n: i + 1 }))
}
