import { describe, it, expect, beforeEach } from 'vitest'
import {
  FLAG_TUNING, FLAG_DIFFICULTIES, DEFAULT_FLAG_DIFFICULTY,
  flagTuning, flagGameKey, pickMathDifficulty, computeGrade,
  readStoredFlagDifficulty, storeFlagDifficulty,
} from '../difficulty'

describe('FLAG difficulty tuning', () => {
  it('defaults to easier, and lists easier before hard (left/right of the title)', () => {
    expect(DEFAULT_FLAG_DIFFICULTY).toBe('easier')
    expect(FLAG_DIFFICULTIES.map(d => d.key)).toEqual(['easier', 'hard'])
  })

  it('sends each difficulty to its own leaderboard', () => {
    expect(flagGameKey('easier')).toBe('flag-easier')
    expect(flagGameKey('hard')).toBe('flag')
    // An unknown/absent value can't silently file a run on the wrong board.
    expect(flagGameKey(undefined)).toBe('flag-easier')
    expect(flagTuning('nonsense')).toBe(FLAG_TUNING[DEFAULT_FLAG_DIFFICULTY])
  })

  // The point of Easier is load, not pace: it serves fewer maths questions,
  // fewer callsign questions and fewer ringed contacts. Nothing else about the
  // run may differ — no slower aircraft, no longer timers.
  it('only lowers the three volume dials', () => {
    const e = FLAG_TUNING.easier
    const h = FLAG_TUNING.hard

    expect(e.mathCount).toBeLessThan(h.mathCount)
    expect(e.acSpawnChance).toBeLessThan(h.acSpawnChance)
    expect(e.circleChance).toBeLessThan(h.circleChance)

    // …and rings stay frequent enough that shapes keep arming — the strikes are
    // the reps a new player most needs.
    expect(e.circleChance).toBeGreaterThanOrEqual(0.3)
  })

  it('carries no pace or timing knobs at all', () => {
    // A key appearing here would mean a difficulty had started changing
    // something other than volume (mathWeights being the deliberate exception —
    // Easier never draws a hard sum). Grades are derived: fewer questions cap
    // the achievable total, so the bands come down with it.
    const allowed = ['key', 'label', 'gameKey', 'bars', 'blurb', 'mathCount', 'mathWeights', 'acSpawnChance', 'circleChance', 'grades']
    for (const t of FLAG_DIFFICULTIES) {
      expect(Object.keys(t).sort()).toEqual([...allowed].sort())
    }
  })

  it('never serves a hard sum on the easier difficulty', () => {
    for (let i = 0; i < 200; i++) {
      const t = Math.random() * 60
      expect(['easy', 'medium']).toContain(pickMathDifficulty(t, FLAG_TUNING.easier))
    }
  })

  it('keeps the stage-weighted mix on hard', () => {
    const seen = new Set()
    for (let i = 0; i < 400; i++) seen.add(pickMathDifficulty(30, FLAG_TUNING.hard))
    expect(seen.has('hard')).toBe(true)
  })

  it('hard keeps the original constants (unchanged for existing scores)', () => {
    expect(FLAG_TUNING.hard).toMatchObject({ mathCount: 10, mathWeights: null, acSpawnChance: 0.015, circleChance: 0.5 })
    expect(computeGrade(400, FLAG_TUNING.hard)).toBe('Outstanding')
    expect(computeGrade(250, FLAG_TUNING.hard)).toBe('Good')
    expect(computeGrade(100, FLAG_TUNING.hard)).toBe('Needs Work')
    expect(computeGrade(99, FLAG_TUNING.hard)).toBe('Failed')
  })

  it('grades easier on its own (lower) bands', () => {
    expect(computeGrade(300, FLAG_TUNING.easier)).toBe('Outstanding')
    expect(computeGrade(300, FLAG_TUNING.hard)).toBe('Good')
  })
})

describe('FLAG difficulty persistence', () => {
  beforeEach(() => localStorage.clear())

  it('falls back to the default when nothing is stored', () => {
    expect(readStoredFlagDifficulty()).toBe('easier')
  })

  it('round-trips the most recent choice', () => {
    storeFlagDifficulty('hard')
    expect(readStoredFlagDifficulty()).toBe('hard')
  })

  it('ignores a stored value that is no longer a difficulty', () => {
    storeFlagDifficulty('impossible')
    expect(readStoredFlagDifficulty()).toBe('easier')
  })
})
