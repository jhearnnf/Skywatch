import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const MODEL_URL = '/models/scene.glb'

// Target footprint: the model's longest horizontal dimension is normalised to
// this many world units, regardless of the units it was authored in. 67 units
// at the player's 5 u/s walk speed = a roomy ~13s traversal — reads as a large
// hangar without feeling like a football pitch.
const TARGET_FOOTPRINT = 67

// Loads the authored scene.glb, measures its bounding box, then wraps it in a
// group transformed so that: the longest horizontal axis spans TARGET_FOOTPRINT,
// the floor (box min Y) sits at y=0, and the horizontal centre is on the origin.
// This makes the raw export scale irrelevant. The computed footprint is reported
// back via onFit so the perimeter colliders can be sized to match.
export default function ImmerseModel({ onFit }) {
  const { scene } = useGLTF(MODEL_URL)

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    // Align the *floor surface* to y=0 — not the bounding-box bottom, which can
    // sit well below the floor (foundations, sub-structure) and would leave the
    // player sunk into the ground. Use the top of the floor mesh; fall back to
    // the box bottom if no floor mesh is found.
    let floorTop = null
    scene.traverse((o) => {
      if (o.isMesh && /floor/i.test(o.name)) {
        const top = new THREE.Box3().setFromObject(o).max.y
        floorTop = floorTop === null ? top : Math.max(floorTop, top)
      }
    })
    const groundLevel = floorTop !== null ? floorTop : box.min.y

    const longestHoriz = Math.max(size.x, size.z) || 1
    const scale = TARGET_FOOTPRINT / longestHoriz

    return {
      scale,
      position: [-center.x * scale, -groundLevel * scale, -center.z * scale],
      footprint: { halfX: (size.x * scale) / 2, halfZ: (size.z * scale) / 2 },
      height: size.y * scale,
    }
    // TARGET_FOOTPRINT in deps so HMR re-fits live when the value is edited.
  }, [scene, TARGET_FOOTPRINT])

  useEffect(() => {
    onFit?.(fit)
  }, [fit, onFit])

  return (
    <group scale={fit.scale} position={fit.position}>
      <primitive object={scene} />
    </group>
  )
}

useGLTF.preload(MODEL_URL)
