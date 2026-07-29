import { describe, it, expect, beforeEach } from 'vitest'
import {
  FLAG_TUNING, FLAG_DIFFICULTIES, DEFAULT_FLAG_DIFFICULTY,
  flagTuning, flagGameKey, buildQuestionSchedule, pickMathDifficulty, computeGrade,
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
    expect(e.acCount).toBeLessThan(h.acCount)
    expect(e.circleChance).toBeLessThan(h.circleChance)

    // Both counts are guaranteed per run, so "fewer" has to still be "several" —
    // a run that serves one callsign question teaches nothing.
    expect(e.acCount).toBeGreaterThanOrEqual(4)
    expect(e.mathCount).toBeGreaterThanOrEqual(5)

    // …and rings stay frequent enough that shapes keep arming — the strikes are
    // the reps a new player most needs.
    expect(e.circleChance).toBeGreaterThanOrEqual(0.3)
  })

  it('carries no pace or timing knobs at all', () => {
    // A key appearing here would mean a difficulty had started changing
    // something other than volume (mathWeights being the deliberate exception —
    // Easier never draws a hard sum). Grades are derived: fewer questions cap
    // the achievable total, so the bands come down with it.
    const allowed = ['key', 'label', 'gameKey', 'bars', 'blurb', 'mathCount', 'mathWeights', 'acCount', 'circleChance', 'grades']
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
    expect(FLAG_TUNING.hard).toMatchObject({ mathCount: 10, mathWeights: null, acCount: 6, circleChance: 0.5 })
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

// Callsign prompts used to fire on a per-tick random roll, which could serve a
// whole run just one question. The schedule is what makes the count a promise.
describe('FLAG question schedules', () => {
  it('serves exactly the requested number of questions', () => {
    for (const count of [4, 6, 10]) {
      expect(buildQuestionSchedule(count, 5, 51)).toHaveLength(count)
    }
  })

  it('keeps them in order and inside the run', () => {
    for (let run = 0; run < 50; run++) {
      const times = buildQuestionSchedule(4, 5, 51)
      expect([...times].sort((a, b) => a - b)).toEqual(times)
      // The jitter is ±20% of a step, so nothing escapes the window by enough
      // to start before the game does or to land after the clock stops.
      expect(times[0]).toBeGreaterThan(0)
      expect(times[times.length - 1]).toBeLessThan(56)
    }
  })

  it('spreads them out rather than clustering', () => {
    const times = buildQuestionSchedule(6, 5, 51)
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThan(1)
    }
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
