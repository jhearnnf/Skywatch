import { describe, it, expect } from 'vitest'
import {
  generateSatSituation, formatSatEntry, formatSatClock, satTypedCorrect, satEntryLength,
  SAT_HEADINGS_8, SAT_HEADING_WORD,
} from '../satGenerator'

// Deterministic PRNG so each case is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const REF_RE = /^[A-J][0-9]$/

describe('generateSatSituation', () => {
  it('is deterministic for a given seed', () => {
    const a = generateSatSituation({}, mulberry32(42))
    const b = generateSatSituation({}, mulberry32(42))
    expect(a).toEqual(b)
  })

  it('honours requested unit / aircraft / question counts', () => {
    const s = generateSatSituation({ unitCount: 4, aircraftCount: 3, questionCount: 6, supportCall: false }, mulberry32(7))
    expect(s.units).toHaveLength(4)
    expect(s.aircraft).toHaveLength(3)
    expect(s.comms).toHaveLength(3)
    expect(s.questions).toHaveLength(6)
  })

  it('adds exactly one support call when asked, and none when not', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const withCall = generateSatSituation({ aircraftCount: 3, supportCall: true }, mulberry32(seed))
      const without = generateSatSituation({ aircraftCount: 3, supportCall: false }, mulberry32(seed))
      expect(withCall.comms.filter(c => c.kind === 'support')).toHaveLength(1)
      expect(without.comms.filter(c => c.kind === 'support')).toHaveLength(0)
      expect(withCall.comms).toHaveLength(4) // one per aircraft + the support call
    }
  })

  it('support calls name a real unit on the grid and a real aircraft', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = generateSatSituation({ supportCall: true }, mulberry32(seed))
      const call = s.comms.find(c => c.kind === 'support')
      const caller = s.units.find(u => u.ref === call.supportRef)
      expect(caller).toBeDefined()
      expect(call.supportUnitType).toBe(caller.type)
      expect(s.aircraft.map(a => a.callsign)).toContain(call.callsign)
      // Friendly units do the asking whenever the situation has one.
      if (s.units.some(u => u.allegiance === 'friendly')) {
        expect(caller.allegiance).toBe('friendly')
      }
      expect(call.text).toContain(call.supportRef)
      expect(call.speech).not.toContain(call.supportRef) // phonetic for TTS
    }
  })

  it('is occasional — fires on some seeds but not all', () => {
    const fired = []
    for (let seed = 1; seed <= 200; seed++) {
      const s = generateSatSituation({}, mulberry32(seed))
      fired.push(s.comms.some(c => c.kind === 'support'))
    }
    expect(fired.some(Boolean)).toBe(true)
    expect(fired.some(f => !f)).toBe(true)
  })

  it('places every unit in a distinct, valid grid cell with a count ≥ 1', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = generateSatSituation({}, mulberry32(seed))
      const refs = s.units.map(u => u.ref)
      expect(new Set(refs).size).toBe(refs.length) // distinct cells
      s.units.forEach(u => {
        expect(u.ref).toMatch(REF_RE)
        expect(u.count).toBeGreaterThanOrEqual(1)
        expect(u.count).toBeLessThanOrEqual(9)
        expect(['friendly', 'hostile', 'unknown']).toContain(u.allegiance)
        expect(['N', 'S', 'E', 'W']).toContain(u.heading)
      })
    }
  })

  it('gives aircraft distinct callsigns and sane data fields', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = generateSatSituation({}, mulberry32(seed))
      const calls = s.aircraft.map(a => a.callsign)
      expect(new Set(calls).size).toBe(calls.length)
      s.aircraft.forEach(a => {
        expect(['York', 'Leeds', 'Hull']).toContain(a.callsign)
        expect(a.waypointRef).toMatch(REF_RE)
        expect(a.waypointAt % 5).toBe(0)
        expect(a.altitude % 10).toBe(0)
      })
    }
  })

  it('every question has 4 unique options containing its answer', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = generateSatSituation({}, mulberry32(seed))
      expect(s.questions.length).toBeGreaterThanOrEqual(6)
      const prompts = s.questions.map(q => q.prompt)
      expect(new Set(prompts).size).toBe(prompts.length) // no duplicate prompts
      s.questions.forEach(q => {
        // Most questions are 4-option; callsign questions are 3 (only York /
        // Leeds / Hull exist). Either way: unique options that include the answer.
        expect(q.options.length).toBeGreaterThanOrEqual(3)
        expect(q.options.length).toBeLessThanOrEqual(4)
        expect(new Set(q.options.map(String)).size).toBe(q.options.length)
        expect(q.options.map(String)).toContain(String(q.answer))
      })
    }
  })
})

// The Real CBAT theme's format, from a candidate who passed the real SAT: all 8
// compass points, altitude in thousands of feet, waypoint times on the clock,
// 8-option multiple choice and 40-60% typed answers.
describe('generateSatSituation, cbat format', () => {
  const FIELDS = ['waypoint', 'waypointAt', 'altitude', 'channel']
  const cbat = (seed, extra = {}) => generateSatSituation(
    { format: 'cbat', aircraftCount: 3, unitRange: [3, 5], questionCount: 6, aircraftFields: FIELDS, ...extra },
    mulberry32(seed),
  )

  it('leaves the classic format untouched by default', () => {
    const s = generateSatSituation({}, mulberry32(3))
    expect(s.format).toBe('classic')
    expect(s.clockStart).toBeNull()
    s.questions.forEach(q => expect(q.kind).toBeUndefined())
  })

  it('uses 8 compass headings, feet and clock times', () => {
    const headings = new Set()
    for (let seed = 1; seed <= 300; seed++) {
      const s = cbat(seed)
      expect(s.clockStart).toBeGreaterThanOrEqual(8 * 3600)
      s.units.forEach(u => headings.add(u.heading))
      s.aircraft.forEach(a => {
        expect(a.altitudeUnit).toBe('kft')
        expect(a.altitude).toBeGreaterThanOrEqual(5)
        expect(a.altitude).toBeLessThanOrEqual(40)
        expect(a.waypointAt).toMatch(/^\d\d:\d\d:\d\d$/)
        // Ahead of the clock by 2-15 minutes.
        const [h, m, sec] = a.waypointAt.split(':').map(Number)
        const ahead = h * 3600 + m * 60 + sec - s.clockStart
        expect(ahead).toBeGreaterThanOrEqual(120)
        expect(ahead).toBeLessThanOrEqual(900)
      })
    }
    expect([...headings].sort()).toEqual(['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W'])
  })

  it('reads altitude out in feet over the radio', () => {
    for (let seed = 1; seed <= 100; seed++) {
      cbat(seed).comms.filter(c => c.kind === 'altitude').forEach(c => {
        expect(c.text).toMatch(/\d+,000ft\.$/)
        expect(c.speech).toMatch(/thousand feet\.$/)
        expect(c.text).not.toContain('flight level')
      })
    }
  })

  it('types 40-60% of every situation\'s questions', () => {
    for (const questionCount of [5, 6]) {
      for (let seed = 1; seed <= 300; seed++) {
        const s = cbat(seed, { questionCount })
        expect(s.questions).toHaveLength(questionCount)
        const typed = s.questions.filter(q => q.kind === 'typed').length
        expect(typed / questionCount, `seed ${seed}`).toBeGreaterThanOrEqual(0.4)
        expect(typed / questionCount, `seed ${seed}`).toBeLessThanOrEqual(0.6)
      }
    }
  })

  it('asks altitude as __,000ft and waypoint time as HH:__:__', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = cbat(seed)
      s.questions.filter(q => q.kind === 'typed').forEach(q => {
        const ac = s.aircraft.find(a => q.prompt.includes(a.callsign))
        if (q.category === 'aircraft-altitude') {
          expect(formatSatEntry(q.entry)).toBe('__,000ft')
          expect(satTypedCorrect(q, String(ac.altitude))).toBe(true)
          expect(q.answer).toBe(`${ac.altitude},000ft`)
        } else {
          expect(q.category).toBe('aircraft-seconds')
          expect(formatSatEntry(q.entry)).toBe(`${ac.waypointAt.slice(0, 2)}:__:__`)
          expect(formatSatEntry(q.entry, q.answerDigits)).toBe(ac.waypointAt)
        }
      })
    }
  })

  it('offers 8 options in a fixed order wherever the pool allows', () => {
    const NUMERIC_OR_ORDERED = ['unit-count', 'unit-heading', 'aircraft-channel', 'aircraft-waypoint', 'unit-cell', 'audio-support-ref']
    for (let seed = 1; seed <= 200; seed++) {
      const s = cbat(seed, { supportCall: true })
      s.questions.filter(q => q.kind !== 'typed').forEach(q => {
        expect(q.options.map(String)).toContain(String(q.answer))
        expect(new Set(q.options.map(String)).size).toBe(q.options.length)
        if (NUMERIC_OR_ORDERED.includes(q.category)) expect(q.options).toHaveLength(8)
        else expect(q.options).toHaveLength(3) // callsigns and unit types: only 3 exist
        // Listed in the pool's own order, never shuffled.
        if (q.category === 'unit-count') expect(q.options).toEqual([...q.options].sort((a, b) => a - b))
        if (q.category === 'unit-cell') expect(q.options).toEqual([...q.options].sort())
        if (q.category === 'unit-heading') {
          const order = SAT_HEADINGS_8.map(h => SAT_HEADING_WORD[h])
          expect(q.options).toEqual(order.filter(w => q.options.includes(w)))
        }
      })
    }
  })

  it('is deterministic for a given seed', () => {
    expect(cbat(42)).toEqual(cbat(42))
  })
})

describe('typed answer marking', () => {
  const alt = { entry: [{ digits: 2 }, { text: ',000ft' }], answerDigits: '5' }
  const time = { entry: [{ text: '11:' }, { digits: 2 }, { text: ':' }, { digits: 2 }], answerDigits: '0605' }

  it('takes an altitude with or without a leading zero', () => {
    expect(satTypedCorrect(alt, '5')).toBe(true)
    expect(satTypedCorrect(alt, '05')).toBe(true)
    expect(satTypedCorrect(alt, '50')).toBe(false)
    expect(satTypedCorrect(alt, '')).toBe(false)
  })

  it('needs a clock time digit for digit', () => {
    expect(satTypedCorrect(time, '0605')).toBe(true)
    expect(satTypedCorrect(time, '605')).toBe(false)
    expect(satTypedCorrect(time, '0650')).toBe(false)
  })

  it('shows blanks for the digits not typed yet', () => {
    expect(formatSatEntry(time.entry, '06')).toBe('11:06:__')
    expect(formatSatEntry(alt.entry, '2')).toBe('2_,000ft')
    expect(satEntryLength(time.entry)).toBe(4)
  })

  it('formats the clock', () => {
    expect(formatSatClock(11 * 3600 + 6 * 60 + 5)).toBe('11:06:05')
  })
})
