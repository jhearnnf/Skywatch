// Stylised arcade cabinet — primitive boxes only, no GLB. The cabinet's
// screen faces the cabinet's local -Z so the player approaches it from the
// front; rotate the parent group to point the screen at the room interior.
//
// Working variant: dim brand-blue screen with a glowing title strip.
// Broken variant: cracked dark screen, faintly-flickering caution stripe.

const BODY   = '#0c1829'
const TRIM   = '#1a4e98'
const SCREEN = '#5baaff'
const SCREEN_DIM = '#102040'
const WARN   = '#f59e0b'

export default function ArcadeCabinet({ broken = false, game, rotation = 0 }) {
  const screenColor = broken ? '#1a0e08' : SCREEN_DIM
  const screenEmissive = broken ? '#1a0e08' : '#1a4e98'
  const trim = broken ? WARN : TRIM

  return (
    <group rotation={[0, rotation, 0]}>
      {/* base/cabinet body */}
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[1.4, 1.8, 1.0]} />
        <meshStandardMaterial color={BODY} flatShading roughness={0.95} />
      </mesh>
      {/* angled control deck */}
      <mesh position={[0, 1.05, -0.45]} rotation={[Math.PI / 6, 0, 0]}>
        <boxGeometry args={[1.3, 0.15, 0.6]} />
        <meshStandardMaterial color={trim} flatShading roughness={0.7} />
      </mesh>
      {/* upper monitor box */}
      <mesh position={[0, 2.0, -0.1]}>
        <boxGeometry args={[1.4, 1.0, 0.8]} />
        <meshStandardMaterial color={BODY} flatShading roughness={0.95} />
      </mesh>
      {/* screen (front face, slightly inset) */}
      <mesh position={[0, 2.0, -0.51]}>
        <planeGeometry args={[1.05, 0.7]} />
        <meshStandardMaterial color={screenColor} emissive={screenEmissive} emissiveIntensity={broken ? 0.2 : 0.9} flatShading roughness={0.5} />
      </mesh>
      {/* title strip across the top */}
      <mesh position={[0, 2.6, -0.45]}>
        <boxGeometry args={[1.4, 0.25, 0.1]} />
        <meshStandardMaterial color={trim} flatShading roughness={0.5} />
      </mesh>
      {/* glowing emoji-sized accent on the front of the cabinet */}
      {!broken && (
        <mesh position={[0, 0.4, -0.51]}>
          <planeGeometry args={[0.6, 0.6]} />
          <meshStandardMaterial color={SCREEN} emissive={SCREEN} emissiveIntensity={0.6} transparent opacity={0.85} />
        </mesh>
      )}
      {/* broken-glass diagonal hatching on a broken cabinet */}
      {broken && (
        <>
          <mesh position={[0, 2.0, -0.5]} rotation={[0, 0, Math.PI / 6]}>
            <boxGeometry args={[1.2, 0.04, 0.02]} />
            <meshStandardMaterial color={WARN} flatShading roughness={0.6} />
          </mesh>
          <mesh position={[0, 2.0, -0.5]} rotation={[0, 0, -Math.PI / 6]}>
            <boxGeometry args={[1.2, 0.04, 0.02]} />
            <meshStandardMaterial color={WARN} flatShading roughness={0.6} />
          </mesh>
        </>
      )}
    </group>
  )
}
