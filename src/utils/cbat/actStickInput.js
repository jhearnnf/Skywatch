// Joystick input for ACT.
//
// ACT and RTT both want a stick, but they were built around opposite kinds of
// number. RTT is rate control from the start — deflection IS a slew rate — so a
// stick drops straight in. ACT was built for a mouse and takes DISPLACEMENT: the
// pixels the pointer moved since the last frame, banked in an accumulator and
// converted to a rotation by TURN_RATE. A stick cannot produce that. It does not
// move; it sits somewhere and stays there, and a held position reports the same
// value every frame for as long as it is held.
//
// So the stick is integrated instead: deflection × rate × dt becomes a number of
// pixel-equivalents per frame, added to the same accumulator the mouse writes
// to. Hold the stick over and the ball keeps turning; centre it and it stops —
// which is how the real test flies, and how RTT already behaves.
//
// Everything downstream of the accumulator — the per-tick rotation cap, the
// forward-deviation cone, the wall snap — is untouched and cannot tell where the
// pixels came from. That is deliberate: it is the only way to add a whole input
// device to a game this fiddly without re-testing the flight model.
//
// Signs line up with the mouse exactly, so there is no flip at the call site:
// +x is right, and the game reads dx>0 as a turn to the right; +y is stick
// forward, and the game reads dy>0 (a downward drag) as pitching down.

import { createStickReader, loadProfile, defaultProfile } from './gamepad'

// Pixel-equivalents per second at full deflection.
//
// For scale: TURN_RATE is 0.006 rad per pixel, so 200 px/s is about 1.2 rad/s
// with the stick hard over, and the keyboard — 4.5 px per 16 ms tick — works out
// at roughly 1.7 rad/s. A stick therefore starts a shade gentler than the arrow
// keys, which is the right way round for something with an analogue centre.
//
// This number is the one thing here that genuinely wants a stick in a hand to
// settle, so it is a slider rather than a constant, with a range wide enough to
// cover being badly wrong in either direction.
export const DEFAULT_ACT_STICK_RATE = 200
export const MIN_ACT_STICK_RATE = 60
export const MAX_ACT_STICK_RATE = 480

const ACT_STICK_RATE_KEY = 'sw_cbat_act_stick_rate'

export function readStoredActStickRate() {
  try {
    const n = Number(localStorage.getItem(ACT_STICK_RATE_KEY))
    if (Number.isFinite(n) && n >= MIN_ACT_STICK_RATE && n <= MAX_ACT_STICK_RATE) return n
  } catch { /* storage unavailable */ }
  return DEFAULT_ACT_STICK_RATE
}

export function storeActStickRate(value) {
  try { localStorage.setItem(ACT_STICK_RATE_KEY, String(value)) } catch { /* storage unavailable */ }
}

// Deflection → pixel-equivalents for one frame. Pure, and the only piece of
// maths in the file, so it is the piece worth testing.
export function stickDelta(axes, dt, rate = DEFAULT_ACT_STICK_RATE) {
  const step = rate * Math.max(0, dt)
  return { dx: (axes?.x || 0) * step, dy: (axes?.y || 0) * step }
}

// The rate is resolved once, at creation, rather than per frame — the setting
// lives in localStorage and the round that reads it is mounted after the intro
// screen that writes it, so re-reading storage sixty times a second would buy
// nothing but the read.
export function createActStick({ rate = readStoredActStickRate() } = {}) {
  const reader = createStickReader({
    profileFor: (id) => loadProfile(id) || defaultProfile(id),
  })

  return {
    // Once per frame, with the same clamped dt the game loop uses. Returns the
    // pixels to bank; the caller adds them, so the accumulator stays the single
    // place input arrives from.
    poll(dt) {
      reader.poll()
      if (!reader.connected()) return { dx: 0, dy: 0 }
      return stickDelta(reader.axes(), dt, rate)
    },

    // Rising edges on whatever button is bound to BLEEP. A count rather than a
    // boolean for the same reason RTT's shutter is: a frame that swallowed two
    // presses should score two, and it is ACT's own scoring — false alarms cost
    // points, deliberately without debounce — that decides what to do with them.
    consumeBleeps() { return reader.consumeEdges('action') },

    connected() { return reader.connected() },
    padId() { return reader.padId() },
    axes() { return reader.axes() },
    refresh() { reader.refresh() },
    dispose() { reader.dispose() },
  }
}
