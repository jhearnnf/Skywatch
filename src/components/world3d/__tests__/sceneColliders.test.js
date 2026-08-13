import { describe, it, expect, beforeEach } from 'vitest'
import {
  HANGAR_INTERIOR,
  PROP_BOXES,
  PROP_CIRCLES,
  SPAWN,
  WALL_THICKNESS,
  hangarWallBoxes,
  modelBoxToWorldRect,
  modelCircleToWorldCircle,
  worldColliders,
} from '../data/sceneColliders'
import { _reset, registerCollider, resolveMove } from '../collision/colliders'

// The fit ImmerseModel derives from public/models/scene.glb: its horizontal
// bounds are x -20.000000..20.000004 and z -12.281997..11.774357, its floor mesh
// tops out at y=0, and the longest horizontal axis (40.000005) is normalised to
// TARGET_FOOTPRINT = 67. Restated here so the collider maths can be checked
// without loading a 1.5 MB binary in jsdom.
const SCALE = 67 / 40.000005
const FIT = {
  scale: SCALE,
  position: [-0.000002 * SCALE, 0, 0.25382 * SCALE],
}

// CharacterController's RADIUS.
const PLAYER_RADIUS = 0.45

beforeEach(() => _reset())

describe('generated scene shapes', () => {
  it('ships both boxes and circles', () => {
    expect(PROP_BOXES.length).toBeGreaterThan(0)
    // Round props (tyres, drums, cable reels) must not be silently boxed —
    // that was the whole point of teaching the collider registry about discs.
    expect(PROP_CIRCLES.length).toBeGreaterThan(0)
  })

  it('every box is a non-degenerate AABB', () => {
    for (const [i, b] of PROP_BOXES.entries()) {
      expect([i, b.maxX > b.minX]).toEqual([i, true])
      expect([i, b.maxZ > b.minZ]).toEqual([i, true])
    }
  })

  it('every circle has a positive radius', () => {
    for (const [i, c] of PROP_CIRCLES.entries()) {
      expect([i, c.r > 0]).toEqual([i, true])
      expect([i, Number.isFinite(c.x) && Number.isFinite(c.z)]).toEqual([i, true])
    }
  })

  // Props may sink into a wall — the lockers along the south wall are modelled
  // flush against it and overhang the interior face by a tenth of a unit — but
  // nothing may float outside the building.
  it('every prop stands inside the hangar shell', () => {
    const t = WALL_THICKNESS
    for (const [i, b] of PROP_BOXES.entries()) {
      const ok = b.minX >= HANGAR_INTERIOR.minX - t && b.maxX <= HANGAR_INTERIOR.maxX + t &&
                 b.minZ >= HANGAR_INTERIOR.minZ - t && b.maxZ <= HANGAR_INTERIOR.maxZ + t
      expect([`box${i}`, ok]).toEqual([`box${i}`, true])
    }
    for (const [i, c] of PROP_CIRCLES.entries()) {
      const ok = c.x - c.r >= HANGAR_INTERIOR.minX - t && c.x + c.r <= HANGAR_INTERIOR.maxX + t &&
                 c.z - c.r >= HANGAR_INTERIOR.minZ - t && c.z + c.r <= HANGAR_INTERIOR.maxZ + t
      expect([`circle${i}`, ok]).toEqual([`circle${i}`, true])
    }
  })

  // Shapes may touch — a disc fitted to a drum can clip the rectangle covering
  // the bench beside it — but a disc swallowed whole by a rectangle denies no
  // floor the rectangle does not already deny, and is pure per-frame cost. The
  // generator strips those; this catches a regression that stops it.
  it('no circle is entirely contained in a box', () => {
    for (const [i, c] of PROP_CIRCLES.entries()) {
      const swallowed = PROP_BOXES.some(b =>
        c.x - c.r >= b.minX && c.x + c.r <= b.maxX &&
        c.z - c.r >= b.minZ && c.z + c.r <= b.maxZ)
      expect([`circle${i}`, swallowed]).toEqual([`circle${i}`, false])
    }
  })

  it('the four shell walls seal the interior with no gap at the corners', () => {
    const walls = hangarWallBoxes()
    expect(walls).toHaveLength(4)
    const north = walls.find(w => w.id === 'shell-north')
    const west = walls.find(w => w.id === 'shell-west')
    // Each wall spans the full run of its face, corners included, so a player
    // pushed into a corner cannot squeeze between two walls.
    expect(north.minX).toBeLessThan(HANGAR_INTERIOR.minX)
    expect(north.maxX).toBeGreaterThan(HANGAR_INTERIOR.maxX)
    expect(west.minZ).toBeLessThan(HANGAR_INTERIOR.minZ)
    expect(west.maxZ).toBeGreaterThan(HANGAR_INTERIOR.maxZ)
    // and none of them eats into the playable floor
    expect(north.maxZ).toBeCloseTo(HANGAR_INTERIOR.minZ, 6)
    expect(west.maxX).toBeCloseTo(HANGAR_INTERIOR.minX, 6)
  })
})

describe('model -> world conversion', () => {
  it('converts a model box to a centre + half-extent world rect', () => {
    const rect = modelBoxToWorldRect({ minX: -2, maxX: 2, minZ: 0, maxZ: 10 }, FIT)
    expect(rect.halfX).toBeCloseTo(2 * SCALE, 6)
    expect(rect.halfZ).toBeCloseTo(5 * SCALE, 6)
    expect(rect.z).toBeCloseTo(5 * SCALE + FIT.position[2], 6)
  })

  it('keeps a circle circular — the fit is uniform', () => {
    const c = modelCircleToWorldCircle({ x: 2, z: -3, r: 0.5 }, FIT)
    expect(c.r).toBeCloseTo(0.5 * SCALE, 6)
    expect(c.x).toBeCloseTo(2 * SCALE + FIT.position[0], 6)
  })

  it('scales with the fit, so re-tuning TARGET_FOOTPRINT moves colliders too', () => {
    const box = { minX: 1, maxX: 3, minZ: 1, maxZ: 3 }
    const a = modelBoxToWorldRect(box, { scale: 1, position: [0, 0, 0] })
    const b = modelBoxToWorldRect(box, { scale: 2, position: [0, 0, 0] })
    expect(b.halfX).toBeCloseTo(a.halfX * 2, 6)
    expect(b.x).toBeCloseTo(a.x * 2, 6)
  })

  it('worldColliders returns every shape with a unique id', () => {
    const all = worldColliders(FIT)
    expect(all).toHaveLength(4 + PROP_BOXES.length + PROP_CIRCLES.length)
    expect(new Set(all.map(s => s.id)).size).toBe(all.length)
    expect(all.filter(s => s.r !== undefined)).toHaveLength(PROP_CIRCLES.length)
  })
})

describe('registered world colliders', () => {
  const register = () => {
    for (const s of worldColliders(FIT)) registerCollider(s.id, s)
  }

  it('the spawn point is on open floor, clear of every collider', () => {
    const pos = { x: SPAWN[0], z: SPAWN[2] }
    for (const s of worldColliders(FIT)) {
      if (s.r !== undefined) {
        // outside by more than the player's radius, so the controller does not
        // shove the player on the first frame
        expect([s.id, Math.hypot(pos.x - s.x, pos.z - s.z) > s.r + PLAYER_RADIUS])
          .toEqual([s.id, true])
      } else {
        const inside = pos.x > s.x - s.halfX - PLAYER_RADIUS && pos.x < s.x + s.halfX + PLAYER_RADIUS &&
                       pos.z > s.z - s.halfZ - PLAYER_RADIUS && pos.z < s.z + s.halfZ + PLAYER_RADIUS
        expect([s.id, inside]).toEqual([s.id, false])
      }
    }
  })

  it('keeps the player inside the hangar shell', () => {
    register()
    const eastFace = modelBoxToWorldRect(
      { minX: HANGAR_INTERIOR.maxX, maxX: HANGAR_INTERIOR.maxX, minZ: 0, maxZ: 0 }, FIT,
    ).x
    // Sprint east from mid-floor; must not pass the interior face.
    const out = resolveMove({ x: 0, z: -8 }, { x: 40, z: 0 }, PLAYER_RADIUS)
    expect(out.x).toBeLessThanOrEqual(eastFace - PLAYER_RADIUS + 1e-6)
  })

  it('stops the player at the aircraft rather than letting them walk through it', () => {
    register()
    // Drive north across the middle of the hangar, straight at the airframe.
    const out = resolveMove({ x: -4, z: 14 }, { x: 0, z: -12 }, PLAYER_RADIUS)
    expect(out.z).toBeGreaterThan(2)
  })
})
