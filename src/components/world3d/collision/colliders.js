// Collider shapes on the X-Z plane. The player is treated as a circle (radius).
// Movement is resolved per-axis (X first, then Z) so the character slides along
// walls instead of stopping when grazing a corner.
//
// Rect shape:   { x, z, halfX, halfZ }  — centre + half-extents
// Circle shape: { x, z, r }             — centre + radius
// Position:     { x, z }
//
// Round props (tyres, drums, cable reels) are common in the hangar and a box
// around them blocks the corners where nothing is, so circles are a first-class
// shape rather than something approximated.
//
// Module-scope registry keeps the registration API symmetric with React
// useEffect (mount/unmount). Tests reset via _reset().

const colliders = new Map()

export function registerCollider(id, rect) {
  colliders.set(id, rect)
}

export function unregisterCollider(id) {
  colliders.delete(id)
}

export function getColliders() {
  return Array.from(colliders.values())
}

export function _reset() {
  colliders.clear()
}

// The span on `axis` that a shape denies the character, given where the
// character currently sits on the other axis. null when the shape is out of
// range there. Both shapes are grown by the character's radius, which turns the
// character into a point and keeps the rest of the maths a 1-D interval test.
//
// Boundary counts as "outside" — after an axis-1 snap the character sits exactly
// on a wall's perpendicular edge, and treating that as still-inside makes axis-2
// incorrectly think the wall is in range.
function blockedSpan(shape, axis, other, otherPos, radius) {
  if (shape.r !== undefined) {
    // Circle: the grown disc's width on `axis` shrinks as the character moves
    // off-centre on the other axis, which is exactly what a box gets wrong.
    const reach = shape.r + radius
    const d = otherPos - shape[other]
    if (d <= -reach || d >= reach) return null
    const half = Math.sqrt(reach * reach - d * d)
    return [shape[axis] - half, shape[axis] + half]
  }
  const halfOther = other === 'x' ? shape.halfX : shape.halfZ
  const halfAxis = axis === 'x' ? shape.halfX : shape.halfZ
  if (otherPos <= shape[other] - halfOther - radius) return null
  if (otherPos >= shape[other] + halfOther + radius) return null
  return [shape[axis] - halfAxis - radius, shape[axis] + halfAxis + radius]
}

// Resolve the character vs all shapes on a single axis. `axis` is 'x' or 'z'.
// `pos` is the current (already-resolved) position; `next` is the candidate
// position after applying delta on `axis` only. Returns the corrected scalar
// for that axis.
//
// Algorithm: for each shape in range, snap to its edge on the side the character
// started from. Handles large per-frame steps (next may overshoot the shape) and
// the rare case where the character is already lodged inside one.
export function resolveAxis(axis, pos, next, radius, shapes = getColliders()) {
  const other = axis === 'x' ? 'z' : 'x'
  let resolved = next

  for (const s of shapes) {
    const span = blockedSpan(s, axis, other, pos[other], radius)
    if (!span) continue
    const [minAxis, maxAxis] = span

    if (pos[axis] <= minAxis) {
      if (resolved > minAxis) resolved = minAxis
    } else if (pos[axis] >= maxAxis) {
      if (resolved < maxAxis) resolved = maxAxis
    } else {
      // Character already inside the shape's expanded interval — push out
      // to the nearer edge to avoid getting stuck.
      resolved = (pos[axis] - minAxis) < (maxAxis - pos[axis]) ? minAxis : maxAxis
    }
  }
  return resolved
}

export function resolveMove(pos, delta, radius, shapes = getColliders()) {
  const afterX = resolveAxis('x', pos, pos.x + delta.x, radius, shapes)
  const stepX = { x: afterX, z: pos.z }
  const afterZ = resolveAxis('z', stepX, pos.z + delta.z, radius, shapes)
  return { x: afterX, z: afterZ }
}
