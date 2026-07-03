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
const CARDINALS = ['N', 'E', 'S', 'W']

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
    for (const diagonals of [false, true]) {
      for (let seed = 1; seed <= 500; seed++) {
        for (const legCount of [2, 3, 4, 5, 6]) {
          const q = generateDadQuestion(legCount, mulberry32(seed), { diagonals })
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
    expect(q.prose).toMatch(/sets out heading (North|North-East|East|South-East|South|South-West|West|North-West)/)
    // Default (8-point) mode states an angle on every turn.
    expect(q.prose).toMatch(/turns (left|right) (45|90)°/)
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

  // ── First-half (cardinal-only) mode ────────────────────────────────────────
  describe('with diagonals disabled', () => {
    it('uses only cardinal headings and 90° turns', () => {
      for (let seed = 1; seed <= 300; seed++) {
        const q = generateDadQuestion(5, mulberry32(seed), { diagonals: false })
        q.legs.forEach(leg => {
          expect(CARDINALS).toContain(leg.dirName)
          expect(leg.deg === 0 || leg.deg === 90).toBe(true)
        })
        // Original wording: no angle stated on turns.
        expect(q.prose).not.toMatch(/°/)
      }
    })

    it('keeps every stated distance a clean multiple of 100', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const q = generateDadQuestion(6, mulberry32(seed), { diagonals: false })
        q.legs.forEach(leg => expect(leg.miles % 100).toBe(0))
      }
    })
  })

  // ── Second-half (8-point) mode ─────────────────────────────────────────────
  describe('with diagonals enabled', () => {
    it('every movement leg before the final corrective one may be diagonal, but the last is cardinal', () => {
      // The corrective leg must be cardinal for the clean-answer guarantee.
      for (let seed = 1; seed <= 300; seed++) {
        const q = generateDadQuestion(5, mulberry32(seed), { diagonals: true })
        const last = q.legs[q.legs.length - 1]
        expect(CARDINALS).toContain(last.dirName)
        // Every turn states its angle (45° or 90°); the start leg does not.
        for (let i = 1; i < q.legs.length; i++) {
          expect(q.prose).toMatch(new RegExp(`turns (left|right) ${q.legs[i].deg}°`))
          expect([45, 90]).toContain(q.legs[i].deg)
        }
      }
    })

    it('introduces intercardinal headings and 45° turns across seeds', () => {
      let sawDiagonalHeading = false
      let saw45Turn = false
      for (let seed = 1; seed <= 300 && !(sawDiagonalHeading && saw45Turn); seed++) {
        const q = generateDadQuestion(5, mulberry32(seed), { diagonals: true })
        q.legs.forEach(leg => {
          if (!CARDINALS.includes(leg.dirName)) sawDiagonalHeading = true
          if (leg.deg === 45) saw45Turn = true
        })
      }
      expect(sawDiagonalHeading).toBe(true)
      expect(saw45Turn).toBe(true)
    })

    it('scales diagonal-leg distances by ~√2 relative to unit steps', () => {
      // A diagonal leg spanning `d` unit steps moves (±d, ±d); its stated miles
      // should be ≈ d·100·√2 (rounded to 10), i.e. longer than a cardinal leg.
      const q = generateDadQuestion(6, mulberry32(7), { diagonals: true })
      q.legs.forEach((leg, i) => {
        const [dx, dy] = [q.path[i + 1][0] - q.path[i][0], q.path[i + 1][1] - q.path[i][1]]
        const steps = Math.max(Math.abs(dx), Math.abs(dy))
        const diagonal = Math.abs(dx) === Math.abs(dy) && dx !== 0
        const expected = Math.round((diagonal ? steps * Math.SQRT2 : steps) * 100 / 10) * 10
        expect(leg.miles).toBe(expected)
      })
    })
  })
})
