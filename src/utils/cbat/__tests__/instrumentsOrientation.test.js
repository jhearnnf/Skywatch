import { describe, it, expect } from 'vitest'
import {
  buildOrientationRound, buildOrientationRun, attitudesEqual, describeAttitude, headingName,
  orientationGrade, randomAttitude,
  BANKS, PITCHES, HEADINGS, ORIENTATION_OPTIONS, ORIENTATION_QUESTIONS,
} from '../instrumentsOrientation'

// A tiny seedable generator so the sweep is repeatable.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const onScale = (a) => BANKS.includes(a.bank) && PITCHES.includes(a.pitch) && HEADINGS.includes(a.heading)

describe('buildOrientationRound', () => {
  it('always offers four distinct pictures with exactly one matching the instruments', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const round = buildOrientationRound(mulberry32(seed))
      expect(round.options).toHaveLength(ORIENTATION_OPTIONS)
      // Every option is on the instrument scales, so every picture can be
      // read off the dials rather than estimated.
      for (const o of round.options) expect(onScale(o)).toBe(true)
      // One and only one option is the attitude shown.
      const matches = round.options.filter(o => attitudesEqual(o, round.attitude))
      expect(matches).toHaveLength(1)
      expect(attitudesEqual(round.options[round.correctIdx], round.attitude)).toBe(true)
      // No two pictures are the same aircraft.
      for (let i = 0; i < round.options.length; i++) {
        for (let j = i + 1; j < round.options.length; j++) {
          expect(attitudesEqual(round.options[i], round.options[j])).toBe(false)
        }
      }
    }
  })

  it('does not always put the answer in the same slot', () => {
    const slots = new Set()
    for (let seed = 1; seed <= 60; seed++) slots.add(buildOrientationRound(mulberry32(seed)).correctIdx)
    expect(slots.size).toBe(ORIENTATION_OPTIONS)
  })

  it('sets the bank trap: the mirror-image bank turns up among the distractors', () => {
    // Reading a nose-on aircraft's bank the wrong way round is THE mistake in
    // this test, so the mirrored bank has to be a live option often enough to
    // catch it.
    let mirrored = 0, banked = 0
    for (let seed = 1; seed <= 300; seed++) {
      const round = buildOrientationRound(mulberry32(seed))
      if (round.attitude.bank === 0) continue
      banked++
      if (round.options.some(o => o.bank === -round.attitude.bank)) mirrored++
    }
    expect(banked).toBeGreaterThan(100)
    expect(mirrored / banked).toBeGreaterThan(0.4)
  })
})

describe('buildOrientationRun', () => {
  it('builds the fixed question count', () => {
    expect(buildOrientationRun(undefined, mulberry32(7))).toHaveLength(ORIENTATION_QUESTIONS)
    expect(buildOrientationRun(3, mulberry32(7))).toHaveLength(3)
  })
})

describe('randomAttitude', () => {
  it('only ever lands on the instrument scales', () => {
    const rng = mulberry32(99)
    for (let i = 0; i < 200; i++) expect(onScale(randomAttitude(rng))).toBe(true)
  })
})

describe('describeAttitude', () => {
  it('names heading, pitch and bank in plain words', () => {
    expect(describeAttitude({ heading: 45, pitch: 20, bank: -30 })).toBe('Heading NE, nose up, 30° left bank')
    expect(describeAttitude({ heading: 180, pitch: -20, bank: 45 })).toBe('Heading S, nose down, 45° right bank')
    expect(describeAttitude({ heading: 0, pitch: 0, bank: 0 })).toBe('Heading N, level, wings level')
  })

  it('names every compass point the generator can pick', () => {
    expect(HEADINGS.map(headingName)).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])
    expect(headingName(360)).toBe('N')
    expect(headingName(-45)).toBe('NW')
  })
})

describe('orientationGrade', () => {
  it('bands a score out of ten', () => {
    expect(orientationGrade(10)).toBe('Outstanding')
    expect(orientationGrade(9)).toBe('Outstanding')
    expect(orientationGrade(7)).toBe('Good')
    expect(orientationGrade(5)).toBe('Needs Work')
    expect(orientationGrade(4)).toBe('Failed')
    expect(orientationGrade(0)).toBe('Failed')
  })
})
