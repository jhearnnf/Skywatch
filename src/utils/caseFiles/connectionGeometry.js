/**
 * connectionGeometry.js
 * Pure SVG curve-math utilities for the Case Files red-string connector.
 * No React dependencies — safe to import in test environments without jsdom.
 */

/**
 * bezierPath(fromPt, toPt)
 * Returns an SVG cubic-bezier `d` string between two {x, y} points.
 * The control-point elevation is proportional to distance so the string
 * looks "draped" (droops naturally on short runs, arcs more on long runs).
 *
 * Strategy: use two control points that both sit above (or beside) the
 * midpoint by a fraction of the distance — gives a gentle S-free drape.
 */
export function bezierPath(fromPt, toPt) {
  const dx = toPt.x - fromPt.x
  const dy = toPt.y - fromPt.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  // Drape factor: 15 % of distance, minimum 20px, maximum 80px.
  // Positive value = control points shift downward (gravity drape).
  const drape = Math.min(Math.max(dist * 0.15, 20), 80)

  // Mid x/y
  const mx = fromPt.x + dx / 2
  const my = fromPt.y + dy / 2

  // Perpendicular direction (rotate 90 degrees) — used to offset control
  // points so the curve bows sideways on nearly-vertical connections.
  const len = dist || 1
  const px = -dy / len  // perpendicular unit vector x
  const py =  dx / len  // perpendicular unit vector y

  // For a natural drape we bias the perpendicular offset toward "downward".
  // If the string runs mostly horizontally, add a vertical drape; if mostly
  // vertical, add a horizontal sway.
  const horizBias = Math.abs(dx) / len  // 1 = horizontal, 0 = vertical
  const vertBias  = Math.abs(dy) / len

  const cp1x = fromPt.x + dx * 0.25 + px * drape * vertBias  + 0 * horizBias
  const cp1y = fromPt.y + dy * 0.25 + py * drape * vertBias  + drape * horizBias
  const cp2x = fromPt.x + dx * 0.75 + px * drape * vertBias  + 0 * horizBias
  const cp2y = fromPt.y + dy * 0.75 + py * drape * vertBias  + drape * horizBias

  return `M ${fromPt.x} ${fromPt.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPt.x} ${toPt.y}`
}

/**
 * midpoint(fromPt, toPt)
 * Returns the geometric midpoint {x, y} — used for label positioning.
 */
export function midpoint(fromPt, toPt) {
  return {
    x: (fromPt.x + toPt.x) / 2,
    y: (fromPt.y + toPt.y) / 2,
  }
}

/**
 * arePointsEqual(a, b, eps)
 * Returns true if both points are within `eps` pixels of each other.
 * Useful for deduplication guards.
 */
export function arePointsEqual(a, b, eps = 0.5) {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
}
