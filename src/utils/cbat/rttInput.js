// Input abstraction for the Rapid Tracking Test.
//
// The real CBAT RTT is flown on a joystick: how far the stick is pushed sets how
// FAST the camera slews (rate control, not aim), and the trigger on the front of
// the stick takes the picture. A pointer stands in for one where there is no
// stick — the pointer's offset from the middle of the arena is the stick's
// deflection, and the mouse button is the trigger.
//
// Everything downstream only ever sees a normalised axis pair in [-1,1] and a
// count of trigger presses. That is the entire point of this module: a real
// stick is just another source feeding the same two numbers, and not one line of
// the game changes when one is plugged in. It is also why the pointer path is
// written against pointer events rather than mouse events — the same code drives
// a finger drag, which is what the native CBAT-only app needs.
//
// The stick itself lives in gamepad.js, shared with ACT. This file owns the
// pointer and keyboard fallbacks and the rule for which source is in charge.
//
//   const input = createRttInput({ el })
//   input.poll()                    // once per frame
//   const { x, y } = input.axes()   // curved, dead-zoned, [-1,1]
//   const shots = input.consumeTriggerEdges()
//   input.dispose()

import {
  createStickReader, applyCurve, clamp1, loadProfile, defaultProfile, listPads,
  STICK_DEAD_ZONE, STICK_EXPO,
} from './gamepad'

// Re-exported under their old names: the curve is shared with the stick (a
// mouse standing in for a stick had better behave like one), and these are the
// names the rest of RTT and its tests already use.
export const RTT_DEAD_ZONE = STICK_DEAD_ZONE
export const RTT_EXPO = STICK_EXPO
export { applyCurve, clamp1 }

// Pointer position → stick deflection. Both axes are normalised by HALF THE
// HEIGHT, not by each own dimension: dividing x by the width would make the
// same hand movement mean different rates horizontally and vertically on a wide
// arena, which is exactly the thing a stick never does.
export function pointerAxes(clientX, clientY, rect, opts = {}) {
  const half = Math.max(1, rect.height / 2)
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const { deadZone = RTT_DEAD_ZONE, expo = RTT_EXPO } = opts
  return {
    x: applyCurve((clientX - cx) / half, deadZone, expo),
    y: applyCurve((clientY - cy) / half, deadZone, expo),
  }
}

export function createRttInput({ el, deadZone = RTT_DEAD_ZONE, expo = RTT_EXPO } = {}) {
  // The dead zone and expo the caller asked for have to reach the stick too, or
  // a tuned pointer and an untuned stick would fly differently on the same run.
  const stick = createStickReader({
    profileFor: (id) => ({ ...(loadProfile(id) || defaultProfile(id)), deadZone, expo }),
  })

  const state = {
    source: 'pointer',
    axes: { x: 0, y: 0 },
    triggerEdges: 0,
    // Pointer is tracked in client coordinates on the window, not on the arena.
    // Flinging the mouse past the edge should peg the stick in that direction,
    // not freeze the camera at whatever it read on the way out.
    pointer: null,
    rect: null,
    rectAt: 0,
    keyDown: false,
    // Touch has no resting position — a finger that is not down is not anywhere.
    // So a touch only drives the stick while it is held, and only if it started
    // inside the arena; otherwise tapping the shutter button below the arena
    // would peg the aim downward on its way past.
    touchTracking: false,
  }

  const readRect = (now) => {
    // Cached because axes() runs every frame and getBoundingClientRect forces
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
  const onPointerMove = (e) => {
    if (e.pointerType === 'touch' && !state.touchTracking) return
    state.pointer = { x: e.clientX, y: e.clientY }
  }
  // Leaving the document entirely centres the stick — the alternative is a
  // camera that slews forever because the pointer is off in another window.
  const onPointerOut = (e) => {
    if (e.relatedTarget === null) state.pointer = null
  }
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return
    state.touchTracking = false
    state.pointer = null
  }
  const onPointerDown = (e) => {
    if (e.pointerType === 'touch') state.touchTracking = true
    state.pointer = { x: e.clientX, y: e.clientY }
    // A touch is a slew, not a shot — the shutter is its own button. Only a
    // real mouse click takes a picture.
    if (e.pointerType !== 'touch' && e.button === 0) {
      state.triggerEdges += 1
      state.source = 'pointer'
    }
  }
  const onContextMenu = (e) => e.preventDefault()

  // ── Keyboard ───────────────────────────────────────────────────────────────
  // Space is the shutter for anyone who would rather keep the mouse purely on
  // the stick. Repeat is ignored so holding it down is one frame, not fifty.
  const onKeyDown = (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return
    e.preventDefault()
    if (state.keyDown) return
    state.keyDown = true
    state.triggerEdges += 1
  }
  const onKeyUp = (e) => {
    if (e.code === 'Space' || e.key === ' ') state.keyDown = false
  }

  // ── Gamepad ────────────────────────────────────────────────────────────────
  // Unplugging mid-run drops straight back to the pointer rather than pausing.
  // A run is scored on time, and a USB dropout is not a reason to void one — the
  // player should be able to keep flying on the mouse.
  const onGamepadDisconnected = () => {
    if (!listPads().length) state.source = 'pointer'
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerout', onPointerOut, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('resize', invalidateRect, { passive: true })
    window.addEventListener('scroll', invalidateRect, { passive: true })
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected)
  }
  if (el) {
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('contextmenu', onContextMenu)
  }

  return {
    // Called once per frame. Polling is explicit rather than hidden inside
    // axes() because a gamepad trigger is only observable by comparing button
    // state between frames — there are no gamepad events for it.
    poll(now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
      stick.poll()
      if (stick.connected()) {
        // A trigger squeeze is a shot whichever source is nominally in charge —
        // the player reaching for the stick's trigger has told us what they are
        // flying on, and swallowing that first press would cost them a frame.
        const shots = stick.consumeEdges('trigger')
        state.triggerEdges += shots
        // A connected-but-idle stick shouldn't steal the pointer's job; it takes
        // over the moment it's actually moved or its trigger is squeezed.
        if (stick.awake() || shots > 0) state.source = 'gamepad'
        if (state.source === 'gamepad') {
          state.axes = stick.axes()
          return
        }
      }

      const rect = readRect(now)
      if (!rect || !state.pointer) {
        state.axes = { x: 0, y: 0 }
        return
      }
      state.axes = pointerAxes(state.pointer.x, state.pointer.y, rect, { deadZone, expo })
    },

    axes() { return state.axes },

    // Returns how many shots were taken since the last call and resets. A count
    // rather than a boolean so a frame that swallowed two presses still fires
    // twice (the shutter cooldown in rttSim is what limits the rate, not this).
    consumeTriggerEdges() {
      const n = state.triggerEdges
      state.triggerEdges = 0
      return n
    },

    // The on-screen shutter button (and touch play generally) goes through here
    // rather than faking a pointer event.
    fireTrigger() { state.triggerEdges += 1 },

    source() { return state.source },
    // Which physical device is flying, for the HUD's source readout.
    stickId() { return stick.padId() },

    dispose() {
      stick.dispose()
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerout', onPointerOut)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        window.removeEventListener('resize', invalidateRect)
        window.removeEventListener('scroll', invalidateRect)
        window.removeEventListener('gamepaddisconnected', onGamepadDisconnected)
      }
      if (el) {
        el.removeEventListener('pointerdown', onPointerDown)
        el.removeEventListener('contextmenu', onContextMenu)
      }
    },
  }
}
