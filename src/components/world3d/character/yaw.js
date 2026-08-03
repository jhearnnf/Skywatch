export const TAU = Math.PI * 2

// Signed shortest rotation from `from` to `to`, in [-PI, PI).
//
// Extracted from CharacterController's auto-follow yaw so the wrap can be tested: the controller
// itself only runs inside a useFrame loop, which is where this bug was able to hide.
//
// The double modulo is not decoration. JavaScript's `%` is a REMAINDER, not a modulo — it keeps
// the sign of the dividend, so `-2.858 % TAU` is `-2.858`, NOT `3.425`. A single-modulo wrap
//
//     ((to - from + PI) % TAU) - PI
//
// therefore lands in (-3PI, -PI) whenever `to - from < -PI`, returning a rotation that is both
// the wrong way round and up to ~20x too large. Fed into a per-frame lerp that overshoots and
// recomputes wrong again, it spins the camera continuously. Adding TAU before the second modulo
// forces a true non-negative modulo first.
//
// Same idiom as the compass wrap in src/components/cbat/InstrumentPanel.jsx.
export function shortestAngleDelta(from, to) {
  return ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI
}

// World movement direction for camera-relative input. `localX` is strafe (+1 = right),
// `localZ` is forward/back (-1 = forward), both as written to input.move.
export function cameraRelativeMove(yaw, localX, localZ) {
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  return {
    dx: localX * cosY + localZ * sinY,
    dz: -localX * sinY + localZ * cosY,
  }
}

// The camera yaw that trails a character heading.
//
// The two angles use DIFFERENT conventions and the half-turn between them is the whole point
// of this helper. A character heading F moves along (sin F, cos F) — the +Z-forward convention
// the model is authored in. The camera at yaw Y sits behind the player and looks along
// (-sin Y, -cos Y). So the camera that trails heading F is at F + PI, not at F.
//
// Aiming the auto-follow at F itself asks for a 180 degree turn on the very first frame of
// walking forward. Worse, the input is camera-relative: rotating the camera rotates the world
// movement direction with it, so the next frame recomputes the same 180 degree error. The turn
// never converges and the camera spins (~860 deg/s forward, ~430 deg/s strafing) instead of
// settling behind the player.
export function cameraYawBehind(facing) {
  return facing + Math.PI
}
