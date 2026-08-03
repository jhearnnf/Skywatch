import { describe, it, expect } from 'vitest'
import { shortestAngleDelta, cameraRelativeMove, cameraYawBehind, TAU } from '../character/yaw'

// The camera's auto-follow yaw (CharacterController, pointer NOT locked) turns by this delta
// every frame. It has to be the SHORT way round and it has to be bounded by PI — a delta outside
// that range overshoots, recomputes wrong on the next frame, and spins the camera continuously.

const near = (a, b) => expect(a).toBeCloseTo(b, 10)

describe('shortestAngleDelta', () => {
  it('is zero when already facing the target', () => {
    near(shortestAngleDelta(0, 0), 0)
    near(shortestAngleDelta(2.5, 2.5), 0)
  })

  it('turns the obvious way for small differences', () => {
    near(shortestAngleDelta(0, 1), 1)
    near(shortestAngleDelta(1, 0), -1)
  })

  // The exact case that spun the camera. A single-modulo wrap returns -6.0 here: the wrong
  // direction, and ~20x the size of the real turn.
  it('turns the short way across the -PI/+PI seam', () => {
    const delta = shortestAngleDelta(3, -3)
    near(delta, TAU - 6)          // ≈ +0.283, not -6
    expect(delta).toBeGreaterThan(0)
    expect(Math.abs(delta)).toBeLessThan(Math.PI)
  })

  it('turns the short way across the seam in the other direction', () => {
    const delta = shortestAngleDelta(-3, 3)
    near(delta, 6 - TAU)          // ≈ -0.283
    expect(delta).toBeLessThan(0)
  })

  // The invariant that actually matters: whatever the inputs, one frame's turn is never more
  // than half a revolution, so the lerp always converges instead of chasing its tail.
  it('never exceeds half a revolution, for any pair of angles', () => {
    for (let from = -3 * TAU; from <= 3 * TAU; from += 0.37) {
      for (let to = -3 * TAU; to <= 3 * TAU; to += 0.41) {
        const delta = shortestAngleDelta(from, to)
        expect(Math.abs(delta)).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })

  // Applying the delta must actually land on the target heading (mod a full turn), or the
  // camera converges on the wrong direction.
  it('lands on the target heading once applied', () => {
    for (let from = -8; from <= 8; from += 0.31) {
      for (let to = -8; to <= 8; to += 0.29) {
        const landed = from + shortestAngleDelta(from, to)
        const gap = ((landed - to) % TAU + TAU) % TAU
        expect(Math.min(gap, TAU - gap)).toBeLessThan(1e-9)
      }
    }
  })

  it('is unaffected by winding — angles many turns apart behave the same', () => {
    near(shortestAngleDelta(0.5, 1.5), shortestAngleDelta(0.5 + 4 * TAU, 1.5 - 6 * TAU))
  })

  // Exactly opposite is a tie; either way round is equally short. Pinned so the sign can't drift
  // silently into something that reads as a direction preference.
  it('resolves an exact half-turn to -PI', () => {
    near(shortestAngleDelta(0, Math.PI), -Math.PI)
  })
})

// The auto-follow's TARGET, which is the other half of the same bug. Aiming at the character
// heading instead of cameraYawBehind(heading) left the camera one half-turn out, and because the
// input is camera-relative the error was regenerated every frame instead of shrinking: walking
// forward spun the view at ~860 deg/s and strafing at ~430 deg/s. Backwards was the only stable
// direction, because that is the one case where the two conventions happen to coincide.

// One frame of auto-follow: the turn the camera is asked to make, given a yaw and the input.
function autoFollowDelta(yaw, localX, localZ) {
  const { dx, dz } = cameraRelativeMove(yaw, localX, localZ)
  const facing = Math.atan2(dx, dz)
  return shortestAngleDelta(yaw, cameraYawBehind(facing))
}

describe('camera auto-follow target', () => {
  const YAWS = [0, 0.7, 1.9, 3.0, -2.2, -0.4, 5.8]

  it('asks for no turn at all when walking straight forward, at any yaw', () => {
    for (const yaw of YAWS) near(autoFollowDelta(yaw, 0, -1), 0)
  })

  it('asks for a half-turn when reversing — the camera swings behind you', () => {
    for (const yaw of YAWS) expect(Math.abs(autoFollowDelta(yaw, 0, 1))).toBeCloseTo(Math.PI, 10)
  })

  it('asks for a quarter-turn when strafing, towards the side being strafed', () => {
    for (const yaw of YAWS) {
      near(autoFollowDelta(yaw, 1, 0), -Math.PI / 2)   // right
      near(autoFollowDelta(yaw, -1, 0), Math.PI / 2)   // left
    }
  })

  // The regression itself: the old target (facing, unshifted) was stable for exactly one input.
  it('the unshifted heading is stable only in reverse — which is why only S behaved', () => {
    const unshifted = (yaw, x, z) => {
      const { dx, dz } = cameraRelativeMove(yaw, x, z)
      return shortestAngleDelta(yaw, Math.atan2(dx, dz))
    }
    near(unshifted(0.7, 0, 1), 0)                                      // S — stable
    expect(Math.abs(unshifted(0.7, 0, -1))).toBeCloseTo(Math.PI, 10)   // W — worst case
    expect(Math.abs(unshifted(0.7, 1, 0))).toBeCloseTo(Math.PI / 2, 10) // D
    expect(Math.abs(unshifted(0.7, -1, 0))).toBeCloseTo(Math.PI / 2, 10) // A
  })
})

describe('cameraRelativeMove', () => {
  it('sends forward input along the camera view direction', () => {
    // The camera at yaw Y looks along (-sin Y, -cos Y).
    for (const yaw of [0, 1.1, -2.4, 4.9]) {
      const { dx, dz } = cameraRelativeMove(yaw, 0, -1)
      near(dx, -Math.sin(yaw))
      near(dz, -Math.cos(yaw))
    }
  })

  it('keeps the movement vector unit-length for a unit input', () => {
    for (const yaw of [0, 2.3, -1.7]) {
      const { dx, dz } = cameraRelativeMove(yaw, 1, 0)
      near(Math.hypot(dx, dz), 1)
    }
  })
})
