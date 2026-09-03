/**
 * motionGeometry.js
 * Pure maths for the animated Case Files map layer. No React, no Leaflet, no
 * DOM — every value here is computed analytically so the same code runs in
 * jsdom tests as in the browser.
 *
 * The moving pieces on the live map travel along a quadratic Bezier: the two
 * endpoints are the hotspots, and the control point is pushed sideways off the
 * midpoint so a missile arcs rather than sliding along a ruler. A convoy uses
 * a bend of zero, which collapses the curve back to a straight line.
 */

// ── Per-kind presentation ────────────────────────────────────────────────────
//
// bend        how far the control point is pushed off the midpoint, as a
//             fraction of the endpoint distance. Positive bends "up-left" of
//             the direction of travel.
// travelMs    fallback duration when the content gives no animationMs.
// holdMs      pause at the destination before the run loops, which is where
//             the impact flash plays.
// trailPx     length of the comet tail behind the head, in screen pixels.
// label       plain-English name, drawn beside the route so a player who has
//             never read a military map still knows what just moved.

export const UNIT_KIND_STYLE = {
  missile: {
    bend: 0.26, travelMs: 1500, holdMs: 900, trailPx: 96,
    label: 'Missile strike', impact: 'blast', width: 2.4,
  },
  airborne: {
    bend: 0.14, travelMs: 2200, holdMs: 1200, trailPx: 70,
    label: 'Airborne assault', impact: 'drop', width: 2.2,
  },
  convoy: {
    bend: 0.05, travelMs: 3200, holdMs: 700, trailPx: 120,
    label: 'Ground convoy', impact: 'dwell', width: 3.2,
  },
  armour: {
    bend: 0.06, travelMs: 3000, holdMs: 700, trailPx: 110,
    label: 'Armoured push', impact: 'dwell', width: 3.2,
  },
  naval: {
    bend: 0.18, travelMs: 3000, holdMs: 800, trailPx: 90,
    label: 'Naval movement', impact: 'dwell', width: 2.4,
  },
  air: {
    bend: 0.16, travelMs: 2000, holdMs: 800, trailPx: 80,
    label: 'Air strike', impact: 'blast', width: 2.2,
  },
}

const DEFAULT_KIND_STYLE = {
  bend: 0.12, travelMs: 2400, holdMs: 800, trailPx: 80,
  label: 'Movement', impact: 'dwell', width: 2.4,
}

export function kindStyle(kind) {
  return UNIT_KIND_STYLE[kind] ?? DEFAULT_KIND_STYLE
}

// Side colours match UNIT_SIDE_COLOR in MapCanvas so the static rings and the
// moving pieces read as the same force.
export const SIDE_COLOR = {
  ru:       '#f87171',
  hostile:  '#f87171',
  ua:       '#4ade80',
  friendly: '#4ade80',
  neutral:  '#facc15',
}

export function sideColor(side) {
  return SIDE_COLOR[side] ?? '#94a3b8'
}

// ── Bezier maths ─────────────────────────────────────────────────────────────

/**
 * controlPoint(p0, p1, bend)
 * Midpoint of p0→p1, pushed perpendicular to the run by `bend` × distance.
 */
export function controlPoint(p0, p1, bend) {
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular unit vector. Screen y grows downward, so this pushes the
  // curve to the left of the direction of travel — consistently, run to run.
  const px = dy / len
  const py = -dx / len
  return {
    x: (p0.x + p1.x) / 2 + px * len * bend,
    y: (p0.y + p1.y) / 2 + py * len * bend,
  }
}

/** Point on the quadratic Bezier at t ∈ [0, 1]. */
export function bezierPoint(p0, c, p1, t) {
  const mt = 1 - t
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  }
}

/** Heading at t, in degrees, for rotating a glyph to face where it is going. */
export function bezierHeading(p0, c, p1, t) {
  const mt = 1 - t
  const dx = 2 * mt * (c.x - p0.x) + 2 * t * (p1.x - c.x)
  const dy = 2 * mt * (c.y - p0.y) + 2 * t * (p1.y - c.y)
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

/**
 * bezierLength(p0, c, p1, samples)
 * Polyline approximation of the curve length. 16 samples is well inside a
 * pixel of the true length at the distances this map deals in, and it means
 * the comet tail can be sized without asking the DOM for getTotalLength().
 */
export function bezierLength(p0, c, p1, samples = 16) {
  let total = 0
  let prev = p0
  for (let i = 1; i <= samples; i += 1) {
    const pt = bezierPoint(p0, c, p1, i / samples)
    total += Math.hypot(pt.x - prev.x, pt.y - prev.y)
    prev = pt
  }
  return total
}

/** SVG path data for the curve. */
export function bezierPath(p0, c, p1) {
  return `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`
}

// ── Cycle timing ─────────────────────────────────────────────────────────────

/**
 * cyclePhase({ elapsedMs, travelMs, holdMs, delayMs })
 *
 * Maps wall-clock time onto one looping run and reports where in it we are:
 *
 *   { t, phase, impactT }
 *     t        0..1 eased travel progress along the curve
 *     phase    'waiting' before the run's stagger delay has elapsed,
 *              'travel' while the piece is moving,
 *              'impact' during the hold at the destination
 *     impactT  0..1 through the hold, for sizing the blast ring (0 outside it)
 *
 * Runs loop forever: the point of the loop is that a player can look away,
 * look back, and still see what happened rather than a frozen dot.
 */
export function cyclePhase({ elapsedMs, travelMs, holdMs, delayMs = 0 }) {
  const travel = Math.max(1, travelMs)
  const hold   = Math.max(0, holdMs)
  const period = travel + hold

  if (elapsedMs < delayMs) {
    return { t: 0, phase: 'waiting', impactT: 0 }
  }

  const into = (elapsedMs - delayMs) % period

  if (into < travel) {
    return { t: easeInOutQuad(into / travel), phase: 'travel', impactT: 0 }
  }
  return { t: 1, phase: 'impact', impactT: hold === 0 ? 1 : (into - travel) / hold }
}

/**
 * Launch slow, cross fast, arrive slow. A linear run reads like a screensaver;
 * this reads like something being fired.
 */
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
}

/**
 * trailDash(pathLength, headDistance, trailPx)
 * stroke-dasharray / stroke-dashoffset pair that lights up only the `trailPx`
 * of path immediately behind the head. One <path> renders the whole comet.
 */
export function trailDash(pathLength, headDistance, trailPx) {
  const tail = Math.min(trailPx, headDistance)
  const gap  = Math.max(pathLength, 1)
  return {
    dashArray:  `${Math.max(tail, 0.01)} ${gap}`,
    dashOffset: -(headDistance - tail),
  }
}

/**
 * staggerDelay(index)
 * Three missiles launching on the same frame look like one event. Fanning the
 * starts out makes each one legible on its own.
 */
export function staggerDelay(index) {
  return index * 380
}

/**
 * bezierLengthTo(p0, c, p1, t, samples)
 * Arc length from the start of the curve up to parameter t. The head glyph is
 * placed by bezierPoint(t) while the comet tail is drawn with a dash offset,
 * which is measured in arc length — so the two only line up if the offset is
 * derived from the real distance travelled rather than from t itself.
 */
export function bezierLengthTo(p0, c, p1, t, samples = 16) {
  if (t <= 0) return 0
  let total = 0
  let prev = p0
  for (let i = 1; i <= samples; i += 1) {
    const pt = bezierPoint(p0, c, p1, (i / samples) * t)
    total += Math.hypot(pt.x - prev.x, pt.y - prev.y)
    prev = pt
  }
  return total
}

/**
 * labelAnchor(p0, p1, offsetPx)
 * Where a route's plain-English label goes: off to the outside of the bow,
 * on the same side the control point was pushed, rather than sitting on the
 * straight line between the two places. Dropping it on the chord midpoint put
 * it on top of hotspot names on short runs.
 */
export function labelAnchor(p0, p1, offsetPx = 16) {
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const len = Math.hypot(dx, dy) || 1
  // Same perpendicular controlPoint() uses, so label and bow agree on "outside".
  const px = dy / len
  const py = -dx / len
  return {
    x: (p0.x + p1.x) / 2 + px * offsetPx,
    y: (p0.y + p1.y) / 2 + py * offsetPx,
  }
}
