import { describe, it, expect } from 'vitest'
import {
  buildRound,
  wholeAnswerDistances,
  scoreAnswer,
  solutionSteps,
  solutionAnchors,
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

// Rounding the arrival time to the minute used to corrupt every answer derived
// from it: a 400 kg speed round graded 239 mph instead of 240, and a distance
// answer didn't match the legs drawn on the map.
describe('buildRound — exact arithmetic (no rounding drift)', () => {
  it('always flies a whole number of minutes', () => {
    for (let i = 0; i < 300; i++) {
      const r = buildRound()
      expect(r.totalDistance % r.mpm).toBe(0)
      expect(r.arrivalMin - r.timeNowMin).toBe(r.totalDistance / r.mpm)
    }
  })

  it('keeps both legs inside the 30–120 mile range', () => {
    for (let i = 0; i < 300; i++) {
      const r = buildRound()
      expect(r.seg1).toBeGreaterThanOrEqual(30)
      expect(r.seg1).toBeLessThanOrEqual(120)
      expect(r.seg2).toBeGreaterThanOrEqual(30)
      expect(r.seg2).toBeLessThanOrEqual(120)
      expect(r.seg1 + r.seg2).toBe(r.totalDistance)
    }
  })

  it('grades a distance round as the sum of the legs on the map', () => {
    for (let i = 0; i < 100; i++) {
      const r = buildRound('distance')
      expect(r.correctAnswer).toBe(r.seg1 + r.seg2)
    }
  })

  it('grades a speed round as the parcel\'s true cruise speed', () => {
    for (let i = 0; i < 100; i++) {
      const r = buildRound('speed')
      expect(r.correctAnswer).toBe(r.mpm * 60)
    }
  })

  it('grades an arrival round to the exact minute', () => {
    for (let i = 0; i < 100; i++) {
      const r = buildRound('arrival')
      expect(r.correctAnswer).toBe(r.timeNowMin + r.totalDistance / r.mpm)
    }
  })

  it('never asks for an answer that isn\'t a whole number', () => {
    ;['arrival', 'distance', 'fuel', 'speed'].forEach(type => {
      for (let i = 0; i < 200; i++) {
        const r = buildRound(type)
        expect(Number.isInteger(r.correctAnswer)).toBe(true)
      }
    })
  })

  it('burns a whole number of gallons on a fuel round', () => {
    for (let i = 0; i < 200; i++) {
      const r = buildRound('fuel')
      const travel = r.arrivalMin - r.timeNowMin
      expect(r.correctAnswer).toBe((travel * r.gph) / 60)
      expect(r.correctAnswer).toBeGreaterThan(0)
    }
  })

  it('offers every parcel more than one fuel journey, so no round is memorisable', () => {
    const usable = WEIGHT_TABLE.filter(w => wholeAnswerDistances(w.mpm, w.gph).length > 1)
    expect(usable.length).toBeGreaterThan(1)
    const seen = new Set()
    for (let i = 0; i < 200; i++) seen.add(buildRound('fuel').weight)
    seen.forEach(w => {
      const row = WEIGHT_TABLE.find(x => x.weight === w)
      expect(wholeAnswerDistances(row.mpm, row.gph).length).toBeGreaterThan(1)
    })
  })
})

describe('solutionSteps', () => {
  it('ends on the round\'s correct answer for every type', () => {
    ;['arrival', 'distance', 'fuel', 'speed'].forEach(type => {
      const r = buildRound(type)
      const last = solutionSteps(r).at(-1)
      const expected = type === 'arrival' ? formatHHMM(r.correctAnswer) : String(r.correctAnswer)
      expect(last.result).toContain(expected)
    })
  })

  it('cites the clock and the parcel speed for a distance round', () => {
    const r = buildRound('distance')
    expect([...solutionAnchors(r)].sort()).toEqual(['arrive', 'mpm', 'now'])
  })

  it('cites the map and the clock for a speed round — never the hidden parcel', () => {
    const r = buildRound('speed')
    const anchors = solutionAnchors(r)
    expect(anchors.has('seg1')).toBe(true)
    expect(anchors.has('seg2')).toBe(true)
    expect(anchors.has('mpm')).toBe(false)
    expect(anchors.has('weightkg')).toBe(false)
  })

  it('only ever points at values the board can show', () => {
    const known = ['now', 'arrive', 'mpm', 'gph', 'seg1', 'seg2']
    ;['arrival', 'distance', 'fuel', 'speed'].forEach(type => {
      solutionAnchors(buildRound(type)).forEach(a => expect(known).toContain(a))
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
  it('scores close in the answer\'s own units, not a percentage', () => {
    const dist = { type: 'distance', correctAnswer: 145 }
    expect(scoreAnswer(dist, '140').points).toBe(5)     // 5 miles out
    expect(scoreAnswer(dist, '139').points).toBe(0)     // 6 miles out
    const speed = { type: 'speed', correctAnswer: 240 }
    expect(scoreAnswer(speed, '250').points).toBe(5)
    expect(scoreAnswer(speed, '251').points).toBe(0)
  })

  it('gives no half credit on fuel — a gallon is a gallon', () => {
    const fuel = { type: 'fuel', correctAnswer: 3 }
    expect(scoreAnswer(fuel, '3').points).toBe(10)
    expect(scoreAnswer(fuel, '2').points).toBe(0)
    // the old ±1 floor handed 5 pts to an answer of 0 on a 1-gallon question
    expect(scoreAnswer({ type: 'fuel', correctAnswer: 1 }, '0').points).toBe(0)
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
