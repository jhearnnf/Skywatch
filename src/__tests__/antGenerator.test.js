import { describe, it, expect } from 'vitest'
import {
  buildRound,
  scoreAnswer,
  roundHalfUp,
  formatHHMM,
  parseHHMM,
  gradeForScore,
  WEIGHT_TABLE,
  ANT_NODES,
  ANT_ADJ,
} from '../utils/antGenerator'

describe('roundHalfUp', () => {
  it('rounds 0.5 up', () => expect(roundHalfUp(0.5)).toBe(1))
  it('rounds 0.49 down', () => expect(roundHalfUp(0.49)).toBe(0))
  it('rounds 12.5 up', () => expect(roundHalfUp(12.5)).toBe(13))
  it('rounds 12.49 down', () => expect(roundHalfUp(12.49)).toBe(12))
})

describe('formatHHMM', () => {
  it('formats midnight', () => expect(formatHHMM(0)).toBe('0000'))
  it('formats 8:30am', () => expect(formatHHMM(510)).toBe('0830'))
  it('formats 2:05pm', () => expect(formatHHMM(14 * 60 + 5)).toBe('1405'))
  it('wraps past midnight', () => expect(formatHHMM(1500)).toBe('0100'))
})

describe('parseHHMM', () => {
  it('parses 1430', () => expect(parseHHMM('1430')).toBe(14 * 60 + 30))
  it('parses 0800', () => expect(parseHHMM('0800')).toBe(8 * 60))
  it('parses 14:30 with colon', () => expect(parseHHMM('14:30')).toBe(14 * 60 + 30))
  it('returns NaN for invalid', () => expect(parseHHMM('abc')).toBeNaN())
  it('returns NaN for out-of-range hour', () => expect(parseHHMM('2500')).toBeNaN())
  it('returns NaN for out-of-range minute', () => expect(parseHHMM('0865')).toBeNaN())
})

describe('buildRound', () => {
  it('produces valid start/via/destination on the graph', () => {
    for (let i = 0; i < 50; i++) {
      const r = buildRound()
      expect(ANT_NODES).toContain(r.start)
      expect(ANT_NODES).toContain(r.via)
      expect(ANT_NODES).toContain(r.destination)
      expect(ANT_ADJ[r.start]).toContain(r.via)
      expect(ANT_ADJ[r.via]).toContain(r.destination)
      expect(r.destination).not.toBe(r.start)
    }
  })

  it('uses a weight row from the reference table', () => {
    const weights = WEIGHT_TABLE.map(w => w.weight)
    for (let i = 0; i < 20; i++) {
      const r = buildRound()
      expect(weights).toContain(r.weight)
      const row = WEIGHT_TABLE.find(w => w.weight === r.weight)
      expect(r.mpm).toBe(row.mpm)
      expect(r.gph).toBe(row.gph)
    }
  })

  it('yields internally consistent arithmetic for each question type', () => {
    ;['arrival', 'distance', 'fuel', 'speed'].forEach(type => {
      const r = buildRound(type)
      const travel = r.arrivalMin - r.timeNowMin
      if (type === 'arrival') {
        expect(r.correctAnswer).toBe(r.arrivalMin)
        expect(r.show.arrivalTime).toBe(false)
      } else if (type === 'distance') {
        expect(r.correctAnswer).toBe(travel * r.mpm)
        expect(r.show.segments).toBe(false)
      } else if (type === 'fuel') {
        expect(r.correctAnswer).toBe(roundHalfUp((travel / 60) * r.gph))
      } else if (type === 'speed') {
        expect(r.correctAnswer).toBe(roundHalfUp((r.totalDistance * 60) / travel))
        expect(r.show.weight).toBe(false)
      }
    })
  })
})

describe('scoreAnswer', () => {
  it('awards 10 for exact numeric', () => {
    const r = { type: 'distance', correctAnswer: 120, timeNowMin: 0, arrivalMin: 30 }
    expect(scoreAnswer(r, '120').points).toBe(10)
  })
  it('awards 5 for within 5%', () => {
    const r = { type: 'distance', correctAnswer: 100, timeNowMin: 0, arrivalMin: 25 }
    expect(scoreAnswer(r, '104').points).toBe(5)
  })
  it('awards 0 for way off', () => {
    const r = { type: 'distance', correctAnswer: 100, timeNowMin: 0, arrivalMin: 25 }
    expect(scoreAnswer(r, '50').points).toBe(0)
  })
  it('parses HHMM for arrival questions', () => {
    const r = { type: 'arrival', correctAnswer: 14 * 60 + 30, timeNowMin: 14 * 60, arrivalMin: 14 * 60 + 30 }
    expect(scoreAnswer(r, '1430').points).toBe(10)
  })
  it('gives partial for close HHMM', () => {
    // travel = 60 min. 5% tolerance = 3 min. 1431 is 1 min off → partial.
    const r = { type: 'arrival', correctAnswer: 14 * 60 + 30, timeNowMin: 13 * 60 + 30, arrivalMin: 14 * 60 + 30 }
    expect(scoreAnswer(r, '1431').points).toBe(5)
  })
  it('returns 0 for empty input', () => {
    const r = { type: 'distance', correctAnswer: 100, timeNowMin: 0, arrivalMin: 25 }
    expect(scoreAnswer(r, '').points).toBe(0)
    expect(scoreAnswer(r, '   ').points).toBe(0)
  })
})

describe('gradeForScore', () => {
  it('grades tiers', () => {
    expect(gradeForScore(75)).toBe('Outstanding')
    expect(gradeForScore(50)).toBe('Good')
    expect(gradeForScore(25)).toBe('Needs Work')
    expect(gradeForScore(10)).toBe('Failed')
  })
})
