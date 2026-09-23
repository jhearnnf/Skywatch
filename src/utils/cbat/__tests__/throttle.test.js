import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createLeverCalibration, createButtonCalibration, createThrottleReader, readLever, LEVER_WAKE,
} from '../throttle'
import {
  pickPad, saveProfile, saveThrottleProfile, loadThrottleProfile, clearThrottleProfile, defaultProfile,
  THROTTLE_PROFILE_VERSION,
} from '../gamepad'
import { createFlight, stepFlight } from '../instrumentsDrill'

// The Instruments drill's throttle on real hardware: the lever by default,
// two chosen buttons as the override. Nobody working on this owns a throttle,
// so what is pinned is that both are LEARNED from what the player does, on
// whichever device they are on, and fly the right way round once learned.

function pad({ id, axes = [0, 0], buttons = 0, held = [] }) {
  return {
    id, connected: true, axes,
    buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })),
  }
}

let pads = []
beforeEach(() => {
  localStorage.clear()
  navigator.getGamepads = () => pads
})
afterEach(() => {
  delete navigator.getGamepads
  localStorage.clear()
})

function calibrateLever(idlePads, fullPads) {
  const cal = createLeverCalibration()
  cal.observe(idlePads)
  cal.commit()
  cal.observe(fullPads)
  cal.commit()
  expect(cal.done()).toBe(true)
  return cal.result()
}

describe('throttle lever calibration', () => {
  it('finds a lever on the stick itself, whichever way round the driver reports it', () => {
    // Axis 3 reads +1 at idle and -1 at full: inverted, as many drivers are.
    const out = calibrateLever(
      [pad({ id: 'stick', axes: [0, 0, 0, 1], buttons: 12 })],
      [pad({ id: 'stick', axes: [0.02, 0, 0, -1], buttons: 12 })],
    )
    expect(out.ok).toBe(true)
    expect(out.lever).toEqual({ id: 'stick', axis: { index: 3, idle: 1, full: -1 } })
    // Idle reads 0, full reads 1, halfway reads a half.
    expect(readLever(pad({ id: 'stick', axes: [0, 0, 0, 1] }), out.lever.axis)).toBe(0)
    expect(readLever(pad({ id: 'stick', axes: [0, 0, 0, -1] }), out.lever.axis)).toBe(1)
    expect(readLever(pad({ id: 'stick', axes: [0, 0, 0, 0] }), out.lever.axis)).toBeCloseTo(0.5)
  })

  it('finds a lever on a separate throttle unit', () => {
    const out = calibrateLever(
      [pad({ id: 'stick', axes: [0, 0], buttons: 12 }), pad({ id: 'quadrant', axes: [-1, 0, 0], buttons: 4 })],
      [pad({ id: 'stick', axes: [0, 0], buttons: 12 }), pad({ id: 'quadrant', axes: [1, 0, 0], buttons: 4 })],
    )
    expect(out.ok).toBe(true)
    expect(out.lever.id).toBe('quadrant')
    expect(out.lever.axis.index).toBe(0)
  })

  it('refuses when nothing moved far enough', () => {
    const out = calibrateLever(
      [pad({ id: 'stick', axes: [0, 0, 0.1] })],
      [pad({ id: 'stick', axes: [0, 0.05, 0.2] })],
    )
    expect(out.ok).toBe(false)
  })
})

describe('throttle button calibration', () => {
  it('binds the first new press for FASTER, then a different one for SLOWER', () => {
    const cal = createButtonCalibration()
    cal.observe([pad({ id: 'stick', buttons: 8 })])                   // baseline
    expect(cal.observe([pad({ id: 'stick', buttons: 8, held: [4] })])).toBe(true)
    // Still holding 4 and pressing it again binds nothing: it is taken.
    cal.observe([pad({ id: 'stick', buttons: 8 })])
    cal.observe([pad({ id: 'stick', buttons: 8, held: [4] })])
    expect(cal.done()).toBe(false)
    cal.observe([pad({ id: 'stick', buttons: 8, held: [5] })])
    expect(cal.done()).toBe(true)
    expect(cal.result()).toEqual({
      ok: true,
      buttons: { faster: { id: 'stick', index: 4 }, slower: { id: 'stick', index: 5 } },
    })
  })

  it('ignores a button already held when the step opens', () => {
    const cal = createButtonCalibration()
    cal.observe([pad({ id: 'stick', buttons: 8, held: [2] })])        // wedged on from the start
    cal.observe([pad({ id: 'stick', buttons: 8, held: [2] })])
    expect(cal.done()).toBe(false)
    expect(cal.step().key).toBe('faster')
  })
})

describe('throttle reader', () => {
  const leverProfile = () => ({
    version: THROTTLE_PROFILE_VERSION, mode: 'lever',
    lever: { id: 'stick', axis: { index: 2, idle: -1, full: 1 } }, buttons: null,
  })

  it('does not take the throttle until the lever is moved, then sets it outright', () => {
    const r = createThrottleReader({ profileFor: leverProfile })
    r.poll([pad({ id: 'stick', axes: [0, 0, -1] })])   // parked at idle from last time
    expect(r.level()).toBe(null)
    expect(r.position()).toBe(0)
    r.poll([pad({ id: 'stick', axes: [0, 0, -1 + LEVER_WAKE] })])
    expect(r.level()).toBe(null)
    r.poll([pad({ id: 'stick', axes: [0, 0, 0.2] })])
    expect(r.level()).toBeCloseTo(0.6)
    // Once taken, it keeps the throttle, even held back at idle.
    r.poll([pad({ id: 'stick', axes: [0, 0, -1] })])
    expect(r.level()).toBe(0)
  })

  it('lets the keys fly again if the lever is unplugged', () => {
    const r = createThrottleReader({ profileFor: leverProfile })
    r.poll([pad({ id: 'stick', axes: [0, 0, -1] })])
    r.poll([pad({ id: 'stick', axes: [0, 0, 1] })])
    expect(r.level()).toBe(1)
    r.poll([])
    expect(r.level()).toBe(null)
  })

  it('reads the bound buttons as faster and slower, and nothing when uncalibrated', () => {
    const buttons = () => ({
      version: THROTTLE_PROFILE_VERSION, mode: 'buttons', lever: null,
      buttons: { faster: { id: 'stick', index: 4 }, slower: { id: 'stick', index: 5 } },
    })
    const r = createThrottleReader({ profileFor: buttons })
    r.poll([pad({ id: 'stick', buttons: 8, held: [4] })])
    expect(r.direction()).toBe(1)
    r.poll([pad({ id: 'stick', buttons: 8, held: [5] })])
    expect(r.direction()).toBe(-1)
    r.poll([pad({ id: 'stick', buttons: 8, held: [0] })])   // some other button
    expect(r.direction()).toBe(0)
    expect(r.level()).toBe(null)

    const none = createThrottleReader({ profileFor: () => null })
    none.poll([pad({ id: 'stick', axes: [0, 0, 1], buttons: 8, held: [4] })])
    expect(none.level()).toBe(null)
    expect(none.direction()).toBe(0)
  })
})

describe('throttle profile store', () => {
  it('keeps both setups and the chosen mode, and forgets them', () => {
    saveThrottleProfile({
      mode: 'buttons',
      lever: { id: 'stick', axis: { index: 2, idle: -1, full: 1 } },
      buttons: { faster: { id: 'stick', index: 4 }, slower: { id: 'stick', index: 5 } },
    })
    const p = loadThrottleProfile()
    expect(p.mode).toBe('buttons')
    expect(p.lever.axis.index).toBe(2)
    clearThrottleProfile()
    expect(loadThrottleProfile()).toBe(null)
  })
})

describe('pickPad with a throttle unit plugged in', () => {
  it('never takes a separate throttle unit for the stick, even with more buttons', () => {
    saveThrottleProfile({ mode: 'lever', lever: { id: 'quadrant', axis: { index: 0, idle: -1, full: 1 } }, buttons: null })
    const quadrant = pad({ id: 'quadrant', buttons: 20 })
    const stick = pad({ id: 'stick', buttons: 8 })
    expect(pickPad([quadrant, stick]).id).toBe('stick')
  })

  it('still flies a stick whose lever is on its own base', () => {
    saveThrottleProfile({ mode: 'lever', lever: { id: 'stick', axis: { index: 3, idle: 1, full: -1 } }, buttons: null })
    expect(pickPad([pad({ id: 'stick', buttons: 12 })]).id).toBe('stick')
    // And once calibrated as a stick it is a stick outright.
    saveProfile({ ...defaultProfile('stick'), calibrated: true })
    expect(pickPad([pad({ id: 'quadrant', buttons: 30 }), pad({ id: 'stick', buttons: 12 })]).id).toBe('stick')
  })
})

describe('flight model throttle lever', () => {
  it('sets the throttle outright from a lever, ignoring the key rate', () => {
    const f = createFlight()
    stepFlight(f, { throttle: 1, throttleLevel: 0.1 }, 1 / 60)
    expect(f.throttle).toBe(0.1)
    stepFlight(f, { throttle: 1 }, 1)
    expect(f.throttle).toBeGreaterThan(0.1)
  })
})
