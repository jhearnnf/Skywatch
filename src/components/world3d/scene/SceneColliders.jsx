import { useMemo } from 'react'
import { useCollider } from '../collision/useCollider'
import { worldColliders } from '../data/sceneColliders'

// Registers the hangar shell and every solid prop in scene.glb against the
// shared collider registry, converting the authored model-space shapes with the
// same fit ImmerseModel applied to the mesh itself.
//
// Pass debug to draw each shape as a wireframe standing to player height — the
// only practical way to check a collider against the art it stands in for.

const DEBUG_HEIGHT = 2.6 // player height in world units

function Shape({ shape, debug }) {
  useCollider(shape)
  if (!debug) return null
  return (
    <mesh position={[shape.x, DEBUG_HEIGHT / 2, shape.z]}>
      {shape.r !== undefined
        ? <cylinderGeometry args={[shape.r, shape.r, DEBUG_HEIGHT, 16]} />
        : <boxGeometry args={[shape.halfX * 2, DEBUG_HEIGHT, shape.halfZ * 2]} />}
      <meshBasicMaterial color="#5baaff" wireframe transparent opacity={0.6} />
    </mesh>
  )
}

export default function SceneColliders({ fit, debug = false }) {
  const shapes = useMemo(() => worldColliders(fit), [fit])
  return shapes.map((s) => <Shape key={s.id} shape={s} debug={debug} />)
}
