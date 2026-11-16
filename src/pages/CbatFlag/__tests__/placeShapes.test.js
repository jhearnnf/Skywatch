import { describe, it, expect } from 'vitest'
import { placeShapes } from '../PlayField'

// The four target shapes must cover the whole field. Plain uniform sampling put
// all four on one side in about one run in five, so aircraft crossing the other
// side could never arm anything. Placement is now one shape per quadrant.

const PALETTE = [
  { kind: 'circle',   color: '#5baaff' },
  { kind: 'square',   color: '#22c55e' },
  { kind: 'triangle', color: '#facc15' },
]

// Desktop wide, desktop stacked, tablet, phone portrait, phone landscape.
const FIELDS = [[895, 480], [740, 380], [600, 360], [360, 300], [420, 220]]

describe('FLAG placeShapes', () => {
  it.each(FIELDS)('puts one shape in each quadrant of a %ix%i field', (w, h) => {
    for (let run = 0; run < 200; run++) {
      const shapes = placeShapes(w, h, PALETTE)
      expect(shapes).toHaveLength(4)
      const left  = shapes.filter(s => s.cx < w / 2).length
      const top   = shapes.filter(s => s.cy < h / 2).length
      // Never all on one half, in either direction.
      expect(left).toBe(2)
      expect(top).toBe(2)
    }
  })

  it.each(FIELDS)('keeps shapes apart and inside a %ix%i field', (w, h) => {
    for (let run = 0; run < 200; run++) {
      const shapes = placeShapes(w, h, PALETTE)
      for (const s of shapes) {
        const extent = s.radius * Math.SQRT2
        expect(s.cx - extent).toBeGreaterThan(0)
        expect(s.cx + extent).toBeLessThan(w)
        expect(s.cy - extent).toBeGreaterThan(0)
        expect(s.cy + extent).toBeLessThan(h)
      }
      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
          const a = shapes[i], b = shapes[j]
          expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThanOrEqual(2 * a.radius * Math.SQRT2 + 18 - 1e-9)
        }
      }
    }
  })
})
