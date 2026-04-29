import { describe, it, expect } from 'vitest'
import { bezierPath, midpoint, arePointsEqual } from '../connectionGeometry.js'

describe('bezierPath', () => {
  it('returns a string that starts with M and contains C', () => {
    const d = bezierPath({ x: 0, y: 0 }, { x: 100, y: 50 })
    expect(typeof d).toBe('string')
    expect(d).toMatch(/^M\s/)
    expect(d).toContain('C')
  })

  it('contains the from-point coordinates', () => {
    const d = bezierPath({ x: 10, y: 20 }, { x: 200, y: 150 })
    expect(d).toContain('10')
    expect(d).toContain('20')
  })

  it('contains the to-point coordinates', () => {
    const d = bezierPath({ x: 0, y: 0 }, { x: 300, y: 200 })
    expect(d).toContain('300')
    expect(d).toContain('200')
  })

  it('returns a valid SVG path format M ... C ...', () => {
    const d = bezierPath({ x: 50, y: 50 }, { x: 250, y: 150 })
    // Should match SVG cubic bezier: M x y C cx1 cy1, cx2 cy2, x y
    expect(d).toMatch(/M\s[\d.]+\s[\d.]+\s*C\s[\d.\s,-]+/)
  })

  it('handles identical from/to points without throwing', () => {
    expect(() => bezierPath({ x: 0, y: 0 }, { x: 0, y: 0 })).not.toThrow()
  })

  it('handles near-vertical connections', () => {
    const d = bezierPath({ x: 100, y: 0 }, { x: 101, y: 300 })
    expect(typeof d).toBe('string')
    expect(d.length).toBeGreaterThan(10)
  })

  it('handles near-horizontal connections', () => {
    const d = bezierPath({ x: 0, y: 100 }, { x: 400, y: 101 })
    expect(typeof d).toBe('string')
    expect(d.length).toBeGreaterThan(10)
  })
})

describe('midpoint', () => {
  it('returns midpoint between two points', () => {
    const m = midpoint({ x: 0, y: 0 }, { x: 100, y: 200 })
    expect(m).toEqual({ x: 50, y: 100 })
  })

  it('returns midpoint for non-origin start', () => {
    const m = midpoint({ x: 20, y: 40 }, { x: 60, y: 80 })
    expect(m).toEqual({ x: 40, y: 60 })
  })

  it('handles negative coordinates', () => {
    const m = midpoint({ x: -100, y: -50 }, { x: 100, y: 50 })
    expect(m).toEqual({ x: 0, y: 0 })
  })
})

describe('arePointsEqual', () => {
  it('returns true for identical points', () => {
    expect(arePointsEqual({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(true)
  })

  it('returns true when within default epsilon of 0.5', () => {
    expect(arePointsEqual({ x: 10, y: 20 }, { x: 10.4, y: 20.4 })).toBe(true)
  })

  it('returns false when outside default epsilon', () => {
    expect(arePointsEqual({ x: 10, y: 20 }, { x: 11, y: 20 })).toBe(false)
  })

  it('returns true with custom larger epsilon', () => {
    expect(arePointsEqual({ x: 0, y: 0 }, { x: 5, y: 5 }, 6)).toBe(true)
  })

  it('returns false with custom tighter epsilon', () => {
    expect(arePointsEqual({ x: 0, y: 0 }, { x: 0.1, y: 0 }, 0.05)).toBe(false)
  })
})
