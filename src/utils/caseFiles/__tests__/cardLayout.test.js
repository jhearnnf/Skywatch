import { describe, it, expect } from 'vitest'
import { computeCardPositions } from '../cardLayout.js'

const ITEM = (id, category = 'general') => ({ id, category, title: id })

describe('computeCardPositions', () => {
  it('returns empty positions for empty input', () => {
    const out = computeCardPositions([])
    expect(out.positions.size).toBe(0)
    expect(out.boardSize.width).toBeGreaterThan(0)
    expect(out.boardSize.height).toBeGreaterThan(0)
  })

  it('places one position per item', () => {
    const items = [ITEM('a'), ITEM('b'), ITEM('c')]
    const out = computeCardPositions(items)
    expect(out.positions.size).toBe(3)
    for (const item of items) {
      expect(out.positions.has(item.id)).toBe(true)
    }
  })

  it('keeps card top-left coords inside the board with full card visible', () => {
    const items = [ITEM('a'), ITEM('b'), ITEM('c'), ITEM('d', 'other')]
    const out = computeCardPositions(items)
    for (const [, pos] of out.positions) {
      expect(pos.x).toBeGreaterThanOrEqual(0)
      expect(pos.y).toBeGreaterThanOrEqual(0)
      expect(pos.x + out.cardSize.width).toBeLessThanOrEqual(out.boardSize.width)
      expect(pos.y + out.cardSize.height).toBeLessThanOrEqual(out.boardSize.height)
    }
  })

  it('is deterministic across runs (same items → same positions)', () => {
    const items = [ITEM('a', 'x'), ITEM('b', 'x'), ITEM('c', 'y')]
    const a = computeCardPositions(items)
    const b = computeCardPositions(items)
    for (const [id, pos] of a.positions) {
      expect(b.positions.get(id)).toEqual(pos)
    }
  })

  it('groups items in the same category closer than items across categories', () => {
    const items = [
      ITEM('a1', 'alpha'),
      ITEM('a2', 'alpha'),
      ITEM('b1', 'bravo'),
      ITEM('b2', 'bravo'),
    ]
    const { positions } = computeCardPositions(items, { jitter: 0 })
    const a1 = positions.get('a1')
    const a2 = positions.get('a2')
    const b1 = positions.get('b1')
    const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)
    // Same-cluster pair should be closer than cross-cluster pair
    expect(dist(a1, a2)).toBeLessThan(dist(a1, b1))
  })

  it('does not assign two items to the same position', () => {
    const items = Array.from({ length: 10 }, (_, i) => ITEM(`item-${i}`))
    const { positions } = computeCardPositions(items)
    const seen = new Set()
    for (const [, pos] of positions) {
      const key = `${Math.round(pos.x)},${Math.round(pos.y)}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})
