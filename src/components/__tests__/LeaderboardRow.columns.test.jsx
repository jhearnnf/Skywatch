// Guards the mobile width budget for the leaderboard's Agent column.
//
// Agent is the `1fr` column, so it only gets whatever the fixed columns leave
// behind. The desktop widths (3rem rank + 5rem score + 4rem plays) squeeze it
// to ~10 characters on a 360px phone, which truncates display names and even
// "Agent 1234". These tests fail if the fixed columns are widened for mobile
// again without a separate `sm:` override.

import { describe, it, expect } from 'vitest'
import { rowCols, rowPad } from '../LeaderboardRow'

// Sum the rem widths of the non-`1fr` tracks in the base (unprefixed) class.
const mobileFixedRem = (classes) => {
  const base = classes.split(' ').find(c => c.startsWith('grid-cols-['))
  return base
    .replace(/^grid-cols-\[|\]$/g, '')
    .split('_')
    .filter(t => t !== '1fr')
    .reduce((sum, t) => sum + parseFloat(t), 0)
}

const cfg = { hideTime: false }

describe('leaderboard column budget', () => {
  // 360px phone: 22.5rem viewport, less page gutters and the row's own padding
  // leaves roughly 18rem of row, so the fixed columns are what's left to spend.
  // Budgets are per-variant because the columns carry different content — the
  // widest score string is 5 mono characters ("12/40") and the widest time is
  // 6 ("12.34s"), where weekly's Plays is only ever 1-2 digits.
  it.each([
    ['weekly', 'weekly', cfg, 8],
    ['all-time', 'alltime', cfg, 9.5],
    ['all-time without the Time column', 'alltime', { hideTime: true }, 6],
  ])('keeps %s fixed columns within the mobile budget', (_label, variant, c, budget) => {
    expect(mobileFixedRem(rowCols(variant, c))).toBeLessThanOrEqual(budget)
  })

  it('still widens the fixed columns on larger screens', () => {
    for (const c of [cfg, { hideTime: true }]) {
      for (const variant of ['weekly', 'alltime']) {
        expect(rowCols(variant, c)).toMatch(/sm:grid-cols-\[/)
      }
    }
  })

  it('leaves the compact variant unprefixed — it is already phone-sized', () => {
    const compact = rowCols('weekly', cfg, true)
    expect(compact).not.toMatch(/sm:/)
    expect(mobileFixedRem(compact)).toBeLessThanOrEqual(8.5)
  })

  it('pairs narrower padding with the narrower columns on mobile', () => {
    expect(rowPad()).toBe('gap-1.5 px-3 sm:gap-2 sm:px-4')
    expect(rowPad(true)).toBe('gap-1.5 px-2.5')
  })
})
