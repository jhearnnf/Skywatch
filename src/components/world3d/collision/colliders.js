// Axis-aligned rectangle colliders on the X-Z plane. The player is treated as
// a circle (radius). Movement is resolved per-axis (X first, then Z) so the
// character slides along walls instead of stopping when grazing a corner.
//
// Rect shape: { x, z, halfX, halfZ }  — center + half-extents
// Position shape: { x, z }
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

// Resolve a circle vs all rects on a single axis. `axis` is 'x' or 'z'.
// `pos` is the current (already-resolved) position; `next` is the candidate
// position after applying delta on `axis` only. Returns the corrected scalar
// for that axis.
//
// Algorithm: for each wall whose perpendicular range overlaps the character,
// snap to the wall edge on the side the character started from. Handles
// large per-frame steps (next may overshoot the wall) and the rare case
// where the character is already lodged inside a wall.
export function resolveAxis(axis, pos, next, radius, rects = getColliders()) {
  const other = axis === 'x' ? 'z' : 'x'
  const halfAxis = axis === 'x' ? 'halfX' : 'halfZ'
  const halfOther = axis === 'x' ? 'halfZ' : 'halfX'
  let resolved = next

  for (const r of rects) {
    const minOther = r[other] - r[halfOther] - radius
    const maxOther = r[other] + r[halfOther] + radius
    // Boundary counts as "outside" — after an axis-1 snap, the character sits
    // exactly on the wall's perpendicular edge; treating that as still-inside
    // makes axis-2 incorrectly think the wall is in range.
    if (pos[other] <= minOther || pos[other] >= maxOther) continue

    const minAxis = r[axis] - r[halfAxis] - radius
    const maxAxis = r[axis] + r[halfAxis] + radius

    if (pos[axis] <= minAxis) {
      if (resolved > minAxis) resolved = minAxis
    } else if (pos[axis] >= maxAxis) {
      if (resolved < maxAxis) resolved = maxAxis
    } else {
      // Character already inside the wall's expanded interval — push out
      // to the nearer edge to avoid getting stuck.
      resolved = (pos[axis] - minAxis) < (maxAxis - pos[axis]) ? minAxis : maxAxis
    }
  }
  return resolved
}

export function resolveMove(pos, delta, radius, rects = getColliders()) {
  const afterX = resolveAxis('x', pos, pos.x + delta.x, radius, rects)
  const stepX = { x: afterX, z: pos.z }
  const afterZ = resolveAxis('z', stepX, pos.z + delta.z, radius, rects)
  return { x: afterX, z: afterZ }
}
