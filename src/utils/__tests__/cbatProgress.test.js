import { describe, it, expect } from 'vitest'
import { cbatTrend, isCbatNewBest } from '../cbatProgress'

// The whole point of this helper is that "positive = improving" holds for every CBAT game,
// including the ones where a lower score is the better score.
describe('cbatTrend', () => {
  describe('higher-is-better games', () => {
    it('reads a rising average as improving', () => {
      expect(cbatTrend({ firstAvg: 100, lastAvg: 120 }, false)).toEqual({ pct: 20, improving: true, steady: false })
    })

    it('reads a falling average as declining', () => {
      const t = cbatTrend({ firstAvg: 100, lastAvg: 80 }, false)
      expect(t.pct).toBe(-20)
      expect(t.improving).toBe(false)
    })
  })

  describe('lower-is-better games (Trace Practise scores rotations)', () => {
    it('reads a falling average as improving, not declining', () => {
      expect(cbatTrend({ firstAvg: 40, lastAvg: 30 }, true)).toEqual({ pct: 25, improving: true, steady: false })
    })

    it('reads a rising average as declining', () => {
      const t = cbatTrend({ firstAvg: 30, lastAvg: 40 }, true)
      expect(t.pct).toBe(-33)
      expect(t.improving).toBe(false)
    })
  })

  it('calls a negligible change steady rather than inventing a direction', () => {
    const t = cbatTrend({ firstAvg: 200, lastAvg: 200 }, false)
    expect(t).toMatchObject({ pct: 0, steady: true, improving: false })
  })

  it('rounds to whole percent', () => {
    expect(cbatTrend({ firstAvg: 3, lastAvg: 4 }, false).pct).toBe(33)
  })

  describe('returns null when there is nothing trustworthy to say', () => {
    // The backend withholds these below 6 attempts, where the delta is noise.
    it('when the averages are absent', () => {
      expect(cbatTrend({ firstAvg: null, lastAvg: null }, false)).toBeNull()
      expect(cbatTrend({ firstAvg: 10, lastAvg: null }, false)).toBeNull()
      expect(cbatTrend({ firstAvg: null, lastAvg: 10 }, false)).toBeNull()
    })

    // A zero baseline has no percentage to measure against — "up 100% from nothing" is meaningless.
    it('when the starting average is zero', () => {
      expect(cbatTrend({ firstAvg: 0, lastAvg: 5 }, false)).toBeNull()
    })
  })
})

// The last run in `series` is the one just played; allTimeBest is the authoritative record.
const run = (score, time, daysAgo) => ({ score, time, at: new Date(Date.now() - daysAgo * 86400000).toISOString() })

describe('isCbatNewBest', () => {
  const timed = { hideTime: false, lowerIsBetter: false }

  it('is a PB on the very first run', () => {
    expect(isCbatNewBest([run(12, 30, 0)], { bestScore: 12, bestTime: 30 }, timed)).toBe(true)
  })

  it('is a PB when the run sets a new high score', () => {
    const series = [run(10, 30, 2), run(12, 28, 0)]
    expect(isCbatNewBest(series, { bestScore: 12, bestTime: 28 }, timed)).toBe(true)
  })

  it('is not a PB when the run trails the record score', () => {
    const series = [run(15, 20, 2), run(11, 18, 0)]
    expect(isCbatNewBest(series, { bestScore: 15, bestTime: 20 }, timed)).toBe(false)
  })

  describe('score ceiling (maxed out)', () => {
    it('celebrates the first max — it sets the record time', () => {
      const series = [run(18, 25, 2), run(20, 18, 0)]
      expect(isCbatNewBest(series, { bestScore: 20, bestTime: 18 }, timed)).toBe(true)
    })

    it('does not re-celebrate a slower max', () => {
      const series = [run(20, 18, 2), run(20, 22, 0)]
      expect(isCbatNewBest(series, { bestScore: 20, bestTime: 18 }, timed)).toBe(false)
    })

    it('does not re-celebrate an equal-time max (a pure tie is not an improvement)', () => {
      const series = [run(20, 18, 2), run(20, 18, 0)]
      expect(isCbatNewBest(series, { bestScore: 20, bestTime: 18 }, timed)).toBe(false)
    })

    it('celebrates a faster max', () => {
      const series = [run(20, 18, 2), run(20, 15, 0)]
      expect(isCbatNewBest(series, { bestScore: 20, bestTime: 15 }, timed)).toBe(true)
    })
  })

  // The series is capped at a recent window; allTimeBest still knows about an older record beyond it,
  // so a run that beats everything visible but not the real record is correctly rejected.
  it('rejects a run that beats the window but not the older all-time record', () => {
    const series = [run(16, 30, 2), run(20, 19, 0)]   // window has no earlier 20
    expect(isCbatNewBest(series, { bestScore: 20, bestTime: 12 }, timed)).toBe(false)
  })

  describe('lower-is-better games (fewer rotations wins)', () => {
    const lower = { hideTime: false, lowerIsBetter: true }
    it('celebrates a lower score', () => {
      const series = [run(30, 40, 2), run(20, 35, 0)]
      expect(isCbatNewBest(series, { bestScore: 20, bestTime: 35 }, lower)).toBe(true)
    })
    it('does not celebrate a higher score', () => {
      const series = [run(20, 35, 2), run(30, 30, 0)]
      expect(isCbatNewBest(series, { bestScore: 20, bestTime: 35 }, lower)).toBe(false)
    })
  })

  describe('hideTime games (no time tiebreaker)', () => {
    const noTime = { hideTime: true, lowerIsBetter: false }
    it('celebrates a new high score', () => {
      const series = [run(38, 12, 2), run(40, 20, 0)]
      expect(isCbatNewBest(series, { bestScore: 40, bestTime: 20 }, noTime)).toBe(true)
    })
    it('does not re-celebrate matching the max, regardless of time', () => {
      const series = [run(40, 12, 2), run(40, 9, 0)]   // faster, but time is not a factor here
      expect(isCbatNewBest(series, { bestScore: 40, bestTime: 9 }, noTime)).toBe(false)
    })
  })

  it('returns null when it cannot decide (no series or no record yet)', () => {
    expect(isCbatNewBest(null, { bestScore: 10, bestTime: 5 }, timed)).toBeNull()
    expect(isCbatNewBest([], { bestScore: 10, bestTime: 5 }, timed)).toBeNull()
    expect(isCbatNewBest([run(10, 5, 0)], null, timed)).toBeNull()
  })
})
