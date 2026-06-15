// CBAT "Directions and Distances" (DAD) question generator.
//
// Mirrors the real RAF DAD test: the player reads a text-only journey worded
// with *relative* turns — only the first leg names an absolute compass heading,
// every later leg is "turns left/right and travels D" — then answers which
// direction the start point lies in from their final position.
//
// Pure and deterministic: pass a seeded `rng` (0..1) to reproduce a question in
// tests. Defaults to Math.random for live play.
//
// Geometry: a grid with +y = North, +x = East. Turns are 90° only, so every leg
// is axis-aligned and the net displacement is a sum of axis moves. The question
// only has a clean 8-point answer when the net lands axis-aligned (dx==0 or
// dy==0) or on a perfect diagonal (|dx|==|dy|). We GUARANTEE that by making the
// final leg corrective: it runs perpendicular to the previous leg, so its signed
// length can be chosen to force the net onto one of the 8 compass points. This
// is always solvable — never a reject-and-retry loop.

const DIRS = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] }
const CARDINALS = ['N', 'E', 'S', 'W']
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] // 45° steps, clockwise
const DIR_WORD = { N: 'North', E: 'East', S: 'South', W: 'West' }
const SUBJECTS = ['A ship', 'A convoy', 'A patrol aircraft', 'A recon drone', 'A survey vessel']

const rotR = ([x, y]) => [y, -x]  // clockwise 90°
const rotL = ([x, y]) => [-y, x]  // counter-clockwise 90°
const vecName = ([x, y]) => Object.keys(DIRS).find(k => DIRS[k][0] === x && DIRS[k][1] === y)

// 8-point compass name for a clean (axis-aligned or perfect-diagonal) vector.
export function vecToCompass(x, y) {
  const key = `${Math.sign(x)},${Math.sign(y)}`
  const map = {
    '0,1': 'N', '1,1': 'NE', '1,0': 'E', '1,-1': 'SE',
    '0,-1': 'S', '-1,-1': 'SW', '-1,0': 'W', '-1,1': 'NW',
  }
  return map[key] || null
}

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 4 multiple-choice options: the answer plus 3 plausible near-misses (both
// 45° neighbours and the opposite point), then shuffled.
function buildOptions(answer, rng) {
  const i = COMPASS.indexOf(answer)
  const distractors = [
    COMPASS[(i + 1) % 8],
    COMPASS[(i + 7) % 8],
    COMPASS[(i + 4) % 8],
  ]
  return shuffle([answer, ...distractors], rng)
}

// Generate a single DAD question.
//   legCount — number of legs (≥2). Difficulty scales with this.
//   rng      — () => [0,1), injectable for deterministic tests.
// Returns { subject, legs, prose, path, end, answer, options }.
//   legs[i] = { turn: 'start'|'left'|'right', dirName, miles }
//   path    = array of [x,y] grid points from origin (length legCount+1), base units
//   end     = final [x,y]; answer = compass dir of end (final position as seen
//             from the start — the more intuitive framing)
export function generateDadQuestion(legCount, rng = Math.random) {
  const n = Math.max(2, legCount | 0)
  const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1))

  const subject = SUBJECTS[randInt(0, SUBJECTS.length - 1)]
  const legs = []
  const path = [[0, 0]]
  let px = 0, py = 0

  // First leg — absolute heading.
  let facing = DIRS[CARDINALS[randInt(0, 3)]]
  {
    const dist = randInt(2, 9)
    legs.push({ turn: 'start', dirName: vecName(facing), miles: dist * 100 })
    px += facing[0] * dist; py += facing[1] * dist
    path.push([px, py])
  }

  // Middle legs — random relative turns (skipped when n === 2).
  for (let i = 1; i < n - 1; i++) {
    const turn = rng() < 0.5 ? 'left' : 'right'
    facing = turn === 'left' ? rotL(facing) : rotR(facing)
    const dist = randInt(2, 9)
    legs.push({ turn, dirName: vecName(facing), miles: dist * 100 })
    px += facing[0] * dist; py += facing[1] * dist
    path.push([px, py])
  }

  // Corrective final leg — perpendicular to current facing, length chosen to
  // force the net onto a clean 8-point direction. `axis` is the coordinate this
  // leg changes; `fixed` is the other (held) coordinate.
  const axis = facing[0] !== 0 ? 'y' : 'x'
  const moving = axis === 'y' ? py : px
  const fixed = axis === 'y' ? px : py

  // Candidate target values for the moving coordinate that yield a clean,
  // non-origin endpoint. Pick the smallest non-zero move.
  let targets
  if (fixed !== 0) {
    targets = [Math.abs(fixed), -Math.abs(fixed), 0] // diagonal, diagonal, pure-axis
  } else {
    // Fixed coord is 0 → endpoint must be a pure cardinal along the moving axis.
    targets = [moving + 2, moving - 2]
  }
  let best = null
  for (const t of targets) {
    const delta = t - moving
    if (delta === 0) continue
    if (fixed === 0 && t === 0) continue // would land on the origin
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { t, delta }
  }

  {
    const delta = best.delta
    const dist = Math.abs(delta)
    const vec = axis === 'y'
      ? (delta > 0 ? [0, 1] : [0, -1])
      : (delta > 0 ? [1, 0] : [-1, 0])
    const turn = vecName(vec) === vecName(rotL(facing)) ? 'left' : 'right'
    legs.push({ turn, dirName: vecName(vec), miles: dist * 100 })
    if (axis === 'y') py += delta; else px += delta
    path.push([px, py])
  }

  const end = [px, py]
  const answer = vecToCompass(px, py)
  const options = buildOptions(answer, rng)

  return { subject, legs, prose: buildProse(subject, legs), path, end, answer, options }
}

function buildProse(subject, legs) {
  const parts = legs.map((leg, i) => {
    if (leg.turn === 'start') {
      return `${subject} sets out heading ${DIR_WORD[leg.dirName]} for ${leg.miles} miles`
    }
    return `turns ${leg.turn} and travels ${leg.miles} miles`
  })
  return parts.join(', ') + '.'
}
