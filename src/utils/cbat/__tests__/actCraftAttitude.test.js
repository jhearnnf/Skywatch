import { describe, it, expect } from 'vitest'
import {
  createCraftAttitude,
  turnRates,
  bankTarget,
  aoaTarget,
  approach,
  MAX_BANK,
  MAX_AOA,
} from '../actCraftAttitude'

// One second of 60 fps steering at a constant rate.
function fly(attitude, { yawRate = 0, pitchRate = 0, seconds = 1 } = {}) {
  const dt = 1 / 60
  let out = attitude.value()
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    out = attitude.update(yawRate, pitchRate, dt)
  }
  return out
}

describe('bank', () => {
  it('rolls into the turn — right bank turning right, left turning left', () => {
    expect(bankTarget(1.2)).toBeGreaterThan(0)
    expect(bankTarget(-1.2)).toBeLessThan(0)
    expect(bankTarget(-1.2)).toBeCloseTo(-bankTarget(1.2), 10)
  })

  it('is level when the player is not turning', () => {
    expect(bankTarget(0)).toBe(0)
  })

  // A flicked mouse can apply a whole frame's rotation cap at once, which is an
  // enormous instantaneous rate. It must not put the aircraft on its back.
  it('never exceeds the bank limit, however hard the flick', () => {
    expect(bankTarget(500)).toBe(MAX_BANK)
    expect(bankTarget(-500)).toBe(-MAX_BANK)
    const { bank } = fly(createCraftAttitude(), { yawRate: 500, seconds: 3 })
    expect(bank).toBeLessThanOrEqual(MAX_BANK)
  })

  it('builds up over a turn rather than snapping to angle', () => {
    const attitude = createCraftAttitude()
    const dt = 1 / 60
    const first = attitude.update(1.2, 0, dt).bank
    const target = bankTarget(1.2)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(target * 0.5)     // nowhere near there yet
    expect(fly(attitude, { yawRate: 1.2, seconds: 1 }).bank).toBeCloseTo(target, 2)
  })

  it('rolls back level once the turn stops', () => {
    const attitude = createCraftAttitude()
    fly(attitude, { yawRate: 1.2, seconds: 1 })
    expect(attitude.value().bank).toBeGreaterThan(0.3)
    expect(fly(attitude, { yawRate: 0, seconds: 1 }).bank).toBeCloseTo(0, 2)
  })
})

describe('angle of attack', () => {
  it('lifts the nose climbing and drops it diving, within its limit', () => {
    expect(aoaTarget(0.8)).toBeGreaterThan(0)
    expect(aoaTarget(-0.8)).toBeLessThan(0)
    expect(aoaTarget(50)).toBe(MAX_AOA)
  })

  // Pitch is a supporting detail; a nose held high enough to hide the tunnel
  // would cost the player shapes.
  it('stays far smaller than the bank', () => {
    expect(MAX_AOA).toBeLessThan(MAX_BANK / 3)
  })
})

describe('approach', () => {
  it('is framerate-independent — same angle after the same time', () => {
    let coarse = 0
    for (let i = 0; i < 30; i++) coarse = approach(coarse, 1, 1 / 30)
    let fine = 0
    for (let i = 0; i < 120; i++) fine = approach(fine, 1, 1 / 120)
    expect(coarse).toBeCloseTo(fine, 3)
  })

  it('holds still on a stalled frame', () => {
    expect(approach(0.4, 1, 0)).toBe(0.4)
    expect(approach(0.4, 1, -1)).toBe(0.4)
  })
})

describe('turnRates', () => {
  const right = { x: 1, y: 0, z: 0 }
  const up = { x: 0, y: 1, z: 0 }

  it('reads a heading swinging toward the right wing as a right turn', () => {
    const { yawRate, pitchRate } = turnRates(
      { x: 0, y: 0, z: -1 },
      { x: 0.02, y: 0, z: -1 },
      right, up, 1 / 60,
    )
    expect(yawRate).toBeCloseTo(1.2, 6)
    expect(pitchRate).toBeCloseTo(0, 6)
  })

  it('reads a rising heading as a climb', () => {
    const { yawRate, pitchRate } = turnRates(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0.02, z: -1 },
      right, up, 1 / 60,
    )
    expect(pitchRate).toBeCloseTo(1.2, 6)
    expect(yawRate).toBeCloseTo(0, 6)
  })

  it('is zero on a frame with no elapsed time', () => {
    expect(turnRates({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, right, up, 0))
      .toEqual({ yawRate: 0, pitchRate: 0 })
  })
})
