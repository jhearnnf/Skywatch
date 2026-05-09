import { describe, it, expect } from 'vitest'
import {
  CALLSIGNS,
  pickCallsigns,
  isValidDistractor,
  generateDistractorCallsign,
  buildAvoidSequence,
} from '../actAudio'

describe('CALLSIGNS pool', () => {
  it('has 6 callsigns including hotel', () => {
    expect(CALLSIGNS).toHaveLength(6)
    expect(CALLSIGNS).toContain('hotel')
  })
})

describe('pickCallsigns', () => {
  it('returns the requested count of distinct callsigns', () => {
    for (let i = 0; i < 50; i++) {
      const set = pickCallsigns(3)
      expect(set).toHaveLength(3)
      expect(new Set(set).size).toBe(3)
      for (const c of set) expect(CALLSIGNS).toContain(c)
    }
  })
})

describe('isValidDistractor — 2-callsign rounds', () => {
  const userSet = ['bravo', 'echo']

  it('rejects exact same set in same order', () => {
    expect(isValidDistractor(['bravo', 'echo'], userSet)).toBe(false)
  })

  it('rejects reordered same set', () => {
    expect(isValidDistractor(['echo', 'bravo'], userSet)).toBe(false)
  })

  it('rejects 50% overlap (one matching)', () => {
    expect(isValidDistractor(['bravo', 'alpha'], userSet)).toBe(false)
    expect(isValidDistractor(['echo', 'delta'], userSet)).toBe(false)
  })

  it('accepts 100% different (no overlap)', () => {
    expect(isValidDistractor(['alpha', 'delta'], userSet)).toBe(true)
    expect(isValidDistractor(['charlie', 'hotel'], userSet)).toBe(true)
  })
})

describe('isValidDistractor — 3-callsign rounds', () => {
  const userSet = ['bravo', 'echo', 'charlie']

  it('rejects exact same set', () => {
    expect(isValidDistractor(['bravo', 'echo', 'charlie'], userSet)).toBe(false)
  })

  it('rejects any reordering of same set', () => {
    expect(isValidDistractor(['echo', 'charlie', 'bravo'], userSet)).toBe(false)
    expect(isValidDistractor(['charlie', 'bravo', 'echo'], userSet)).toBe(false)
  })

  it('rejects 2/3 overlap (only 33% different)', () => {
    expect(isValidDistractor(['bravo', 'echo', 'alpha'], userSet)).toBe(false)
  })

  it('accepts 1/3 overlap (66.7% different)', () => {
    expect(isValidDistractor(['bravo', 'alpha', 'delta'], userSet)).toBe(true)
    expect(isValidDistractor(['echo', 'hotel', 'delta'], userSet)).toBe(true)
  })

  it('accepts 0% overlap (100% different)', () => {
    expect(isValidDistractor(['alpha', 'delta', 'hotel'], userSet)).toBe(true)
  })
})

describe('generateDistractorCallsign', () => {
  it('always returns a valid distractor for 2-callsign user sets', () => {
    const userSet = ['bravo', 'echo']
    for (let i = 0; i < 100; i++) {
      const d = generateDistractorCallsign(userSet)
      expect(d).not.toBeNull()
      expect(isValidDistractor(d, userSet)).toBe(true)
    }
  })

  it('always returns a valid distractor for 3-callsign user sets', () => {
    const userSet = ['bravo', 'echo', 'charlie']
    for (let i = 0; i < 100; i++) {
      const d = generateDistractorCallsign(userSet)
      expect(d).not.toBeNull()
      expect(isValidDistractor(d, userSet)).toBe(true)
    }
  })
})

describe('buildAvoidSequence', () => {
  it('builds 2-callsign + combined avoid+shape clip', () => {
    expect(buildAvoidSequence(['bravo', 'echo'], 'circle'))
      .toEqual(['bravo', 'echo', 'avoid_the_next_circle'])
  })

  it('builds 3-callsign + combined avoid+shape clip (square)', () => {
    expect(buildAvoidSequence(['bravo', 'echo', 'hotel'], 'square'))
      .toEqual(['bravo', 'echo', 'hotel', 'avoid_the_next_square'])
  })
})
