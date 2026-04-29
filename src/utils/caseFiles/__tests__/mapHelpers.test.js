import { describe, it, expect } from 'vitest'
import { boundsCentre, lookupHotspot, arrowheadPolyline } from '../mapHelpers'

// ── boundsCentre ──────────────────────────────────────────────────────────────

describe('boundsCentre', () => {
  it('returns the geographic midpoint of a bounding box', () => {
    const result = boundsCentre({ south: 10, west: 20, north: 30, east: 60 })
    expect(result).toEqual([20, 40])
  })

  it('handles negative coordinates (e.g. western hemisphere)', () => {
    const result = boundsCentre({ south: -10, west: -30, north: 10, east: -10 })
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBeCloseTo(-20)
  })

  it('handles a zero-area box (point)', () => {
    const result = boundsCentre({ south: 51.5, west: -0.12, north: 51.5, east: -0.12 })
    expect(result).toEqual([51.5, -0.12])
  })

  it('returns [lat, lng] array (lat first)', () => {
    const result = boundsCentre({ south: 24, west: 44, north: 40, east: 56 })
    expect(result[0]).toBe(32)   // lat (north+south)/2
    expect(result[1]).toBe(50)   // lng (west+east)/2
  })
})

// ── lookupHotspot ─────────────────────────────────────────────────────────────

const HOTSPOTS = [
  { id: 'bel', label: 'Belgorod', lat: 50.6, lng: 36.6, kind: 'staging' },
  { id: 'kyv', label: 'Kyiv',     lat: 50.4, lng: 30.5, kind: 'capital' },
  { id: 'kha', label: 'Kharkiv',  lat: 49.9, lng: 36.2, kind: 'logistics' },
]

describe('lookupHotspot', () => {
  it('returns the matching hotspot by id', () => {
    const result = lookupHotspot(HOTSPOTS, 'bel')
    expect(result).toBeDefined()
    expect(result.label).toBe('Belgorod')
  })

  it('returns undefined for an unknown id', () => {
    expect(lookupHotspot(HOTSPOTS, 'xyz')).toBeUndefined()
  })

  it('returns undefined for null id', () => {
    expect(lookupHotspot(HOTSPOTS, null)).toBeUndefined()
  })

  it('returns undefined for an empty hotspots array', () => {
    expect(lookupHotspot([], 'bel')).toBeUndefined()
  })

  it('returns undefined when hotspots is not an array', () => {
    expect(lookupHotspot(null, 'bel')).toBeUndefined()
    expect(lookupHotspot(undefined, 'bel')).toBeUndefined()
  })

  it('finds the last matching hotspot when ids are unique', () => {
    const result = lookupHotspot(HOTSPOTS, 'kha')
    expect(result.lat).toBe(49.9)
  })
})

// ── arrowheadPolyline ─────────────────────────────────────────────────────────

describe('arrowheadPolyline', () => {
  it('returns exactly three [lat, lng] pairs', () => {
    const pts = arrowheadPolyline([50.6, 36.6], [50.4, 30.5])
    expect(pts).toHaveLength(3)
    pts.forEach(pt => {
      expect(pt).toHaveLength(2)
      expect(typeof pt[0]).toBe('number')
      expect(typeof pt[1]).toBe('number')
    })
  })

  it('tip (middle point) matches toLatLng', () => {
    const to  = [50.4, 30.5]
    const pts = arrowheadPolyline([50.6, 36.6], to)
    // Middle point is the tip
    expect(pts[1][0]).toBeCloseTo(to[0], 5)
    expect(pts[1][1]).toBeCloseTo(to[1], 5)
  })

  it('left and right wing points are not equal', () => {
    const pts = arrowheadPolyline([50.6, 36.6], [50.4, 30.5])
    const leftLat  = pts[0][0]
    const rightLat = pts[2][0]
    // The two wing points should differ (perpendicular spread)
    expect(Math.abs(leftLat - rightLat)).toBeGreaterThan(0)
  })

  it('respects a custom sizeMeters', () => {
    const ptsSmall = arrowheadPolyline([50.6, 36.6], [50.4, 30.5], 5000)
    const ptsLarge = arrowheadPolyline([50.6, 36.6], [50.4, 30.5], 100000)
    // Larger size → wings further from tip
    function wingDist(pts) {
      const [lLat, lLng] = pts[0]
      const [tLat, tLng] = pts[1]
      return Math.sqrt((lLat - tLat) ** 2 + (lLng - tLng) ** 2)
    }
    expect(wingDist(ptsLarge)).toBeGreaterThan(wingDist(ptsSmall))
  })
})
