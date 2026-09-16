// Instruments Orientation: the question generator.
//
// The real test's second half shows an attitude indicator and a compass and
// asks which of several aircraft pictures matches them. Every picture is
// drawn from the same place: behind an aircraft flying north, a little above
// it. So heading is how the aircraft points relative to you (north is a tail
// view, south a nose view), pitch is where the nose sits against the horizon,
// and bank is which wing is low. Bank is the trap: an aircraft banked left
// and heading TOWARDS you drops its left wing on YOUR right.
//
// Pure and seedable so a test can sweep it. `rng` is any () => [0, 1).

export const ORIENTATION_QUESTIONS = 10
export const ORIENTATION_TIME_LIMIT = 120   // seconds, for the whole run
// Four pictures in a 2×2. The real test shows five, but the fifth made the
// grid look silly; both themes offer the same four, since they post to the
// same board.
export const ORIENTATION_OPTIONS = 4

// Bank and pitch steps are the ones the attitude indicator's scale marks, so
// every answer can be read off the instrument rather than estimated. Pitch is
// nose up / level / nose down: the pictures cannot honestly show 5° steps at
// this size.
export const BANKS = [-60, -45, -30, -15, 0, 15, 30, 45, 60]
export const PITCHES = [-20, 0, 20]
export const HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315]
export const HEADING_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)]
}

function norm360(deg) {
  return ((deg % 360) + 360) % 360
}

export function randomAttitude(rng = Math.random) {
  return { heading: pick(HEADINGS, rng), pitch: pick(PITCHES, rng), bank: pick(BANKS, rng) }
}

export function attitudesEqual(a, b) {
  return a.heading === b.heading && a.pitch === b.pitch && a.bank === b.bank
}

// One change to one attribute. Each is a mistake someone actually makes:
// reading the bank the wrong way round, missing the pitch, or misreading the
// compass by a point or two.
const MUTATIONS = {
  mirrorBank: (a, rng) => ({ ...a, bank: a.bank === 0 ? pick([-30, 30], rng) : -a.bank }),
  levelBank:  (a, rng) => ({ ...a, bank: a.bank === 0 ? pick([-45, -15, 15, 45], rng) : 0 }),
  stepBank:   (a, rng) => {
    const others = BANKS.filter(b => b !== a.bank && Math.sign(b) === Math.sign(a.bank) && b !== 0)
    return { ...a, bank: others.length ? pick(others, rng) : -a.bank }
  },
  flipPitch:  (a, rng) => ({ ...a, pitch: a.pitch === 0 ? pick([-20, 20], rng) : -a.pitch }),
  levelPitch: (a, rng) => ({ ...a, pitch: a.pitch === 0 ? pick([-20, 20], rng) : 0 }),
  shiftHeading: (a, rng) => ({ ...a, heading: norm360(a.heading + pick([-90, -45, 45, 90, 180], rng)) }),
}
const MUTATION_KEYS = Object.keys(MUTATIONS)

function mutate(attitude, rng) {
  // Mostly one change, sometimes two, so the odd option is wrong in two ways
  // and the near-misses are the ones that need a careful read.
  const n = rng() < 0.7 ? 1 : 2
  let out = attitude
  for (let i = 0; i < n; i++) out = MUTATIONS[pick(MUTATION_KEYS, rng)](out, rng)
  return out
}

// One question: the attitude to read, four pictures, and which one is right.
export function buildOrientationRound(rng = Math.random) {
  const correct = randomAttitude(rng)
  const options = [correct]
  let guard = 0
  while (options.length < ORIENTATION_OPTIONS && guard++ < 500) {
    const d = mutate(correct, rng)
    if (!options.some(o => attitudesEqual(o, d))) options.push(d)
  }
  // Shuffle so the answer is not always first.
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return { attitude: correct, options, correctIdx: options.findIndex(o => attitudesEqual(o, correct)) }
}

export function buildOrientationRun(count = ORIENTATION_QUESTIONS, rng = Math.random) {
  return Array.from({ length: count }, () => buildOrientationRound(rng))
}

export function headingName(deg) {
  const idx = HEADINGS.indexOf(norm360(deg))
  return idx >= 0 ? HEADING_NAMES[idx] : `${norm360(deg)}°`
}

// "Heading NE, nose up, 30° left bank" for the review list and screen readers.
export function describeAttitude(a) {
  const pitch = a.pitch > 0 ? 'nose up' : a.pitch < 0 ? 'nose down' : 'level'
  const bank = a.bank === 0 ? 'wings level' : `${Math.abs(a.bank)}° ${a.bank < 0 ? 'left' : 'right'} bank`
  return `Heading ${headingName(a.heading)}, ${pitch}, ${bank}`
}

// Out of ORIENTATION_QUESTIONS. Bands sit where Reading's do as a share of a
// strong run; retune against the demo board once there are real runs.
export function orientationGrade(correct) {
  if (correct >= 9) return 'Outstanding'
  if (correct >= 7) return 'Good'
  if (correct >= 5) return 'Needs Work'
  return 'Failed'
}
