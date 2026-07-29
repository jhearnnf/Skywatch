import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  buildRound,
  buildRounds,
  compositeCorners,
  COMPOSITES,
  TIER1_ROTATIONS,
  TIER2_ROTATIONS,
  mulberry32,
} from '../visualisation3DPuzzle'
import { getCompositeGeometry } from '../visualisation3DGeometry'
import { SHAPES, shapeOrbits } from '../visualisation3DShapes'

describe('visualisation3DShapes — clean manifold geometry', () => {
  // The composites are built as watertight manifold polyhedra (no CSG). These
  // guard the two properties that made the old CSG shapes look like "two blocks
  // stuck together":
  //   • every edge is shared by exactly two faces (watertight, no gaps), and
  //   • no vertex sits mid-edge of another face (T-junction) — T-junctions
  //     render as hairline cracks / seams on a real GPU.
  it('every shape is a watertight manifold (each edge shared by exactly 2 faces)', () => {
    for (const [key, shape] of Object.entries(SHAPES)) {
      const edge = new Map()
      for (const f of shape.faces) {
        for (let i = 0; i < f.length; i++) {
          const a = f[i]
          const b = f[(i + 1) % f.length]
          const k = `${Math.min(a, b)}_${Math.max(a, b)}`
          edge.set(k, (edge.get(k) || 0) + 1)
        }
      }
      const bad = [...edge.values()].filter((c) => c !== 2).length
      expect(bad, `${key} has ${bad} non-manifold edges`).toBe(0)
    }
  })

  it('no shape has T-junctions (a vertex lying mid-edge of another face)', () => {
    for (const [key, shape] of Object.entries(SHAPES)) {
      const P = shape.vertices.map((v) => new THREE.Vector3(v[0], v[1], v[2]))
      let tj = 0
      for (let vi = 0; vi < P.length; vi++) {
        for (const f of shape.faces) {
          if (f.includes(vi)) continue
          for (let i = 0; i < f.length; i++) {
            const p = P[f[i]]
            const q = P[f[(i + 1) % f.length]]
            const pq = new THREE.Vector3().subVectors(q, p)
            const t = new THREE.Vector3().subVectors(P[vi], p).dot(pq) / pq.lengthSq()
            if (t > 0.01 && t < 0.99) {
              const proj = new THREE.Vector3().copy(p).addScaledVector(pq, t)
              if (proj.distanceTo(P[vi]) < 1e-4) tj++
            }
          }
        }
      }
      expect(tj, `${key} has ${tj} T-junctions`).toBe(0)
    }
  })

  // A REGULAR pentagon has 5-fold symmetry about Y: turn it 72° and the
  // silhouette is identical, so five corners are visually interchangeable and a
  // marked corner can't be pinned to a side. The penta shapes therefore use an
  // irregular base (PENTA_PROFILE). Guarded here because "tidying" the profile
  // back to a regular n-gon would look harmless and quietly make those rounds
  // unanswerable.
  describe('pentagon shapes are irregular', () => {
    const PENTA = ['pentaTower', 'pentaCap']

    it('have no rotational symmetry at all — every corner is its own orbit', () => {
      for (const key of PENTA) {
        const orbits = shapeOrbits(key)
        const distinct = new Set(Object.values(orbits)).size
        expect(distinct, `${key} has symmetric corners`).toBe(SHAPES[key].vertices.length)
      }
    })

    it('give every side of the base a different width', () => {
      for (const key of PENTA) {
        const V = SHAPES[key].vertices
        const yMin = Math.min(...V.map((v) => v[1]))
        const ring = V.filter((v) => Math.abs(v[1] - yMin) < 1e-6)
        expect(ring).toHaveLength(5)

        // Distinct radii — the visible cue that tells the sides apart.
        const radii = ring.map((v) => Math.hypot(v[0], v[2]))
        for (let i = 0; i < radii.length; i++) {
          for (let j = i + 1; j < radii.length; j++) {
            expect(Math.abs(radii[i] - radii[j])).toBeGreaterThan(0.02)
          }
        }

        // Still convex — orientFaces and the wall/ring faces assume a polygon
        // that's star-convex from its centroid.
        const turns = new Set()
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length]
          turns.add(Math.sign((b[0] - a[0]) * (c[2] - b[2]) - (b[2] - a[2]) * (c[0] - b[0])))
        }
        expect(turns.size, `${key} base is not convex`).toBe(1)
      }
    })

    it('stay inside the frame the camera already accommodates', () => {
      // The irregular profile pushes one corner further out than the old radius;
      // it must not exceed the widest shape the fixed camera already frames.
      const far = (k) => Math.max(...SHAPES[k].vertices.map((v) => Math.hypot(v[0], v[1], v[2])))
      const widest = Math.max(...Object.keys(SHAPES).filter(k => !PENTA.includes(k)).map(far))
      for (const key of PENTA) expect(far(key)).toBeLessThanOrEqual(widest)
    })
  })

  it('every composite builds one non-empty geometry (cached)', () => {
    for (const key of Object.keys(COMPOSITES)) {
      const geo = getCompositeGeometry(key)
      expect(geo).toBeTruthy()
      expect(geo.attributes.position.count).toBeGreaterThan(0)
      // Same reference on a second call — the geometry is memoised.
      expect(getCompositeGeometry(key)).toBe(geo)
    }
  })

  it('every corner coincides with a real vertex of the built geometry', () => {
    // The red dots are placed at corner positions, so each must sit on an actual
    // vertex of the rendered solid.
    for (const key of Object.keys(COMPOSITES)) {
      const geo = getCompositeGeometry(key)
      const pos = geo.attributes.position
      const verts = new Set()
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i)
        verts.add(`${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`)
      }
      for (const c of compositeCorners(key)) {
        const k = `${c.pos[0].toFixed(3)},${c.pos[1].toFixed(3)},${c.pos[2].toFixed(3)}`
        expect(verts.has(k), `${key} corner ${c.id} is not a geometry vertex`).toBe(true)
      }
    }
  })
})

describe('visualisation3DPuzzle — composites', () => {
  it('compositeCorners returns one stable-id corner per shape vertex', () => {
    const corners = compositeCorners('cubeStack')
    // cubeStack (square prism stack) has 16 vertices.
    expect(corners.length).toBe(16)
    expect(corners.every((c) => /^c\d+$/.test(c.id))).toBe(true)
    // Corners span a range of heights (base bottom through upper top).
    const ys = corners.map((c) => c.pos[1])
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys))
  })
})

describe('visualisation3DPuzzle — buildRound', () => {
  it('returns 8 rounds with the right tier split', () => {
    const rounds = buildRounds(mulberry32(42))
    expect(rounds.length).toBe(8)
    expect(rounds.slice(0, 4).every((r) => r.tier === 0)).toBe(true)
    expect(rounds.slice(4, 8).every((r) => r.tier === 1)).toBe(true)
  })

  it('each round has exactly 5 options (A–E) with one correct id', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 8; i++) {
      const round = buildRound(i, rng)
      expect(round.options.length).toBe(5)
      const ids = round.options.map((o) => o.id).sort()
      expect(ids).toEqual(['A', 'B', 'C', 'D', 'E'])
      expect(['A', 'B', 'C', 'D', 'E']).toContain(round.correctOptionId)
    }
  })

  it('the correct option carries the prompt dot ids on the same logical corners', () => {
    const rng = mulberry32(11)
    for (let i = 0; i < 8; i++) {
      const round = buildRound(i, rng)
      const correct = round.options.find((o) => o.id === round.correctOptionId)
      expect(correct.dots[0]).toBe(round.shapes[0].dotCornerId)
      expect(correct.dots[1]).toBe(round.shapes[1].dotCornerId)
    }
  })

  it('every distractor differs from the correct dot pair on at least one shape', () => {
    const rng = mulberry32(99)
    for (let i = 0; i < 8; i++) {
      const round = buildRound(i, rng)
      const correctDots = [round.shapes[0].dotCornerId, round.shapes[1].dotCornerId]
      const distractors = round.options.filter((o) => o.id !== round.correctOptionId)
      for (const d of distractors) {
        const sameA = d.dots[0] === correctDots[0]
        const sameB = d.dots[1] === correctDots[1]
        expect(sameA && sameB).toBe(false)
      }
    }
  })

  it('no distractor is symmetry-equivalent to the correct answer (unambiguous)', () => {
    // A distractor is ambiguous — looks just as correct — if BOTH its shapes
    // carry the dot in the SAME symmetry orbit as the correct answer, since an
    // orbit-mate is a rotated copy of the same corner. Sweep many seeds/rounds.
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed * 101 + 7)
      for (let i = 0; i < 8; i++) {
        const round = buildRound(i, rng)
        const orbits = round.shapes.map((s) => shapeOrbits(s.compositeKey))
        const correctDots = [round.shapes[0].dotCornerId, round.shapes[1].dotCornerId]
        const distractors = round.options.filter((o) => o.id !== round.correctOptionId)
        for (const d of distractors) {
          const sameOrbitA = orbits[0][d.dots[0]] === orbits[0][correctDots[0]]
          const sameOrbitB = orbits[1][d.dots[1]] === orbits[1][correctDots[1]]
          expect(
            sameOrbitA && sameOrbitB,
            `seed ${seed} round ${i}: distractor ${d.id} is symmetry-equivalent to correct`,
          ).toBe(false)
        }
      }
    }
  })

  it('tier-1 rounds pick rotations from the single-axis Y set', () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 4; i++) {
      const round = buildRound(i, rng)
      for (const opt of round.options) {
        for (const rot of opt.rotations) {
          expect(TIER1_ROTATIONS).toContainEqual(rot)
        }
      }
    }
  })

  it('tier-2 rounds pick rotations from the cube rotation group', () => {
    const rng = mulberry32(5)
    for (let i = 4; i < 8; i++) {
      const round = buildRound(i, rng)
      for (const opt of round.options) {
        for (const rot of opt.rotations) {
          expect(TIER2_ROTATIONS).toContainEqual(rot)
        }
      }
    }
  })

  it('composite keys are real entries in COMPOSITES', () => {
    const rng = mulberry32(13)
    for (let i = 0; i < 8; i++) {
      const round = buildRound(i, rng)
      for (const shape of round.shapes) {
        expect(COMPOSITES[shape.compositeKey]).toBeTruthy()
      }
    }
  })
})
