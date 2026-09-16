import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createPedalCalibration, createPedalReader, readPedalAxis, PEDAL_CALIBRATION_STEPS,
} from '../pedals'
import {
  pickPad, savePedalProfile, loadPedalProfile, clearPedalProfile, saveProfile,
  PEDAL_PROFILE_VERSION, STICK_WAKE,
} from '../gamepad'

// Pedals are learned, never guessed: nobody working on this owns a set, and a
// guessed rudder axis is a toe brake steering the dot. What is worth pinning
// is that the calibration finds the right device AND axis whichever way the
// pedals are plugged in, and that once learned they fly the right way round.

function pad({ id, axes = [0, 0], buttons = 0 }) {
  return {
    id, connected: true, axes,
    buttons: Array.from({ length: buttons }, () => ({ pressed: false, value: 0 })),
  }
}

// Walk the three steps with the given snapshots of every pad.
function calibrate(snapshots) {
  const cal = createPedalCalibration()
  for (const pads of snapshots) {
    cal.observe(pads)
    cal.commit()
  }
  expect(cal.done()).toBe(true)
  return cal.result()
}

let pads = []
beforeEach(() => {
  localStorage.clear()
  navigator.getGamepads = () => pads
})
afterEach(() => {
  delete navigator.getGamepads
  localStorage.clear()
  pads = []
})

describe('createPedalCalibration', () => {
  it('asks for rest, right and left, and commits from the panel rather than a button', () => {
    expect(PEDAL_CALIBRATION_STEPS.map(s => s.key)).toEqual(['centre', 'right', 'left'])
    const cal = createPedalCalibration()
    expect(cal.step().key).toBe('centre')
    cal.observe([pad({ id: 'Pedals', axes: [0, 0, 0] })])
    // Pedals have no buttons, so nothing advances until the panel says so.
    expect(cal.step().key).toBe('centre')
    cal.commit()
    expect(cal.step().key).toBe('right')
  })

  it('learns which device and axis the pedals are on, with right pedal positive', () => {
    // Pedals on their own USB lead, rudder on their third axis, alongside a
    // stick that sits still. On this driver right pedal reads negative.
    const stick = pad({ id: 'Sidestick', axes: [0, 0], buttons: 12 })
    const res = calibrate([
      [stick, pad({ id: 'Pedals', axes: [0, 0, 0.02] })],
      [stick, pad({ id: 'Pedals', axes: [0, 0, -0.95] })],
      [stick, pad({ id: 'Pedals', axes: [0, 0, 0.97] })],
    ])
    expect(res.ok).toBe(true)
    expect(res.profile.id).toBe('Pedals')
    expect(res.profile.axis.index).toBe(2)
    expect(res.profile.version).toBe(PEDAL_PROFILE_VERSION)

    // Right pedal forward is +x: the dot goes right, which is what you press
    // when it has drifted left.
    expect(readPedalAxis(pad({ id: 'Pedals', axes: [0, 0, -0.95] }), res.profile)).toBeGreaterThan(0.9)
    expect(readPedalAxis(pad({ id: 'Pedals', axes: [0, 0, 0.97] }), res.profile)).toBeLessThan(-0.9)
    expect(readPedalAxis(pad({ id: 'Pedals', axes: [0, 0, 0.02] }), res.profile)).toBe(0)
  })

  it('finds pedals daisy-chained into the stick, as a third axis on the same device', () => {
    // The same pedals plugged into a HOTAS enumerate as extra axes on the
    // stick's own id. The profile then points at the stick's device, and the
    // stick keeps its first two axes.
    const res = calibrate([
      [pad({ id: 'HOTAS', axes: [0, 0, 0, 0, 0], buttons: 12 })],
      [pad({ id: 'HOTAS', axes: [0, 0, 0, 0, 0.9], buttons: 12 })],
      [pad({ id: 'HOTAS', axes: [0, 0, 0, 0, -0.9], buttons: 12 })],
    ])
    expect(res.ok).toBe(true)
    expect(res.profile.id).toBe('HOTAS')
    expect(res.profile.axis.index).toBe(4)
    expect(res.profile.axis.sign).toBe(1)
  })

  it('refuses when nothing moved far enough', () => {
    const res = calibrate([
      [pad({ id: 'Pedals', axes: [0, 0, 0] })],
      [pad({ id: 'Pedals', axes: [0, 0, 0.1] })],
      [pad({ id: 'Pedals', axes: [0, 0, -0.1] })],
    ])
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/far enough/i)
  })

  it('ignores a device that was not present for every step', () => {
    const res = calibrate([
      [pad({ id: 'Pedals', axes: [0, 0, 0] })],
      [pad({ id: 'Pedals', axes: [0, 0, 0.9] }), pad({ id: 'Late', axes: [1, 0] })],
      [pad({ id: 'Pedals', axes: [0, 0, -0.9] }), pad({ id: 'Late', axes: [-1, 0] })],
    ])
    expect(res.ok).toBe(true)
    expect(res.profile.id).toBe('Pedals')
  })
})

describe('createPedalReader', () => {
  it('reads nothing until a set has been calibrated', () => {
    pads = [pad({ id: 'Pedals', axes: [0, 0, 0.9] })]
    const r = createPedalReader()
    r.poll()
    expect(r.connected()).toBe(false)
    expect(r.x()).toBe(0)
  })

  it('reads the calibrated device, wakes past the threshold and reports -0 as 0', () => {
    savePedalProfile({
      id: 'Pedals', version: PEDAL_PROFILE_VERSION, calibrated: true,
      axis: { index: 2, centre: 0, min: -1, max: 1, sign: -1 },
    })
    const p = pad({ id: 'Pedals', axes: [0, 0, 0] })
    pads = [pad({ id: 'Sidestick', axes: [0.9, 0], buttons: 12 }), p]
    const r = createPedalReader()
    r.poll()
    expect(r.connected()).toBe(true)
    expect(r.padId()).toBe('Pedals')
    expect(r.awake()).toBe(false)
    expect(Object.is(r.x(), 0)).toBe(true)

    p.axes = [0, 0, -0.8]
    r.poll()
    expect(r.x()).toBeGreaterThan(STICK_WAKE)
    expect(r.awake()).toBe(true)

    pads = []
    r.poll()
    expect(r.connected()).toBe(false)
    expect(r.x()).toBe(0)
  })

  it('picks up a fresh calibration after refresh()', () => {
    savePedalProfile({
      id: 'Pedals', version: PEDAL_PROFILE_VERSION, calibrated: true,
      axis: { index: 2, centre: 0, min: -1, max: 1, sign: 1 },
    })
    const p = pad({ id: 'Pedals', axes: [0, 0, 0.8] })
    pads = [p]
    const r = createPedalReader()
    r.poll()
    expect(r.x()).toBeGreaterThan(0)
    savePedalProfile({ ...loadPedalProfile('Pedals'), axis: { index: 2, centre: 0, min: -1, max: 1, sign: -1 } })
    r.poll()
    expect(r.x()).toBeGreaterThan(0)   // cached until told
    r.refresh()
    r.poll()
    expect(r.x()).toBeLessThan(0)
    clearPedalProfile('Pedals')
    r.refresh()
    r.poll()
    expect(r.connected()).toBe(false)
  })
})

describe('pickPad with pedals about', () => {
  it('never hands a device known only as pedals to the stick', () => {
    savePedalProfile({
      id: 'Pedals', version: PEDAL_PROFILE_VERSION, calibrated: true,
      axis: { index: 2, centre: 0, min: -1, max: 1, sign: 1 },
    })
    const pedals = pad({ id: 'Pedals', axes: [0, 0, 0] })
    const stick = pad({ id: 'Sidestick', axes: [0, 0], buttons: 12 })
    expect(pickPad([pedals, stick], null).id).toBe('Sidestick')
    // Pedals alone are not a stick.
    expect(pickPad([pedals], null)).toBeNull()
    // Unless the setup screen asks for that device by name.
    expect(pickPad([pedals], 'Pedals').id).toBe('Pedals')
  })

  it('keeps a device that is both stick and pedals as the stick', () => {
    savePedalProfile({
      id: 'HOTAS', version: PEDAL_PROFILE_VERSION, calibrated: true,
      axis: { index: 4, centre: 0, min: -1, max: 1, sign: 1 },
    })
    saveProfile({
      id: 'HOTAS', version: 2, calibrated: true,
      x: { index: 0, centre: 0, min: -1, max: 1, sign: 1 },
      y: { index: 1, centre: 0, min: -1, max: 1, sign: 1 },
      triggerButtons: [], actionButtons: [],
    })
    const hotas = pad({ id: 'HOTAS', axes: [0, 0, 0, 0, 0], buttons: 12 })
    expect(pickPad([hotas], null).id).toBe('HOTAS')
  })

  it('prefers a calibrated stick, then the device with more buttons', () => {
    // Uncalibrated pedals listed first must not become the stick: they have
    // no buttons and the stick has a dozen.
    const pedals = pad({ id: 'Pedals', axes: [0, 0, 0], buttons: 0 })
    const stick = pad({ id: 'Sidestick', axes: [0, 0], buttons: 12 })
    expect(pickPad([pedals, stick], null).id).toBe('Sidestick')

    // A calibrated stick beats a bigger uncalibrated device.
    saveProfile({
      id: 'Small', version: 2, calibrated: true,
      x: { index: 0, centre: 0, min: -1, max: 1, sign: 1 },
      y: { index: 1, centre: 0, min: -1, max: 1, sign: 1 },
      triggerButtons: [], actionButtons: [],
    })
    const small = pad({ id: 'Small', axes: [0, 0], buttons: 2 })
    expect(pickPad([stick, small], null).id).toBe('Small')
  })
})
