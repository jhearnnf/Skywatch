import { forwardRef } from 'react'

// Stylised low-poly player character. Flat-shaded primitives in the dark
// electric-blue palette — body cylinder + sphere head + small visor. Faces
// forward along -Z so atan2(dx, dz) yaw aligns with the agent's nose.

const Agent = forwardRef(function Agent({ position = [0, 0, 0] }, ref) {
  return (
    <group ref={ref} position={position}>
      {/* shadow disc */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.5, 24]} />
        <meshBasicMaterial color="#040810" transparent opacity={0.35} />
      </mesh>
      {/* body */}
      <mesh position={[0, 0.75, 0]} castShadow={false}>
        <cylinderGeometry args={[0.35, 0.4, 1.1, 12]} />
        <meshStandardMaterial color="#1a4e98" flatShading roughness={0.85} />
      </mesh>
      {/* shoulders */}
      <mesh position={[0, 1.35, 0]}>
        <boxGeometry args={[0.95, 0.25, 0.45]} />
        <meshStandardMaterial color="#243650" flatShading roughness={0.85} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.7, 0]}>
        <sphereGeometry args={[0.28, 16, 12]} />
        <meshStandardMaterial color="#ccd8ec" flatShading roughness={0.8} />
      </mesh>
      {/* visor */}
      <mesh position={[0, 1.72, -0.22]}>
        <boxGeometry args={[0.5, 0.12, 0.04]} />
        <meshStandardMaterial color="#5baaff" emissive="#1a4e98" flatShading roughness={0.35} />
      </mesh>
    </group>
  )
})

export default Agent
