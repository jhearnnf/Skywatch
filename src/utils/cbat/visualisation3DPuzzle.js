// CBAT Visualisation 3D — puzzle generator.
//
// Each round shows TWO composite shapes (each = two simple 3D primitives
// stitched together) with one corner highlighted by a dot on each. The user
// picks the option (A–E) where both composites carry their dots on the same
// logical corners (regardless of how the composite has been rotated).
//
// Difficulty tiers:
//   Tier 0 (rounds 0–3): single-axis 90° rotations around Y; rounds 0–1 use
//   cuboid+cuboid only, rounds 2–3 add prism/pyramid composites.
//   Tier 1 (rounds 4–7): full cube-rotation group (24 orientations) across all
//   composite templates.

// ─── Primitives ──────────────────────────────────────────────────────────────
// Each primitive is centred on the origin in its own local frame. Corner IDs
// are stable identifiers used to track which corner a dot sits on across
// rotations.
export const PRIMITIVES = {
  cuboid: {
    corners: [
      { id: 'c0', pos: [-0.5, -0.5, -0.5] },
      { id: 'c1', pos: [ 0.5, -0.5, -0.5] },
      { id: 'c2', pos: [ 0.5,  0.5, -0.5] },
      { id: 'c3', pos: [-0.5,  0.5, -0.5] },
      { id: 'c4', pos: [-0.5, -0.5,  0.5] },
      { id: 'c5', pos: [ 0.5, -0.5,  0.5] },
      { id: 'c6', pos: [ 0.5,  0.5,  0.5] },
      { id: 'c7', pos: [-0.5,  0.5,  0.5] },
    ],
    render: { kind: 'box' },
  },
  triangularPrism: {
    // Equilateral triangle in XZ (side 1, circumradius 1/√3 ≈ 0.577),
    // extruded along Y by 1.
    corners: [
      { id: 'c0', pos: [-0.5, -0.5, -0.289] },
      { id: 'c1', pos: [ 0.5, -0.5, -0.289] },
      { id: 'c2', pos: [ 0.0, -0.5,  0.577] },
      { id: 'c3', pos: [-0.5,  0.5, -0.289] },
      { id: 'c4', pos: [ 0.5,  0.5, -0.289] },
      { id: 'c5', pos: [ 0.0,  0.5,  0.577] },
    ],
    render: { kind: 'prism' },
  },
  squarePyramid: {
    // Base 1×1 in XZ, apex at (0, 0.5, 0).
    corners: [
      { id: 'c0', pos: [-0.5, -0.5, -0.5] },
      { id: 'c1', pos: [ 0.5, -0.5, -0.5] },
      { id: 'c2', pos: [ 0.5, -0.5,  0.5] },
      { id: 'c3', pos: [-0.5, -0.5,  0.5] },
      { id: 'c4', pos: [ 0.0,  0.5,  0.0] },
    ],
    render: { kind: 'pyramid' },
  },
}

// ─── Composite templates ─────────────────────────────────────────────────────
// Each composite is two PRIMITIVES placed in a parent frame. We aggregate
// their corners into one list with stable IDs prefixed by part index.
//
// Offsets are tuned so the two primitives slightly overlap (by ~0.04 units) at
// the joining face. With depth-tested edges, the buried seam edges disappear
// inside the other primitive — the rendered composite reads as one continuous
// shape with a single silhouette outline instead of two stacked tiles.
export const COMPOSITES = {
  // Tier-1 (rounds 0–3 use these in order). All cuboid-only first, then
  // mixed shapes.
  cubeStack: {
    label: 'Cube on cube',
    parts: [
      { prim: 'cuboid', offset: [0, 0, 0],    scale: [1.0, 1.0, 1.0] },
      { prim: 'cuboid', offset: [0, 0.76, 0], scale: [0.6, 0.6, 0.6] },
    ],
  },
  cubeStep: {
    label: 'Stepped cube',
    parts: [
      { prim: 'cuboid', offset: [0, 0, 0],          scale: [1.0, 1.0, 1.0] },
      { prim: 'cuboid', offset: [0.55, 0.36, 0],    scale: [0.6, 0.6, 1.0] },
    ],
  },
  // Tier-1 (rounds 2–3 add these mixed shapes).
  cubePrismRoof: {
    label: 'Cube + roof',
    parts: [
      { prim: 'cuboid',          offset: [0, 0, 0],    scale: [1.0, 1.0, 1.0] },
      { prim: 'triangularPrism', offset: [0, 0.71, 0], scale: [1.0, 0.5, 1.0] },
    ],
  },
  cubePyramidTop: {
    label: 'Cube + pyramid',
    parts: [
      { prim: 'cuboid',        offset: [0, 0, 0],    scale: [1.0, 1.0, 1.0] },
      { prim: 'squarePyramid', offset: [0, 0.76, 0], scale: [1.0, 0.6, 1.0] },
    ],
  },
  // Tier-2 (rounds 4–7 unlock more variety).
  pyramidStack: {
    label: 'Pyramid stack',
    parts: [
      { prim: 'cuboid',        offset: [0, 0, 0],    scale: [1.0, 0.6, 1.0] },
      { prim: 'squarePyramid', offset: [0, 0.76, 0], scale: [1.0, 1.0, 1.0] },
    ],
  },
  prismOnPrism: {
    label: 'Prism stack',
    parts: [
      { prim: 'triangularPrism', offset: [0, 0, 0],    scale: [1.0, 1.0, 1.0] },
      { prim: 'cuboid',          offset: [0, 0.76, 0], scale: [0.6, 0.6, 0.6] },
    ],
  },
}

const TIER1_EARLY = ['cubeStack', 'cubeStep']
const TIER1_LATE  = ['cubeStack', 'cubeStep', 'cubePrismRoof', 'cubePyramidTop']
const TIER2_ALL   = Object.keys(COMPOSITES)

// ─── Composite corner enumeration ────────────────────────────────────────────
// Each entry is { id, pos, partIdx, primCornerId } — pos is in composite-local
// coords (before any composite-level rotation).
export function compositeCorners(compositeKey) {
  const comp = COMPOSITES[compositeKey]
  const corners = []
  comp.parts.forEach((part, partIdx) => {
    const prim = PRIMITIVES[part.prim]
    prim.corners.forEach((corner) => {
      const [x, y, z] = corner.pos
      const [sx, sy, sz] = part.scale
      const [ox, oy, oz] = part.offset
      corners.push({
        id: `p${partIdx}_${corner.id}`,
        pos: [x * sx + ox, y * sy + oy, z * sz + oz],
        partIdx,
        primCornerId: corner.id,
      })
    })
  })
  return corners
}

// ─── Rotation generators ─────────────────────────────────────────────────────
// Each rotation is an Euler triplet [rx, ry, rz] in radians.
const HALF_PI = Math.PI / 2

// Tier-1 rotations: single-axis Y rotations by 90° steps.
export const TIER1_ROTATIONS = [0, 1, 2, 3].map((k) => [0, k * HALF_PI, 0])

// Tier-2 rotations: 24 orientations of the cube rotation group, enumerated as
// Euler angles. Built by combining 6 face-up rotations × 4 rotations around
// that face's axis. The full group is sufficient for variety; duplicates after
// reducing modulo the cube symmetry are pruned visually by random sampling.
export const TIER2_ROTATIONS = (() => {
  const rots = []
  // 6 "face up" base rotations (which axis points up after rotation).
  const baseUps = [
    [0, 0, 0],
    [Math.PI, 0, 0],
    [HALF_PI, 0, 0],
    [-HALF_PI, 0, 0],
    [0, 0, HALF_PI],
    [0, 0, -HALF_PI],
  ]
  for (const base of baseUps) {
    for (let k = 0; k < 4; k++) {
      rots.push([base[0], base[1] + k * HALF_PI, base[2]])
    }
  }
  return rots
})()

// ─── Seeded RNG ──────────────────────────────────────────────────────────────
// Tiny LCG so test runs are deterministic when a seeded rng is passed.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, arr)  { return arr[Math.floor(rng() * arr.length)] }
function pickN(rng, arr, n) {
  const pool = arr.slice()
  const out = []
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
  }
  return out
}

// ─── Round build ─────────────────────────────────────────────────────────────
// Returns:
// {
//   roundIdx,
//   tier: 0 | 1,
//   shapes: [{ compositeKey, dotCornerId }, ...],     // the two prompt shapes
//   options: [
//     { id: 'A'..'E', rotations: [rA, rB], dots: [cornerIdA, cornerIdB] },
//   ],
//   correctOptionId,
// }
export function buildRound(roundIdx, rng = Math.random) {
  // Tier matches the Visualisation 2D convention: 0 for rounds 0–3, 1 for 4–7.
  // The shared result model stores tier1Correct / tier2Correct counts.
  const tier = roundIdx < 4 ? 0 : 1

  const compositePool =
    roundIdx <= 1 ? TIER1_EARLY :
    roundIdx <= 3 ? TIER1_LATE  :
                    TIER2_ALL
  const rotationPool = tier === 0 ? TIER1_ROTATIONS : TIER2_ROTATIONS

  // Pick two composite types (allow duplicates for variety in tier-1 small pool).
  const compA = pick(rng, compositePool)
  const compB = pick(rng, compositePool)

  const cornersA = compositeCorners(compA)
  const cornersB = compositeCorners(compB)

  // Pick one corner per shape as the "logical" highlighted corner.
  const dotA = pick(rng, cornersA).id
  const dotB = pick(rng, cornersB).id

  const shapes = [
    { compositeKey: compA, dotCornerId: dotA },
    { compositeKey: compB, dotCornerId: dotB },
  ]

  // Pick rotations for the 5 options. The correct option uses ANY rotation
  // (could be 0 — the identity — or a non-trivial one) and shows the dots on
  // the same logical corners. Distractors use random rotations and pick at
  // least one wrong corner.
  const correctRotA = pick(rng, rotationPool)
  const correctRotB = pick(rng, rotationPool)

  const wrongPoolA = cornersA.map((c) => c.id).filter((id) => id !== dotA)
  const wrongPoolB = cornersB.map((c) => c.id).filter((id) => id !== dotB)

  // Build 4 distractors with varied "wrongness" so guesses can't shortcut on a
  // single mismatch pattern.
  //   D1: shape A wrong, shape B correct
  //   D2: shape A correct, shape B wrong
  //   D3: both shapes wrong
  //   D4: both shapes wrong (different corners than D3 if pool allows)
  function newWrongPair(taken) {
    const wA = pickN(rng, wrongPoolA, 1)[0]
    let wB = pickN(rng, wrongPoolB, 1)[0]
    let attempts = 0
    while (taken.some((t) => t[0] === wA && t[1] === wB) && attempts < 8) {
      wB = pickN(rng, wrongPoolB, 1)[0]
      attempts++
    }
    return [wA, wB]
  }

  const taken = []
  const d1 = [pickN(rng, wrongPoolA, 1)[0], dotB]
  const d2 = [dotA, pickN(rng, wrongPoolB, 1)[0]]
  const d3 = newWrongPair(taken); taken.push(d3)
  const d4 = newWrongPair(taken)

  const distractorDots = [d1, d2, d3, d4]

  // Each distractor also gets its own random rotation pair.
  const distractors = distractorDots.map((dots) => ({
    rotations: [pick(rng, rotationPool), pick(rng, rotationPool)],
    dots,
  }))

  // Correct option dots match the prompt's logical corners.
  const correct = {
    rotations: [correctRotA, correctRotB],
    dots: [dotA, dotB],
  }

  // Shuffle the 5 options into A..E and record which letter is correct.
  const pool = [correct, ...distractors]
  // Fisher–Yates shuffle.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const correctIdx = pool.indexOf(correct)
  const LETTERS = ['A', 'B', 'C', 'D', 'E']
  const options = pool.map((opt, i) => ({ id: LETTERS[i], ...opt }))

  return {
    roundIdx,
    tier,
    shapes,
    options,
    correctOptionId: LETTERS[correctIdx],
  }
}

export function buildRounds(rng = Math.random) {
  const rounds = []
  for (let i = 0; i < 8; i++) rounds.push(buildRound(i, rng))
  return rounds
}
