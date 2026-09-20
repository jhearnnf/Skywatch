// Guards the mobile width budget for the leaderboard's Agent column.
//
// Agent is the `1fr` column, so it only gets whatever the fixed columns leave
// behind. The desktop widths (3rem rank + 5rem score + 4rem plays) squeeze it
// to ~10 characters on a 360px phone, which truncates display names and even
// "Agent 1234". These tests fail if the fixed columns are widened for mobile
// again without a separate `sm:` override.

import { describe, it, expect } from 'vitest'
import { iconTrackCount, rowCols, rowPad } from '../LeaderboardRow'

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
  // 6 ("12.34s"), where weekly's Plays is only ever 1-2 digits. Every board
  // carries the Theme column, a 2.5rem icon-only track, so it is in every
  // budget; the Input column (steered games only) is the same kind of track
  // and widens the budget by exactly that much, not more. Rank is 2rem: the
  // list is a top 20, so "#20" is the widest rank a list row ever holds.
  it.each([
    ['weekly', 'weekly', cfg, 10],
    ['all-time', 'alltime', cfg, 11.5],
    ['all-time without the Time column', 'alltime', { hideTime: true }, 8],
    ['weekly with Input', 'weekly', { ...cfg, showInput: true }, 12.5],
    ['all-time with Input', 'alltime', { ...cfg, showInput: true }, 14],
    ['all-time without Time, with Input', 'alltime', { hideTime: true, showInput: true }, 10.5],
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

  // The icon tracks exist only where there's room for them — the compact
  // variant (the post-game chase window) is already fighting for width, so it
  // carries neither Input nor Theme.
  it('ignores showInput on the compact variant', () => {
    expect(rowCols('weekly', { ...cfg, showInput: true }, true)).toBe(rowCols('weekly', cfg, true))
  })

  it('drops the Theme track on the compact variant', () => {
    expect(iconTrackCount(cfg, true)).toBe(0)
    expect(iconTrackCount({ ...cfg, showInput: true }, true)).toBe(0)
    expect(trackCounts(rowCols('weekly', cfg, true))).toEqual([4])
  })

  // Sum of tracks per bracket ("grid-cols-[...]" appears twice: the unprefixed
  // base and the sm: override), so this catches a track added to one but not
  // the other.
  const trackCounts = (classes) =>
    classes.match(/grid-cols-\[([^\]]+)\]/g).map(g => g.replace(/^grid-cols-\[|\]$/, '').split('_').length)

  it('adds exactly one extra track (mobile and sm:) when showInput is set', () => {
    for (const variant of ['weekly', 'alltime']) {
      for (const c of [cfg, { hideTime: true }]) {
        const base = trackCounts(rowCols(variant, c))
        const withInput = trackCounts(rowCols(variant, { ...c, showInput: true }))
        expect(withInput).toEqual(base.map(n => n + 1))
      }
    }
  })

  // The Theme track is on every non-compact board: one icon track by default,
  // two with Input, in both the base and the sm: bracket.
  it('always carries the Theme track outside compact mode', () => {
    expect(iconTrackCount(cfg)).toBe(1)
    expect(iconTrackCount({ ...cfg, showInput: true })).toBe(2)
    expect(trackCounts(rowCols('weekly', cfg))).toEqual([5, 5])
    expect(trackCounts(rowCols('alltime', cfg))).toEqual([5, 5])
    expect(trackCounts(rowCols('alltime', { hideTime: true }))).toEqual([4, 4])
    expect(trackCounts(rowCols('alltime', { hideTime: true, showInput: true }))).toEqual([5, 5])
  })
})

// Tailwind emits CSS only for class names it can find written out in the
// source. A rowCols variant assembled from a template literal returns a class
// with no rule behind it, and the board silently collapses into one column
// (that happened when the Input column was added). Every string rowCols can
// return must therefore exist verbatim in LeaderboardRow.jsx.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

describe('rowCols classes are literal in the source', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'LeaderboardRow.jsx'), 'utf8')
  const configs = [
    {}, { hideTime: true }, { showInput: true }, { hideTime: true, showInput: true },
  ]
  it.each(['weekly', 'alltime'])('every %s variant is written out in full', (variant) => {
    for (const c of configs) {
      for (const compact of [false, true]) {
        for (const cls of rowCols(variant, c, compact).split(' ')) {
          expect(source).toContain(cls)
        }
      }
    }
  })
})
