import { describe, expect, it } from 'vitest'
import { clockMinuteParts } from '../../../utils/cbat/antVisualBreakdown'

describe('ANT visual clock working', () => {
  it('splits the example journey at the hour instead of subtracting HHMM as a decimal', () => {
    expect(clockMinuteParts(14 * 60 + 55, 15 * 60 + 32)).toEqual([
      { from: 895, to: 900, minutes: 5 },
      { from: 900, to: 932, minutes: 32 },
    ])
  })

  it('handles journeys spanning several whole hours', () => {
    expect(clockMinuteParts(10 * 60 + 45, 13 * 60 + 10).map(p => p.minutes)).toEqual([15, 60, 60, 10])
  })

  it('keeps a journey within one hour as one simple chunk', () => {
    expect(clockMinuteParts(8 * 60 + 5, 8 * 60 + 42).map(p => p.minutes)).toEqual([37])
  })
})
