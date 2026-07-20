import { describe, it, expect } from 'vitest'
import {
  ADMIN_ROUND_CHEATS,
  CHEAT_IDLE_MS,
  emptyCheatBuffer,
  pushCheatDigit,
} from '../actRoundCheat'

// Type a string of digits in quick succession, returning the last result.
function type(keys, { start = 1000, gap = 100, buffer = emptyCheatBuffer() } = {}) {
  let now = start
  let result = { buffer, round: null }
  for (const key of keys) {
    result = pushCheatDigit(result.buffer, key, now)
    now += gap
  }
  return result
}

describe('ADMIN_ROUND_CHEATS', () => {
  it('covers all five ACT rounds, DPT-style', () => {
    expect(ADMIN_ROUND_CHEATS).toEqual({ 111: 1, 222: 2, 333: 3, 444: 4, 555: 5 })
  })
})

describe('pushCheatDigit', () => {
  it('matches a repeated triple to its round', () => {
    expect(type('111').round).toBe(1)
    expect(type('333').round).toBe(3)
    expect(type('555').round).toBe(5)
  })

  it('reports no round until the third digit', () => {
    const first = pushCheatDigit(emptyCheatBuffer(), '2', 1000)
    expect(first.round).toBeNull()
    const second = pushCheatDigit(first.buffer, '2', 1100)
    expect(second.round).toBeNull()
    expect(pushCheatDigit(second.buffer, '2', 1200).round).toBe(2)
  })

  it('clears the buffer on a match so digits are not reused', () => {
    const matched = type('111')
    expect(matched.buffer).toEqual(emptyCheatBuffer())
    // A single further '1' must not re-trigger off the old digits.
    expect(pushCheatDigit(matched.buffer, '1', 1400).round).toBeNull()
  })

  it('slides over a longer run of digits', () => {
    // 9,4,4,4 — the trailing 444 still matches.
    expect(type('9444').round).toBe(4)
  })

  it('ignores non-matching triples', () => {
    expect(type('123').round).toBeNull()
    expect(type('666').round).toBeNull()   // ACT has five rounds, DPT's 666 does not apply
    expect(type('000').round).toBeNull()
  })

  it('starts a fresh code after an idle gap', () => {
    const a = pushCheatDigit(emptyCheatBuffer(), '1', 1000)
    const b = pushCheatDigit(a.buffer, '1', 1000 + CHEAT_IDLE_MS + 1)   // stale — restarts
    expect(b.buffer.digits).toBe('1')
    expect(pushCheatDigit(b.buffer, '1', 1000 + CHEAT_IDLE_MS + 100).round).toBeNull()
  })

  it('ignores non-digit keys without disturbing the buffer', () => {
    const a = type('11')
    for (const key of ['a', 'Enter', 'ArrowLeft', 'Shift', '', undefined]) {
      const r = pushCheatDigit(a.buffer, key, 1300)
      expect(r.round).toBeNull()
      expect(r.buffer).toBe(a.buffer)
    }
    // The pending "11" is intact, so the next 1 still completes the code.
    expect(pushCheatDigit(a.buffer, '1', 1300).round).toBe(1)
  })
})
