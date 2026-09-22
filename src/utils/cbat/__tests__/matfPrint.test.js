import { describe, it, expect, beforeEach } from 'vitest'
import { buildMatfRun, mulberry32, buildMatfGrid, buildMatfSheet } from '../matfGenerator'
import { MATF_TUNING } from '../matfDifficulty'
import {
  matfRunSeed, matfSheetCode, matfPrintoutShape,
  readMatfPrintouts, recordMatfPrintout, clearMatfPrintouts,
  MATF_PRINTOUT_LIMIT,
} from '../matfPrint'

describe('buildMatfRun', () => {
  it('rebuilds the identical grid and wind sheet from the same seed', () => {
    // The load-bearing property of the whole printing feature. A player prints
    // a sheet, comes back a fortnight later and picks it off the rail; if this
    // ever stops holding, the numbers on the paper and the numbers the test is
    // asking about are different, and the run is unplayable in a way that looks
    // like the player's fault.
    for (const tuning of [MATF_TUNING.easier, MATF_TUNING.hard]) {
      for (const seed of [0, 1, 42, 999983, 0xFFFFFFFF]) {
        const a = buildMatfRun(tuning, seed)
        const b = buildMatfRun(tuning, seed)
        expect(a.grid).toEqual(b.grid)
        expect(a.sheet).toEqual(b.sheet)
      }
    }
  })

  it('builds the grid BEFORE the sheet, off one rng', () => {
    // Pinning the order, not the values. Split these onto two rngs — or swap
    // them — and every printout anyone is holding stops matching the run it
    // rebuilds, silently, with no error anywhere.
    const tuning = MATF_TUNING.hard
    const rng = mulberry32(2026)
    const grid = buildMatfGrid(tuning.gridExtent, rng)
    const sheet = buildMatfSheet(tuning, rng)
    expect(buildMatfRun(tuning, 2026)).toEqual({ grid, sheet })
  })

  it('gives different seeds different numbers', () => {
    const a = buildMatfRun(MATF_TUNING.hard, 1)
    const b = buildMatfRun(MATF_TUNING.hard, 2)
    expect(a.grid.cells).not.toEqual(b.grid.cells)
  })

  it('still produces a symmetric grid when seeded', () => {
    // The "either way round" shortcut is the one real technique for part one
    // and the intro tells players to use it. A seeded run is still a run.
    const { grid } = buildMatfRun(MATF_TUNING.hard, 7)
    for (let r = 0; r < grid.cells.length; r++) {
      for (let c = 0; c < grid.cells.length; c++) {
        expect(grid.cells[r][c]).toBe(grid.cells[c][r])
      }
    }
  })
})

describe('matfRunSeed', () => {
  it('is a whole 32-bit number', () => {
    expect(matfRunSeed(() => 0)).toBe(0)
    expect(matfRunSeed(() => 0.9999999)).toBeLessThanOrEqual(0xFFFFFFFF)
    for (let i = 0; i < 50; i++) {
      const s = matfRunSeed()
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(0xFFFFFFFF)
    }
  })
})

describe('matfSheetCode', () => {
  it('is six stable hex characters', () => {
    expect(matfSheetCode(0)).toBe('000000')
    expect(matfSheetCode(0xABCDEF)).toBe('ABCDEF')
    // Only the low six digits — the code is a label on a piece of paper, not a
    // key, and nothing is ever looked up by it.
    expect(matfSheetCode(0x12ABCDEF)).toBe('ABCDEF')
  })
})

describe('matfPrintoutShape', () => {
  it('names the board and the shape of the sheet', () => {
    expect(matfPrintoutShape('hard')).toBe('Hard · ±17 grid · 5 tables')
    expect(matfPrintoutShape('easier')).toBe('Easier · ±8 grid · 3 tables')
  })
})

describe('the saved-sheets store', () => {
  beforeEach(() => { clearMatfPrintouts() })

  it('keeps the newest first', () => {
    recordMatfPrintout({ seed: 1, difficulty: 'hard' }, 1000)
    recordMatfPrintout({ seed: 2, difficulty: 'easier' }, 2000)
    expect(readMatfPrintouts().map(e => e.seed)).toEqual([2, 1])
  })

  it('moves a reprinted sheet back to the top instead of duplicating it', () => {
    recordMatfPrintout({ seed: 1, difficulty: 'hard' }, 1000)
    recordMatfPrintout({ seed: 2, difficulty: 'hard' }, 2000)
    recordMatfPrintout({ seed: 1, difficulty: 'hard' }, 3000)
    const kept = readMatfPrintouts()
    expect(kept.map(e => e.seed)).toEqual([1, 2])
    expect(kept[0].printedAt).toBe(3000)
  })

  it('keeps only the last few', () => {
    for (let i = 1; i <= MATF_PRINTOUT_LIMIT + 3; i++) {
      recordMatfPrintout({ seed: i, difficulty: 'hard' }, i * 100)
    }
    const kept = readMatfPrintouts()
    expect(kept).toHaveLength(MATF_PRINTOUT_LIMIT)
    expect(kept[0].seed).toBe(MATF_PRINTOUT_LIMIT + 3)
  })

  it('stores the difficulty, because the seed alone cannot rebuild a run', () => {
    // buildMatfRun takes a tuning as well as a seed — the grid extent and the
    // sheet shape come from the board, not the seed.
    recordMatfPrintout({ seed: 5, difficulty: 'easier' }, 1000)
    expect(readMatfPrintouts()[0].difficulty).toBe('easier')
  })

  it('drops malformed entries rather than repairing them', () => {
    // A half-valid entry rebuilds a run that is NOT the one on the player's
    // sheet, which is worse than not offering the replay at all.
    localStorage.setItem('sw_cbat_matf_printouts', JSON.stringify([
      { seed: 1, difficulty: 'hard', printedAt: 1000 },
      { seed: 2, difficulty: 'impossible', printedAt: 2000 },
      { seed: 'three', difficulty: 'hard', printedAt: 3000 },
      { seed: 4, difficulty: 'hard' },
      null,
    ]))
    expect(readMatfPrintouts().map(e => e.seed)).toEqual([1])
  })

  it('survives junk in storage', () => {
    localStorage.setItem('sw_cbat_matf_printouts', 'not json')
    expect(readMatfPrintouts()).toEqual([])
    localStorage.setItem('sw_cbat_matf_printouts', '{"seed":1}')
    expect(readMatfPrintouts()).toEqual([])
  })

  it('refuses to record a sheet it could not rebuild', () => {
    recordMatfPrintout({ seed: 9, difficulty: 'nonsense' }, 1000)
    expect(readMatfPrintouts()).toEqual([])
  })
})
