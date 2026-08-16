// Input abstraction for the Sensory Motor Apparatus Test.
//
// The real SMA is flown on two limbs at once: the joystick owns the vertical
// axis and a pair of foot pedals own the lateral one, worked with forward ankle
// pressure rather than by pressing down. Nobody sitting at a laptop has pedals,
// and a browser cannot tell a rudder axis from a throttle lever without being
// shown, so SMA puts BOTH axes on whatever single two-axis control the player
// has. The instructions card says so plainly rather than implying the hand and
// foot split has been reproduced — it has not, and pretending otherwise would be
// the one claim about this test worth not making.
//
// Four sources feed one pair of numbers, and nothing downstream can tell them
// apart:
//
//   pad       a virtual stick on a surface below the display. Touch's source,
//             and the reason a finger never covers the dot it is chasing.
//   pointer   the mouse's offset from the middle of the display IS the
//             deflection, exactly as in RTT. Desktop's source.
//   gamepad   a real stick, through the shared learned-calibration layer in
//             gamepad.js. Same profile RTT and ACT use, so a stick calibrated
//             once works in all three.
//   keyboard  arrow keys or WASD, ramped rather than switched, for anyone with
//             neither a mouse nor a touchscreen to hand.
//
//   const input = createSmaInput({ el: arenaEl })
//   input.poll(dtMs)                // once per frame
//   const { x, y } = input.axes()   // curved, dead-zoned, [-1,1]
//   input.dispose()
//
// +x is right, +y is DOWN — see the sign note at the top of smaSim.js. Three of
// the four sources feed that straight through: a mouse below the middle, a
// thumb dragged down the pad and the down arrow all read +y.
//
// The joystick is the exception, and deliberately. gamepad.js hands out +y for
// stick BACK, because RTT and ACT were built around a mouse and want the stick
// to move the picture the way the hand moves. The real SMA apparatus is flown
// the other way — push the stick away and the dot goes down, like an aircraft
// stick — so this game, and only this game, inverts pitch on the stick path.
// See STICK_PITCH_SIGN below.

import {
  createStickReader, applyCurve, clamp1, loadProfile, defaultProfile, listPads,
  STICK_DEAD_ZONE, STICK_EXPO,
} from './gamepad'
import { pointerAxes } from './rttInput'

export { pointerAxes }

// How far a finger must travel from where it landed for full deflection, as a
// fraction of the pad's SHORTER side. A third means full deflection is a
// comfortable thumb sweep and the fine control lives in the first few
// millimetres, which is where a tracking task needs it.
export const PAD_RADIUS_FRACTION = 1 / 3

// What the stick's pitch is multiplied by on its way into this game. -1, so
// pushing the stick away sends the dot DOWN, which is how the real apparatus is
// flown and what the instructions card promises. It is a per-game flip rather
// than a change to the shared profile, because the same calibrated stick has to
// keep pitching the other way in RTT and ACT, where the mouse is the reference
// and the picture follows the hand.
export const STICK_PITCH_SIGN = -1

// Where a pad gesture is centred. The origin is where the finger LANDED, not the
// middle of the pad: a fixed centre would have to be found by feel every time,
// and on a compensatory task the first correction is the one that matters.
//
// Pulled inward so a full-deflection circle always fits inside the pad —
// otherwise a gesture started near an edge could never reach full deflection
// outward, and the dot would be uncorrectable in exactly one direction.
export function clampPadOrigin(clientX, clientY, rect, radius) {
  const minX = rect.left + radius
  const maxX = rect.right - radius
  const minY = rect.top + radius
  const maxY = rect.bottom - radius
  return {
    // max/min ordering matters when the pad is narrower than 2×radius: the
    // clamp then collapses to the centre rather than inverting.
    x: minX > maxX ? (rect.left + rect.right) / 2 : Math.min(maxX, Math.max(minX, clientX)),
    y: minY > maxY ? (rect.top + rect.bottom) / 2 : Math.min(maxY, Math.max(minY, clientY)),
  }
}

export function padRadius(rect) {
  return Math.max(1, Math.min(rect.width, rect.height) * PAD_RADIUS_FRACTION)
}

// Finger position → deflection. Curved through the same applyCurve the stick and
// the mouse go through, so a thumb behaves like a stick rather than like a
// different game.
export function padAxes(clientX, clientY, origin, radius, opts = {}) {
  const { deadZone = STICK_DEAD_ZONE, expo = STICK_EXPO } = opts
  const r = Math.max(1, radius)
  return {
    x: applyCurve(clamp1((clientX - origin.x) / r), deadZone, expo),
    y: applyCurve(clamp1((clientY - origin.y) / r), deadZone, expo),
  }
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
// Held keys ramp toward full deflection instead of snapping to it. A switched
// input on a rate-control task is unusable: every tap is a full-rate command and
// the dot ends up oscillating harder than the drift ever moved it.
export const KEY_RAMP_MS = 220      // rest → full deflection
export const KEY_RELEASE_MS = 140   // and back, which wants to be quicker

export function rampAxis(current, target, dtMs) {
  if (current === target) return target
  // Coming back toward centre is a release and uses the faster constant; going
  // further out is a command and uses the slower one.
  const towardZero = Math.abs(target) < Math.abs(current)
  const step = Math.max(0, dtMs) / (towardZero ? KEY_RELEASE_MS : KEY_RAMP_MS)
  if (current < target) return Math.min(target, current + step)
  return Math.max(target, current - step)
}

const KEY_AXIS = {
  ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['y', -1], ArrowDown: ['y', 1],
  KeyA: ['x', -1], KeyD: ['x', 1], KeyW: ['y', -1], KeyS: ['y', 1],
}

// ── Reader ───────────────────────────────────────────────────────────────────

export function createSmaInput({ el, deadZone = STICK_DEAD_ZONE, expo = STICK_EXPO } = {}) {
  // The dead zone and expo the caller asked for have to reach the stick too, or
  // a tuned pointer and an untuned stick would fly differently on the same run.
  const stick = createStickReader({
    profileFor: (id) => ({ ...(loadProfile(id) || defaultProfile(id)), deadZone, expo }),
  })

  const state = {
    source: 'pointer',
    axes: { x: 0, y: 0 },

    // Pointer is tracked in client coordinates on the window, not on the arena.
    // Flinging the mouse past the edge should peg the control in that direction,
    // not freeze it at whatever it read on the way out.
    pointer: null,
    rect: null,
    rectAt: 0,

    // Pad gesture, live only while a finger is down. A finger that is not down
    // is not anywhere, so releasing centres the control rather than leaving it
    // wherever it was let go.
    padOrigin: null,
    padRadius: 0,
    padAxes: { x: 0, y: 0 },
    padId: null,

    keysHeld: new Set(),
    keyAxes: { x: 0, y: 0 },
  }

  const readRect = (now) => {
    // Cached because poll() runs every frame and getBoundingClientRect forces
    // layout. Refreshed on a timer plus on resize/scroll, which covers
    // everything that can move the arena under a stationary pointer.
    if (!el) return null
    if (!state.rect || now - state.rectAt > 500) {
      state.rect = el.getBoundingClientRect()
      state.rectAt = now
    }
    return state.rect
  }
  const invalidateRect = () => { state.rect = null }

  // ── Pointer ────────────────────────────────────────────────────────────────
  // Only a real pointing device drives this path. A touch on the arena is
  // ignored on purpose: the pad below is where touch steers from, and letting a
  // finger on the display steer as well would mean the hand covering the one
  // thing the player is trying to watch.
  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return
    state.pointer = { x: e.clientX, y: e.clientY }
  }
  // Leaving the document entirely centres the control — the alternative is a dot
  // running for the bezel because the pointer is off in another window.
  const onPointerOut = (e) => {
    if (e.relatedTarget === null) state.pointer = null
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────
  // Modifier chords are left alone so browser and OS shortcuts keep working.
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (!KEY_AXIS[e.code]) return
    state.keysHeld.add(e.code)
    e.preventDefault()
  }
  const onKeyUp = (e) => {
    if (KEY_AXIS[e.code]) state.keysHeld.delete(e.code)
  }
  // A tab switch mid-run leaves a key logically held forever, and the dot flies
  // into the bezel while nobody is watching.
  const onBlur = () => state.keysHeld.clear()

  // ── Gamepad ────────────────────────────────────────────────────────────────
  // Unplugging mid-run drops straight back to the pointer rather than pausing. A
  // run is scored on time and a USB dropout is not a reason to void one.
  const onGamepadDisconnected = () => {
    if (!listPads().length) state.source = 'pointer'
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerout', onPointerOut, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', invalidateRect, { passive: true })
    window.addEventListener('scroll', invalidateRect, { passive: true })
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected)
  }

  const keyTarget = () => {
    const target = { x: 0, y: 0 }
    for (const code of state.keysHeld) {
      const [axis, dir] = KEY_AXIS[code]
      // Holding both directions on one axis cancels, rather than letting
      // whichever was added last win.
      target[axis] += dir
    }
    return { x: clamp1(target.x), y: clamp1(target.y) }
  }

  return {
    // ── Pad, driven by the page's pointer handlers on the pad element ────────
    // The page owns the element and its rect; this owns what a gesture means.
    padDown(clientX, clientY, rect, pointerId = null) {
      if (state.padId != null) return   // a second finger never steals the stick
      state.padId = pointerId
      state.padRadius = padRadius(rect)
      state.padOrigin = clampPadOrigin(clientX, clientY, rect, state.padRadius)
      state.padAxes = padAxes(clientX, clientY, state.padOrigin, state.padRadius, { deadZone, expo })
      state.source = 'pad'
    },
    padMove(clientX, clientY, pointerId = null) {
      if (!state.padOrigin) return
      if (state.padId != null && pointerId != null && pointerId !== state.padId) return
      state.padAxes = padAxes(clientX, clientY, state.padOrigin, state.padRadius, { deadZone, expo })
    },
    padUp(pointerId = null) {
      if (state.padId != null && pointerId != null && pointerId !== state.padId) return
      state.padOrigin = null
      state.padId = null
      state.padAxes = { x: 0, y: 0 }
    },
    // Where to draw the knob, in client coordinates, or null when nothing is
    // held. The page reads this once per frame to position the pad's thumb.
    padGesture() {
      if (!state.padOrigin) return null
      return {
        origin: state.padOrigin,
        radius: state.padRadius,
        axes: state.padAxes,
      }
    },

    // Called once per frame with the same clamped dt the game loop uses.
    // Polling is explicit rather than hidden inside axes() because a gamepad is
    // only observable by reading it, and the keyboard ramp needs the dt.
    poll(dtMs = 16, now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
      const target = keyTarget()
      state.keyAxes = {
        x: rampAxis(state.keyAxes.x, target.x, dtMs),
        y: rampAxis(state.keyAxes.y, target.y, dtMs),
      }

      stick.poll()
      // A connected-but-idle stick shouldn't steal the pointer's job; it takes
      // over the moment it is actually moved, and keeps the job after that even
      // when it is back at centre (a centred stick is a command, not an absence).
      if (stick.connected() && stick.awake()) state.source = 'gamepad'
      else if (!stick.connected() && state.source === 'gamepad') state.source = 'pointer'

      // A finger on the pad outranks everything for as long as it is down — it
      // is an unambiguous, deliberate gesture, and on a hybrid laptop it should
      // win over a mouse that happens to be sitting off-centre.
      if (state.padOrigin) {
        state.source = 'pad'
        state.axes = state.padAxes
        return
      }

      if (state.source === 'gamepad' && stick.connected()) {
        const a = stick.axes()
        // A centred stick would come out as -0 from the multiply. Nothing here
        // flies differently on it, but it compares unequal to 0 and would put a
        // baffling minus sign in front of a HUD readout.
        state.axes = { x: a.x, y: a.y === 0 ? 0 : a.y * STICK_PITCH_SIGN }
        return
      }

      // Keys beat the mouse while anything is held or still winding down, so a
      // player using the keyboard is not fighting a stationary pointer parked
      // halfway to the bezel.
      if (state.keysHeld.size || state.keyAxes.x !== 0 || state.keyAxes.y !== 0) {
        state.source = 'keyboard'
        state.axes = state.keyAxes
        return
      }

      // Nothing else is claiming it, so the mouse has the job — and the HUD
      // readout has to say so. A source left reading 'pad' or 'keyboard' after
      // the finger lifted or the key wound down would be telling the player
      // they are flying on something they let go of.
      if (state.source !== 'pointer') state.source = 'pointer'

      const rect = readRect(now)
      if (!rect || !state.pointer) {
        state.axes = { x: 0, y: 0 }
        return
      }
      state.axes = pointerAxes(state.pointer.x, state.pointer.y, rect, { deadZone, expo })
    },

    axes() { return state.axes },
    source() { return state.source },
    // Which physical device is flying, for the HUD's source readout.
    stickId() { return stick.padId() },
    // Lets the stick pick up a fresh calibration without a remount.
    refresh() { stick.refresh() },

    dispose() {
      stick.dispose()
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerout', onPointerOut)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('resize', invalidateRect)
        window.removeEventListener('scroll', invalidateRect)
        window.removeEventListener('gamepaddisconnected', onGamepadDisconnected)
      }
    },
  }
}

// Human-readable name for the source readout on the HUD. The player should
// always be able to see which of the four is actually flying, because "my
// joystick isn't doing anything" is otherwise impossible to diagnose.
export const SMA_SOURCE_LABEL = {
  pad: 'Touch pad',
  pointer: 'Mouse',
  gamepad: 'Joystick',
  keyboard: 'Keyboard',
}
