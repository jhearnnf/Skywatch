import { describe, it, expect } from 'vitest'
import {
  buildRound,
  buildRounds,
  compositeCorners,
  COMPOSITES,
  PRIMITIVES,
  TIER1_ROTATIONS,
  TIER2_ROTATIONS,
  mulberry32,
} from '../visualisation3DPuzzle'

describe('visualisation3DPuzzle — primitives + composites', () => {
  it('every primitive has corners and a render kind', () => {
    for (const [, prim] of Object.entries(PRIMITIVES)) {
      expect(prim.corners.length).toBeGreaterThan(0)
      expect(prim.render?.kind).toBeTruthy()
    }
  })

  it('compositeCorners returns world-space corners for both parts', () => {
    const corners = compositeCorners('cubeStack')
    // Cube has 8 corners; cubeStack has two cuboids → 16 corners total.
    expect(corners.length).toBe(16)
    expect(corners.every((c) => c.id.startsWith('p0_') || c.id.startsWith('p1_'))).toBe(true)
    // The top (small) cube is offset by [0, 0.8, 0] and scaled 0.6 — its top
    // corner should sit above y = 0.8.
    const tops = corners.filter((c) => c.id.startsWith('p1_'))
    expect(tops.some((c) => c.pos[1] > 0.8)).toBe(true)
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
