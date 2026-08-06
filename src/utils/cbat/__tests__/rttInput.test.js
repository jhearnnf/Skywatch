import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  createRttInput, applyCurve, pointerAxes, clamp1,
  RTT_DEAD_ZONE, RTT_EXPO,
} from '../rttInput'

// A 400×200 arena whose centre sits at (300, 200) in client coordinates. Both
// axes are normalised by HALF THE HEIGHT (100), so the same hand movement means
// the same rate in either direction.
const RECT = { left: 100, top: 100, width: 400, height: 200 }

function makeArena() {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => RECT
  document.body.appendChild(el)
  return el
}

function pointerEvent(type, { clientX = 0, clientY = 0, pointerType = 'mouse', button = 0 } = {}) {
  const e = new MouseEvent(type, { clientX, clientY, button, bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e
}

const created = []
function input(el) {
  const i = createRttInput({ el })
  created.push(i)
  return i
}

afterEach(() => {
  while (created.length) created.pop().dispose()
  document.body.innerHTML = ''
  delete navigator.getGamepads
})

describe('applyCurve', () => {
  it('is dead inside the dead zone', () => {
    expect(applyCurve(0)).toBe(0)
    expect(applyCurve(RTT_DEAD_ZONE)).toBe(0)
    expect(applyCurve(-RTT_DEAD_ZONE)).toBe(0)
    expect(applyCurve(RTT_DEAD_ZONE + 0.01)).toBeGreaterThan(0)
  })

  it('still reaches full deflection at the ends', () => {
    expect(applyCurve(1)).toBeCloseTo(1)
    expect(applyCurve(-1)).toBeCloseTo(-1)
  })

  it('clamps past full deflection instead of running away', () => {
    expect(applyCurve(4)).toBeCloseTo(1)
    expect(applyCurve(-9)).toBeCloseTo(-1)
    expect(clamp1(3)).toBe(1)
    expect(clamp1(-3)).toBe(-1)
    expect(clamp1(0.4)).toBe(0.4)
  })

  it('is monotonic and odd', () => {
    let prev = -Infinity
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const out = applyCurve(v)
      expect(out).toBeGreaterThanOrEqual(prev)
      expect(applyCurve(-v)).toBeCloseTo(-out)
      prev = out
    }
  })

  it('gives finer control near centre than a linear stick would', () => {
    // The whole point of expo: half deflection must move the camera at LESS
    // than half rate, or tracking a walker is impossible.
    expect(applyCurve(0.5)).toBeLessThan(0.5)
    expect(applyCurve(0.5, RTT_DEAD_ZONE, 0)).toBeGreaterThan(applyCurve(0.5, RTT_DEAD_ZONE, RTT_EXPO))
  })
})

describe('pointerAxes', () => {
  it('is centred at the middle of the arena', () => {
    expect(pointerAxes(300, 200, RECT)).toEqual({ x: 0, y: 0 })
  })

  it('normalises both axes by half the height, so the response is square', () => {
    // 100 px right and 100 px down are both exactly full deflection.
    const right = pointerAxes(400, 200, RECT)
    const down = pointerAxes(300, 300, RECT)
    expect(right.x).toBeCloseTo(1)
    expect(right.y).toBe(0)
    expect(down.y).toBeCloseTo(1)
    expect(down.x).toBe(0)
  })

  it('signs left/up negative', () => {
    expect(pointerAxes(200, 100, RECT).x).toBeCloseTo(-1)
    expect(pointerAxes(200, 100, RECT).y).toBeCloseTo(-1)
  })

  it('pegs the stick rather than overshooting when the pointer leaves the arena', () => {
    expect(pointerAxes(9000, 200, RECT).x).toBeCloseTo(1)
  })
})

describe('createRttInput — pointer', () => {
  it('reads zero until the pointer has been anywhere', () => {
    const i = input(makeArena())
    i.poll()
    expect(i.axes()).toEqual({ x: 0, y: 0 })
    expect(i.source()).toBe('pointer')
  })

  it('turns pointer position into stick deflection', () => {
    const i = input(makeArena())
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 200 }))
    i.poll()
    expect(i.axes().x).toBeCloseTo(1)
    expect(i.axes().y).toBe(0)
  })

  it('keeps tracking past the edge of the arena, so the camera does not freeze', () => {
    const i = input(makeArena())
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 5000, clientY: 200 }))
    i.poll()
    expect(i.axes().x).toBeCloseTo(1)
  })

  it('centres the stick when the pointer leaves the document', () => {
    const i = input(makeArena())
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 200 }))
    i.poll()
    expect(i.axes().x).toBeCloseTo(1)
    const out = pointerEvent('pointerout', { clientX: 400, clientY: 200 })
    Object.defineProperty(out, 'relatedTarget', { value: null })
    window.dispatchEvent(out)
    i.poll()
    expect(i.axes()).toEqual({ x: 0, y: 0 })
  })

  it('counts a left click in the arena as a shot', () => {
    const el = makeArena()
    const i = input(el)
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 300, clientY: 200 }))
    expect(i.consumeTriggerEdges()).toBe(1)
    expect(i.consumeTriggerEdges()).toBe(0)
  })

  it('ignores a right click', () => {
    const el = makeArena()
    const i = input(el)
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 300, clientY: 200, button: 2 }))
    expect(i.consumeTriggerEdges()).toBe(0)
  })

  it('counts Space as a shot, once per press', () => {
    const i = input(makeArena())
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
    expect(i.consumeTriggerEdges()).toBe(1)
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
    expect(i.consumeTriggerEdges()).toBe(1)
  })

  it('reports every press when two land between polls', () => {
    const el = makeArena()
    const i = input(el)
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 300, clientY: 200 }))
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 300, clientY: 200 }))
    expect(i.consumeTriggerEdges()).toBe(2)
  })

  it('lets the on-screen shutter fire without a pointer event', () => {
    const i = input(makeArena())
    i.fireTrigger()
    expect(i.consumeTriggerEdges()).toBe(1)
  })

  it('stops listening once disposed', () => {
    const el = makeArena()
    const i = createRttInput({ el })
    i.dispose()
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 300, clientY: 200 }))
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 200 }))
    i.poll()
    expect(i.consumeTriggerEdges()).toBe(0)
    expect(i.axes()).toEqual({ x: 0, y: 0 })
  })
})

describe('createRttInput — touch', () => {
  it('only slews while a finger that started in the arena is down', () => {
    const el = makeArena()
    const i = input(el)

    // A finger dragging across the page without ever touching the arena — e.g.
    // reaching for the shutter button below it — must not move the aim.
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 200, pointerType: 'touch' }))
    i.poll()
    expect(i.axes()).toEqual({ x: 0, y: 0 })

    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 350, clientY: 200, pointerType: 'touch' }))
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 200, pointerType: 'touch' }))
    i.poll()
    expect(i.axes().x).toBeCloseTo(1)
  })

  it('springs back to centre when the finger lifts', () => {
    const el = makeArena()
    const i = input(el)
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 400, clientY: 200, pointerType: 'touch' }))
    i.poll()
    expect(i.axes().x).toBeCloseTo(1)
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 400, clientY: 200, pointerType: 'touch' }))
    i.poll()
    expect(i.axes()).toEqual({ x: 0, y: 0 })
  })

  it('does not treat a touch as a shot — the shutter is its own button', () => {
    const el = makeArena()
    const i = input(el)
    el.dispatchEvent(pointerEvent('pointerdown', { clientX: 300, clientY: 200, pointerType: 'touch' }))
    expect(i.consumeTriggerEdges()).toBe(0)
  })
})

// The contract that makes a real joystick a drop-in later: the gamepad source
// produces the same curved axis pair and the same trigger edges as the pointer,
// so nothing downstream changes.
describe('createRttInput — gamepad', () => {
  const pad = (axes = [0, 0], pressed = false) => ({
    connected: true,
    axes,
    buttons: [{ pressed }, { pressed: false }],
  })

  it('leaves a connected but idle stick alone', () => {
    navigator.getGamepads = vi.fn(() => [pad([0.02, -0.01])])
    const i = input(makeArena())
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 200 }))
    i.poll()
    expect(i.source()).toBe('pointer')
    expect(i.axes().x).toBeCloseTo(1)
  })

  it('takes over the moment the stick is actually moved', () => {
    navigator.getGamepads = vi.fn(() => [pad([0.9, -0.5])])
    const i = input(makeArena())
    i.poll()
    expect(i.source()).toBe('gamepad')
    expect(i.axes().x).toBeGreaterThan(0)
    expect(i.axes().y).toBeLessThan(0)
  })

  it('curves and dead-zones gamepad axes exactly like the pointer', () => {
    navigator.getGamepads = vi.fn(() => [pad([1, 0.5], true)])
    const i = input(makeArena())
    i.poll()
    expect(i.axes().x).toBeCloseTo(applyCurve(1))
    expect(i.axes().y).toBeCloseTo(applyCurve(0.5))
  })

  it('fires one shot per trigger squeeze, not one per frame held', () => {
    let held = false
    navigator.getGamepads = vi.fn(() => [pad([0.9, 0], held)])
    const i = input(makeArena())
    i.poll()
    held = true
    i.poll(); i.poll(); i.poll()
    expect(i.consumeTriggerEdges()).toBe(1)
    held = false
    i.poll()
    held = true
    i.poll()
    expect(i.consumeTriggerEdges()).toBe(1)
  })

  it('hands control back to the pointer when the stick is unplugged', () => {
    navigator.getGamepads = vi.fn(() => [pad([0.9, 0])])
    const i = input(makeArena())
    i.poll()
    expect(i.source()).toBe('gamepad')

    navigator.getGamepads = vi.fn(() => [])
    window.dispatchEvent(new Event('gamepaddisconnected'))
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 200, clientY: 200 }))
    i.poll()
    expect(i.source()).toBe('pointer')
    expect(i.axes().x).toBeCloseTo(-1)
  })

  it('survives a browser that has no gamepad API at all', () => {
    delete navigator.getGamepads
    const i = input(makeArena())
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 200 }))
    expect(() => i.poll()).not.toThrow()
    expect(i.axes().x).toBeCloseTo(1)
  })
})
