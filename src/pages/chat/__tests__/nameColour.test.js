import { describe, it, expect } from 'vitest'
import { nameColour, PALETTE } from '../nameColour'

describe('nameColour', () => {
  it('is stable for the same user', () => {
    // The whole point: a colour that changed between polls would be worse than
    // no colour at all.
    const id = '507f1f77bcf86cd799439011'
    expect(nameColour(id)).toBe(nameColour(id))
  })

  it('always returns a palette colour', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(PALETTE).toContain(nameColour(`507f1f77bcf86cd7994390${i}`))
    }
  })

  it('spreads consecutive ObjectIds across the palette', () => {
    // ObjectIds issued together share a long prefix, which a naive charCode sum
    // maps to a handful of buckets — a channel where everyone is the same
    // colour. FNV-1a should use most of the palette.
    const ids = Array.from({ length: 60 }, (_, i) =>
      `507f1f77bcf86cd7994390${String(i).padStart(2, '0')}`)
    const used = new Set(ids.map(nameColour))
    expect(used.size).toBeGreaterThanOrEqual(PALETTE.length - 2)
  })

  it('falls back to a neutral colour for a missing id', () => {
    expect(nameColour(null)).toBe('#94a3b8')
    expect(nameColour(undefined)).toBe('#94a3b8')
  })

  it('accepts a non-string id without throwing', () => {
    expect(PALETTE).toContain(nameColour({ toString: () => 'abc123' }))
  })
})
