import { useCollider } from '../collision/useCollider'

// Four thin AABB walls placed at the model's footprint edges so the player can
// roam the floor but can't walk out past the shell into the void. Inset a little
// from the exact bounding box so the player capsule doesn't poke through glass.
const INSET = 1.5
const THICK = 0.5

function Wall({ rect }) {
  useCollider(rect)
  return null
}

export default function PerimeterColliders({ footprint }) {
  const hx = Math.max(footprint.halfX - INSET, 1)
  const hz = Math.max(footprint.halfZ - INSET, 1)

  const walls = [
    { x: 0, z: -hz, halfX: hx, halfZ: THICK }, // north
    { x: 0, z: hz, halfX: hx, halfZ: THICK }, // south
    { x: -hx, z: 0, halfX: THICK, halfZ: hz }, // west
    { x: hx, z: 0, halfX: THICK, halfZ: hz }, // east
  ]

  return walls.map((rect, i) => <Wall key={i} rect={rect} />)
}
