import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  stickDelta, createActStick,
  readStoredActStickRate, storeActStickRate,
  DEFAULT_ACT_STICK_RATE, MIN_ACT_STICK_RATE, MAX_ACT_STICK_RATE,
} from '../actStickInput'
import { saveProfile, defaultProfile } from '../gamepad'

// ACT converts pixel-equivalents to rotation with TURN_RATE = 0.006 rad/px.
// Kept here as a literal on purpose: if the game's constant moves, this test
// should fail and make someone re-check the stick feels right, rather than
// silently tracking it.
const TURN_RATE = 0.006

function pad({ id = 'Stick', axes = [0, 0], down = [] } = {}) {
  const buttons = []
  for (let i = 0; i <= Math.max(3, ...down); i++) {
    buttons.push({ pressed: down.includes(i), touched: false, value: down.includes(i) ? 1 : 0 })
  }
  return { id, index: 0, connected: true, mapping: '', axes, buttons }
}

const setPads = (list) => { navigator.getGamepads = vi.fn(() => list) }

beforeEach(() => { localStorage.clear() })
afterEach(() => { delete navigator.getGamepads; localStorage.clear() })

describe('stickDelta', () => {
  it('is zero with the stick centred — the ball stops, it does not drift', () => {
    expect(stickDelta({ x: 0, y: 0 }, 0.016, 200)).toEqual({ dx: 0, dy: 0 })
  })

  it('integrates deflection over time, which is what makes a held stick keep turning', () => {
    // A mouse produces pixels by moving. A stick produces the same pixels by
    // being held somewhere — this is the conversion that makes the two
    // interchangeable in ACT's accumulator.
    const oneSecond = stickDelta({ x: 1, y: 0 }, 1, 200)
    expect(oneSecond.dx).toBeCloseTo(200)
    const sixtyFrames = Array.from({ length: 60 }, () => stickDelta({ x: 1, y: 0 }, 1 / 60, 200))
      .reduce((a, d) => a + d.dx, 0)
    expect(sixtyFrames).toBeCloseTo(200)
  })

  it('scales linearly with deflection', () => {
    expect(stickDelta({ x: 0.5, y: 0 }, 1, 200).dx).toBeCloseTo(100)
    expect(stickDelta({ x: -1, y: 0 }, 1, 200).dx).toBeCloseTo(-200)
  })

  it('keeps the mouse sign convention, so nothing downstream needs a flip', () => {
    // +x is right and ACT reads dx>0 as a turn right; +y is stick forward and
    // ACT reads dy>0 (a downward drag) as pitching down.
    const d = stickDelta({ x: 1, y: 1 }, 1, 200)
    expect(d.dx).toBeGreaterThan(0)
    expect(d.dy).toBeGreaterThan(0)
  })

  it('turns the default rate into a sane number of radians per second', () => {
    // Full deflection should be brisk but flyable. The keyboard, for
    // comparison, is 4.5 px per 16 ms tick — about 1.7 rad/s.
    const radPerSec = stickDelta({ x: 1, y: 0 }, 1, DEFAULT_ACT_STICK_RATE).dx * TURN_RATE
    expect(radPerSec).toBeGreaterThan(0.8)
    expect(radPerSec).toBeLessThan(1.6)
  })

  it('cannot run backwards on a negative dt', () => {
    expect(stickDelta({ x: 1, y: 1 }, -0.5, 200)).toEqual({ dx: 0, dy: 0 })
  })

  it('treats a missing axis pair as centred', () => {
    expect(stickDelta(null, 0.016, 200)).toEqual({ dx: 0, dy: 0 })
  })
})

describe('stick rate setting', () => {
  it('defaults when nothing is stored', () => {
    expect(readStoredActStickRate()).toBe(DEFAULT_ACT_STICK_RATE)
  })

  it('round-trips a stored value', () => {
    storeActStickRate(320)
    expect(readStoredActStickRate()).toBe(320)
  })

  it('falls back rather than trusting a value outside the slider', () => {
    storeActStickRate(MAX_ACT_STICK_RATE + 500)
    expect(readStoredActStickRate()).toBe(DEFAULT_ACT_STICK_RATE)
    storeActStickRate(MIN_ACT_STICK_RATE - 10)
    expect(readStoredActStickRate()).toBe(DEFAULT_ACT_STICK_RATE)
    localStorage.setItem('sw_cbat_act_stick_rate', 'fast')
    expect(readStoredActStickRate()).toBe(DEFAULT_ACT_STICK_RATE)
  })
})

describe('createActStick', () => {
  it('contributes nothing when no stick is plugged in', () => {
    // The overwhelming majority of players. There is no flag guarding this
    // path, so "inert with no device" has to be true by construction.
    setPads([])
    const s = createActStick()
    expect(s.poll(0.016)).toEqual({ dx: 0, dy: 0 })
    expect(s.consumeBleeps()).toBe(0)
    expect(s.connected()).toBe(false)
  })

  it('reads a held stick as continuous input', () => {
    setPads([pad({ axes: [1, 0] })])
    const s = createActStick({ rate: 200 })
    const a = s.poll(0.1)
    const b = s.poll(0.1)
    expect(a.dx).toBeCloseTo(20)
    expect(b.dx).toBeCloseTo(20)
  })

  it('honours the rate setting', () => {
    setPads([pad({ axes: [1, 0] })])
    expect(createActStick({ rate: 60 }).poll(1).dx).toBeCloseTo(60)
    expect(createActStick({ rate: 480 }).poll(1).dx).toBeCloseTo(480)
  })

  it('reads the stored rate once at creation, not once a frame', () => {
    storeActStickRate(400)
    setPads([pad({ axes: [1, 0] })])
    const s = createActStick()
    expect(s.poll(1).dx).toBeCloseTo(400)
    // Changing the setting mid-round must not retune the stick under the
    // player — the round picks it up next time it mounts.
    storeActStickRate(100)
    expect(s.poll(1).dx).toBeCloseTo(400)
  })

  it('scores one bleep per press, not one per frame held', () => {
    const s = createActStick()
    setPads([pad({ id: 'S', axes: [0, 0], down: [] })])
    s.poll(0.016)
    setPads([pad({ id: 'S', axes: [0, 0], down: [1] })])
    s.poll(0.016); s.poll(0.016); s.poll(0.016)
    expect(s.consumeBleeps()).toBe(1)
    expect(s.consumeBleeps()).toBe(0)
  })

  it('reads bleeps off the bound button once calibrated', () => {
    saveProfile({ ...defaultProfile('S'), calibrated: true, triggerButtons: [2], actionButtons: [5] })
    const s = createActStick()
    setPads([pad({ id: 'S', down: [] })])
    s.poll(0.016)
    setPads([pad({ id: 'S', down: [2] })])
    s.poll(0.016)
    // The trigger is not the bleep — ACT must not score a shutter squeeze.
    expect(s.consumeBleeps()).toBe(0)
    setPads([pad({ id: 'S', down: [5] })])
    s.poll(0.016)
    expect(s.consumeBleeps()).toBe(1)
  })

  it('reports every press when two land between polls', () => {
    // ACT scores false alarms without debounce, so swallowing a press would
    // quietly change what the game measures.
    const s = createActStick()
    setPads([pad({ id: 'S', down: [] })])
    s.poll(0.016)
    setPads([pad({ id: 'S', down: [1, 2] })])
    s.poll(0.016)
    expect(s.consumeBleeps()).toBe(2)
  })

  it('applies a calibrated profile rather than assuming axes 0 and 1', () => {
    saveProfile({
      ...defaultProfile('S'),
      calibrated: true,
      x: { index: 3, centre: 0, min: -1, max: 1, sign: 1 },
      y: { index: 4, centre: 0, min: -1, max: 1, sign: -1 },
    })
    setPads([pad({ id: 'S', axes: [0, 0, -1, 1, -1, 0] })])
    const s = createActStick({ rate: 200 })
    const d = s.poll(1)
    expect(d.dx).toBeGreaterThan(150)
    // Stick forward reads -1 on this device; the sign turns it into a
    // downward pitch, which is what forward means.
    expect(d.dy).toBeGreaterThan(150)
  })

  it('goes quiet when the stick is unplugged mid-round', () => {
    setPads([pad({ axes: [1, 0] })])
    const s = createActStick({ rate: 200 })
    expect(s.poll(1).dx).toBeCloseTo(200)
    setPads([])
    expect(s.poll(1)).toEqual({ dx: 0, dy: 0 })
  })
})
