import { describe, it, expect } from 'vitest'
import {
  moveAircraft, turnDistance, shortestTurnDirection, normalizeDeg, bearingBetween,
  SCOPE_HALF, ARENA_HALF, EDGE_BUFFER, TURN_RATE, AIRCRAFT_SPEED,
} from '../dptPhysics'

// The flight model is shared by the live DPT loop and the practice drills, so
// the drills fly the aircraft a run does. These pin the behaviour the drills
// are written against: which way "L" goes, how a turn completes, and what the
// boundary does.

const plane = (over = {}) => ({
  id: 'CA-A', kind: 'CA-A',
  position: { x: SCOPE_HALF, y: SCOPE_HALF },
  headingDeg: 360, targetHeadingDeg: null, turnDirection: null,
  altitudeFt: 5000, targetAltitudeFt: null, wasInEdgeBuffer: false,
  ...over,
})

const settle = (a, maxSteps = 600) => {
  for (let i = 0; i < maxSteps && a.targetHeadingDeg != null; i++) a = moveAircraft(a, 1 / 30).aircraft
  return a
}

describe('turn geometry', () => {
  it('measures a turn in the commanded direction', () => {
    expect(turnDistance(360, 90, 'R')).toBe(90)
    expect(turnDistance(360, 90, 'L')).toBe(270)
    expect(turnDistance(330, 30, 'R')).toBe(60)
    expect(turnDistance(330, 30, 'L')).toBe(300)
  })

  it('names the shorter side, and calls a dead 180 either', () => {
    expect(shortestTurnDirection(360, 315)).toBe('L')
    expect(shortestTurnDirection(330, 30)).toBe('R')
    expect(shortestTurnDirection(90, 270)).toBe('either')
  })

  it('folds 360 onto 0', () => {
    expect(normalizeDeg(360)).toBe(0)
    expect(normalizeDeg(-90)).toBe(270)
  })

  it('reads a bearing between two points on the compass, north up', () => {
    expect(bearingBetween({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(0)
    expect(bearingBetween({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90)
    expect(bearingBetween({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(180)
  })
})

describe('moveAircraft', () => {
  it('turns at TURN_RATE in the commanded direction and snaps onto the target', () => {
    let a = plane({ targetHeadingDeg: 90, turnDirection: 'R' })
    a = moveAircraft(a, 1).aircraft
    expect(a.headingDeg).toBe(normalizeDeg(360 + TURN_RATE))
    a = settle(a)
    expect(a.headingDeg).toBe(90)
    expect(a.targetHeadingDeg).toBeNull()
    expect(a.turnDirection).toBeNull()
  })

  it('goes the long way round when told to', () => {
    const left  = settle(plane({ targetHeadingDeg: 90, turnDirection: 'L' }), 200)
    const right = settle(plane({ targetHeadingDeg: 90, turnDirection: 'R' }), 200)
    expect(right.headingDeg).toBe(90)
    // 270° at 35°/s is ~7.7s: 200 frames at 1/30s (6.7s) is not enough.
    expect(left.targetHeadingDeg).toBe(90)
    expect(settle(left).headingDeg).toBe(90)
  })

  it('flies north when heading 360, at AIRCRAFT_SPEED', () => {
    const a = moveAircraft(plane(), 1).aircraft
    expect(a.position.x).toBeCloseTo(SCOPE_HALF, 5)
    expect(a.position.y).toBeCloseTo(SCOPE_HALF - AIRCRAFT_SPEED, 5)
  })

  it('drifts sideways by about a turn radius while coming round', () => {
    // This is why the practice gates are placed from where the aircraft
    // settles after its turn, not from where it starts.
    const a = settle(plane({ targetHeadingDeg: 90, turnDirection: 'R' }))
    const radius = AIRCRAFT_SPEED / (TURN_RATE * Math.PI / 180)
    // Within a unit or two: the heading snaps onto the target at the end of
    // a 1/30s step, so the arc is not quite a perfect quarter circle.
    expect(Math.abs((a.position.x - SCOPE_HALF) - radius)).toBeLessThan(2)
    expect(Math.abs((SCOPE_HALF - a.position.y) - radius)).toBeLessThan(2)
  })

  it('hands the heading to the boundary once on entering the buffer, and reports it', () => {
    const edgeY = SCOPE_HALF - ARENA_HALF + EDGE_BUFFER
    let a = plane({ position: { x: SCOPE_HALF, y: edgeY - 1 } })
    let r = moveAircraft(a, 1 / 30)
    expect(r.edgeAuto).not.toBeNull()
    expect(r.aircraft.targetHeadingDeg).toBe(180)
    expect(r.aircraft.wasInEdgeBuffer).toBe(true)
    // Still inside: no second command, so a player's bearing can override it.
    r = moveAircraft(r.aircraft, 1 / 30)
    expect(r.edgeAuto).toBeNull()
  })

  it('climbs and descends toward the target altitude and clamps to the arena', () => {
    let a = plane({ targetAltitudeFt: 6000 })
    a = moveAircraft(a, 1).aircraft
    expect(a.altitudeFt).toBe(5500)
    a = moveAircraft(a, 1).aircraft
    expect(a.altitudeFt).toBe(6000)
    expect(a.targetAltitudeFt).toBeNull()

    const pinned = moveAircraft(plane({ position: { x: SCOPE_HALF, y: SCOPE_HALF - ARENA_HALF } }), 1).aircraft
    expect(pinned.position.y).toBe(SCOPE_HALF - ARENA_HALF)
  })
})
