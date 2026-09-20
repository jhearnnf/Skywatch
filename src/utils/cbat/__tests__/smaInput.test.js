import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { savePedalProfile, PEDAL_PROFILE_VERSION } from '../gamepad'
import {
  createSmaInput, padAxes, padRadius, clampPadOrigin, rampAxis,
  KEY_RAMP_MS, KEY_RELEASE_MS, PAD_RADIUS_FRACTION, SMA_SOURCE_LABEL,
} from '../smaInput'

// SMA is the only CBAT game that has to work identically on four control
// sources. What is worth pinning is not any one of them but the rule for which
// is in charge — a mouse resting off-centre while someone flies on a stick is
// the failure that would look like the joystick being broken.

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
})

describe('padAxes', () => {
  const origin = { x: 100, y: 100 }

  it('is centred on where the finger landed, not on the middle of the pad', () => {
    expect(padAxes(100, 100, origin, 60)).toEqual({ x: 0, y: 0 })
  })

  it('reaches full deflection at exactly the gesture radius', () => {
    expect(padAxes(160, 100, origin, 60).x).toBeCloseTo(1, 6)
    expect(padAxes(40, 100, origin, 60).x).toBeCloseTo(-1, 6)
  })

  it('does not exceed full deflection past the radius', () => {
    expect(padAxes(400, 100, origin, 60).x).toBe(1)
    expect(padAxes(100, -400, origin, 60).y).toBe(-1)
  })

  it('reads a downward move as +y, matching the stick and the mouse', () => {
    // +y is DOWN everywhere in this game — see the sign note in smaSim.js. A
    // flip here would make the touch pad the one control that flies inverted.
    expect(padAxes(100, 140, origin, 60).y).toBeGreaterThan(0)
    expect(padAxes(100, 60, origin, 60).y).toBeLessThan(0)
  })

  it('applies a dead zone, so a resting thumb is not a command', () => {
    expect(padAxes(101, 101, origin, 60)).toEqual({ x: 0, y: 0 })
  })
})

describe('clampPadOrigin', () => {
  const r = rect(0, 0, 300, 160)
  const radius = padRadius(r)

  it('sizes the gesture radius off the pad’s shorter side', () => {
    expect(radius).toBeCloseTo(160 * PAD_RADIUS_FRACTION, 6)
  })

  it('leaves an origin alone when a full-deflection circle already fits', () => {
    expect(clampPadOrigin(150, 80, r, radius)).toEqual({ x: 150, y: 80 })
  })

  it('pulls an origin inward so full deflection stays reachable in every direction', () => {
    // A finger landing hard against the left edge would otherwise have no room
    // to push left, and the dot would be uncorrectable in exactly one direction.
    const o = clampPadOrigin(2, 4, r, radius)
    expect(o.x).toBeCloseTo(radius, 6)
    expect(o.y).toBeCloseTo(radius, 6)
    expect(padAxes(o.x - radius, o.y, o, radius).x).toBeCloseTo(-1, 6)
  })

  it('collapses to the middle rather than inverting on a pad narrower than the circle', () => {
    const tiny = rect(0, 0, 20, 20)
    expect(clampPadOrigin(0, 0, tiny, 50)).toEqual({ x: 10, y: 10 })
  })
})

describe('rampAxis', () => {
  it('takes KEY_RAMP_MS to reach full deflection from rest', () => {
    expect(rampAxis(0, 1, KEY_RAMP_MS)).toBe(1)
    expect(rampAxis(0, 1, KEY_RAMP_MS / 2)).toBeCloseTo(0.5, 6)
  })

  it('releases faster than it commands', () => {
    // A switched input on a rate-control task is unusable: every tap becomes a
    // full-rate command. The asymmetry is what makes a key tap a nudge.
    expect(KEY_RELEASE_MS).toBeLessThan(KEY_RAMP_MS)
    expect(rampAxis(1, 0, KEY_RELEASE_MS)).toBe(0)
  })

  it('never overshoots its target', () => {
    expect(rampAxis(0.9, 1, 10000)).toBe(1)
    expect(rampAxis(-0.9, 0, 10000)).toBe(0)
  })
})

// ── Source arbitration ───────────────────────────────────────────────────────

describe('createSmaInput source priority', () => {
  let input

  beforeEach(() => {
    // No gamepads by default; individual tests install a fake.
    navigator.getGamepads = () => []
  })
  afterEach(() => {
    input?.dispose()
    input = null
    delete navigator.getGamepads
  })

  const arena = () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => rect(0, 0, 400, 400)
    return el
  }

  it('defaults to the mouse and reads deflection from the arena centre', () => {
    input = createSmaInput({ el: arena() })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
    input.poll(16)
    expect(input.source()).toBe('pointer')
    expect(input.axes().x).toBeGreaterThan(0.9)
    expect(input.axes().y).toBe(0)
  })

  it('ignores a touch on the arena — that is what the pad is for', () => {
    // A finger on the face would cover the dot it is chasing, so touch steers
    // from the pad below and nowhere else.
    input = createSmaInput({ el: arena() })
    const e = new MouseEvent('pointermove', { clientX: 400, clientY: 200 })
    Object.defineProperty(e, 'pointerType', { value: 'touch' })
    window.dispatchEvent(e)
    input.poll(16)
    expect(input.axes()).toEqual({ x: 0, y: 0 })
  })

  it('hands control to the pad while a finger is down, and back when it lifts', () => {
    input = createSmaInput({ el: arena() })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
    input.poll(16)
    expect(input.source()).toBe('pointer')

    const padRect = rect(0, 500, 300, 160)
    input.padDown(150, 580, padRect, 1)
    input.padMove(150 + padRadius(padRect), 580, 1)
    input.poll(16)
    expect(input.source()).toBe('pad')
    expect(input.axes().x).toBeCloseTo(1, 6)

    input.padUp(1)
    input.poll(16)
    // The mouse is still parked at the right-hand edge, so it takes over again
    // exactly where it left off rather than the control snapping to centre.
    expect(input.source()).toBe('pointer')
    expect(input.axes().x).toBeGreaterThan(0.9)
  })

  it('lets a second finger neither steal nor cancel the gesture', () => {
    input = createSmaInput({ el: arena() })
    const padRect = rect(0, 500, 300, 160)
    input.padDown(150, 580, padRect, 1)
    input.padDown(40, 520, padRect, 2)     // a second thumb lands
    input.padMove(150 + padRadius(padRect), 580, 1)
    input.poll(16)
    expect(input.axes().x).toBeCloseTo(1, 6)

    input.padUp(2)                          // and lifts again
    input.poll(16)
    expect(input.source()).toBe('pad')
    expect(input.axes().x).toBeCloseTo(1, 6)
  })

  it('exposes the live gesture so the pad can draw its knob', () => {
    input = createSmaInput({ el: arena() })
    expect(input.padGesture()).toBeNull()
    const padRect = rect(0, 500, 300, 160)
    input.padDown(150, 580, padRect, 1)
    const g = input.padGesture()
    expect(g.origin).toEqual({ x: 150, y: 580 })
    expect(g.radius).toBeCloseTo(padRadius(padRect), 6)
    input.padUp(1)
    expect(input.padGesture()).toBeNull()
  })

  it('takes over for a stick only once it is actually moved', () => {
    const pad = {
      id: 'Fake Stick', connected: true,
      axes: [0, 0], buttons: [{ pressed: false, value: 0 }],
    }
    navigator.getGamepads = () => [pad]
    input = createSmaInput({ el: arena() })

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
    input.poll(16)
    // Connected but centred. A stick sitting plugged in must not silently
    // deaden a mouse the player is using.
    expect(input.source()).toBe('pointer')

    pad.axes = [0.9, -0.9]
    input.poll(16)
    expect(input.source()).toBe('gamepad')
    expect(input.axes().x).toBeGreaterThan(0.5)
    // Raw pitch of -0.9 is the stick pushed away on the usual driver
    // convention, and SMA sends the dot DOWN for that — see STICK_PITCH_SIGN.
    expect(input.axes().y).toBeGreaterThan(0.5)

    // And it keeps the job once centred again — a centred stick is a command to
    // hold still, not an absence of input, so the mouse must not grab it back.
    pad.axes = [0, 0]
    input.poll(16)
    expect(input.source()).toBe('gamepad')
    expect(input.axes()).toEqual({ x: 0, y: 0 })
  })

  it('flies the stick the way the real apparatus does, unlike RTT and ACT', () => {
    // SMA is the one game that inverts stick pitch: push away, dot down. The
    // shared gamepad layer hands out the opposite sign because RTT and ACT
    // follow the mouse, so if this flip is ever lost the game silently starts
    // teaching the reverse of the habit it exists to train.
    const pad = { id: 'Fake Stick', connected: true, axes: [0, 0], buttons: [] }
    navigator.getGamepads = () => [pad]
    input = createSmaInput({ el: arena() })

    pad.axes = [0, -1]          // pushed away, as nearly every driver reports it
    input.poll(16)
    expect(input.source()).toBe('gamepad')
    expect(input.axes().y).toBeGreaterThan(0.5)

    pad.axes = [0, 1]           // pulled back
    input.poll(16)
    expect(input.axes().y).toBeLessThan(-0.5)

    // Roll is untouched by the flip: right is still right.
    pad.axes = [1, 0]
    input.poll(16)
    expect(input.axes().x).toBeGreaterThan(0.5)
  })

  it('falls back to the mouse when the stick is unplugged mid-run', () => {
    const pad = { id: 'Fake Stick', connected: true, axes: [0.9, 0], buttons: [] }
    let pads = [pad]
    navigator.getGamepads = () => pads
    input = createSmaInput({ el: arena() })
    input.poll(16)
    expect(input.source()).toBe('gamepad')

    pads = []
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
    input.poll(16)
    // A USB dropout is not a reason to void a timed run.
    expect(input.source()).toBe('pointer')
    expect(input.axes().x).toBeGreaterThan(0.9)
  })

  it('lets held keys beat a parked mouse, and ramps rather than switches', () => {
    input = createSmaInput({ el: arena() })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
    input.poll(16)
    expect(input.source()).toBe('pointer')

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }))
    input.poll(KEY_RAMP_MS / 2)
    expect(input.source()).toBe('keyboard')
    expect(input.axes().x).toBeCloseTo(-0.5, 6)
    input.poll(KEY_RAMP_MS)
    expect(input.axes().x).toBe(-1)

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }))
    input.poll(KEY_RELEASE_MS)
    input.poll(16)
    // Wound all the way down, so the mouse gets the job back.
    expect(input.source()).toBe('pointer')
  })

  it('cancels opposing keys instead of letting the last one win', () => {
    input = createSmaInput({ el: arena() })
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }))
    input.poll(KEY_RAMP_MS)
    expect(input.axes().x).toBe(0)
  })

  it('drops every held key when the window loses focus', () => {
    // Otherwise a tab switch leaves a key logically held and the dot flies into
    // the bezel while nobody is watching.
    input = createSmaInput({ el: arena() })
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' }))
    input.poll(KEY_RAMP_MS)
    expect(input.axes().y).toBe(1)

    window.dispatchEvent(new Event('blur'))
    input.poll(KEY_RELEASE_MS)
    expect(input.axes().y).toBe(0)
  })

  it('leaves modifier chords to the browser', () => {
    input = createSmaInput({ el: arena() })
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', ctrlKey: true }))
    input.poll(KEY_RAMP_MS)
    expect(input.axes().x).toBe(0)
  })

  it('centres the control when the pointer leaves the document entirely', () => {
    input = createSmaInput({ el: arena() })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
    input.poll(16)
    expect(input.axes().x).toBeGreaterThan(0.9)

    const out = new MouseEvent('pointerout')
    Object.defineProperty(out, 'relatedTarget', { value: null })
    window.dispatchEvent(out)
    input.poll(16)
    // The alternative is a dot running for the bezel because the pointer is off
    // in another window.
    expect(input.axes()).toEqual({ x: 0, y: 0 })
  })

  it('unbinds everything on dispose', () => {
    const spy = vi.spyOn(window, 'removeEventListener')
    input = createSmaInput({ el: arena() })
    input.dispose()
    const removed = spy.mock.calls.map(c => c[0])
    for (const evt of ['pointermove', 'pointerout', 'keydown', 'keyup', 'blur', 'resize', 'scroll', 'gamepaddisconnected']) {
      expect([evt, removed.includes(evt)]).toEqual([evt, true])
    }
    spy.mockRestore()
    input = null
  })

  it('names every source it can report', () => {
    for (const key of ['pad', 'pointer', 'gamepad', 'keyboard']) {
      expect([key, !!SMA_SOURCE_LABEL[key]]).toEqual([key, true])
    }
  })

  // The real split: pedals own the lateral axis, whatever holds the vertical
  // one. Pedals only ever come from a calibration, and only take the axis once
  // they have actually been pushed.
  describe('pedals', () => {
    const pedalProfile = (sign = 1) => savePedalProfile({
      id: 'Pedals', version: PEDAL_PROFILE_VERSION, calibrated: true,
      axis: { index: 2, centre: 0, min: -1, max: 1, sign },
    })
    beforeEach(() => localStorage.clear())
    afterEach(() => localStorage.clear())

    it('leaves uncalibrated pedals unread, even when they are the only device', () => {
      const pedals = { id: 'Pedals', connected: true, axes: [0, 0, 0.9], buttons: [] }
      navigator.getGamepads = () => [pedals]
      input = createSmaInput({ el: arena() })
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 300 }))
      input.poll(16)
      // No pedal profile, so the device is a stick candidate on axes 0/1 —
      // which are centred — and the mouse keeps the job.
      expect(input.pedalsEngaged()).toBe(false)
      expect(input.source()).toBe('pointer')
      expect(input.axes().x).toBe(0)
    })

    it('takes the lateral axis from calibrated pedals once pushed, and keeps the stick on vertical', () => {
      pedalProfile(-1)
      const stick = { id: 'Sidestick', connected: true, axes: [0, 0], buttons: Array(12).fill({ pressed: false, value: 0 }) }
      const pedals = { id: 'Pedals', connected: true, axes: [0, 0, 0], buttons: [] }
      navigator.getGamepads = () => [pedals, stick]
      input = createSmaInput({ el: arena() })

      // Stick pushed away, feet resting: stick flies both, as before.
      stick.axes = [0.9, -0.9]
      input.poll(16)
      expect(input.source()).toBe('gamepad')
      expect(input.pedalsEngaged()).toBe(false)
      expect(input.axes().x).toBeGreaterThan(0.5)

      // Right pedal forward (negative on this driver) → +x, and the stick's
      // own roll is no longer read.
      pedals.axes = [0, 0, -0.9]
      stick.axes = [-0.9, -0.9]
      input.poll(16)
      expect(input.pedalsEngaged()).toBe(true)
      expect(input.pedalsId()).toBe('Pedals')
      expect(input.axes().x).toBeGreaterThan(0.5)
      expect(input.axes().y).toBeGreaterThan(0.5)

      // Feet back to rest: pedals still own x (a centred pedal is a command).
      pedals.axes = [0, 0, 0]
      input.poll(16)
      expect(input.pedalsEngaged()).toBe(true)
      expect(input.axes().x).toBe(0)
      expect(Object.is(input.axes().x, 0)).toBe(true)
      // Stick on the vertical axis, pedals on the lateral: the board gets both.
      expect(input.inputMethod()).toBe('joystick')
      expect(input.usedPedals()).toBe(true)
    })

    it('pairs pedals with a mouse on the vertical axis when there is no stick', () => {
      pedalProfile()
      const pedals = { id: 'Pedals', connected: true, axes: [0, 0, 0], buttons: [] }
      navigator.getGamepads = () => [pedals]
      input = createSmaInput({ el: arena() })
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 350 }))
      pedals.axes = [0, 0, 0.9]
      input.poll(16)
      // Calibrated pedals are never the stick, so the mouse keeps vertical.
      expect(input.source()).toBe('pointer')
      expect(input.pedalsEngaged()).toBe(true)
      expect(input.axes().x).toBeGreaterThan(0.5)
      expect(input.axes().y).toBeGreaterThan(0.5)
      // The mouse flew the vertical axis, so that is the run's method — pedals
      // are recorded beside it, not instead of it, and never as a joystick.
      expect(input.inputTally()).toEqual({ joystick: 0, 'keyboard-mouse': 1, touch: 0 })
      expect(input.inputMethod()).toBe('keyboard-mouse')
      expect(input.usedPedals()).toBe(true)
    })

    // The same majority rule the method uses, on the lateral axis: pedals that
    // held it for at least half the run count, a late nudge does not.
    it('credits the pedals only when they held the lateral axis for at least half the run', () => {
      pedalProfile()
      const pedals = { id: 'Pedals', connected: true, axes: [0, 0, 0], buttons: [] }
      navigator.getGamepads = () => [pedals]
      input = createSmaInput({ el: arena() })
      expect(input.usedPedals()).toBeNull()   // nothing has steered yet
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 350 }))
      for (let i = 0; i < 6; i++) input.poll(16)   // six mouse-only frames
      expect(input.usedPedals()).toBe(false)
      pedals.axes = [0, 0, 0.9]
      for (let i = 0; i < 5; i++) input.poll(16)   // five pedal frames: 5 of 11
      expect(input.usedPedals()).toBe(false)
      input.poll(16)                               // 6 of 12: half, and counted
      expect(input.usedPedals()).toBe(true)
    })

    it('lets the pedals go when they are unplugged', () => {
      pedalProfile()
      const pedals = { id: 'Pedals', connected: true, axes: [0, 0, 0.9], buttons: [] }
      let pads = [pedals]
      navigator.getGamepads = () => pads
      input = createSmaInput({ el: arena() })
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
      input.poll(16)
      expect(input.pedalsEngaged()).toBe(true)
      pads = []
      input.poll(16)
      expect(input.pedalsEngaged()).toBe(false)
      expect(input.axes().x).toBeGreaterThan(0.9)   // the mouse has x back
    })
  })

  // What the score gets labelled with. Four sources fold into three labels:
  // keys and mouse are one desk, the pad is touch, the stick is a joystick.
  describe('input method', () => {
    it('reports nothing before anything has steered', () => {
      input = createSmaInput({ el: arena() })
      input.poll(16)
      expect(input.inputMethod()).toBeNull()
    })

    it('folds keys and mouse into one label', () => {
      input = createSmaInput({ el: arena() })
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
      input.poll(16)
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }))
      input.poll(16); input.poll(16)
      expect(input.inputTally()).toMatchObject({ 'keyboard-mouse': 3, touch: 0, joystick: 0 })
      expect(input.inputMethod()).toBe('keyboard-mouse')
    })

    it('reads a pad-flown run as touch, counting only while the finger is down', () => {
      input = createSmaInput({ el: arena() })
      input.padDown(100, 100, rect(0, 400, 400, 200), 1)
      input.poll(16); input.poll(16); input.poll(16)
      input.padUp(1)
      input.poll(16)   // lifted, and no mouse anywhere: nobody is flying
      expect(input.inputTally()).toMatchObject({ touch: 3, 'keyboard-mouse': 0 })
      expect(input.inputMethod()).toBe('touch')
    })

    it('reads a stick-flown run as joystick once the stick has woken', () => {
      const pad = { id: 'Fake Stick', connected: true, axes: [0, 0], buttons: [{ pressed: false, value: 0 }] }
      navigator.getGamepads = () => [pad]
      input = createSmaInput({ el: arena() })
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 200 }))
      input.poll(16)   // stick idle: the mouse's frame
      pad.axes = [0.9, 0]
      input.poll(16)
      pad.axes = [0, 0]
      input.poll(16)   // centred but still in charge: still the stick's frame
      expect(input.inputTally()).toMatchObject({ joystick: 2, 'keyboard-mouse': 1 })
      expect(input.inputMethod()).toBe('joystick')
    })
  })
})
