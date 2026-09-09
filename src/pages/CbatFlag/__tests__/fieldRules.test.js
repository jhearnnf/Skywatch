import { describe, it, expect } from 'vitest'
import {
  nextCallsign, isContactVisible, callsignLabelPos, leavingBoxPos,
} from '../fieldRules'

// Matches AIRCRAFT_RADIUS in PlayField.
const R = 25
const DESKTOP = { w: 896, h: 480 }

describe('FLAG callsign issue', () => {
  it('walks the pool in order', () => {
    const pool = ['AB', 'CD', 'EF']
    expect(nextCallsign(pool, 0, new Set())).toBe('AB')
    expect(nextCallsign(pool, 2, new Set())).toBe('EF')
  })

  it('never reuses a callsign — a run that outlives the pool mints fresh ones', () => {
    // Two aircraft sharing a callsign would make "is XX on screen right now"
    // ambiguous, so exhausting the pool must not wrap back to the start.
    const pool = ['AB', 'CD']
    const issued = new Set(pool)
    const minted = new Set()
    for (let i = 0; i < 50; i++) {
      const sym = nextCallsign(pool, pool.length + i, issued)
      expect(issued.has(sym)).toBe(false)
      expect(minted.has(sym)).toBe(false)
      minted.add(sym)
      issued.add(sym)
    }
  })

  it('never mints a reserved decoy, which has to stay off the field to stay a NO', () => {
    const reserved = new Set(['QQ', 'RR', 'SS'])
    const issued = new Set()
    for (let i = 0; i < 60; i++) {
      const sym = nextCallsign([], i, issued, reserved)
      expect(reserved.has(sym)).toBe(false)
      issued.add(sym)
    }
  })
})

describe('FLAG contact visibility', () => {
  const { w, h } = DESKTOP

  it('counts a contact while any part of its ring is still in the field', () => {
    expect(isContactVisible(w / 2, h / 2, w, h, R)).toBe(true)
    expect(isContactVisible(0, h / 2, w, h, R)).toBe(true)      // spawned on the edge
    expect(isContactVisible(-R + 1, h / 2, w, h, R)).toBe(true) // ring half out
    expect(isContactVisible(w + R - 1, h / 2, w, h, R)).toBe(true)
  })

  it('stops counting it the moment the ring clears the field, not at the cull margin', () => {
    // The cull margin is 60px so the model exits smoothly. Scoring must not wait
    // that long: for ~3s the contact would be invisible with YES still correct.
    expect(isContactVisible(-R, h / 2, w, h, R)).toBe(false)
    expect(isContactVisible(w / 2, -40, w, h, R)).toBe(false)
    expect(isContactVisible(w / 2, h + 40, w, h, R)).toBe(false)
  })
})

describe('FLAG callsign labels stay inside the field', () => {
  const { w, h } = DESKTOP
  const fontSize = 11
  const symbol = 'AB'

  // The field is overflow-hidden. A label drawn outside it is reported as shown
  // to the player and is in fact invisible — the unfair question in a nutshell.
  const inField = (x, y) => x >= 0 && x <= w && y >= 0 && y <= h

  it('keeps the flash label on screen for a contact anywhere on the field', () => {
    for (const x of [0, 1, 6, w / 2, w - 6, w]) {
      for (const y of [0, 1, 12, 30, 31, h / 2, h - 1, h]) {
        const pos = callsignLabelPos({ x, y, symbol, fontSize, radius: R, fieldW: w, fieldH: h })
        expect(inField(pos.x - pos.halfWidth, pos.y - fontSize)).toBe(true)
        expect(inField(pos.x + pos.halfWidth, pos.y)).toBe(true)
      }
    }
  })

  it('drops the label under the aircraft when there is no room above it', () => {
    const top = callsignLabelPos({ x: 200, y: 4, symbol, fontSize, radius: R, fieldW: w, fieldH: h })
    expect(top.y).toBeGreaterThan(4)   // below the aircraft, not off the top edge

    const middle = callsignLabelPos({ x: 200, y: 200, symbol, fontSize, radius: R, fieldW: w, fieldH: h })
    expect(middle.y).toBe(200 - R - 6) // untouched where there is room above
    expect(middle.x).toBe(200)
  })

  it('keeps the leaving box on screen, including in the top corners it exits through', () => {
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [3, 20], [w - 3, 20]]) {
      const box = leavingBoxPos({ x, y, symbol, radius: R, fieldW: w, fieldH: h })
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(w)
      expect(box.y + box.height).toBeLessThanOrEqual(h)
    }
  })
})
