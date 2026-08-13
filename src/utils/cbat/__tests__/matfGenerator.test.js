import { describe, it, expect } from 'vitest'
import {
  buildMatfGrid, matfGridQuestion, cellAt, axisLabels,
  buildMatfSheet, matfSheetQuestion, sheetValue, windCell, MATF_OPTIONS,
} from '../matfGenerator'
import { MATF_TUNING } from '../matfDifficulty'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shapeOf = (t) => ({ tableCount: t.tableCount, rowCount: t.rowCount, angleCount: t.angleCount })

describe('axisLabels', () => {
  it('runs from −extent to +extent through zero', () => {
    // Straight from the corpus: the grid "runs −17 to +17 on both axes". This
    // was a 1..17 grid until the guide was read back against it, which is a
    // quarter of the real search area and none of the sign handling.
    expect(axisLabels(2)).toEqual([-2, -1, 0, 1, 2])
    expect(axisLabels(17)).toHaveLength(35)
    expect(axisLabels(17)[0]).toBe(-17)
    expect(axisLabels(17).at(-1)).toBe(17)
  })
})

describe('buildMatfGrid', () => {
  it('is symmetric — the value at (a,b) is the value at (b,a)', () => {
    // THE load-bearing property. The corpus's one concrete shortcut for this
    // test is "the intersection value is the same whichever way round you
    // assign the two numbers to the axes". Our intro tells players to use it,
    // so it had better be true here — otherwise we are teaching a habit that
    // will lose them marks on the real thing.
    for (const extent of [MATF_TUNING.easier.gridExtent, MATF_TUNING.hard.gridExtent]) {
      for (let seed = 0; seed < 20; seed++) {
        const grid = buildMatfGrid(extent, mulberry32(seed))
        for (const a of axisLabels(extent)) {
          for (const b of axisLabels(extent)) {
            expect([seed, a, b, cellAt(grid, a, b)]).toEqual([seed, a, b, cellAt(grid, b, a)])
          }
        }
      }
    }
  })

  it('builds an axis of 2·extent + 1 either way', () => {
    const grid = buildMatfGrid(17, mulberry32(1))
    expect(grid.extent).toBe(17)
    expect(grid.cells).toHaveLength(35)
    for (const row of grid.cells) expect(row).toHaveLength(35)
  })

  it('keeps every cell two digits, so the columns do not shift under the eye', () => {
    const grid = buildMatfGrid(17, mulberry32(2))
    for (const row of grid.cells) {
      for (const v of row) {
        expect(v).toBeGreaterThanOrEqual(10)
        expect(v).toBeLessThanOrEqual(99)
      }
    }
  })
})

describe('matfGridQuestion', () => {
  it('answers with the value at the stated intersection, either way round', () => {
    for (let seed = 0; seed < 300; seed++) {
      const grid = buildMatfGrid(17, mulberry32(seed))
      const q = matfGridQuestion(grid, mulberry32(seed + 5000))
      expect([seed, q.answer]).toEqual([seed, cellAt(grid, q.a, q.b)])
      expect([seed, q.answer]).toEqual([seed, cellAt(grid, q.b, q.a)])
    }
  })

  it('offers five distinct options containing the answer', () => {
    // The corpus reports "five numbered options each time".
    for (let seed = 0; seed < 200; seed++) {
      const grid = buildMatfGrid(8, mulberry32(seed))
      const q = matfGridQuestion(grid, mulberry32(seed + 99))
      expect(q.options).toHaveLength(MATF_OPTIONS)
      expect(new Set(q.options).size).toBe(MATF_OPTIONS)
      expect(q.options).toContain(q.answer)
    }
  })

  it('keeps its coordinates on the signed axis, and does use the negative half', () => {
    for (const extent of [8, 17]) {
      let sawNegative = false
      for (let seed = 0; seed < 200; seed++) {
        const q = matfGridQuestion(buildMatfGrid(extent, mulberry32(seed)), mulberry32(seed + 7))
        for (const v of [q.a, q.b]) {
          expect(v).toBeGreaterThanOrEqual(-extent)
          expect(v).toBeLessThanOrEqual(extent)
          if (v < 0) sawNegative = true
        }
      }
      expect([extent, sawNegative]).toEqual([extent, true])
    }
  })
})

describe('windCell', () => {
  it('is the wind triangle, so the sheet is internally consistent', () => {
    // A pure crosswind takes nothing off the ground speed beyond the drift, and
    // drift is zero when the wind is dead ahead or dead astern.
    expect(windCell(180, 30, 90).drift).toBe(10)   // asin(30/180) ≈ 9.6°
    expect(windCell(180, 30, 90).ground).toBe(177) // 180·cos(9.6°)
  })

  it('never produces an impossible drift or a negative ground speed', () => {
    // Guards the pool bounds: air speeds floor at 90 and wind velocities cap at
    // 60, which is what keeps asin's argument under 1 and the ground speed
    // positive. Widening either pool without checking this would break both.
    for (const tuning of Object.values(MATF_TUNING)) {
      const sheet = buildMatfSheet(shapeOf(tuning), mulberry32(3))
      for (const table of sheet.tables) {
        for (const row of table.cells) {
          for (const cell of row) {
            expect(Number.isFinite(cell.drift)).toBe(true)
            expect(cell.drift).toBeGreaterThanOrEqual(0)
            expect(cell.ground).toBeGreaterThan(0)
          }
        }
      }
    }
  })
})

describe('buildMatfSheet / matfSheetQuestion', () => {
  it('builds one table per air speed, all sharing the same rows and columns', () => {
    // Identical layout is the point: the only thing separating the tables is the
    // air speed in the caption, which is what makes step one of the three-step
    // lookup a real step rather than a formality.
    for (const tuning of Object.values(MATF_TUNING)) {
      const sheet = buildMatfSheet(shapeOf(tuning), mulberry32(4))
      expect(sheet.tables).toHaveLength(tuning.tableCount)
      expect(sheet.rows).toHaveLength(tuning.rowCount)
      expect(sheet.angles).toHaveLength(tuning.angleCount)
      expect(new Set(sheet.tables.map(t => t.airSpeed)).size).toBe(tuning.tableCount)
      for (const table of sheet.tables) {
        expect(table.cells).toHaveLength(tuning.rowCount)
        for (const row of table.cells) expect(row).toHaveLength(tuning.angleCount)
      }
    }
  })

  it('keeps the rows and columns in ascending order, the way a printed sheet is', () => {
    const sheet = buildMatfSheet(shapeOf(MATF_TUNING.hard), mulberry32(5))
    for (const list of [sheet.rows, sheet.angles, sheet.tables.map(t => t.airSpeed)]) {
      expect(list).toEqual([...list].sort((a, b) => a - b))
    }
  })

  it('answers with the named readout at the named air speed, velocity and angle', () => {
    for (let seed = 0; seed < 300; seed++) {
      const sheet = buildMatfSheet(shapeOf(MATF_TUNING.hard), mulberry32(seed))
      const q = matfSheetQuestion(sheet, mulberry32(seed + 31))
      expect([seed, q.readout]).toEqual([seed, q.readout === 'drift' ? 'drift' : 'ground'])
      expect([seed, q.answer]).toEqual([
        seed,
        sheetValue(sheet, q.airSpeed, q.windVelocity, q.windAngle, q.readout),
      ])
    }
  })

  it('offers five distinct options containing the answer', () => {
    for (let seed = 0; seed < 200; seed++) {
      const sheet = buildMatfSheet(shapeOf(MATF_TUNING.easier), mulberry32(seed))
      const q = matfSheetQuestion(sheet, mulberry32(seed + 13))
      expect(q.options).toHaveLength(MATF_OPTIONS)
      expect(new Set(q.options).size).toBe(MATF_OPTIONS)
      expect(q.options).toContain(q.answer)
    }
  })

  it('offers the same cell from a neighbouring air-speed table as a wrong answer', () => {
    // The characteristic three-step-lookup error is reading the right row and
    // column off the wrong table. If that value is never on the menu, the first
    // of the three steps costs nothing to skip.
    const sheet = buildMatfSheet(shapeOf(MATF_TUNING.hard), mulberry32(6))
    let offered = 0
    for (let seed = 0; seed < 200; seed++) {
      const q = matfSheetQuestion(sheet, mulberry32(seed + 200))
      const wrongTables = sheet.tables.filter(t => t.airSpeed !== q.airSpeed)
      const r = sheet.rows.indexOf(q.windVelocity)
      const c = sheet.angles.indexOf(q.windAngle)
      if (wrongTables.some(t => q.options.includes(t.cells[r][c][q.readout]))) offered++
    }
    expect(offered).toBeGreaterThan(150)
  })

  it('asks for both readouts over a run, not just one', () => {
    const sheet = buildMatfSheet(shapeOf(MATF_TUNING.hard), mulberry32(7))
    const seen = new Set()
    for (let seed = 0; seed < 60; seed++) seen.add(matfSheetQuestion(sheet, mulberry32(seed + 400)).readout)
    expect([...seen].sort()).toEqual(['drift', 'ground'])
  })
})

describe('matfDifficulty', () => {
  it('pins the keys a difficulty is allowed to change', () => {
    const allowed = new Set([
      'key', 'label', 'gameKey', 'bars', 'blurb',
      'gridExtent', 'tableCount', 'rowCount', 'angleCount', 'partMs', 'grades',
    ])
    for (const tuning of Object.values(MATF_TUNING)) {
      for (const k of Object.keys(tuning)) expect([k, allowed.has(k)]).toEqual([k, true])
    }
  })

  it('keeps Hard at the ±17 the corpus states', () => {
    expect(MATF_TUNING.hard.gridExtent).toBe(17)
  })

  it('gives Easier a smaller grid, a smaller sheet and a longer clock', () => {
    expect(MATF_TUNING.easier.gridExtent).toBeLessThan(MATF_TUNING.hard.gridExtent)
    expect(MATF_TUNING.easier.tableCount).toBeLessThan(MATF_TUNING.hard.tableCount)
    expect(MATF_TUNING.easier.partMs).toBeGreaterThan(MATF_TUNING.hard.partMs)
  })

  it('keeps the axes signed on BOTH difficulties', () => {
    // Handling the sign is part of the task, not part of the difficulty. An
    // Easier mode that quietly dropped the negative half would be training a
    // different lookup.
    for (const tuning of Object.values(MATF_TUNING)) {
      expect([tuning.key, axisLabels(tuning.gridExtent)[0]]).toEqual([tuning.key, -tuning.gridExtent])
    }
  })

  it('never asks for more tables than the air-speed pool holds', () => {
    const sheet = buildMatfSheet(shapeOf(MATF_TUNING.hard), mulberry32(1))
    expect(sheet.tables.filter(t => Number.isFinite(t.airSpeed))).toHaveLength(MATF_TUNING.hard.tableCount)
  })

  it('sets higher grade thresholds on Easier, since more answers fit the clock', () => {
    // Speeded and uncapped, so unlike the fixed-length games the bands move up
    // because the achievable count moves up — not to demand more accuracy.
    expect(MATF_TUNING.easier.grades.outstanding).toBeGreaterThan(MATF_TUNING.hard.grades.outstanding)
  })
})
