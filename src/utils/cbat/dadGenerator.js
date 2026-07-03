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
// Geometry: a grid with +y = North, +x = East. Headings are the 8-point compass
// (index 0..7, clockwise from North). Cardinal legs step by (±1,0)/(0,±1);
// diagonal legs step by (±1,±1) — one lattice-diagonal per unit distance, so
// every position stays on the integer lattice and a NE leg is √2 longer on the
// ground than an E leg of the same unit count (reflected in its stated miles).
//
// The question only has a clean 8-point answer when the net lands axis-aligned
// (dx==0 or dy==0) or on a perfect diagonal (|dx|==|dy|). We GUARANTEE that by
// (a) steering the last *movement* leg onto a CARDINAL heading, then (b) making
// the final leg corrective: perpendicular to that cardinal facing, its signed
// length chosen to force the net onto one of the 8 compass points. Always
// solvable — never a reject-and-retry loop.
//
// `opts.diagonals` gates the 8-point behaviour. When false (the game's first
// half), headings are restricted to the four cardinals and every turn is 90°,
// i.e. the original DAD behaviour; when true (second half), intercardinal
// headings (NE/SE/SW/NW) and 45° turns are introduced.

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] // 45° steps, clockwise
// Unit lattice vector per compass index (+y = North, +x = East).
const VECS = [
  [0, 1],   // N
  [1, 1],   // NE
  [1, 0],   // E
  [1, -1],  // SE
  [0, -1],  // S
  [-1, -1], // SW
  [-1, 0],  // W
  [-1, 1],  // NW
]
const DIR_WORD = {
  N: 'North', NE: 'North-East', E: 'East', SE: 'South-East',
  S: 'South', SW: 'South-West', W: 'West', NW: 'North-West',
}
const SUBJECTS = ['A ship', 'A convoy', 'A patrol aircraft', 'A recon drone', 'A survey vessel']

const isCardinal = (i) => i % 2 === 0
const vecIndex = ([x, y]) => VECS.findIndex(v => v[0] === x && v[1] === y)

// Stated miles for a leg of `dist` unit steps in compass direction `dir`.
// Miles are proportional to true ground distance, so a diagonal leg (length √2
// per step) reads ~1.41× a cardinal leg of the same unit count. Rounded to the
// nearest 10 miles; cardinal legs stay clean multiples of 100.
function legMiles(dir, dist) {
  const len = isCardinal(dir) ? dist : dist * Math.SQRT2
  return Math.round(len * 100 / 10) * 10
}

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
//   opts.diagonals — allow 8-point headings + 45° turns (default true).
// Returns { subject, legs, prose, path, end, answer, options }.
//   legs[i] = { turn: 'start'|'left'|'right', deg: 0|45|90, dir, dirName, miles }
//   path    = array of [x,y] grid points from origin (length legCount+1), unit steps
//   end     = final [x,y]; answer = compass dir of end (final position as seen
//             from the start — the more intuitive framing)
export function generateDadQuestion(legCount, rng = Math.random, opts = {}) {
  const { diagonals = true } = opts
  const n = Math.max(2, legCount | 0)
  const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1))

  const subject = SUBJECTS[randInt(0, SUBJECTS.length - 1)]
  const legs = []
  const path = [[0, 0]]
  let px = 0, py = 0

  const pushLeg = (turn, deg, dir, dist) => {
    const [vx, vy] = VECS[dir]
    px += vx * dist; py += vy * dist
    path.push([px, py])
    legs.push({ turn, deg, dir, dirName: COMPASS[dir], miles: legMiles(dir, dist) })
  }

  // First leg — absolute heading. With no middle legs (n === 2) the facing must
  // already be cardinal so the corrective leg's guarantee holds, so restrict the
  // start to a cardinal there.
  let facing = diagonals && n > 2 ? randInt(0, 7) : randInt(0, 3) * 2
  pushLeg('start', 0, facing, randInt(2, 9))

  // Middle legs — relative turns. 90° turns (Δindex ±2) always; 45° turns
  // (Δindex ±1) only when diagonals are enabled. The LAST middle leg is steered
  // so the resulting facing is cardinal, which the corrective leg requires.
  for (let i = 1; i < n - 1; i++) {
    const lastMiddle = i === n - 2
    let deltas
    if (lastMiddle) {
      // Land on a cardinal facing: from a cardinal, that means a 90° turn (±2);
      // from a diagonal, a 45° turn (±1). (When diagonals are off, facing is
      // already cardinal, so this stays ±2 — the original behaviour.)
      deltas = isCardinal(facing) ? [2, -2] : [1, -1]
    } else {
      deltas = diagonals ? [1, 2, -1, -2] : [2, -2]
    }
    const delta = deltas[randInt(0, deltas.length - 1)]
    facing = (facing + delta + 8) % 8
    const turn = delta > 0 ? 'right' : 'left'
    const deg = Math.abs(delta) * 45
    pushLeg(turn, deg, facing, randInt(2, 9))
  }

  // Corrective final leg — facing is guaranteed cardinal here. It runs
  // perpendicular (a 90° turn) to that facing; `axis` is the coordinate this leg
  // changes, `fixed` the other (held) coordinate.
  const fv = VECS[facing]
  const axis = fv[0] !== 0 ? 'y' : 'x'
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
    const dir = vecIndex(vec)
    const turn = (facing + 6) % 8 === dir ? 'left' : 'right' // −90° (Δ−2) == left
    pushLeg(turn, 90, dir, dist)
  }

  const end = [px, py]
  const answer = vecToCompass(px, py)
  const options = buildOptions(answer, rng)

  // Once 8-point headings are in play, turns can be 45° or 90°, so every turn
  // states its angle. In cardinal-only rounds every turn is a 90° and the angle
  // is left implicit (the original wording).
  return { subject, legs, prose: buildProse(subject, legs, diagonals), path, end, answer, options }
}

function buildProse(subject, legs, showDegrees) {
  const parts = legs.map((leg) => {
    if (leg.turn === 'start') {
      return `${subject} sets out heading ${DIR_WORD[leg.dirName]} for ${leg.miles} miles`
    }
    if (showDegrees) {
      return `turns ${leg.turn} ${leg.deg}° and travels ${leg.miles} miles`
    }
    return `turns ${leg.turn} and travels ${leg.miles} miles`
  })
  return parts.join(', ') + '.'
}
