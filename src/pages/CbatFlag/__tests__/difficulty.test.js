import { describe, it, expect, beforeEach } from 'vitest'
import {
  FLAG_TUNING, FLAG_DIFFICULTIES, DEFAULT_FLAG_DIFFICULTY,
  flagTuning, flagGameKey, pickMathDifficulty, stageConfig, computeGrade,
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

  // The whole point of the easier mode: the same 60 seconds, run slowly.
  it('easier is slower than hard on every pacing dimension', () => {
    const e = FLAG_TUNING.easier
    const h = FLAG_TUNING.hard
    expect(e.mathCount).toBeLessThan(h.mathCount)
    expect(e.mathTimeout).toBeGreaterThan(h.mathTimeout)
    expect(e.mathGap).toBeGreaterThan(h.mathGap)
    expect(e.acDuration).toBeGreaterThan(h.acDuration)
    expect(e.acCooldown).toBeGreaterThan(h.acCooldown)
    expect(e.symbolFlashSeconds).toBeGreaterThan(h.symbolFlashSeconds)
    expect(e.aircraftSpeed).toBeLessThan(h.aircraftSpeed)
  })

  it('hard keeps the original constants (unchanged for existing scores)', () => {
    expect(FLAG_TUNING.hard).toMatchObject({
      mathCount: 10, mathTimeout: 8, mathGap: 3,
      acCooldown: 3, acDuration: 4, acFirst: 5, acSpawnChance: 0.015,
      aircraftSpeed: 20, symbolFlashSeconds: 5, maxScale: 1, spawnScale: 1,
    })
    expect(computeGrade(400, FLAG_TUNING.hard)).toBe('Outstanding')
    expect(computeGrade(250, FLAG_TUNING.hard)).toBe('Good')
    expect(computeGrade(100, FLAG_TUNING.hard)).toBe('Needs Work')
    expect(computeGrade(99, FLAG_TUNING.hard)).toBe('Failed')
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

  it('thins the traffic on easier without ever emptying the field', () => {
    for (const t of [0, 12, 24, 36, 48, 59]) {
      const e = stageConfig(t, FLAG_TUNING.easier)
      const h = stageConfig(t, FLAG_TUNING.hard)
      expect(e.max).toBeLessThan(h.max)
      expect(e.max).toBeGreaterThanOrEqual(2)
      expect(e.spawn).toBeGreaterThan(h.spawn)
    }
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
