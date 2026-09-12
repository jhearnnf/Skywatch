// Dynamic Projection Test flight model.
//
// Everything that decides where an aircraft is next frame lives here, shared by
// the live game loop in pages/CbatDpt.jsx and its practice mode. The practice
// drills exist to teach the feel of a turn — how far the aircraft drifts while
// it comes round, how long 180 degrees takes — so they have to fly the same
// aircraft a run does. One flight model, imported by both, is what keeps them
// the same.
//
// Nothing here scores, spawns or reads React state. `moveAircraft` is a pure
// function of (aircraft, dt).

// Arena uses an internal SVG viewBox of 1000×1000. Aircraft, gates and danger
// zones position themselves in this coordinate space, then scale to whatever
// pixel size the panel renders at.
export const SCOPE_SIZE = 1000
export const SCOPE_HALF = SCOPE_SIZE / 2          // 500 — centre of the scope
export const ARENA_HALF = 480                     // half-size of playable square

export const AIRCRAFT_SPEED = 18    // scope units per second (cross-arena ≈ 53s)
export const TURN_RATE      = 35    // degrees per second
export const ALT_RATE       = 500   // ft per second climb/descent
export const ALT_MIN        = 1000  // ft — lowest commandable altitude
export const ALT_MAX        = 10000 // ft — highest commandable altitude
export const EDGE_BUFFER    = 90    // scope units inside boundary that triggers auto-turn

export function normalizeDeg(d) {
  let x = d % 360
  if (x < 0) x += 360
  return x
}

// Compass bearing → unit vector (SVG y is inverted, so north = (0, -1))
export function bearingToVec(bearing) {
  const rad = (bearing * Math.PI) / 180
  return { dx: Math.sin(rad), dy: -Math.cos(rad) }
}

// Distance the heading must travel to reach `target` going `direction`.
// Result is in [0, 360).
export function turnDistance(heading, target, direction) {
  if (direction === 'L') return normalizeDeg(heading - target)
  return normalizeDeg(target - heading)
}

// Which of L / R reaches `target` from `heading` with less turning. A dead
// 180 is a tie and reads as 'either'.
export function shortestTurnDirection(heading, target) {
  const right = turnDistance(heading, target, 'R')
  const left  = turnDistance(heading, target, 'L')
  if (right === left) return 'either'
  return right < left ? 'R' : 'L'
}

// Compass bearing from (x, y) toward arena centre.
export function bearingToCenter(x, y) {
  const dx = SCOPE_HALF - x
  const dy = SCOPE_HALF - y
  return normalizeDeg((Math.atan2(dx, -dy) * 180) / Math.PI)
}

// Compass bearing from one point to another.
export function bearingBetween(from, to) {
  return normalizeDeg((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI)
}

// Segment-segment intersection test using cross-product orientation.
function cross(ax, ay, bx, by) { return ax * by - ay * bx }
export function segmentsIntersect(p1, p2, q1, q2) {
  const d1 = cross(q2.x - q1.x, q2.y - q1.y, p1.x - q1.x, p1.y - q1.y)
  const d2 = cross(q2.x - q1.x, q2.y - q1.y, p2.x - q1.x, p2.y - q1.y)
  const d3 = cross(p2.x - p1.x, p2.y - p1.y, q1.x - p1.x, q1.y - p1.y)
  const d4 = cross(p2.x - p1.x, p2.y - p1.y, q2.x - p1.x, q2.y - p1.y)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

// One frame of flight for one aircraft. Returns the moved aircraft and, when
// the boundary took over the heading this frame, the command it issued (the
// caller draws that as the yellow auto-turn line).
//
//   1. Edge auto-turn fires ONCE on entry into the buffer rather than every
//      frame, so a bearing the player issues while the yellow pulse is still
//      showing sticks instead of being blown away next frame. It re-fires only
//      after the aircraft has left the buffer and come back in.
//   2. The heading rotates toward its target at TURN_RATE, in the commanded
//      direction, and snaps on when the remainder is under one step.
//   3. Altitude interpolates toward its target at ALT_RATE.
//   4. The aircraft advances along its heading at AIRCRAFT_SPEED, clamped to
//      the arena.
export function moveAircraft(a, dt) {
  let { headingDeg, targetHeadingDeg, turnDirection, position, altitudeFt, targetAltitudeFt, wasInEdgeBuffer } = a
  let edgeAuto = null

  const dxFromEdge = ARENA_HALF - Math.abs(position.x - SCOPE_HALF)
  const dyFromEdge = ARENA_HALF - Math.abs(position.y - SCOPE_HALF)
  const inBuffer = dxFromEdge < EDGE_BUFFER || dyFromEdge < EDGE_BUFFER
  if (inBuffer && !wasInEdgeBuffer) {
    const t = bearingToCenter(position.x, position.y)
    targetHeadingDeg = t
    turnDirection    = normalizeDeg(t - headingDeg) <= 180 ? 'R' : 'L'
    edgeAuto = {
      fromHeading:   headingDeg,
      targetBearing: t,
      direction:     turnDirection,
      capturedPos:   { x: position.x, y: position.y },
    }
  }
  wasInEdgeBuffer = inBuffer

  if (targetHeadingDeg != null) {
    const angleStep = TURN_RATE * dt
    const remaining = turnDistance(headingDeg, targetHeadingDeg, turnDirection)
    if (remaining <= angleStep) {
      headingDeg       = targetHeadingDeg
      targetHeadingDeg = null
      turnDirection    = null
    } else if (turnDirection === 'L') {
      headingDeg = normalizeDeg(headingDeg - angleStep)
    } else {
      headingDeg = normalizeDeg(headingDeg + angleStep)
    }
  }

  if (targetAltitudeFt != null) {
    const altStep = ALT_RATE * dt
    const altDiff = targetAltitudeFt - altitudeFt
    if (Math.abs(altDiff) <= altStep) {
      altitudeFt       = targetAltitudeFt
      targetAltitudeFt = null
    } else {
      altitudeFt += Math.sign(altDiff) * altStep
    }
  }

  const rad = (headingDeg * Math.PI) / 180
  let nx = position.x + Math.sin(rad) * AIRCRAFT_SPEED * dt
  let ny = position.y - Math.cos(rad) * AIRCRAFT_SPEED * dt
  nx = Math.max(SCOPE_HALF - ARENA_HALF, Math.min(SCOPE_HALF + ARENA_HALF, nx))
  ny = Math.max(SCOPE_HALF - ARENA_HALF, Math.min(SCOPE_HALF + ARENA_HALF, ny))

  return {
    aircraft: { ...a, headingDeg, targetHeadingDeg, turnDirection, position: { x: nx, y: ny }, altitudeFt, targetAltitudeFt, wasInEdgeBuffer },
    edgeAuto,
  }
}
