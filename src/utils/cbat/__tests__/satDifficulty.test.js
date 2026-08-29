import { describe, it, expect } from 'vitest'
import {
  SAT_TUNING, SAT_DIFFICULTIES, DEFAULT_SAT_DIFFICULTY,
  satTuning, satGameKey, satTotalQuestions, computeGrade,
} from '../satDifficulty'
import { generateSatSituation, ALL_AIRCRAFT_FIELDS } from '../satGenerator'

// A difficulty tunes the LOAD and the card dwell, and nothing else. Pinning the
// allowed key set is what stops one quietly growing a new lever (a slower
// question timer, fewer options per question) that nobody agreed to.
const ALLOWED_KEYS = [
  'key', 'label', 'gameKey', 'bars', 'blurb',
  'situations', 'questionsPerSituation',
  'unitRange', 'aircraftRange', 'aircraftFields', 'supportChance', 'cardMs', 'layout',
  'grades',
].sort()

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('SAT difficulty tuning', () => {
  it('exposes exactly the agreed levers on both difficulties', () => {
    for (const t of SAT_DIFFICULTIES) {
      expect(Object.keys(t).sort()).toEqual(ALLOWED_KEYS)
    }
  })

  it('orders the pair easier-then-hard and defaults to easier', () => {
    expect(SAT_DIFFICULTIES.map(t => t.key)).toEqual(['easier', 'hard'])
    expect(DEFAULT_SAT_DIFFICULTY).toBe('easier')
    expect(satTuning('nonsense').key).toBe('easier')
  })

  it('keeps Hard on the original collection and gives Easier its own', () => {
    expect(satGameKey('hard')).toBe('sat')
    expect(satGameKey('easier')).toBe('sat-easier')
  })

  it('gives Easier a bare card and Hard the whole console', () => {
    // Both feed one fact at a time. Hard keeps every panel on screen around it,
    // which is what the real console does — the player has to spot which
    // instrument the fact landed on, not just remember it.
    expect(SAT_TUNING.easier.layout).toBe('card')
    expect(SAT_TUNING.hard.layout).toBe('panels')
  })

  it('holds every card longer on Easier than on Hard', () => {
    // The whole difference between the two is how many facts there are and how
    // long each is on screen — if the dwells ever match, Easier is only "fewer
    // questions" and stops being an intro to the same test.
    expect(SAT_TUNING.easier.cardMs).toBeGreaterThan(SAT_TUNING.hard.cardMs)
  })

  it('holds Hard to the run shape its leaderboard was built on', () => {
    // The load levers are retunable; 3 situations of 6 is not. Scores on the
    // 'sat' board are a raw count out of 18, so changing the total silently
    // rescales every run already sitting on it.
    const h = SAT_TUNING.hard
    expect(h.situations).toBe(3)
    expect(h.questionsPerSituation).toBe(6)
    expect(satTotalQuestions(h)).toBe(18)
    expect(h.unitRange).toEqual([3, 4])
    expect(h.aircraftRange).toEqual([2, 3])
    expect(h.supportChance).toBe(0.5)
  })

  it('asks 10 questions on Easier and 18 on Hard', () => {
    expect(satTotalQuestions(SAT_TUNING.easier)).toBe(10)
    expect(satTotalQuestions(SAT_TUNING.hard)).toBe(18)
  })

  it('never drops Easier below two controller aircraft', () => {
    // With one aircraft on screen, "which aircraft was instructed to X?" has
    // only one possible answer and the radio stops testing anything.
    expect(SAT_TUNING.easier.aircraftRange[0]).toBeGreaterThanOrEqual(2)
  })

  it('makes Easier strictly lighter than Hard on every load lever', () => {
    const e = SAT_TUNING.easier, h = SAT_TUNING.hard
    expect(e.unitRange[0]).toBeLessThanOrEqual(h.unitRange[0])
    expect(e.unitRange[1]).toBeLessThan(h.unitRange[1])
    expect(e.aircraftRange[1]).toBeLessThan(h.aircraftRange[1])
    expect(e.aircraftFields.length).toBeLessThan(h.aircraftFields.length)
    expect(e.supportChance).toBeLessThan(h.supportChance)
    expect(e.situations).toBeLessThan(h.situations)
  })

  it('shows the full panel on Hard and altitude/channel only on Easier', () => {
    expect(SAT_TUNING.hard.aircraftFields).toEqual(ALL_AIRCRAFT_FIELDS)
    expect(SAT_TUNING.easier.aircraftFields).toEqual(['altitude', 'channel'])
  })

  it('demands more accuracy on Easier for the same grade', () => {
    // Both difficulties score a count out of their own question total, so both
    // top out at 100%. An easier run has to be cleaner to earn the same word.
    for (const band of ['outstanding', 'good', 'needsWork']) {
      expect(SAT_TUNING.easier.grades[band]).toBeGreaterThan(SAT_TUNING.hard.grades[band])
    }
    expect(computeGrade(90, SAT_TUNING.hard)).toBe('Outstanding')
    expect(computeGrade(90, SAT_TUNING.easier)).toBe('Good')
    expect(computeGrade(100, SAT_TUNING.easier)).toBe('Outstanding')
    expect(computeGrade(0, SAT_TUNING.easier)).toBe('Failed')
  })
})

describe('SAT generator honours a difficulty', () => {
  const build = (tuning, seed) => generateSatSituation({
    questionCount: tuning.questionsPerSituation,
    unitRange: tuning.unitRange,
    aircraftRange: tuning.aircraftRange,
    aircraftFields: tuning.aircraftFields,
    supportChance: tuning.supportChance,
  }, mulberry32(seed))

  it('stays inside each difficulty\'s unit and aircraft ranges', () => {
    for (const t of SAT_DIFFICULTIES) {
      for (let seed = 1; seed <= 200; seed++) {
        const sit = build(t, seed)
        expect(sit.units.length).toBeGreaterThanOrEqual(t.unitRange[0])
        expect(sit.units.length).toBeLessThanOrEqual(t.unitRange[1])
        expect(sit.aircraft.length).toBeGreaterThanOrEqual(t.aircraftRange[0])
        expect(sit.aircraft.length).toBeLessThanOrEqual(t.aircraftRange[1])
      }
    }
  })

  it('always fills the requested question count, even at the thinnest setup', () => {
    // Easier's worst case is 2 units + 2 aircraft, no support call, and only the
    // two panel fields it shows — about 9 candidates. The pool has to still
    // cover 5 questions or a situation comes up short, and that is the
    // constraint deciding how far any of these counts can drop.
    for (let seed = 1; seed <= 200; seed++) {
      expect(build(SAT_TUNING.easier, seed).questions).toHaveLength(5)
    }
    for (let seed = 1; seed <= 50; seed++) {
      const thinnest = generateSatSituation({
        unitCount: 2, aircraftCount: 2, questionCount: 5, supportCall: false,
        aircraftFields: SAT_TUNING.easier.aircraftFields,
      }, mulberry32(seed))
      expect(thinnest.questions).toHaveLength(5)
    }
  })

  it('keeps the radio worth listening to on Easier', () => {
    // Two aircraft means "who was told what" still has more than one answer.
    for (let seed = 1; seed <= 50; seed++) {
      const sit = build(SAT_TUNING.easier, seed)
      const spoken = new Set(sit.comms.map(c => c.callsign))
      expect(spoken.size).toBeGreaterThanOrEqual(2)
    }
  })

  // The panel, the radio and the questions all have to agree on which fields
  // exist. If any one of them drifts, the player gets asked about something that
  // was never on screen — which reads as a broken game, not a hard one.
  it('never asks Easier about a field its panel does not show', () => {
    const HIDDEN = ['aircraft-waypoint', 'aircraft-seconds']
    for (let seed = 1; seed <= 300; seed++) {
      const categories = build(SAT_TUNING.easier, seed).questions.map(q => q.category)
      for (const banned of HIDDEN) expect(categories).not.toContain(banned)
    }
  })

  it('never reads a hidden field out over the radio on Easier', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const sit = build(SAT_TUNING.easier, seed)
      for (const c of sit.comms) {
        expect(c.kind).not.toBe('waypoint')
        expect(c.text).not.toMatch(/next waypoint/i)
      }
    }
  })

  it('still asks Hard about all four panel fields across a spread of seeds', () => {
    const seen = new Set()
    for (let seed = 1; seed <= 300; seed++) {
      for (const q of build(SAT_TUNING.hard, seed).questions) seen.add(q.category)
    }
    for (const c of ['aircraft-waypoint', 'aircraft-seconds', 'aircraft-altitude', 'aircraft-channel']) {
      expect(seen).toContain(c)
    }
  })

  it('is reproducible from a seed', () => {
    expect(build(SAT_TUNING.easier, 42)).toEqual(build(SAT_TUNING.easier, 42))
  })
})
