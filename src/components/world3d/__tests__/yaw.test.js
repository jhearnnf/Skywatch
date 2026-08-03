import { describe, it, expect } from 'vitest'
import { shortestAngleDelta, TAU } from '../character/yaw'

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
