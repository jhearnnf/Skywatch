import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    expect(input.axes().y).toBeLessThan(-0.5)

    // And it keeps the job once centred again — a centred stick is a command to
    // hold still, not an absence of input, so the mouse must not grab it back.
    pad.axes = [0, 0]
    input.poll(16)
    expect(input.source()).toBe('gamepad')
    expect(input.axes()).toEqual({ x: 0, y: 0 })
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
})
