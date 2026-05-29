import { describe, it, expect } from 'vitest'
import { isCbatGameEnabled } from '../isCbatGameEnabled'

describe('isCbatGameEnabled', () => {
  it('returns true when the key is missing (default-enabled)', () => {
    expect(isCbatGameEnabled({}, 'angles')).toBe(true)
  })

  it('returns false when the key is explicitly disabled', () => {
    expect(isCbatGameEnabled({ angles: false }, 'angles')).toBe(false)
  })

  it('plane-turn alias: enabled if any of 2d, 3d or trace-1 is enabled', () => {
    const allOff = { 'plane-turn-2d': false, 'plane-turn-3d': false, 'trace-1': false }
    expect(isCbatGameEnabled(allOff, 'plane-turn')).toBe(false)
    expect(isCbatGameEnabled({ ...allOff, 'plane-turn-3d': true }, 'plane-turn')).toBe(true)
    expect(isCbatGameEnabled({ ...allOff, 'plane-turn-2d': true }, 'plane-turn')).toBe(true)
    expect(isCbatGameEnabled({ ...allOff, 'trace-1': true }, 'plane-turn')).toBe(true)
    expect(isCbatGameEnabled({}, 'plane-turn')).toBe(true)
  })

  it('visualisation alias: enabled if either 2d or 3d is enabled', () => {
    expect(isCbatGameEnabled({ 'visualisation-2d': false, 'visualisation-3d': false }, 'visualisation')).toBe(false)
    expect(isCbatGameEnabled({ 'visualisation-2d': false, 'visualisation-3d': true  }, 'visualisation')).toBe(true)
    expect(isCbatGameEnabled({ 'visualisation-2d': true,  'visualisation-3d': false }, 'visualisation')).toBe(true)
    expect(isCbatGameEnabled({}, 'visualisation')).toBe(true)
  })

  it('handles null cbatGameEnabled gracefully', () => {
    expect(isCbatGameEnabled(null, 'angles')).toBe(true)
    expect(isCbatGameEnabled(undefined, 'visualisation')).toBe(true)
  })
})
