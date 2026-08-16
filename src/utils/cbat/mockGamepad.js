// A synthetic joystick, so the stick support can be flown without a stick.
//
// Enabled by ?stick=mock on a CBAT game's URL, admin only — the same
// affordance-not-a-feature footing as ?round=N (see adminRoundParam.js).
//
// The point of this file is that the mock LIES. It would be trivial to emit a
// tidy pad with roll on axis 0, pitch on axis 1 and the trigger on button 0,
// and it would prove nothing: the code would pass because it guessed the same
// layout, not because it reads the layout. So the mock reports its axes at 3
// and 4, inverts pitch, trims its centre off zero, parks a throttle at -1 for
// ever, wedges a button permanently on, and declares `mapping: ''`. Anything
// that flies correctly through this is genuinely reading the device rather than
// assuming it.
//
// Every one of those lies is a real thing a real stick does. None of them is
// exotic.
//
// Driving it: the mouse position is the stick (no button held — so it does not
// fight ACT's drag-to-steer, which only engages while the pointer is down),
// J is the trigger and K is the bleep button.

const MOCK_ID = 'Mock Sidestick (Vendor: dead Product: beef)'

// Roll rests left of zero, the way a stick with a bit of trim in it does. The
// two halves of its travel are therefore different sizes, which is the case
// that catches a normaliser using one span for both.
const ROLL_CENTRE = -0.08
const AXIS_COUNT = 6
const BUTTON_COUNT = 8
const ROLL_AXIS = 3
const PITCH_AXIS = 4
const THROTTLE_AXIS = 2
const TRIGGER_BUTTON = 2
const ACTION_BUTTON = 5
const STUCK_BUTTON = 0

export const MOCK_STICK_HINT = 'Mouse = stick · J = trigger · K = bleep'

export function wantsMockStick(search) {
  return new URLSearchParams(search || '').get('stick') === 'mock'
}

// Idle noise, small enough to sit inside the dead zone. Present so that a
// dead zone accidentally removed shows up as a drifting camera immediately.
function noise() {
  return (Math.random() - 0.5) * 0.03
}

export function installMockStick() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { dispose() {} }
  }

  // Kept unbound and by reference. Binding it would restore a function that
  // merely behaves like the original, and anything holding the real one — a
  // test, another shim — would be left comparing against a stranger.
  const original = navigator.getGamepads || null
  const pointer = { x: null, y: null }
  const held = new Set()

  const onPointerMove = (e) => { pointer.x = e.clientX; pointer.y = e.clientY }
  const onKeyDown = (e) => {
    const k = e.key.toLowerCase()
    if (k === 'j' || k === 'k') { held.add(k); e.preventDefault() }
  }
  const onKeyUp = (e) => held.delete(e.key.toLowerCase())

  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v)

  // Deflection is normalised by HALF THE WINDOW HEIGHT on both axes, so the
  // same hand movement means the same thing in either direction.
  const deflection = () => {
    if (pointer.x == null) return { x: 0, y: 0 }
    const half = Math.max(1, window.innerHeight / 2)
    return {
      x: clamp1((pointer.x - window.innerWidth / 2) / half),
      y: clamp1((pointer.y - window.innerHeight / 2) / half),
    }
  }

  const button = (pressed) => ({ pressed, touched: pressed, value: pressed ? 1 : 0 })

  const buildPad = () => {
    const d = deflection()
    const axes = new Array(AXIS_COUNT).fill(0)
    // A twist rudder nobody is touching, jittering the way a potentiometer does.
    axes[0] = noise()
    axes[1] = 0
    // The detachable throttle lever, parked. It never centres and it never
    // will; anything that treats "is this stick being flown" as a sweep over
    // every axis will see full deflection here for ever.
    axes[THROTTLE_AXIS] = -1
    // Trimmed centre and asymmetric travel: full right stops short of 1.0,
    // full left reaches -1.0.
    axes[ROLL_AXIS] = clamp1(ROLL_CENTRE + d.x * (1 - Math.abs(ROLL_CENTRE)) + noise())
    // Pitch as most flight drivers report it: pushing the stick forward reads
    // NEGATIVE. Screen-Y grows downward, so mouse-up (forward) gives d.y < 0
    // and this axis passes it straight through — the same pass-through the
    // uncalibrated default profile does, which is why a calibration run over
    // this mock has to come back with the pitch sign left alone.
    axes[PITCH_AXIS] = clamp1(d.y + noise())
    axes[5] = 0

    const buttons = new Array(BUTTON_COUNT).fill(null).map(() => button(false))
    // A mode switch left in the on position. Real sticks have these, and a
    // shutter driven by "is any button down" fires for ever against one.
    buttons[STUCK_BUTTON] = button(true)
    buttons[TRIGGER_BUTTON] = button(held.has('j'))
    buttons[ACTION_BUTTON] = button(held.has('k'))

    return {
      id: MOCK_ID,
      index: 2,
      connected: true,
      mapping: '',
      timestamp: performance.now(),
      axes,
      buttons,
      hapticActuators: [],
    }
  }

  // Real sticks sit behind empty slots in the array, so the mock does too.
  navigator.getGamepads = () => [null, null, buildPad()]

  return {
    id: MOCK_ID,
    dispose() {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (original) navigator.getGamepads = original
      else delete navigator.getGamepads
    },
  }
}
