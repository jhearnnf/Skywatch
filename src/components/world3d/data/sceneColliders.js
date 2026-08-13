// Collision setup for the authored hangar in public/models/scene.glb.
//
// The prop shapes themselves live in sceneCollisionShapes.js and are generated
// from the mesh by scripts/gen-scene-colliders.mjs. This file holds the parts
// that are decisions rather than measurements: where the playable floor ends,
// where the player starts, and how model units become world units.
//
// Everything here is in the GLB's OWN units, not world units. ImmerseModel
// rescales the model at runtime (TARGET_FOOTPRINT is a tuning constant that is
// expected to be edited), so baking world numbers would silently desync every
// collider the moment that constant moved.

import { PROP_BOXES, PROP_CIRCLES } from './sceneCollisionShapes'

export { PROP_BOXES, PROP_CIRCLES }

// Inner face of the hangar shell. The concrete slab in the GLB extends well
// past the building (x +/-20, z -12.3..11.8) but the shell is closed on all
// four sides at walking height, so the apron outside is neither reachable nor
// visible — the walls, not the slab edge, are what should stop the player.
export const HANGAR_INTERIOR = { minX: -12.75, maxX: 11.75, minZ: -10.0, maxZ: 9.5 }

// Thickness of the generated shell walls, in model units. Only needs to exceed
// one movement step so a fast player cannot tunnel; resolveAxis also clamps
// overshoot, so this is belt-and-braces.
export const WALL_THICKNESS = 0.5

// Where the player starts, in WORLD units — the exception to the model-units
// rule above, because CharacterController seeds its position at mount, before
// the GLB has loaded and reported a fit. This is open floor south-east of the
// parked aircraft, facing it; the old [0,0,0] spawn is inside the aircraft's
// collision shapes now that the props are solid. sceneColliders.test.js asserts
// it stays clear of every shape by more than the player's radius.
export const SPAWN = [0, 0, -8]

// Four walls sealing the shell, each sitting just outside the interior face so
// the playable rectangle is exactly HANGAR_INTERIOR.
export function hangarWallBoxes(interior = HANGAR_INTERIOR, t = WALL_THICKNESS) {
  const { minX, maxX, minZ, maxZ } = interior
  return [
    { id: 'shell-north', minX: minX - t, maxX: maxX + t, minZ: minZ - t, maxZ: minZ },
    { id: 'shell-south', minX: minX - t, maxX: maxX + t, minZ: maxZ, maxZ: maxZ + t },
    { id: 'shell-west', minX: minX - t, maxX: minX, minZ: minZ - t, maxZ: maxZ + t },
    { id: 'shell-east', minX: maxX, maxX: maxX + t, minZ: minZ - t, maxZ: maxZ + t },
  ]
}

// Model-space min/max box -> the { x, z, halfX, halfZ } centre+half-extent rect
// that collision/colliders.js expects, in world units.
export function modelBoxToWorldRect(box, fit) {
  const s = fit.scale
  const x0 = box.minX * s + fit.position[0]
  const x1 = box.maxX * s + fit.position[0]
  const z0 = box.minZ * s + fit.position[2]
  const z1 = box.maxZ * s + fit.position[2]
  return {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    halfX: (x1 - x0) / 2,
    halfZ: (z1 - z0) / 2,
  }
}

// Model-space disc -> world-space { x, z, r }. The fit is uniform, so a circle
// stays a circle rather than becoming an ellipse.
export function modelCircleToWorldCircle(circle, fit) {
  return {
    x: circle.x * fit.scale + fit.position[0],
    z: circle.z * fit.scale + fit.position[2],
    r: circle.r * fit.scale,
  }
}

// Every collider for the scene, in world units, ready to register. Ids are
// debugging aids and are not user-visible.
export function worldColliders(fit) {
  const out = []
  for (const b of hangarWallBoxes()) out.push({ id: b.id, ...modelBoxToWorldRect(b, fit) })
  PROP_BOXES.forEach((b, i) => out.push({ id: `box-${i}`, ...modelBoxToWorldRect(b, fit) }))
  PROP_CIRCLES.forEach((c, i) => out.push({ id: `circle-${i}`, ...modelCircleToWorldCircle(c, fit) }))
  return out
}
