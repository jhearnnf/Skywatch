import { describe, it, expect } from 'vitest'
import { aircraftPolygons, polygonPoints, HORIZON_Y } from '../orientationScene'

// The flat pictures are the answer key for the Real CBAT theme, so the
// geometry has to say what the instruments say: a right bank drops the right
// wing, nose up lifts the nose, and a heading turns the aircraft the way a
// compass reads. Pinned here rather than eyeballed.

const points = (attitude) => aircraftPolygons(attitude).flatMap(p => p.points)
const bounds = (pts) => ({
  minX: Math.min(...pts.map(p => p[0])), maxX: Math.max(...pts.map(p => p[0])),
  minY: Math.min(...pts.map(p => p[1])), maxY: Math.max(...pts.map(p => p[1])),
})
// The wing tips are the two points furthest from the centre line.
const wingTips = (attitude) => {
  const pts = points(attitude)
  const left = pts.reduce((a, b) => (b[0] < a[0] ? b : a))
  const right = pts.reduce((a, b) => (b[0] > a[0] ? b : a))
  return { left, right }
}

describe('aircraftPolygons', () => {
  it('draws something inside the frame for every attitude on the scales', () => {
    for (const heading of [0, 45, 90, 135, 180, 225, 270, 315]) {
      for (const pitch of [-20, 0, 20]) {
        for (const bank of [-60, -30, 0, 30, 60]) {
          const polys = aircraftPolygons({ heading, pitch, bank })
          expect(polys.length).toBeGreaterThan(5)
          const b = bounds(polys.flatMap(p => p.points))
          expect(b.minX).toBeGreaterThan(0)
          expect(b.maxX).toBeLessThan(100)
          expect(b.minY).toBeGreaterThan(0)
          expect(b.maxY).toBeLessThan(100)
          for (const p of polys) expect(p.fill).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
        }
      }
    }
  })

  it('is deterministic', () => {
    const a = JSON.stringify(aircraftPolygons({ heading: 45, pitch: 20, bank: -30 }))
    const b = JSON.stringify(aircraftPolygons({ heading: 45, pitch: 20, bank: -30 }))
    expect(a).toBe(b)
  })

  it('puts the horizon above the aircraft, inside the frame', () => {
    expect(HORIZON_Y).toBeGreaterThan(10)
    expect(HORIZON_Y).toBeLessThan(50)
  })

  it('drops the right wing for a right bank, seen from behind', () => {
    // Heading north is a tail view, so the aircraft's right wing is on the
    // viewer's right. SVG y grows downwards.
    const { left, right } = wingTips({ heading: 0, pitch: 0, bank: 30 })
    expect(right[1]).toBeGreaterThan(left[1])
    const level = wingTips({ heading: 0, pitch: 0, bank: 0 })
    expect(Math.abs(level.left[1] - level.right[1])).toBeLessThan(0.5)
  })

  it('shows the same right bank on the viewer\'s LEFT for an aircraft flying towards them', () => {
    // The trap the test sets: heading south is a nose view, so the right
    // wing is on the viewer's left, and a right bank drops the LEFT side of
    // the picture.
    const { left, right } = wingTips({ heading: 180, pitch: 0, bank: 30 })
    expect(left[1]).toBeGreaterThan(right[1])
  })

  it('mirrors a bank left-to-right', () => {
    const a = points({ heading: 0, pitch: 0, bank: 45 })
    const b = points({ heading: 0, pitch: 0, bank: -45 })
    const bx = bounds(a), bxm = bounds(b)
    expect(bx.minX).toBeCloseTo(100 - bxm.maxX, 0)
    expect(bx.maxX).toBeCloseTo(100 - bxm.minX, 0)
    expect(bx.minY).toBeCloseTo(bxm.minY, 0)
  })

  it('lifts the nose for a positive pitch on a side view', () => {
    // Heading east: nose on the right of the picture. The fin is taller than
    // the nose ever climbs, so the aircraft's overall top edge is no use
    // here; the nose end is what moves.
    // (The tail end's extreme point swaps between the fin tip and the tail
    // cone as the pitch changes, so only the nose is asserted on.)
    const nose = (pitch) => points({ heading: 90, pitch, bank: 0 }).reduce((a, b) => (b[0] > a[0] ? b : a))
    expect(nose(20)[1]).toBeLessThan(nose(0)[1])
    expect(nose(0)[1]).toBeLessThan(nose(-20)[1])
  })

  it('turns the nose the way the compass reads', () => {
    // East: the aircraft is longer than it is tall and its nose is on the
    // right; west is the mirror. North and south are foreshortened.
    const east = bounds(points({ heading: 90, pitch: 0, bank: 0 }))
    const north = bounds(points({ heading: 0, pitch: 0, bank: 0 }))
    expect(east.maxX - east.minX).toBeGreaterThan(north.maxY - north.minY)
    const eastPts = points({ heading: 90, pitch: 0, bank: 0 })
    const westPts = points({ heading: 270, pitch: 0, bank: 0 })
    expect(bounds(eastPts).minX).toBeCloseTo(100 - bounds(westPts).maxX, 0)
    // A nose-on view and a tail view are not the same picture.
    expect(JSON.stringify(aircraftPolygons({ heading: 0, pitch: 0, bank: 0 })))
      .not.toBe(JSON.stringify(aircraftPolygons({ heading: 180, pitch: 0, bank: 0 })))
  })
})

describe('aircraftPolygons in a landscape frame', () => {
  it('centres the aircraft on the wider frame and keeps the vertical scale', () => {
    const square = points({ heading: 90, pitch: 0, bank: 0 })
    const wide = aircraftPolygons({ heading: 90, pitch: 0, bank: 0 }, { width: 150 }).flatMap(p => p.points)
    const bs = bounds(square), bw = bounds(wide)
    expect(bw.minX).toBeCloseTo(bs.minX + 25, 5)
    expect(bw.maxX).toBeCloseTo(bs.maxX + 25, 5)
    expect(bw.minY).toBeCloseTo(bs.minY, 5)
    expect(bw.maxY).toBeCloseTo(bs.maxY, 5)
  })
})

describe('polygonPoints', () => {
  it('formats an SVG points attribute', () => {
    expect(polygonPoints([[1, 2], [3.456, 4]])).toBe('1.00,2.00 3.46,4.00')
  })
})
