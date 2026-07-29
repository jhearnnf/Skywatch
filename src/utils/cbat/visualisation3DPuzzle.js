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

// ─── Shapes ──────────────────────────────────────────────────────────────────
// Composites are clean manifold polyhedra defined in visualisation3DShapes.js
// (see that file for why: no CSG, no T-junctions, coplanar faces merged). Each
// exposes its vertices as stable corners for dot placement. We re-export SHAPES
// as COMPOSITES and shapeCorners as compositeCorners so the puzzle/round logic
// below is unchanged.
export { SHAPES as COMPOSITES } from './visualisation3DShapes'
export { shapeCorners as compositeCorners } from './visualisation3DShapes'

import * as THREE from 'three'
import { SHAPES } from './visualisation3DShapes'
import { shapeCorners as compositeCorners, shapeOrbits } from './visualisation3DShapes'

// Difficulty pools. Easy rounds use simple square-based shapes; later rounds add
// the full varied set (triangles, pentagons, hexagons; stacks, caps, tents,
// tapers, a house).
const TIER1_EARLY = ['cubeStack', 'pyramidTop']
const TIER1_LATE  = ['cubeStack', 'pyramidTop', 'houseSquare', 'taperBlock', 'triTent']
const TIER2_ALL   = Object.keys(SHAPES)

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

// ─── Rendered-appearance key ─────────────────────────────────────────────────
// What an option tile actually LOOKS like for one shape slot: the rotated hull
// (as a canonical point set) plus where the dot ends up. Two slots with the same
// key are the same picture.
//
// The orbit rule below guarantees a distractor's dot is on a logically different
// corner, but it can't stop two options being drawn the same: rotations come
// from a symmetry group, so a different (rotation, corner) pair can land the
// shape and its dot in exactly the same place. That produced rounds with two
// identical tiles — and, if one of them was the correct option, two correct
// answers. buildRound re-rolls until every tile is distinct.
const _keyCache = new Map()
export function slotRenderKey(compositeKey, euler, dotId) {
  const memo = `${compositeKey}|${euler.join(',')}|${dotId}`
  if (_keyCache.has(memo)) return _keyCache.get(memo)
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]))
  const q = (n) => Math.round(n * 1000) / 1000
  const at = (p) => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m)
    return `${q(v.x)},${q(v.y)},${q(v.z)}`
  }
  const hull = SHAPES[compositeKey].vertices.map(at).sort().join(';')
  const corner = compositeCorners(compositeKey).find((c) => c.id === dotId)
  const key = `${hull}|${corner ? at(corner.pos) : 'none'}`
  _keyCache.set(memo, key)
  return key
}

const optionRenderKey = (shapes, option) =>
  shapes.map((s, i) => slotRenderKey(s.compositeKey, option.rotations[i], option.dots[i])).join('#')

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

  // A distractor's "wrong" corner must be UNAMBIGUOUSLY different from the
  // correct one, or the option looks just as correct. Two guards:
  //   • different symmetry orbit — a corner in the same orbit is a rotated copy
  //     of the correct corner and is visually identical (the ambiguity bug);
  //   • not spatially near the correct corner — even different orbits can sit
  //     close enough to be hard to tell apart once rotated.
  // Fall back to orbit-only if the distance filter would empty the pool.
  const MIN_SEP = 0.33
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  function wrongPool(corners, orbits, dotId) {
    const dotPos = corners.find((c) => c.id === dotId).pos
    const diffOrbit = corners.filter((c) => orbits[c.id] !== orbits[dotId])
    const separated = diffOrbit.filter((c) => dist(c.pos, dotPos) >= MIN_SEP)
    return (separated.length ? separated : diffOrbit).map((c) => c.id)
  }
  const orbitsA = shapeOrbits(compA)
  const orbitsB = shapeOrbits(compB)
  const wrongPoolA = wrongPool(cornersA, orbitsA, dotA)
  const wrongPoolB = wrongPool(cornersB, orbitsB, dotB)

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

  // Every tile must be a different picture. A distractor that renders exactly
  // like the correct option is a second correct answer; two distractors that
  // render alike are a duplicate choice. Re-roll the offender's rotations (the
  // dots are already constrained by orbit, so rotation is the free variable),
  // and fall back to nudging its dot if no rotation separates them.
  const taken2 = new Set([optionRenderKey(shapes, correct)])
  for (const d of distractors) {
    let key = optionRenderKey(shapes, d)
    for (let attempt = 0; taken2.has(key) && attempt < 40; attempt++) {
      d.rotations = [pick(rng, rotationPool), pick(rng, rotationPool)]
      if (attempt >= 20) {
        // Rotation alone isn't separating them — try a different wrong corner.
        d.dots = [
          d.dots[0] === dotA ? dotA : pickN(rng, wrongPoolA, 1)[0],
          d.dots[1] === dotB ? dotB : pickN(rng, wrongPoolB, 1)[0],
        ]
      }
      key = optionRenderKey(shapes, d)
    }
    taken2.add(key)
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
