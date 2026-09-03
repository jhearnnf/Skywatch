import { describe, it, expect } from 'vitest'
import {
  kindStyle,
  sideColor,
  controlPoint,
  bezierPoint,
  bezierHeading,
  bezierLength,
  bezierLengthTo,
  bezierPath,
  cyclePhase,
  easeInOutQuad,
  trailDash,
  staggerDelay,
  labelAnchor,
  UNIT_KIND_STYLE,
} from '../motionGeometry'

const P0 = { x: 0,   y: 0 }
const P1 = { x: 100, y: 0 }

describe('kindStyle', () => {
  it('returns the styling for a known unit kind', () => {
    expect(kindStyle('missile')).toBe(UNIT_KIND_STYLE.missile)
    expect(kindStyle('missile').label).toBe('Missile strike')
  })

  it('falls back for an unknown kind rather than returning undefined', () => {
    const style = kindStyle('trebuchet')
    expect(style.label).toBe('Movement')
    expect(typeof style.travelMs).toBe('number')
  })
})

describe('sideColor', () => {
  it('gives the two named sides distinct colours', () => {
    expect(sideColor('ru')).not.toBe(sideColor('ua'))
  })

  it('accepts the friendly/hostile spellings as well as ru/ua', () => {
    expect(sideColor('hostile')).toBe(sideColor('ru'))
    expect(sideColor('friendly')).toBe(sideColor('ua'))
  })

  it('falls back to slate for an unknown side', () => {
    expect(sideColor('martian')).toBe('#94a3b8')
  })
})

describe('controlPoint', () => {
  it('sits on the midpoint when the bend is zero', () => {
    expect(controlPoint(P0, P1, 0)).toEqual({ x: 50, y: 0 })
  })

  it('pushes off the midpoint perpendicular to the run', () => {
    const c = controlPoint(P0, P1, 0.25)
    expect(c.x).toBeCloseTo(50)
    // 100px apart, bend 0.25 → 25px off the line. Perpendicular, so all in y.
    expect(Math.abs(c.y)).toBeCloseTo(25)
  })

  it('does not divide by zero when both ends are the same point', () => {
    const c = controlPoint(P0, P0, 0.3)
    expect(Number.isFinite(c.x)).toBe(true)
    expect(Number.isFinite(c.y)).toBe(true)
  })
})

describe('bezierPoint', () => {
  const C = { x: 50, y: -50 }

  it('starts at p0 and ends at p1', () => {
    expect(bezierPoint(P0, C, P1, 0)).toEqual(P0)
    expect(bezierPoint(P0, C, P1, 1)).toEqual(P1)
  })

  it('bends towards the control point in between', () => {
    const mid = bezierPoint(P0, C, P1, 0.5)
    expect(mid.x).toBeCloseTo(50)
    expect(mid.y).toBeCloseTo(-25)
  })
})

describe('bezierHeading', () => {
  it('reads zero degrees for a straight run to the right', () => {
    const c = controlPoint(P0, P1, 0)
    expect(bezierHeading(P0, c, P1, 0.5)).toBeCloseTo(0)
  })

  it('points back the other way for a run to the left', () => {
    const back = { x: -100, y: 0 }
    const c = controlPoint(P0, back, 0)
    expect(Math.abs(bezierHeading(P0, c, back, 0.5))).toBeCloseTo(180)
  })
})

describe('bezierLength / bezierLengthTo', () => {
  it('measures a straight run as the distance between its ends', () => {
    const c = controlPoint(P0, P1, 0)
    expect(bezierLength(P0, c, P1)).toBeCloseTo(100, 1)
  })

  it('measures an arc as longer than the straight line', () => {
    const c = controlPoint(P0, P1, 0.3)
    expect(bezierLength(P0, c, P1)).toBeGreaterThan(100)
  })

  it('grows monotonically with t and reaches the full length at t=1', () => {
    const c = controlPoint(P0, P1, 0.25)
    const full = bezierLength(P0, c, P1)
    expect(bezierLengthTo(P0, c, P1, 0)).toBe(0)
    expect(bezierLengthTo(P0, c, P1, 0.5)).toBeLessThan(bezierLengthTo(P0, c, P1, 0.9))
    expect(bezierLengthTo(P0, c, P1, 1)).toBeCloseTo(full, 4)
  })
})

describe('bezierPath', () => {
  it('emits a quadratic SVG path through the control point', () => {
    expect(bezierPath(P0, { x: 50, y: -20 }, P1)).toBe('M 0 0 Q 50 -20 100 0')
  })
})

describe('easeInOutQuad', () => {
  it('is pinned at both ends and symmetric about the middle', () => {
    expect(easeInOutQuad(0)).toBe(0)
    expect(easeInOutQuad(1)).toBe(1)
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5)
  })

  it('accelerates out of the launch', () => {
    // Slower than linear early on is what makes a launch read as a launch.
    expect(easeInOutQuad(0.25)).toBeLessThan(0.25)
  })
})

describe('cyclePhase', () => {
  const RUN = { travelMs: 1000, holdMs: 500, delayMs: 200 }

  it('waits out the stagger delay before starting', () => {
    const { phase, t } = cyclePhase({ elapsedMs: 100, ...RUN })
    expect(phase).toBe('waiting')
    expect(t).toBe(0)
  })

  it('travels during the travel window', () => {
    const { phase, t } = cyclePhase({ elapsedMs: 700, ...RUN })
    expect(phase).toBe('travel')
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThan(1)
  })

  it('holds at the destination after arriving', () => {
    const { phase, t, impactT } = cyclePhase({ elapsedMs: 1450, ...RUN })
    expect(phase).toBe('impact')
    expect(t).toBe(1)
    expect(impactT).toBeGreaterThan(0)
    expect(impactT).toBeLessThan(1)
  })

  it('loops: one full period later it is travelling again', () => {
    const first  = cyclePhase({ elapsedMs: 700,        ...RUN })
    const second = cyclePhase({ elapsedMs: 700 + 1500, ...RUN })
    expect(second.phase).toBe('travel')
    expect(second.t).toBeCloseTo(first.t)
  })

  it('survives a zero hold without dividing by zero', () => {
    const { impactT } = cyclePhase({ elapsedMs: 1200, travelMs: 1000, holdMs: 0, delayMs: 0 })
    expect(Number.isFinite(impactT)).toBe(true)
  })
})

describe('trailDash', () => {
  it('keeps the tail short at the start of the run', () => {
    // Only 10px travelled, so the comet cannot be 80px long yet.
    const { dashArray } = trailDash(200, 10, 80)
    expect(dashArray.startsWith('10 ')).toBe(true)
  })

  it('caps the tail at the configured trail length once past it', () => {
    const { dashArray, dashOffset } = trailDash(200, 150, 80)
    expect(dashArray.startsWith('80 ')).toBe(true)
    // The lit stretch ends at the head: 150 travelled, 80 of tail behind it.
    expect(dashOffset).toBe(-70)
  })

  it('never emits a zero-width dash, which some renderers drop entirely', () => {
    const { dashArray } = trailDash(200, 0, 80)
    expect(dashArray.startsWith('0 ')).toBe(false)
  })
})

describe('staggerDelay', () => {
  it('fans consecutive units out so they do not launch on one frame', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(2)).toBeGreaterThan(staggerDelay(1))
  })
})

describe('labelAnchor', () => {
  it('sits off the line between the two places, not on it', () => {
    const anchor = labelAnchor(P0, P1, 16)
    expect(anchor.x).toBeCloseTo(50)
    expect(Math.abs(anchor.y)).toBeCloseTo(16)
  })

  it('leans the same way the arc bows, so the two never cross', () => {
    const bowed = controlPoint(P0, P1, 0.3)
    const anchor = labelAnchor(P0, P1, 16)
    expect(Math.sign(anchor.y)).toBe(Math.sign(bowed.y))
  })

  it('does not blow up when both ends are the same point', () => {
    const anchor = labelAnchor(P0, P0)
    expect(Number.isFinite(anchor.x)).toBe(true)
    expect(Number.isFinite(anchor.y)).toBe(true)
  })
})
