import * as THREE from 'three'

// Flies ACT's ball for a landing-page demo card.
//
// The point is that nobody can tell: a tunnel where the ball drifts into the
// wall reads as a broken tile, and one that snaps dead-centre through every
// gate reads as a video. So this steers like a competent player — it lines up
// on the next gate, dodges the one it has been told to avoid, and weaves
// slightly on the way.
//
// It never touches the ball directly. `steerInput` returns the same dx/dy
// pixel-equivalents a drag produces, which the game loop converts through
// TURN_RATE and clamps exactly as it would a human's; the ball stays subject to
// every rule (rotation cap, forward-deviation cone, wall snap) that a player is.
//
// Geometry mirrors CbatAct: gate centres sit on the curve at `ev.t`, pushed out
// by (offsetU, offsetV) in the cross-section frame, and a gate counts as
// threaded when the ball passes within SHAPE_RADIUS - BALL_RADIUS of that
// centre.

const UP   = new THREE.Vector3(0, 1, 0)
const ZERO = new THREE.Vector3(0, 0, 0)

// How fast the pilot is willing to swing the nose. A real drag can rotate far
// harder (the game caps at 0.9 rad in a single tick); staying well under that
// is what makes the flying look considered rather than twitchy.
export const PILOT_MAX_RAD_PER_S = 2.2

// Lateral drift, in world units, of a pilot that isn't a machine. Small enough
// that gates still get threaded — SHAPE_RADIUS - BALL_RADIUS is 0.52.
export const PILOT_WOBBLE = 0.16

// How far off the tunnel axis to sit when dodging. Comfortably clear of a gate
// (0.52 needed) and comfortably short of the wall (1.82 available).
export const PILOT_DODGE = 1.25

// The cross-section frame at a point on the curve: the same lookAt basis the
// renderer and the scorer use, so U/V here mean what they mean everywhere else.
export function crossSectionQuat(curve, t) {
  const tan = curve.getTangentAt(t).normalize()
  const m = new THREE.Matrix4().lookAt(ZERO, tan, UP)
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

// World-space centre of a gate.
export function gateCentre(curve, ev) {
  const pos = curve.getPointAt(ev.t)
  if (ev.offsetU || ev.offsetV) {
    const local = new THREE.Vector3(ev.offsetU || 0, ev.offsetV || 0, 0)
    pos.add(local.applyQuaternion(crossSectionQuat(curve, ev.t)))
  }
  return pos
}

/**
 * Where to point the ball right now.
 *
 * @param {THREE.Curve} curve
 * @param {Array}  events           shape events, ascending by t
 * @param {number} ballT            progress along the curve, 0..1
 * @param {object} opts
 * @param {*}      opts.avoidTargetId  id of the gate the round told us to miss
 * @param {number} opts.wobble      -1..1, the pilot's current drift
 * @returns {THREE.Vector3} a world point to fly at
 */
export function pickAim(curve, events, ballT, { avoidTargetId = null, wobble = 0 } = {}) {
  const next = events.find((e) => e.t > ballT)
  // Past the last gate — settle back onto the centreline and ride it out.
  if (!next) return curve.getPointAt(Math.min(1, ballT + 0.05))

  const quat = crossSectionQuat(curve, next.t)
  const u = new THREE.Vector3(1, 0, 0).applyQuaternion(quat)

  if (next.id != null && next.id === avoidTargetId) {
    // Dodge: slide to the far side of the tunnel from wherever the gate sits,
    // so the miss holds whether the gate is off-centre or dead on the axis.
    const axis = curve.getPointAt(next.t)
    const centre = gateCentre(curve, next)
    const tan = curve.getTangentAt(next.t).normalize()
    const lateral = centre.clone().sub(axis)
    lateral.addScaledVector(tan, -lateral.dot(tan))
    const dir = lateral.lengthSq() > 1e-6 ? lateral.normalize() : u
    return axis.addScaledVector(dir, -PILOT_DODGE)
  }

  // Thread it, give or take the wobble.
  return gateCentre(curve, next).addScaledVector(u, wobble * PILOT_WOBBLE)
}

// Signed angle from `a` to `b` measured about `axis` (all in world space).
function angleAbout(a, b, axis) {
  const pa = a.clone().addScaledVector(axis, -a.dot(axis))
  const pb = b.clone().addScaledVector(axis, -b.dot(axis))
  if (pa.lengthSq() < 1e-9 || pb.lengthSq() < 1e-9) return 0
  pa.normalize(); pb.normalize()
  const cross = new THREE.Vector3().crossVectors(pa, pb)
  return Math.atan2(cross.dot(axis), pa.dot(pb))
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * Convert "point the nose at `aim`" into the drag the game loop expects.
 *
 * Mirrors CbatAct's own decomposition: a yaw about world-up, then a pitch about
 * the camera-right axis taken from the pre-yaw forward — so the input we hand
 * back produces the rotation we asked for once the loop applies it.
 *
 * @returns {{dx: number, dy: number}} pixel-equivalent drag for this frame
 */
export function steerInput({ position, forward, aim, turnRate, dt, maxRadPerS = PILOT_MAX_RAD_PER_S }) {
  const desired = aim.clone().sub(position)
  if (desired.lengthSq() < 1e-9) return { dx: 0, dy: 0 }
  desired.normalize()

  const yaw = angleAbout(forward, desired, UP)
  const afterYaw = forward.clone().applyAxisAngle(UP, yaw)
  const camRight = new THREE.Vector3().crossVectors(forward, UP)
  const pitch = camRight.lengthSq() > 1e-9 ? angleAbout(afterYaw, desired, camRight.normalize()) : 0

  const cap = maxRadPerS * dt
  return {
    // The loop reads yaw as `-dx * turnRate` and pitch as `dy * turnRate`.
    dx: -clamp(yaw,   -cap, cap) / turnRate,
    dy:  clamp(pitch, -cap, cap) / turnRate,
  }
}

// A slow, irregular drift so the flying doesn't look sampled off a rail. Two
// primes-ish periods beat together, so it never repeats on an obvious cycle.
export function wobbleAt(elapsedS) {
  return 0.6 * Math.sin(elapsedS * 0.9) + 0.4 * Math.sin(elapsedS * 2.3 + 1.1)
}
