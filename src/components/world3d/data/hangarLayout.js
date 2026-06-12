// Single source of truth for the world layout. Four hangars on cardinal
// compass points around a central spawn, each with its door facing the
// origin. Wall colliders + door trigger are pre-computed in world space so
// Hangar.jsx is purely visual.
//
// Coordinate convention: +X = east, -Z = north. "facing" describes the
// direction the door OPENS (the side of the hangar where the door gap lives).

const W = 16   // hangar width along the face containing the door
const D = 14   // depth perpendicular to door
const H = 7    // wall height
const DOOR = 4 // doorway width
const T = 0.3  // wall thickness half-extent
const TRIG_HALF = 1.6 // door trigger half-extent

function frontFaceCoords(center, facing) {
  const [cx, cz] = center
  if (facing === 'north') return { frontZ: cz - D / 2, backZ: cz + D / 2 }
  if (facing === 'south') return { frontZ: cz + D / 2, backZ: cz - D / 2 }
  if (facing === 'east')  return { frontX: cx + W / 2, backX: cx - W / 2 }
  if (facing === 'west')  return { frontX: cx - W / 2, backX: cx + W / 2 }
  throw new Error(`bad facing: ${facing}`)
}

function buildHangar({ id, kind, label, center, facing }) {
  const [cx, cz] = center
  const walls = []
  let doorCenter, doorTrigger

  if (facing === 'north' || facing === 'south') {
    const { frontZ, backZ } = frontFaceCoords(center, facing)
    // Back wall (no door)
    walls.push({ x: cx, z: backZ, halfX: W / 2, halfZ: T })
    // Side walls
    walls.push({ x: cx - W / 2, z: cz, halfX: T, halfZ: D / 2 })
    walls.push({ x: cx + W / 2, z: cz, halfX: T, halfZ: D / 2 })
    // Front wall split around the door
    const segLen = (W / 2 - DOOR / 2) / 2
    walls.push({ x: cx - (DOOR / 2 + segLen), z: frontZ, halfX: segLen, halfZ: T })
    walls.push({ x: cx + (DOOR / 2 + segLen), z: frontZ, halfX: segLen, halfZ: T })
    doorCenter = [cx, 0, frontZ]
    // Trigger sits a touch INSIDE the hangar so brushing past from outside doesn't fire.
    const dz = facing === 'north' ? +0.6 : -0.6
    doorTrigger = { x: cx, z: frontZ + dz, halfX: TRIG_HALF, halfZ: 0.9 }
  } else {
    const { frontX, backX } = frontFaceCoords(center, facing)
    walls.push({ x: backX, z: cz, halfX: T, halfZ: W / 2 })
    walls.push({ x: cx, z: cz - D / 2, halfX: D / 2, halfZ: T })
    walls.push({ x: cx, z: cz + D / 2, halfX: D / 2, halfZ: T })
    const segLen = (W / 2 - DOOR / 2) / 2
    walls.push({ x: frontX, z: cz - (DOOR / 2 + segLen), halfX: T, halfZ: segLen })
    walls.push({ x: frontX, z: cz + (DOOR / 2 + segLen), halfX: T, halfZ: segLen })
    doorCenter = [frontX, 0, cz]
    const dx = facing === 'east' ? -0.6 : +0.6
    doorTrigger = { x: frontX + dx, z: cz, halfX: 0.9, halfZ: TRIG_HALF }
  }

  return { id, kind, label, center: [cx, 0, cz], size: [W, H, D], facing, doorWidth: DOOR, walls, doorCenter, doorTrigger }
}

export const HANGARS = [
  // Aircraft bay sits NORTH of spawn (z=-25); door opens to the south, facing the spawn.
  buildHangar({ id: 'aircraft',      kind: 'aircraft',      label: 'Aircraft Bay',   center: [0,  -25], facing: 'south' }),
  // CBAT arcade sits SOUTH of spawn (z=+25); door opens to the north.
  buildHangar({ id: 'cbat',          kind: 'cbat',          label: 'CBAT Arcade',    center: [0,   25], facing: 'north' }),
  // Interrogation room WEST of spawn (x=-25); door opens east.
  buildHangar({ id: 'interrogation', kind: 'interrogation', label: 'Interrogation',  center: [-25,  0], facing: 'east' }),
  // Operations / kanban room EAST of spawn (x=+25); door opens west.
  buildHangar({ id: 'kanban',        kind: 'kanban',        label: 'Operations Room',center: [ 25,  0], facing: 'west' }),
]

export const TARMAC_SIZE = 80
export const SPAWN = [0, 0, 0]
