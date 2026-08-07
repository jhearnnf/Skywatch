import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  normaliseAxis, readStickAxes, applyCurve, defaultProfile,
  createEdgeTracker, createCalibration, createStickReader,
  listPads, pickPad, loadProfile, saveProfile, clearProfile,
  CALIBRATION_STEPS, STICK_DEAD_ZONE,
} from '../gamepad'
import { installMockStick, wantsMockStick } from '../mockGamepad'

// A pad shaped the way a flight stick shapes one: no standard mapping, axes
// wherever the driver put them, and buttons that are objects rather than
// booleans.
function pad({ id = 'Test Stick', axes = [0, 0], down = [] } = {}) {
  const buttons = []
  const highest = Math.max(3, ...down)
  for (let i = 0; i <= highest; i++) {
    buttons.push({ pressed: down.includes(i), touched: false, value: down.includes(i) ? 1 : 0 })
  }
  return { id, index: 0, connected: true, mapping: '', axes, buttons }
}

const setPads = (list) => { navigator.getGamepads = vi.fn(() => list) }

beforeEach(() => { localStorage.clear() })
afterEach(() => { delete navigator.getGamepads; localStorage.clear() })

describe('normaliseAxis', () => {
  const centred = { index: 0, centre: 0, min: -1, max: 1, sign: 1 }

  it('is zero at the recorded centre, wherever that is', () => {
    expect(normaliseAxis(0, centred)).toBe(0)
    expect(normaliseAxis(-0.32, { ...centred, centre: -0.32 })).toBe(0)
  })

  it('rescales each half of the travel separately, so a trimmed stick still reaches both ends', () => {
    // A stick resting left of zero: 0.92 of travel one way, 1.08 the other.
    // Normalising both halves by one span would leave one direction short.
    const trimmed = { index: 0, centre: -0.08, min: -1, max: 0.84, sign: 1 }
    expect(normaliseAxis(0.84, trimmed)).toBeCloseTo(1)
    expect(normaliseAxis(-1, trimmed)).toBeCloseTo(-1)
    expect(normaliseAxis(0.38, trimmed)).toBeCloseTo(0.5)
  })

  it('applies the learned sign, which is the whole of the axis-inversion problem', () => {
    const inverted = { index: 0, centre: 0, min: -1, max: 1, sign: -1 }
    expect(normaliseAxis(-1, inverted)).toBeCloseTo(1)
    expect(normaliseAxis(1, inverted)).toBeCloseTo(-1)
  })

  it('clamps rather than running away past the recorded ends', () => {
    expect(normaliseAxis(9, centred)).toBe(1)
    expect(normaliseAxis(-9, centred)).toBe(-1)
  })

  it('reads a collapsed range as zero instead of dividing by it', () => {
    // An axis that never moved during calibration must not slam to full
    // deflection on a millivolt of noise.
    const dead = { index: 0, centre: 0, min: -0.001, max: 0.001, sign: 1 }
    expect(normaliseAxis(0.001, dead)).toBe(0)
    expect(normaliseAxis(1, dead)).toBe(0)
  })
})

describe('readStickAxes', () => {
  it('reads only the axes the profile names', () => {
    // Roll and pitch at 3 and 4, a throttle parked at -1 on 2, a jittering
    // rudder on 0. Anything that swept every axis would see full deflection.
    const profile = {
      ...defaultProfile('x'),
      x: { index: 3, centre: 0, min: -1, max: 1, sign: 1 },
      y: { index: 4, centre: 0, min: -1, max: 1, sign: -1 },
    }
    const p = pad({ axes: [0.01, 0, -1, 1, -1, 0] })
    const out = readStickAxes(p, profile)
    expect(out.x).toBeCloseTo(applyCurve(1))
    // sign -1 on a raw -1 means full positive: stick forward, nose down.
    expect(out.y).toBeCloseTo(applyCurve(1))
  })

  it('dead-zones the slop around centre', () => {
    const p = pad({ axes: [STICK_DEAD_ZONE - 0.01, 0] })
    expect(readStickAxes(p, defaultProfile()).x).toBe(0)
  })

  it('survives a pad with no axes at all', () => {
    expect(readStickAxes(null, defaultProfile())).toEqual({ x: 0, y: 0 })
    expect(readStickAxes({}, defaultProfile())).toEqual({ x: 0, y: 0 })
  })
})

describe('createEdgeTracker', () => {
  it('reports a press once, not once per frame it is held', () => {
    const t = createEdgeTracker()
    expect(t.update(pad({ down: [2] }))).toEqual([2])
    expect(t.update(pad({ down: [2] }))).toEqual([])
    expect(t.update(pad({ down: [] }))).toEqual([])
    expect(t.update(pad({ down: [2] }))).toEqual([2])
  })

  it('never fires for a button wedged permanently on', () => {
    // Real sticks have mode switches that report as a held button for ever.
    // "Is anything pressed" would jam the shutter open against one; per-button
    // edges see it once, at the baseline, and never again.
    const t = createEdgeTracker()
    t.update(pad({ down: [0] }))
    for (let i = 0; i < 10; i++) expect(t.update(pad({ down: [0] }))).toEqual([])
  })

  it('tracks each button independently', () => {
    const t = createEdgeTracker()
    t.update(pad({ down: [0] }))
    expect(t.update(pad({ down: [0, 5] }))).toEqual([5])
  })
})

describe('createCalibration', () => {
  // Walks the wizard with a pad whose layout is deliberately awkward: roll on
  // axis 3, pitch on 4 and INVERTED, a throttle parked at -1 on axis 2, and a
  // button stuck on. If the learner survives this it is genuinely reading the
  // device rather than assuming a layout.
  function walk(cal, { trigger = 2, action = 5 } = {}) {
    const at = (roll, pitch) => pad({ axes: [0, 0, -1, roll, pitch, 0], down: [0] })
    const commit = (p) => { cal.observe(p); cal.commit() }
    cal.observe(at(0, 0))            // primes the button baseline
    commit(at(0, 0))                 // centre
    commit(at(1, 0))                 // right
    commit(at(-1, 0))                // left
    commit(at(0, -1))                // forward — reads NEGATIVE on this device
    commit(at(0, 1))                 // back
    cal.observe(pad({ axes: [0, 0, -1, 0, 0, 0], down: [0, trigger] }))
    cal.observe(pad({ axes: [0, 0, -1, 0, 0, 0], down: [0, action] }))
    return cal
  }

  it('learns which axis is which, and which way round each goes', () => {
    const out = walk(createCalibration('Test Stick')).result()
    expect(out.ok).toBe(true)
    expect(out.profile.x.index).toBe(3)
    expect(out.profile.y.index).toBe(4)
    // Forward read -1, so forward is the negative end: sign flips.
    expect(out.profile.y.sign).toBe(-1)
    expect(out.profile.x.sign).toBe(1)
    expect(out.profile.calibrated).toBe(true)
  })

  it('produces a profile that flies the right way round', () => {
    const { profile } = walk(createCalibration('Test Stick')).result()
    const forward = pad({ axes: [0, 0, -1, 0, -1, 0] })
    const right = pad({ axes: [0, 0, -1, 1, 0, 0] })
    // +y is stick forward; +x is right. Both games read those signs directly.
    expect(readStickAxes(forward, profile).y).toBeCloseTo(applyCurve(1))
    expect(readStickAxes(right, profile).x).toBeCloseTo(applyCurve(1))
  })

  it('never picks the parked throttle, which moves further than anything', () => {
    const { profile } = walk(createCalibration('Test Stick')).result()
    expect(profile.x.index).not.toBe(2)
    expect(profile.y.index).not.toBe(2)
  })

  it('binds the two buttons separately and ignores the stuck one', () => {
    const { profile } = walk(createCalibration('Test Stick'), { trigger: 2, action: 5 }).result()
    expect(profile.triggerButtons).toEqual([2])
    expect(profile.actionButtons).toEqual([5])
  })

  it('cannot bind the same button to both', () => {
    const cal = createCalibration('Test Stick')
    walk(cal, { trigger: 2, action: 2 })
    // The action step ignored the already-bound trigger, so it is still open.
    expect(cal.done()).toBe(false)
    expect(cal.step().key).toBe('action')
  })

  it('commits an axis step on any button press, so the hand can stay on the stick', () => {
    const cal = createCalibration('Test Stick')
    cal.observe(pad({ axes: [0, 0], down: [] }))
    expect(cal.step().key).toBe('centre')
    expect(cal.observe(pad({ axes: [0, 0], down: [3] }))).toBe(true)
    expect(cal.step().key).toBe('right')
  })

  it('ignores a button already held when the wizard opens', () => {
    const cal = createCalibration('Test Stick')
    // Frame one is the baseline. Without it, a stuck button skips a step
    // before the player has read it.
    expect(cal.observe(pad({ down: [0] }))).toBe(false)
    expect(cal.step().key).toBe('centre')
  })

  it('refuses to guess when the stick never moved', () => {
    const cal = createCalibration('Test Stick')
    const still = pad({ axes: [0, 0, -1, 0, 0, 0] })
    cal.observe(still)
    for (let i = 0; i < 5; i++) { cal.observe(still); cal.commit() }
    const out = cal.result()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/left and right/i)
  })

  it('lets a button step be skipped, leaving it unbound', () => {
    const cal = createCalibration('Test Stick')
    const at = (roll, pitch) => pad({ axes: [0, 0, -1, roll, pitch, 0] })
    cal.observe(at(0, 0))
    ;[[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1]].forEach(([r, p]) => { cal.observe(at(r, p)); cal.commit() })
    cal.skip()
    cal.skip()
    expect(cal.done()).toBe(true)
    const { profile } = cal.result()
    expect(profile.triggerButtons).toEqual([])
    expect(profile.actionButtons).toEqual([])
  })

  it('has a prompt for every step', () => {
    for (const s of CALIBRATION_STEPS) {
      expect(s.prompt).toBeTruthy()
      expect(['axes', 'button']).toContain(s.kind)
    }
  })
})

describe('profile storage', () => {
  it('round-trips per device id', () => {
    const p = { ...defaultProfile('Stick A'), calibrated: true }
    saveProfile(p)
    expect(loadProfile('Stick A').calibrated).toBe(true)
    expect(loadProfile('Stick B')).toBe(null)
    clearProfile('Stick A')
    expect(loadProfile('Stick A')).toBe(null)
  })

  it('rejects a stored profile of the wrong shape rather than crashing mid-run', () => {
    localStorage.setItem('sw_cbat_stick_profiles', JSON.stringify({ 'Stick A': { x: {} } }))
    expect(loadProfile('Stick A')).toBe(null)
  })

  it('survives unparseable storage', () => {
    localStorage.setItem('sw_cbat_stick_profiles', 'not json')
    expect(loadProfile('Stick A')).toBe(null)
  })
})

describe('device discovery', () => {
  it('skips the empty slots real pads sit behind', () => {
    setPads([null, null, pad()])
    expect(listPads()).toHaveLength(1)
  })

  it('ignores a device with fewer than two axes', () => {
    setPads([{ id: 'Pedals', connected: true, axes: [0], buttons: [] }])
    expect(listPads()).toHaveLength(0)
  })

  it('prefers the remembered device over whichever the driver listed first', () => {
    // The Airbus throttle quadrant enumerates as its own gamepad; without this
    // it could silently become the stick.
    const quadrant = pad({ id: 'Quadrant' })
    const stick = pad({ id: 'Sidestick' })
    expect(pickPad([quadrant, stick], 'Sidestick').id).toBe('Sidestick')
    expect(pickPad([quadrant, stick], null).id).toBe('Quadrant')
    expect(pickPad([quadrant, stick], 'Unplugged').id).toBe('Quadrant')
  })

  it('survives a browser with no gamepad API', () => {
    delete navigator.getGamepads
    expect(listPads()).toEqual([])
  })
})

describe('createStickReader', () => {
  it('reads nothing when there is no device', () => {
    setPads([])
    const r = createStickReader()
    r.poll()
    expect(r.connected()).toBe(false)
    expect(r.axes()).toEqual({ x: 0, y: 0 })
  })

  it('routes trigger and action to their bound buttons', () => {
    const profile = { ...defaultProfile('S'), triggerButtons: [2], actionButtons: [5] }
    saveProfile({ ...profile, calibrated: true })
    const r = createStickReader()
    setPads([pad({ id: 'S', down: [] })])
    r.poll()
    setPads([pad({ id: 'S', down: [2] })])
    r.poll()
    expect(r.consumeEdges('trigger')).toBe(1)
    expect(r.consumeEdges('action')).toBe(0)
    setPads([pad({ id: 'S', down: [5] })])
    r.poll()
    expect(r.consumeEdges('action')).toBe(1)
    expect(r.consumeEdges('trigger')).toBe(0)
  })

  it('gives an uncalibrated stick a working trigger AND a working bleep', () => {
    // Nothing is bound, so any button has to serve both — the two games read
    // different buckets and never see each other's presses.
    const r = createStickReader()
    setPads([pad({ id: 'Fresh', down: [] })])
    r.poll()
    setPads([pad({ id: 'Fresh', down: [3] })])
    r.poll()
    expect(r.consumeEdges('trigger')).toBe(1)
    expect(r.consumeEdges('action')).toBe(1)
  })

  it('does not double up once a trigger is bound', () => {
    saveProfile({ ...defaultProfile('S'), calibrated: true, triggerButtons: [2], actionButtons: [] })
    const r = createStickReader()
    setPads([pad({ id: 'S', down: [] })])
    r.poll()
    setPads([pad({ id: 'S', down: [2] })])
    r.poll()
    expect(r.consumeEdges('trigger')).toBe(1)
    expect(r.consumeEdges('action')).toBe(0)
  })

  it('only wakes on deflection the profile can actually see', () => {
    // The parked throttle is at -1 for ever. Measuring "is this being flown"
    // before the profile is applied would call that a fully deflected stick.
    saveProfile({
      ...defaultProfile('S'),
      calibrated: true,
      x: { index: 3, centre: 0, min: -1, max: 1, sign: 1 },
      y: { index: 4, centre: 0, min: -1, max: 1, sign: 1 },
    })
    const r = createStickReader()
    setPads([pad({ id: 'S', axes: [0, 0, -1, 0, 0, 0] })])
    r.poll()
    expect(r.awake()).toBe(false)
    setPads([pad({ id: 'S', axes: [0, 0, -1, 0.9, 0, 0] })])
    r.poll()
    expect(r.awake()).toBe(true)
  })

  it('picks up a recalibration without a reload', () => {
    const r = createStickReader()
    setPads([pad({ id: 'S', axes: [1, 0] })])
    r.poll()
    expect(r.axes().x).toBeCloseTo(applyCurve(1))
    saveProfile({
      ...defaultProfile('S'),
      calibrated: true,
      x: { index: 0, centre: 0, min: -1, max: 1, sign: -1 },
    })
    r.refresh()
    r.poll()
    expect(r.axes().x).toBeCloseTo(applyCurve(-1))
  })

  it('does not swallow the first press after a reconnect', () => {
    const r = createStickReader()
    setPads([pad({ id: 'S', down: [1] })])
    r.poll()
    r.consumeEdges('trigger')
    setPads([])
    r.poll()
    setPads([pad({ id: 'S', down: [1] })])
    r.poll()
    expect(r.consumeEdges('trigger')).toBe(1)
  })
})

// The mock is the only way any of this gets flown before real hardware turns
// up, so what it claims to be is worth asserting.
describe('mock stick', () => {
  it('is off unless asked for by name', () => {
    expect(wantsMockStick('')).toBe(false)
    expect(wantsMockStick('?stick=real')).toBe(false)
    expect(wantsMockStick('?stick=mock')).toBe(true)
  })

  it('lies in every way a real stick lies', () => {
    const mock = installMockStick()
    const p = navigator.getGamepads()[2]
    expect(p.mapping).toBe('')            // no standard layout
    expect(p.axes).toHaveLength(6)
    expect(p.axes[2]).toBe(-1)            // throttle parked, for ever
    expect(p.axes[3]).not.toBe(0)         // roll trimmed off centre
    expect(p.buttons[0].pressed).toBe(true) // a mode switch left on
    expect(navigator.getGamepads()[0]).toBe(null)
    mock.dispose()
  })

  it('puts the API back exactly as it found it', () => {
    const before = vi.fn(() => [])
    navigator.getGamepads = before
    const mock = installMockStick()
    expect(navigator.getGamepads).not.toBe(before)
    mock.dispose()
    expect(navigator.getGamepads).toBe(before)
  })

  it('can be calibrated, which is the point of it', () => {
    // Drive the wizard straight off the mock's own frames. This is the closest
    // thing to an end-to-end check that exists without hardware.
    const mock = installMockStick()
    const cal = createCalibration('mock')
    const move = (clientX, clientY) => window.dispatchEvent(
      Object.assign(new MouseEvent('pointermove', { clientX, clientY, bubbles: true }), {}),
    )
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    const half = window.innerHeight / 2
    const at = (x, y) => { move(cx + x * half, cy + y * half); return navigator.getGamepads()[2] }

    cal.observe(at(0, 0))
    ;[[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1]].forEach(([x, y]) => { cal.observe(at(x, y)); cal.commit() })
    cal.skip(); cal.skip()

    const out = cal.result()
    expect(out.ok).toBe(true)
    expect(out.profile.x.index).toBe(3)
    expect(out.profile.y.index).toBe(4)
    // Mouse-up is stick-forward and the mock reports it negative, so the
    // learner has to invert pitch. Getting this wrong is the single most
    // likely real-hardware bug, which is why the mock inverts.
    expect(out.profile.y.sign).toBe(-1)

    // And the learned profile flies correctly: forward gives +y.
    const forward = at(0, -1)
    expect(readStickAxes(forward, out.profile).y).toBeGreaterThan(0.5)
    mock.dispose()
  })
})
