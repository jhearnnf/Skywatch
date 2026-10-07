// Input abstraction for the Sensory Motor Apparatus Test.
//
// The real SMA is flown on two limbs at once: the joystick owns the vertical
// axis and a pair of foot pedals own the lateral one, worked with forward ankle
// pressure rather than by pressing down. Most people sitting at a laptop have
// no pedals, so by default SMA puts BOTH axes on whatever single two-axis
// control the player has. A player who does have pedals calibrates them once
// (pedals.js; a browser cannot tell a rudder axis from a throttle lever without
// being shown) and from then on the pedals own the lateral axis and whatever
// else is flying keeps the vertical one, which is the real split.
//
// Under the Real CBAT theme (`split: true`) the split is enforced for everyone:
// the stick and the mouse fly the vertical axis only, and the lateral axis
// belongs to the left/right keys, or to the pedals when a set is calibrated.
// Up/down keys do nothing there. The touch pad keeps both axes, because a
// phone has neither keys nor pedals to put the lateral axis on.
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
  createStickReader, clamp1, loadProfile, defaultProfile, listPads,
  loadPedalProfile, STICK_DEAD_ZONE, STICK_EXPO,
} from './gamepad'
import { createPedalReader } from './pedals'
import { clampPadOrigin, padRadius, padAxes } from './touchPad'
import { pointerAxes } from './rttInput'
import {
  createInputTally, addInput, dominantInput,
  INPUT_JOYSTICK, INPUT_KEYBOARD_MOUSE, INPUT_TOUCH,
} from './inputMethod'

export { pointerAxes }
// The thumb pad's maths lives in touchPad.js, shared with RTT; re-exported so
// this module's API and its tests are unchanged.
export { PAD_RADIUS_FRACTION, clampPadOrigin, padRadius, padAxes } from './touchPad'

// What the stick's pitch is multiplied by on its way into this game. -1, so
// pushing the stick away sends the dot DOWN, which is how the real apparatus is
// flown and what the instructions card promises. It is a per-game flip rather
// than a change to the shared profile, because the same calibrated stick has to
// keep pitching the other way in RTT and ACT, where the mouse is the reference
// and the picture follows the hand.
export const STICK_PITCH_SIGN = -1

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

export function createSmaInput({ el, deadZone = STICK_DEAD_ZONE, expo = STICK_EXPO, split = false } = {}) {
  // The dead zone and expo the caller asked for have to reach the stick too, or
  // a tuned pointer and an untuned stick would fly differently on the same run.
  const stick = createStickReader({
    profileFor: (id) => ({ ...(loadProfile(id) || defaultProfile(id)), deadZone, expo }),
  })
  // The pedals, if the player has calibrated a set. No profile, no pedals.
  const pedals = createPedalReader({
    profileFor: (id) => {
      const p = loadPedalProfile(id)
      return p ? { ...p, deadZone, expo } : null
    },
  })

  const state = {
    source: 'pointer',
    axes: { x: 0, y: 0 },
    // Once calibrated pedals have been pushed they own the lateral axis for
    // the rest of the run, whatever else is flying: the same latch as the
    // stick's, for the same reason (feet resting on centred pedals are a
    // command to hold, not an absence of input). Released only by unplugging.
    pedalsEngaged: false,

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
    // When each half of the split was last worked, for its "use this control"
    // prompt: a left/right key held, and the mouse moved or the stick off
    // centre on pitch. null until it ever has been; the idle clock then runs
    // from the first poll, so never touching a control counts as idle.
    lateralKeyAt: null,
    verticalAt: null,
    pointerMoved: false,
    firstPollAt: null,

    // Frames flown on each kind of control, so the run can be labelled with the
    // one that did most of the flying (see inputMethod.js). The pad and the
    // keyboard count only while they are being worked; a mouse is somewhere
    // all the time and counts every frame it is on the page; a frame with none
    // of them is nobody's.
    inputTally: createInputTally(),
    // The pedals' own tally, kept apart from the one above because they are
    // not a rival to those controls but a partner: every pedal frame is ALSO
    // a stick, mouse or pad frame on the vertical axis. `steeredFrames` is
    // the denominator — frames on which anything at all was flying.
    pedalFrames: 0,
    steeredFrames: 0,
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
    state.pointerMoved = true
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

  // Which of the four sources has the job this frame, and the pair it produces.
  // Pure with respect to the tally: poll() adds one entry per frame after the
  // pedals have had their say, so a frame flown on pedals plus a mouse is not
  // counted twice.
  const pickBase = (now) => {
    // A finger on the pad outranks everything for as long as it is down — it
    // is an unambiguous, deliberate gesture, and on a hybrid laptop it should
    // win over a mouse that happens to be sitting off-centre.
    if (state.padOrigin) {
      return { source: 'pad', axes: state.padAxes, method: INPUT_TOUCH }
    }

    if (state.source === 'gamepad' && stick.connected()) {
      const a = stick.axes()
      // A centred stick would come out as -0 from the multiply. Nothing here
      // flies differently on it, but it compares unequal to 0 and would put a
      // baffling minus sign in front of a HUD readout.
      return {
        source: 'gamepad',
        axes: { x: a.x, y: a.y === 0 ? 0 : a.y * STICK_PITCH_SIGN },
        method: INPUT_JOYSTICK,
      }
    }

    // Keys beat the mouse while anything is held or still winding down, so a
    // player using the keyboard is not fighting a stationary pointer parked
    // halfway to the bezel.
    // Under the split the keys are the lateral control only, so they never
    // take the vertical job from the mouse.
    if (!split && (state.keysHeld.size || state.keyAxes.x !== 0 || state.keyAxes.y !== 0)) {
      return { source: 'keyboard', axes: state.keyAxes, method: INPUT_KEYBOARD_MOUSE }
    }

    // Nothing else is claiming it, so the mouse has the job — and the HUD
    // readout has to say so. A source left reading 'pad' or 'keyboard' after
    // the finger lifted or the key wound down would be telling the player
    // they are flying on something they let go of.
    const rect = readRect(now)
    if (!rect || !state.pointer) {
      return { source: 'pointer', axes: { x: 0, y: 0 }, method: null }
    }
    return {
      source: 'pointer',
      axes: pointerAxes(state.pointer.x, state.pointer.y, rect, { deadZone, expo }),
      method: INPUT_KEYBOARD_MOUSE,
    }
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
      if (state.firstPollAt == null) state.firstPollAt = now
      const target = keyTarget()
      for (const code of state.keysHeld) {
        if (KEY_AXIS[code][0] === 'x') { state.lateralKeyAt = now; break }
      }
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

      pedals.poll()
      if (pedals.connected() && pedals.awake()) state.pedalsEngaged = true
      else if (!pedals.connected()) state.pedalsEngaged = false

      const base = pickBase(now)
      state.source = base.source
      state.axes = base.axes
      if ((base.source === 'pointer' && state.pointerMoved) || (base.source === 'gamepad' && base.axes.y !== 0)) {
        state.verticalAt = now
      }
      state.pointerMoved = false

      // Engaged pedals own the lateral axis, whatever is flying the vertical
      // one. The stick's own roll goes unread, as on the apparatus. The run's
      // label stays whatever flew the vertical axis — a mouse with pedals is
      // still a mouse run, not a joystick one — and the pedals are recorded
      // beside it, so the board can show both.
      if (state.pedalsEngaged) {
        state.axes = { x: pedals.x(), y: state.axes.y }
        state.pedalFrames += 1
      } else if (split && base.source !== 'pad') {
        // Real CBAT split without pedals: the keys stand in for them. The
        // stick's roll and the mouse's sideways offset go unread. The run's
        // label is still whatever flew the vertical axis.
        state.axes = { x: state.keyAxes.x, y: state.axes.y }
      }
      // Keys steering the lateral axis with nothing on the vertical one (no
      // mouse on the page yet) is still a desk run, not nobody's.
      const method = base.method
        || (split && !state.pedalsEngaged && (state.keysHeld.size || state.keyAxes.x !== 0) ? INPUT_KEYBOARD_MOUSE : null)
      if (method) addInput(state.inputTally, method)
      if (method || state.pedalsEngaged) state.steeredFrames += 1
    },

    axes() { return state.axes },
    source() { return state.source },
    // Which physical device is flying, for the HUD's source readout.
    stickId() { return stick.padId() },
    pedalsId() { return pedals.padId() },
    pedalsEngaged() { return state.pedalsEngaged },
    // Keys own the lateral axis (Real CBAT split, no pedals, not on the pad).
    keysLateral() { return split && !state.pedalsEngaged && state.source !== 'pad' },
    // How long each half of the split has sat unused, timed from the first
    // poll if it never has been used. Drive the split's control prompts.
    lateralKeyIdleMs(now) {
      const from = state.lateralKeyAt ?? state.firstPollAt
      return from == null ? 0 : Math.max(0, now - from)
    },
    verticalIdleMs(now) {
      const from = state.verticalAt ?? state.firstPollAt
      return from == null ? 0 : Math.max(0, now - from)
    },
    // Whether the vertical half of the split is the mouse/stick's alone (Real
    // CBAT, not on the touch pad), i.e. whether its prompt can apply.
    verticalSplit() { return split && state.source !== 'pad' },
    // What the run was flown on, by frames — 'joystick', 'keyboard-mouse',
    // 'touch', or null before anything has steered. Read once at the end of a
    // run and sent with the score.
    inputMethod() { return dominantInput(state.inputTally) },
    inputTally() { return { ...state.inputTally } },
    // Whether the pedals get credited with the run: the same majority rule as
    // the method above, applied to the lateral axis. Pedals that held it for
    // at least half the frames anything was flying count; a set pushed once
    // near the end of a mouse run does not. false once something has steered
    // without them, null before anything has steered at all.
    usedPedals() {
      if (!state.steeredFrames) return null
      return state.pedalFrames * 2 >= state.steeredFrames
    },
    // Lets the stick and pedals pick up a fresh calibration without a remount.
    refresh() { stick.refresh(); pedals.refresh() },

    dispose() {
      stick.dispose()
      pedals.dispose()
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

// ── Control prompts (Real CBAT split) ──────────────────────────────────────
// Under the split each axis has its own control: the mouse or stick for up and
// down, the arrow keys (or pedals) for left and right. A player who has not
// found one of them watches the dot slide off on that axis with no idea why.
// Each prompt shows when its control has sat unused for CONTROL_HINT_IDLE_MS,
// counted from the start of the run if it has never been touched, AND the dot
// is outside the ring on that axis. Using the control clears it at once.
export const CONTROL_HINT_IDLE_MS = 1500

// The direction the dot needs to go, per axis ('left' | 'right' | 'up' |
// 'down'), or null for no prompt on that axis. +x right, +y down.
export function smaControlHints({
  lateral, vertical, lateralIdleMs, verticalIdleMs, x, y, ringRadius,
}) {
  const lat = lateral && lateralIdleMs >= CONTROL_HINT_IDLE_MS
    ? (x > ringRadius ? 'left' : x < -ringRadius ? 'right' : null)
    : null
  const ver = vertical && verticalIdleMs >= CONTROL_HINT_IDLE_MS
    ? (y > ringRadius ? 'up' : y < -ringRadius ? 'down' : null)
    : null
  return { lateral: lat, vertical: ver }
}
