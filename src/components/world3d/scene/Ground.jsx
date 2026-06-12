import { TARMAC_SIZE } from '../data/hangarLayout'

// Tarmac square + a faint runway stripe under the agent. Single textureless
// material per repo convention; the colour palette stays inside the dark
// electric-blue theme so the world feels continuous with the rest of the app.

export default function Ground() {
  return (
    <group>
      {/* Tarmac */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false}>
        <planeGeometry args={[TARMAC_SIZE, TARMAC_SIZE]} />
        <meshStandardMaterial color="#0d1625" flatShading roughness={0.95} />
      </mesh>
      {/* Faint cross axes — give the player a sense of place around spawn */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.5, TARMAC_SIZE * 0.6]} />
        <meshBasicMaterial color="#243650" transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[1.5, TARMAC_SIZE * 0.6]} />
        <meshBasicMaterial color="#243650" transparent opacity={0.6} />
      </mesh>
      {/* Outer apron ring for visual depth at the edge */}
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TARMAC_SIZE / 2 - 2, TARMAC_SIZE / 2 + 8, 32]} />
        <meshBasicMaterial color="#04101f" />
      </mesh>
    </group>
  )
}
