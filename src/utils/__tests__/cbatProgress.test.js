import { describe, it, expect } from 'vitest'
import { cbatTrend } from '../cbatProgress'

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
