import { describe, it, expect } from 'vitest'
import { generateDadQuestion, vecToCompass } from '../dadGenerator'

// Deterministic PRNG so each case is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

describe('vecToCompass', () => {
  it('maps clean vectors to 8-point compass names', () => {
    expect(vecToCompass(0, 1)).toBe('N')
    expect(vecToCompass(3, 3)).toBe('NE')
    expect(vecToCompass(5, 0)).toBe('E')
    expect(vecToCompass(2, -2)).toBe('SE')
    expect(vecToCompass(0, -4)).toBe('S')
    expect(vecToCompass(-1, -1)).toBe('SW')
    expect(vecToCompass(-9, 0)).toBe('W')
    expect(vecToCompass(-6, 6)).toBe('NW')
  })
})

describe('generateDadQuestion', () => {
  it('is deterministic for a given seed', () => {
    const a = generateDadQuestion(5, mulberry32(42))
    const b = generateDadQuestion(5, mulberry32(42))
    expect(a).toEqual(b)
  })

  it('always yields a clean, non-origin endpoint and a correct answer', () => {
    for (let seed = 1; seed <= 500; seed++) {
      for (const legCount of [2, 3, 4, 5, 6]) {
        const q = generateDadQuestion(legCount, mulberry32(seed))
        const [x, y] = q.end

        // Endpoint is never the origin.
        expect(x === 0 && y === 0).toBe(false)

        // Endpoint is axis-aligned OR a perfect diagonal (so the compass is clean).
        const clean = x === 0 || y === 0 || Math.abs(x) === Math.abs(y)
        expect(clean).toBe(true)

        // The labelled answer is the direction of the final position as seen
        // from the start = compass of the endpoint vector.
        expect(q.answer).toBe(vecToCompass(x, y))
        expect(COMPASS).toContain(q.answer)
      }
    }
  })

  it('honours the requested leg count and path length', () => {
    for (const legCount of [2, 3, 4, 5, 6]) {
      const q = generateDadQuestion(legCount, mulberry32(legCount * 7))
      expect(q.legs).toHaveLength(legCount)
      expect(q.path).toHaveLength(legCount + 1)
    }
  })

  it('words the first leg absolutely and the rest as relative turns', () => {
    const q = generateDadQuestion(5, mulberry32(99))
    expect(q.legs[0].turn).toBe('start')
    for (let i = 1; i < q.legs.length; i++) {
      expect(['left', 'right']).toContain(q.legs[i].turn)
    }
    expect(q.prose).toMatch(/sets out heading (North|East|South|West)/)
    expect(q.prose).toMatch(/turns (left|right)/)
  })

  it('offers exactly 4 unique options including the answer', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const q = generateDadQuestion(5, mulberry32(seed))
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options).toContain(q.answer)
      q.options.forEach(o => expect(COMPASS).toContain(o))
    }
  })
})
