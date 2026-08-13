import { describe, it, expect } from 'vitest'
import {
  CELL, CAMERA, CLIP_ASPECT, FIELD_HALF, LAKE,
  cellToWorld, headingSpin, headingVector, fitsInFrame, terrainHeight,
} from '../sitClipGeometry'
import { GRID } from '../sitGenerator'

// The clip is the one part of this test the player cannot re-read, so a scene
// laid out wrong is not recoverable mid-run. Both of these fail silently in the
// renderer — a mirrored scene still looks like a scene — hence the coverage.

describe('cellToWorld', () => {
  it('centres the board on the origin', () => {
    const corners = [
      cellToWorld(0, 0, GRID),
      cellToWorld(GRID - 1, GRID - 1, GRID),
    ]
    expect(corners[0].x).toBeCloseTo(-corners[1].x)
    expect(corners[0].z).toBeCloseTo(-corners[1].z)
  })

  it('keeps every cell inside the ground plane the scene draws', () => {
    // Ground is drawn as GRID * CELL square, centred. An object outside it would
    // appear to float off the edge of the world.
    const half = (GRID * CELL) / 2
    for (let col = 0; col < GRID; col++) {
      for (let row = 0; row < GRID; row++) {
        const { x, z } = cellToWorld(col, row, GRID)
        expect(Math.abs(x)).toBeLessThan(half)
        expect(Math.abs(z)).toBeLessThan(half)
      }
    }
  })

  it('puts north at −Z, matching the plan view the layers are drawn in', () => {
    // Row 0 is the top of the plan and the plan is north-up, so row 0 must be
    // the more negative Z. If this flipped, the clip would be a mirror of the
    // layers and every position question would be wrong in the same direction.
    expect(cellToWorld(0, 0, GRID).z).toBeLessThan(cellToWorld(0, GRID - 1, GRID).z)
  })

  it('steps one cell width at a time', () => {
    expect(cellToWorld(1, 0, GRID).x - cellToWorld(0, 0, GRID).x).toBeCloseTo(CELL)
    expect(cellToWorld(0, 1, GRID).z - cellToWorld(0, 0, GRID).z).toBeCloseTo(CELL)
  })
})

describe('the camera', () => {
  it('keeps the whole board in frame', () => {
    // The failure this exists to stop: the first cut of the scene sat too close
    // and cut the far corners of the ground off the picture, so an object in a
    // corner cell was never shown at all. That is not a hard question, it is an
    // unanswerable one, and no test noticed — it took a screenshot.
    expect(fitsInFrame({ grid: GRID })).toBe(true)
  })

  it('would catch a camera pulled back in too far', () => {
    // Guards the guard: a `fitsInFrame` that returned true for everything would
    // pass the check above while protecting nothing.
    expect(fitsInFrame({ grid: GRID, radius: 17 })).toBe(false)
    expect(fitsInFrame({ grid: GRID, fovDeg: 12 })).toBe(false)
  })

  it('would catch the camera being aimed so high the field falls off the bottom', () => {
    // The aim point trades foreground for horizon, so it is a dial someone will
    // reach for again. Past a point it pushes the near edge of the field out of
    // shot, and the objects nearest the camera simply stop being in the clip.
    expect(fitsInFrame({ grid: GRID, lookAtY: 2.4 })).toBe(true)
    expect(fitsInFrame({ grid: GRID, lookAtY: 6 })).toBe(false)
  })

  it('leaves real margin across the frame, not just on its edge', () => {
    // The corners want to be inside the picture, not on its edge — the camera
    // pans across the clip, so a board that only just fits at the middle of the
    // sweep loses a corner at the ends of it.
    const halfDiagonal = ((GRID * CELL) / 2) * Math.SQRT2
    const halfVertical = CAMERA.radius * Math.tan((CAMERA.fovDeg / 2) * (Math.PI / 180))
    expect(halfVertical * CLIP_ASPECT).toBeGreaterThan(halfDiagonal * 1.1)
  })

  it('is framed for the landscape aspect the page actually gives it', () => {
    // A square frame passes the horizontal check and still wastes a third of its
    // height on empty sky, because a board at this elevation is much wider on
    // screen than it is tall. The page container and this constant have to agree
    // or the framing checked here is not the framing anyone sees.
    expect(CLIP_ASPECT).toBeGreaterThan(1)
  })
})

describe('the landscape', () => {
  it('leaves the playing field dead flat', () => {
    // THE load-bearing property of the terrain. Every scored object stands in
    // the field and the questions ask which square each one is in — objects at
    // different heights on a slope would break the drop-ring cue for airborne
    // contacts and the eye's ability to compare positions on the ground.
    for (let col = 0; col < GRID; col++) {
      for (let row = 0; row < GRID; row++) {
        const { x, z } = cellToWorld(col, row, GRID)
        // Math.abs so a signed −0 reads as flat, which is what it means.
        expect([col, row, Math.abs(terrainHeight(x, z))]).toEqual([col, row, 0])
      }
    }
    // And the whole field, not just the cell centres — an object's model spreads
    // across its square.
    for (let x = -FIELD_HALF; x <= FIELD_HALF; x += 0.5) {
      for (let z = -FIELD_HALF; z <= FIELD_HALF; z += 0.5) {
        expect([x, z, Math.abs(terrainHeight(x, z))]).toEqual([x, z, 0])
      }
    }
  })

  it('keeps the ground flat a little past the hedge, so nothing leans on it', () => {
    for (const d of [FIELD_HALF + 0.5, FIELD_HALF + 1, FIELD_HALF + 1.4]) {
      expect([d, Math.abs(terrainHeight(d, 0))]).toEqual([d, 0])
      expect([d, Math.abs(terrainHeight(0, -d))]).toEqual([d, 0])
    }
  })

  it('actually rolls once it is clear of the field', () => {
    // Guards the guard: terrain that returned zero everywhere would pass every
    // flatness check above while leaving the world a billiard table.
    let peak = 0
    let trough = 0
    for (let x = -110; x <= 110; x += 3) {
      for (let z = -110; z <= 110; z += 3) {
        const h = terrainHeight(x, z)
        if (h > peak) peak = h
        if (h < trough) trough = h
      }
    }
    expect(peak).toBeGreaterThan(3)     // hills
    expect(trough).toBeLessThan(-2)     // and dips
  })

  it('holds water — the lake bed is under the surface across the whole disc', () => {
    // Without the clamp in terrainHeight the noise pokes islands through the
    // water, which reads as the scene being broken rather than as scenery.
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
      for (let f = 0; f <= 1; f += 0.1) {
        const x = LAKE.x + Math.cos(a) * LAKE.radius * f
        const z = LAKE.z + Math.sin(a) * LAKE.radius * f
        expect(terrainHeight(x, z)).toBeLessThan(LAKE.level)
      }
    }
  })

  it('puts the lake well clear of the field', () => {
    const nearestEdge = Math.hypot(
      Math.max(0, Math.abs(LAKE.x) - FIELD_HALF),
      Math.max(0, Math.abs(LAKE.z) - FIELD_HALF),
    )
    expect(nearestEdge).toBeGreaterThan(LAKE.radius * 1.8)
  })

  it('is identical on every call, so two players see the same world', () => {
    const sample = (x, z) => terrainHeight(x, z)
    for (const [x, z] of [[31, -12], [-77, 44], [12.5, 9.25], [LAKE.x + 4, LAKE.z - 3]]) {
      expect(sample(x, z)).toBe(sample(x, z))
    }
  })
})

describe('headingSpin', () => {
  it('points each compass heading the right way in world space', () => {
    // Stated as the direction the nose ends up pointing, not as the angle, so
    // the assertion cannot be satisfied by repeating the formula under test.
    const cases = [
      ['N', { x: 0, z: -1 }],   // north is −Z, up the plan view
      ['E', { x: 1, z: 0 }],
      ['S', { x: 0, z: 1 }],
      ['W', { x: -1, z: 0 }],
    ]
    for (const [heading, want] of cases) {
      const got = headingVector(heading)
      // toBeCloseTo rather than a deep equal on the pair: the trig produces
      // signed zeros and values a hair off 1, neither of which means anything.
      expect(got.x, `${heading} x`).toBeCloseTo(want.x)
      expect(got.z, `${heading} z`).toBeCloseTo(want.z)
    }
  })

  it('does not mirror east and west', () => {
    // The specific failure a sign error produces, called out on its own because
    // it is invisible in a screenshot and halves the score on heading questions.
    expect(headingVector('E').x).toBeGreaterThan(0)
    expect(headingVector('W').x).toBeLessThan(0)
  })

  it('leaves anything without a heading unrotated', () => {
    expect(headingSpin(undefined)).toBe(0)
    expect(headingSpin('nonsense')).toBe(0)
  })
})
