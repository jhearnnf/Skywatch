import { describe, it, expect } from 'vitest'
import {
  DAD_TUNING, DAD_DIFFICULTIES, DAD_TOTAL_QUESTIONS, dadTuning, computeDadGrade,
} from '../dadDifficulty'
import { generateDadQuestion } from '../dadGenerator'

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('DAD difficulty table', () => {
  it('pins the allowed keys, so a difficulty cannot quietly change anything else', () => {
    for (const t of Object.values(DAD_TUNING)) {
      expect(Object.keys(t).sort()).toEqual(
        ['bars', 'blurb', 'diagonalsFrom', 'gameKey', 'grades', 'key', 'label', 'legsAt'].sort())
    }
  })

  it('Hard is the original game, on a fresh board', () => {
    const hard = DAD_TUNING.hard
    expect(hard.gameKey).toBe('dad-hard')
    expect(hard.diagonalsFrom).toBe(9)
    expect(Array.from({ length: 15 }, (_, i) => hard.legsAt(i)))
      .toEqual([3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6])
  })

  it('Easier keeps the original board, with shorter routes and no diagonals', () => {
    const easier = DAD_TUNING.easier
    expect(easier.gameKey).toBe('dad')
    expect(easier.diagonalsFrom).toBe(Infinity)
    for (let i = 0; i < DAD_TOTAL_QUESTIONS; i++) {
      expect(easier.legsAt(i)).toBeLessThan(DAD_TUNING.hard.legsAt(i))
      expect(easier.legsAt(i)).toBeGreaterThanOrEqual(2)
    }
  })

  it('orders the row Easier then Hard, with bars on both', () => {
    expect(DAD_DIFFICULTIES.map(d => d.key)).toEqual(['easier', 'hard'])
    expect(DAD_DIFFICULTIES.map(d => d.bars)).toEqual([1, 3])
  })

  it('falls back to Easier for an unknown key', () => {
    expect(dadTuning('nonsense').key).toBe('easier')
  })

  it('asks more of an Easier run for the same grade', () => {
    expect(computeDadGrade(90, DAD_TUNING.hard)).toBe('Outstanding')
    expect(computeDadGrade(90, DAD_TUNING.easier)).toBe('Good')
  })

  it('every Easier SkyWatch question is cardinal-only with 90° turns', () => {
    const easier = DAD_TUNING.easier
    for (let seed = 1; seed <= 200; seed++) {
      for (let i = 0; i < DAD_TOTAL_QUESTIONS; i++) {
        const q = generateDadQuestion(easier.legsAt(i), mulberry32(seed * 100 + i), { diagonals: i >= easier.diagonalsFrom })
        expect(q.legs).toHaveLength(easier.legsAt(i))
        q.legs.forEach(l => {
          expect(['N', 'E', 'S', 'W']).toContain(l.dirName)
          expect(l.deg === 0 || l.deg === 90).toBe(true)
        })
        expect(q.prose).not.toMatch(/45°/)
      }
    }
  })
})
