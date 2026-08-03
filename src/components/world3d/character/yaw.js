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
