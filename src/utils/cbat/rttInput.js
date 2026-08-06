// Input abstraction for the Rapid Tracking Test.
//
// The real CBAT RTT is flown on a joystick: how far the stick is pushed sets how
// FAST the camera slews (rate control, not aim), and the trigger on the front of
// the stick takes the picture. There is no joystick here yet, so a pointer
// stands in for one — the pointer's offset from the middle of the arena is the
// stick's deflection, and the mouse button is the trigger.
//
// Everything downstream only ever sees a normalised axis pair in [-1,1] and a
// count of trigger presses. That is the entire point of this module: when a real
// stick arrives, `gamepad` below becomes the live source and not one line of the
// game changes. It is also why the pointer path is written against pointer
// events rather than mouse events — the same code drives a finger drag, which is
// what the native CBAT-only app needs.
//
//   const input = createRttInput({ el })
//   input.poll()                    // once per frame
//   const { x, y } = input.axes()   // curved, dead-zoned, [-1,1]
//   const shots = input.consumeTriggerEdges()
//   input.dispose()

// A stick has slop around centre and so does a hand on a mouse; without a dead
// zone the camera never quite stops.
export const RTT_DEAD_ZONE = 0.07
// Expo bends the response curve so small deflections give fine control and the
// outer travel gives the speed — real sticks behave this way, and tracking a
// slow walker is impossible on a linear curve.
export const RTT_EXPO = 0.5
// Deflection a gamepad axis must reach before we accept that a stick is really
// being flown (rather than sitting connected with a drifting potentiometer).
const GAMEPAD_WAKE = 0.2

export function clamp1(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v
}

// Dead zone, then cubic expo. Rescaled past the dead zone so full deflection
// still reaches exactly 1 — otherwise the top of the range is unreachable.
export function applyCurve(v, deadZone = RTT_DEAD_ZONE, expo = RTT_EXPO) {
  const m = Math.abs(clamp1(v))
  if (m <= deadZone) return 0
  const t = (m - deadZone) / (1 - deadZone)
  const curved = (1 - expo) * t + expo * t * t * t
  return Math.sign(v) * curved
}

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

function firstConnectedPad() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null
  let pads
  try { pads = navigator.getGamepads() } catch { return null }
  if (!pads) return null
  for (const p of pads) {
    if (p && p.connected && p.axes && p.axes.length >= 2) return p
  }
  return null
}

export function createRttInput({ el, deadZone = RTT_DEAD_ZONE, expo = RTT_EXPO } = {}) {
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
    padDown: false,
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
  const onGamepadDisconnected = () => {
    if (!firstConnectedPad()) {
      state.source = 'pointer'
      state.padDown = false
    }
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
      const pad = firstConnectedPad()
      if (pad) {
        const px = clamp1(pad.axes[0] || 0)
        const py = clamp1(pad.axes[1] || 0)
        const pressed = !!(pad.buttons && (pad.buttons[0]?.pressed || pad.buttons[1]?.pressed))
        // A connected-but-idle stick shouldn't steal the pointer's job; it takes
        // over the moment it's actually moved or its trigger is squeezed.
        if (Math.hypot(px, py) > GAMEPAD_WAKE || pressed) state.source = 'gamepad'
        if (state.source === 'gamepad') {
          state.axes = { x: applyCurve(px, deadZone, expo), y: applyCurve(py, deadZone, expo) }
          if (pressed && !state.padDown) state.triggerEdges += 1
          state.padDown = pressed
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

    dispose() {
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
