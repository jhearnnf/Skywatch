import { describe, it, expect } from 'vitest'
import { generateSatSituation } from '../satGenerator'

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
