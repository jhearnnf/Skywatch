import { describe, it, expect } from 'vitest'
import { HANGARS } from '../data/hangarLayout'
import { CBAT_GAMES } from '../../../data/cbatGames'

describe('hangar layout integrity', () => {
  it('declares all four hangars by kind', () => {
    const kinds = HANGARS.map(h => h.kind).sort()
    expect(kinds).toEqual(['aircraft', 'cbat', 'interrogation', 'kanban'])
  })

  it('every hangar has wall colliders + a door trigger', () => {
    for (const h of HANGARS) {
      expect(h.walls.length).toBeGreaterThanOrEqual(5)
      expect(h.doorTrigger).toBeDefined()
      expect(h.doorCenter).toHaveLength(3)
    }
  })

  it('every wall collider is a valid AABB', () => {
    for (const h of HANGARS) {
      for (const w of h.walls) {
        expect(Number.isFinite(w.x)).toBe(true)
        expect(Number.isFinite(w.z)).toBe(true)
        expect(w.halfX).toBeGreaterThan(0)
        expect(w.halfZ).toBeGreaterThan(0)
      }
    }
  })

  it('door centre lies on the face matching the hangar facing', () => {
    for (const h of HANGARS) {
      const [cx, , cz] = h.center
      const [dx, , dz] = h.doorCenter
      const [W, , D] = h.size
      if (h.facing === 'north') expect(dz).toBeCloseTo(cz - D / 2)
      if (h.facing === 'south') expect(dz).toBeCloseTo(cz + D / 2)
      if (h.facing === 'east')  expect(dx).toBeCloseTo(cx + W / 2)
      if (h.facing === 'west')  expect(dx).toBeCloseTo(cx - W / 2)
    }
  })

  it('CBAT arcade has enough cabinet slots for every CBAT_GAMES entry', () => {
    // Soft contract — if CBAT_GAMES grows past 13, the world drops the tail.
    // Failure here means the slot grid in CbatArcadeHangar needs new rows.
    expect(CBAT_GAMES.length).toBeLessThanOrEqual(13)
  })
})
