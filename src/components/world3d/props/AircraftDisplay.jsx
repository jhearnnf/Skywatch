import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'

// Aircraft on a plinth. Mirrors the existing PlaneModel3D approach:
// useGLTF + cloned scene to avoid sharing transforms across instances. Each
// plinth has a soft alpha-decal shadow so the model doesn't look hover.

const PLINTH = '#0c1829'
const PLINTH_TRIM = '#1a4e98'

export default function AircraftDisplay({ modelUrl, scale = 0.6 }) {
  const { scene } = useGLTF(modelUrl)
  const cloned = useMemo(() => scene.clone(), [scene])

  return (
    <group>
      {/* plinth shadow */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.4, 24]} />
        <meshBasicMaterial color="#040810" transparent opacity={0.35} />
      </mesh>
      {/* plinth */}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[1.2, 1.3, 0.5, 16]} />
        <meshStandardMaterial color={PLINTH} flatShading roughness={0.95} />
      </mesh>
      {/* plinth top trim */}
      <mesh position={[0, 0.52, 0]}>
        <cylinderGeometry args={[1.21, 1.21, 0.05, 16]} />
        <meshStandardMaterial color={PLINTH_TRIM} flatShading roughness={0.6} />
      </mesh>
      {/* aircraft */}
      <primitive object={cloned} position={[0, 1.3, 0]} scale={[scale, scale, scale]} />
    </group>
  )
}
