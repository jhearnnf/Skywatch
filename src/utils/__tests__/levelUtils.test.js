import { describe, it, expect } from 'vitest'
import { getLevelInfo, getLevelNumber } from '../levelUtils'

const LEVELS = [
  { levelNumber: 1,  airstarsToNextLevel: 100,  cumulativeAirstars: 0     },
  { levelNumber: 2,  airstarsToNextLevel: 250,  cumulativeAirstars: 100   },
  { levelNumber: 3,  airstarsToNextLevel: 500,  cumulativeAirstars: 350   },
  { levelNumber: 4,  airstarsToNextLevel: 850,  cumulativeAirstars: 850   },
  { levelNumber: 5,  airstarsToNextLevel: 1300, cumulativeAirstars: 1700  },
  { levelNumber: 6,  airstarsToNextLevel: 1850, cumulativeAirstars: 3000  },
  { levelNumber: 7,  airstarsToNextLevel: 2500, cumulativeAirstars: 4850  },
  { levelNumber: 8,  airstarsToNextLevel: 3250, cumulativeAirstars: 7350  },
  { levelNumber: 9,  airstarsToNextLevel: 4100, cumulativeAirstars: 10600 },
  { levelNumber: 10, airstarsToNextLevel: null,  cumulativeAirstars: 14700 },
]

// ── getLevelInfo ───────────────────────────────────────────────────────────────

describe('getLevelInfo', () => {
  it('returns null when levels is null', () => {
    expect(getLevelInfo(100, null)).toBeNull()
  })

  it('returns null when levels is empty', () => {
    expect(getLevelInfo(100, [])).toBeNull()
  })

  it('returns null when levels is undefined', () => {
    expect(getLevelInfo(100, undefined)).toBeNull()
  })

  it('0 coins → level 1, 0 progress', () => {
    const info = getLevelInfo(0, LEVELS)
    expect(info.level).toBe(1)
    expect(info.progress).toBe(0)
    expect(info.coinsInLevel).toBe(0)
    expect(info.coinsNeeded).toBe(100)
  })

  it('50 coins → level 1, 50% progress', () => {
    const info = getLevelInfo(50, LEVELS)
    expect(info.level).toBe(1)
    expect(info.progress).toBe(50)
    expect(info.coinsInLevel).toBe(50)
    expect(info.coinsNeeded).toBe(100)
  })

  it('99 coins → level 1, 99% progress', () => {
    const info = getLevelInfo(99, LEVELS)
    expect(info.level).toBe(1)
    expect(info.progress).toBe(99)
    expect(info.coinsInLevel).toBe(99)
  })

  it('exactly 100 coins → level 2, 0% progress', () => {
    const info = getLevelInfo(100, LEVELS)
    expect(info.level).toBe(2)
    expect(info.progress).toBe(0)
    expect(info.coinsInLevel).toBe(0)
    expect(info.coinsNeeded).toBe(250)
  })

  it('101 coins → level 2, tiny progress', () => {
    const info = getLevelInfo(101, LEVELS)
    expect(info.level).toBe(2)
    expect(info.coinsInLevel).toBe(1)
    expect(info.coinsNeeded).toBe(250)
  })

  it('exactly at level 5 boundary (1700) → level 5, 0% progress', () => {
    const info = getLevelInfo(1700, LEVELS)
    expect(info.level).toBe(5)
    expect(info.progress).toBe(0)
    expect(info.coinsInLevel).toBe(0)
    expect(info.coinsNeeded).toBe(1300)
  })

  it('one below level 5 boundary (1699) → level 4', () => {
    const info = getLevelInfo(1699, LEVELS)
    expect(info.level).toBe(4)
    expect(info.coinsInLevel).toBe(849)
    expect(info.coinsNeeded).toBe(850)
  })

  it('exactly at max level (14700) → level 10, 100% progress', () => {
    const info = getLevelInfo(14700, LEVELS)
    expect(info.level).toBe(10)
    expect(info.progress).toBe(100)
    expect(info.coinsNeeded).toBeNull()
  })

  it('above max level → still level 10, 100% progress', () => {
    const info = getLevelInfo(20000, LEVELS)
    expect(info.level).toBe(10)
    expect(info.progress).toBe(100)
  })

  it('levelObj returns the full level object', () => {
    const info = getLevelInfo(500, LEVELS)
    expect(info.level).toBe(3)
    expect(info.levelObj).toEqual(LEVELS[2])
    expect(info.levelObj.cumulativeAirstars).toBe(350)
  })
})

// ── getLevelNumber ─────────────────────────────────────────────────────────────

describe('getLevelNumber', () => {
  it('returns 1 when levels is null', () => {
    expect(getLevelNumber(5000, null)).toBe(1)
  })

  it('returns 1 when levels is empty', () => {
    expect(getLevelNumber(5000, [])).toBe(1)
  })

  it('0 coins → level 1', () => {
    expect(getLevelNumber(0, LEVELS)).toBe(1)
  })

  it('100 coins → level 2', () => {
    expect(getLevelNumber(100, LEVELS)).toBe(2)
  })

  it('14700 coins → level 10', () => {
    expect(getLevelNumber(14700, LEVELS)).toBe(10)
  })

  it('above max → level 10', () => {
    expect(getLevelNumber(99999, LEVELS)).toBe(10)
  })

  it('one below threshold → previous level', () => {
    expect(getLevelNumber(349, LEVELS)).toBe(2)
    expect(getLevelNumber(350, LEVELS)).toBe(3)
  })
})
