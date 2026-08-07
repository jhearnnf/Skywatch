import { describe, it, expect } from 'vitest'
import { parseRoundParam } from '../adminRoundParam'

// The parser is the security-relevant half: everything downstream trusts the
// number it returns to index a rounds array and to move a live game's cursor.
describe('parseRoundParam', () => {
  it('reads a round in range', () => {
    expect(parseRoundParam('?round=5', 8)).toBe(5)
    expect(parseRoundParam('round=5', 8)).toBe(5)
  })

  it('accepts both ends of the range', () => {
    expect(parseRoundParam('?round=1', 8)).toBe(1)
    expect(parseRoundParam('?round=8', 8)).toBe(8)
  })

  it('returns null when the parameter is absent', () => {
    expect(parseRoundParam('', 8)).toBeNull()
    expect(parseRoundParam('?mode=3d', 8)).toBeNull()
    expect(parseRoundParam(undefined, 8)).toBeNull()
  })

  it('rejects rounds past the end of the game', () => {
    expect(parseRoundParam('?round=9', 8)).toBeNull()
    expect(parseRoundParam('?round=999', 8)).toBeNull()
  })

  it('rejects zero and negatives', () => {
    expect(parseRoundParam('?round=0', 8)).toBeNull()
    expect(parseRoundParam('?round=-1', 8)).toBeNull()
  })

  // Number() would take every one of these and hand back something that looks
  // like a round. setCurrentIdx(5.9 - 1) indexes an array with 4.9.
  it('rejects anything that is not plain digits', () => {
    for (const bad of ['5.9', '0x5', '1e1', ' 5 ', '5px', 'five', '', '+5', 'Infinity', 'NaN']) {
      expect(parseRoundParam(`?round=${bad}`, 8)).toBeNull()
    }
  })

  it('honours each game\'s own round count', () => {
    expect(parseRoundParam('?round=12', 15)).toBe(12)   // Symbols
    expect(parseRoundParam('?round=12', 8)).toBeNull()  // Visualisation
    expect(parseRoundParam('?round=6', 5)).toBeNull()   // ACT / Trace 1
  })

  it('takes the first value when the parameter is repeated', () => {
    expect(parseRoundParam('?round=3&round=7', 8)).toBe(3)
  })
})
