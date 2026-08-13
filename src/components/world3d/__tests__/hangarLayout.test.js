import { describe, it, expect } from 'vitest'
import { HANGARS } from '../data/hangarLayout'
import { CBAT_GAMES } from '../../../data/cbatGames'
import { SLOTS, cabinetFootprint } from '../data/cbatArcadeSlots'

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

  // The arcade must have a cabinet slot for every *visible* CBAT game, so no
  // launched game is left without a cabinet. Hidden games never get one.
  it('CBAT arcade has a cabinet slot for every visible CBAT game', () => {
    const visible = CBAT_GAMES.filter(g => !g.hidden)
    expect(SLOTS.length).toBeGreaterThanOrEqual(visible.length)
  })

  // The rows were packed tighter to fit the five games that completed the CBAT
  // roster, so the gaps are no longer obvious by eye. Two cabinets sharing floor
  // space is not subtle in the world, but it is invisible from the source.
  it('no two arcade cabinets overlap on the floor', () => {
    for (let i = 0; i < SLOTS.length; i++) {
      for (let j = i + 1; j < SLOTS.length; j++) {
        const a = cabinetFootprint(SLOTS[i])
        const b = cabinetFootprint(SLOTS[j])
        const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ
        expect([i, j, overlaps]).toEqual([i, j, false])
      }
    }
  })

  it('every arcade cabinet stands inside the hangar and clear of the doorway', () => {
    // The CBAT hangar is 16 × 14, so local x ∈ [-8, 8] and z ∈ [-7, 7], with the
    // door gap spanning x ∈ [-2, 2] on the -Z face. A cabinet in the doorway
    // would block the only way in.
    for (const [i, slot] of SLOTS.entries()) {
      const f = cabinetFootprint(slot)
      expect([i, f.minX >= -8 && f.maxX <= 8]).toEqual([i, true])
      expect([i, f.minZ >= -7 && f.maxZ <= 7]).toEqual([i, true])
      const inDoorway = f.minZ < -5.5 && f.minX < 2 && f.maxX > -2
      expect([i, inDoorway]).toEqual([i, false])
    }
  })
})
