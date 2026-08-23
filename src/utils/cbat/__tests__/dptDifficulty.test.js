import { describe, it, expect, beforeEach } from 'vitest'
import {
  DPT_TUNING, DPT_DIFFICULTIES, DEFAULT_DPT_DIFFICULTY,
  dptTuning, dptGameKey, firstRound, lastRound, displayRound, computeGrade,
  readStoredDptDifficulty, storeDptDifficulty,
} from '../dptDifficulty'

// The allowed key set is pinned, exactly as FLAG's, CUT's, Numerical Ops', SAT's
// and RTT's are: a difficulty is a narrow, stated set of changes, and a new key
// appearing here means one difficulty has quietly started changing something
// outside that scope. DPT's scope is narrower than any of them — a difficulty
// chooses which rungs of the ladder to serve and nothing else. Nothing here
// touches aircraft speed, turn rate, gate size, round duration or scoring.
const ALLOWED_KEYS = new Set([
  'key', 'label', 'gameKey', 'bars', 'blurb',
  'rounds', 'lengthBlurb', 'joinsBlurb', 'maxScore', 'grades',
])

// The scoring constants the ladder is built from, mirrored from CbatDpt.jsx.
// If any of these move, the maxima below fail and the migration that normalised
// the pre-split scores by 1,700 needs revisiting with them.
const POINTS_PER_GATE = 100
const POINTS_PER_INTERCEPT = 250
const ROUND_BONUS_PER_ROUND = 50
// Gates per ladder round: 2, 2, 3, then 3 lettered + 2 numbered, then 3 + 3.
const GATES_BY_ROUND = { 1: 2, 2: 2, 3: 3, 4: 5, 5: 6, 6: 6, 7: 6, 8: 6 }
// Enemies per ladder round — the Fighter earns 250 for each.
const ENEMIES_BY_ROUND = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 2, 8: 3 }

function perfectScore(rounds) {
  return rounds.reduce((sum, r) => (
    sum
    + GATES_BY_ROUND[r] * POINTS_PER_GATE
    + ENEMIES_BY_ROUND[r] * POINTS_PER_INTERCEPT
    + ROUND_BONUS_PER_ROUND * r
  ), 0)
}

describe('DPT difficulty table', () => {
  it('only tunes the agreed keys', () => {
    for (const tuning of Object.values(DPT_TUNING)) {
      for (const key of Object.keys(tuning)) {
        expect(ALLOWED_KEYS.has(key)).toBe(true)
      }
    }
  })

  // Hard is on `dpt-hard`, NOT `dpt`. Plain `dpt` is the original eight-round
  // board, which clients predating the split still play and read with hardcoded
  // URLs. Their totals run up to 1,700 higher than a four-round Hard run can
  // reach, so pointing Hard at that key would put them permanently on top of it.
  it('has both difficulties on their own leaderboard keys, neither of them the pre-split one', () => {
    expect(dptGameKey('easier')).toBe('dpt-easier')
    expect(dptGameKey('hard')).toBe('dpt-hard')
    expect(dptGameKey('hard')).not.toBe('dpt')
    expect(DPT_TUNING.easier.gameKey).not.toBe(DPT_TUNING.hard.gameKey)
  })

  it('orders the pair easier-then-hard for the intro card', () => {
    expect(DPT_DIFFICULTIES.map(d => d.key)).toEqual(['easier', 'hard'])
  })

  it('defaults to easier, and falls back to it for an unknown key', () => {
    expect(DEFAULT_DPT_DIFFICULTY).toBe('easier')
    expect(dptTuning('nonsense').key).toBe('easier')
    expect(dptTuning(undefined).key).toBe('easier')
  })
})

describe('the two halves of the ladder', () => {
  it('splits the eight rounds cleanly, in order, with no overlap', () => {
    expect(DPT_TUNING.easier.rounds).toEqual([1, 2, 3, 4])
    expect(DPT_TUNING.hard.rounds).toEqual([5, 6, 7, 8])
    const all = [...DPT_TUNING.easier.rounds, ...DPT_TUNING.hard.rounds]
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(new Set(all).size).toBe(8)
  })

  it('runs the same number of rounds on both', () => {
    expect(DPT_TUNING.easier.rounds).toHaveLength(4)
    expect(DPT_TUNING.hard.rounds).toHaveLength(4)
  })

  it('opens and closes each difficulty on the right rung', () => {
    expect(firstRound(DPT_TUNING.easier)).toBe(1)
    expect(lastRound(DPT_TUNING.easier)).toBe(4)
    expect(firstRound(DPT_TUNING.hard)).toBe(5)
    expect(lastRound(DPT_TUNING.hard)).toBe(8)
  })

  // Hard is the half with the enemies, the danger zones and the third aircraft,
  // so this is the only ordering assertion that means anything: a difficulty
  // does not change what a round IS.
  it('gives Hard the strictly later, heavier half', () => {
    expect(Math.min(...DPT_TUNING.hard.rounds)).toBeGreaterThan(Math.max(...DPT_TUNING.easier.rounds))
    expect(DPT_TUNING.hard.bars).toBeGreaterThan(DPT_TUNING.easier.bars)
  })
})

describe('displayRound', () => {
  it('numbers a run 1..4 whichever half it is', () => {
    expect(DPT_TUNING.easier.rounds.map(r => displayRound(r, DPT_TUNING.easier))).toEqual([1, 2, 3, 4])
    expect(DPT_TUNING.hard.rounds.map(r => displayRound(r, DPT_TUNING.hard))).toEqual([1, 2, 3, 4])
  })

  // The admin round-jump cheats (111…888, and ?round=N) address ladder rounds
  // absolutely, so a debug run can sit outside its difficulty's own slice. The
  // HUD must still read as a position in a four-round run rather than "RND 0/4"
  // or "RND 5/4".
  it('clamps a round jumped to from outside the difficulty', () => {
    expect(displayRound(8, DPT_TUNING.easier)).toBe(4)
    expect(displayRound(1, DPT_TUNING.hard)).toBe(1)
    expect(displayRound(4, DPT_TUNING.hard)).toBe(1)
  })
})

describe('score ceilings', () => {
  // These are load-bearing. The pre-split eight-round scores were normalised
  // onto the Hard board by subtracting 1,700 — the Easier ceiling — so if the
  // halves stop adding up to a whole ladder, that migration is wrong.
  // See backend/utils/dptLegacyNormalise.js.
  it('matches what a perfect run of each half actually pays', () => {
    expect(DPT_TUNING.easier.maxScore).toBe(perfectScore(DPT_TUNING.easier.rounds))
    expect(DPT_TUNING.hard.maxScore).toBe(perfectScore(DPT_TUNING.hard.rounds))
  })

  it('is 1,700 for Easier and 5,200 for Hard', () => {
    expect(DPT_TUNING.easier.maxScore).toBe(1700)
    expect(DPT_TUNING.hard.maxScore).toBe(5200)
  })

  // 1,700 + 5,200 = 6,900, which is what a perfect run on the eight-round board
  // scored. That identity is what let every pre-split run be carried onto the
  // Hard board by subtracting the Easier ceiling.
  it('sums to what a perfect pre-split eight-round run scored', () => {
    expect(DPT_TUNING.easier.maxScore + DPT_TUNING.hard.maxScore).toBe(6900)
  })

  it('keeps every grade band inside its own ceiling', () => {
    for (const tuning of Object.values(DPT_TUNING)) {
      expect(tuning.grades.outstanding).toBeLessThan(tuning.maxScore)
      expect(tuning.grades.outstanding).toBeGreaterThan(tuning.grades.good)
      expect(tuning.grades.good).toBeGreaterThan(tuning.grades.needsWork)
    }
  })
})

describe('computeGrade', () => {
  it('grades against the difficulty in play, not a shared scale', () => {
    // 1,200 is a fine Easier run and a poor Hard one.
    expect(computeGrade(1200, DPT_TUNING.easier)).toBe('Good')
    expect(computeGrade(1200, DPT_TUNING.hard)).toBe('Failed')
  })

  it('walks the bands', () => {
    const h = DPT_TUNING.hard
    expect(computeGrade(h.maxScore, h)).toBe('Outstanding')
    expect(computeGrade(h.grades.good, h)).toBe('Good')
    expect(computeGrade(h.grades.needsWork, h)).toBe('Needs Work')
    expect(computeGrade(0, h)).toBe('Failed')
  })
})

describe('remembering the choice', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to easier with nothing stored', () => {
    expect(readStoredDptDifficulty()).toBe('easier')
  })

  it('round-trips a stored choice', () => {
    storeDptDifficulty('hard')
    expect(readStoredDptDifficulty()).toBe('hard')
  })

  it('ignores a stored value that is not a difficulty', () => {
    localStorage.setItem('sw_cbat_dpt_difficulty', 'impossible')
    expect(readStoredDptDifficulty()).toBe('easier')
  })
})
