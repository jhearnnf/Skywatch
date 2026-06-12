// Singleton mutable input state. Read every frame by CharacterController;
// written by keyboard listeners, pointer-lock mouse, virtual joystick, and
// action button. Keeping it outside React state avoids per-frame re-renders.
//
// move.x      — strafe (-1 .. 1); +1 = right
// move.z      — forward (-1 .. 1); -1 = forward (matches three.js camera-forward = -Z)
// lookDeltaX  — accumulated mouse/touch yaw delta in pixels (consumed each frame)
// lookDeltaY  — accumulated mouse pitch delta in pixels (consumed each frame)
// pointerLocked — true while pointer-lock is engaged; CharacterController uses
//                 mouse look only while locked, otherwise auto-tracks movement
// _action     — set true on E / action-button tap; CharacterController consumes
//               via consumeAction() so each press fires exactly once
// _jump       — set true on Space / jump-button tap; consumed via consumeJump()
// run         — true while a run modifier (Shift) is held; faster movement

export const input = {
  move: { x: 0, z: 0 },
  lookDeltaX: 0,
  lookDeltaY: 0,
  pointerLocked: false,
  run: false,
  _action: false,
  _jump: false,
  setAction() { this._action = true },
  consumeAction() {
    const v = this._action
    this._action = false
    return v
  },
  setJump() { this._jump = true },
  consumeJump() {
    const v = this._jump
    this._jump = false
    return v
  },
}
