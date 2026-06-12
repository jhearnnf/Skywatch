import { describe, it, expect, beforeEach } from 'vitest'
import { _reset, registerCollider, resolveMove, resolveAxis } from '../collision/colliders'

beforeEach(() => _reset())

describe('resolveAxis', () => {
  it('blocks movement into a wall on +X axis and snaps to wall edge', () => {
    registerCollider('w', { x: 5, z: 0, halfX: 1, halfZ: 5 })
    // Character at (3, 0) with radius 0.5 tries to step to x = 4.6.
    // Wall extends from x=4 to x=6; with radius the no-go zone is [3.5, 6.5].
    // Should snap to x = 3.5 (min edge).
    const next = resolveAxis('x', { x: 3, z: 0 }, 4.6, 0.5)
    expect(next).toBeCloseTo(3.5, 5)
  })

  it('allows movement parallel to a wall when off-axis range is clear', () => {
    registerCollider('w', { x: 0, z: 5, halfX: 5, halfZ: 0.5 })
    // Character at (0, 0) moving along X — wall is far away on Z.
    const next = resolveAxis('x', { x: 0, z: 0 }, 2, 0.4)
    expect(next).toBe(2)
  })

  it('does not snap when the character is outside the wall perpendicular range', () => {
    registerCollider('w', { x: 0, z: 0, halfX: 1, halfZ: 0.5 })
    // Character far away on Z; X movement should pass through freely.
    const next = resolveAxis('x', { x: -2, z: 10 }, 5, 0.4)
    expect(next).toBe(5)
  })
})

describe('resolveMove', () => {
  it('slides along a wall when moving diagonally into a corner', () => {
    // Wall on the +X side of origin.
    registerCollider('w', { x: 3, z: 0, halfX: 0.5, halfZ: 5 })
    const r = 0.4
    // Start at (0, 0), move diagonally (+X, +Z). X is blocked, Z slides.
    const out = resolveMove({ x: 0, z: 0 }, { x: 5, z: 2 }, r)
    expect(out.x).toBeCloseTo(3 - 0.5 - r, 5) // snapped to wall's -X edge
    expect(out.z).toBe(2)                      // Z motion unaffected
  })

  it('returns the desired position when no colliders intervene', () => {
    const out = resolveMove({ x: 0, z: 0 }, { x: 1, z: 1 }, 0.4)
    expect(out).toEqual({ x: 1, z: 1 })
  })

  it('pushes a character lodged inside a wall back to the nearest edge', () => {
    registerCollider('w', { x: 0, z: 0, halfX: 1, halfZ: 1 })
    // Character starts inside the wall's expanded interval on X axis.
    const out = resolveMove({ x: -0.3, z: 0 }, { x: 0, z: 0 }, 0.5)
    // Nearer to -X edge (-1.5) than +X edge (+1.5), so snap to -1.5.
    expect(out.x).toBeCloseTo(-1.5, 5)
  })

  it('caps overshoot when a single step crosses the wall in one frame', () => {
    registerCollider('w', { x: 3, z: 0, halfX: 0.5, halfZ: 5 })
    // Big step (4 units) from -1 to +3 jumps past the wall; should clamp
    // to the -X edge instead of tunneling through.
    const out = resolveMove({ x: -1, z: 0 }, { x: 4, z: 0 }, 0.4)
    expect(out.x).toBeCloseTo(2.1, 5)
  })
})
