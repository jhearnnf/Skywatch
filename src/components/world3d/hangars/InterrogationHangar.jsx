import Interactable from '../interaction/Interactable'
import { modal } from '../state/modalStore'

// Moody interrogation set. Local coordinate frame is rotated relative to
// world (hangar door opens to +X), so local +X = toward the door (escape
// route), local -X = deeper into the room.
//
// Layout: chair at +3 facing -X, desk in the middle, VCR-TV on wheels at -3
// facing the chair, two guard silhouettes flanking the rear. A single
// overhead spotlight pools light on the desk; ambient is suppressed locally
// by darker material colours since we can't toggle world-level lights from
// here.

const DARK   = '#04101f'
const WALL   = '#0c1829'
const METAL  = '#243650'
const RUBBER = '#06101e'
const SCREEN = '#5baaff'
const SPOT_INTENSITY = 14

function Chair() {
  return (
    <group>
      {/* seat */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.7, 0.1, 0.7]} />
        <meshStandardMaterial color={DARK} flatShading roughness={0.95} />
      </mesh>
      {/* back */}
      <mesh position={[0, 1.0, 0.3]}>
        <boxGeometry args={[0.7, 1.0, 0.1]} />
        <meshStandardMaterial color={DARK} flatShading roughness={0.95} />
      </mesh>
      {/* 4 legs */}
      {[[-0.3, 0, -0.3], [0.3, 0, -0.3], [-0.3, 0, 0.3], [0.3, 0, 0.3]].map(([x, , z], i) => (
        <mesh key={i} position={[x, 0.25, z]}>
          <cylinderGeometry args={[0.04, 0.04, 0.5, 8]} />
          <meshStandardMaterial color={METAL} flatShading roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

function InterrogationDesk() {
  return (
    <group>
      {/* table top */}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[2.4, 0.08, 1.0]} />
        <meshStandardMaterial color={WALL} flatShading roughness={0.9} />
      </mesh>
      {/* 4 legs */}
      {[[-1.1, 0, -0.4], [1.1, 0, -0.4], [-1.1, 0, 0.4], [1.1, 0, 0.4]].map(([x, , z], i) => (
        <mesh key={i} position={[x, 0.39, z]}>
          <boxGeometry args={[0.06, 0.78, 0.06]} />
          <meshStandardMaterial color={METAL} flatShading roughness={0.7} />
        </mesh>
      ))}
      {/* desk lamp gooseneck */}
      <mesh position={[-1.0, 0.82, -0.35]}>
        <cylinderGeometry args={[0.03, 0.03, 0.5, 8]} />
        <meshStandardMaterial color={METAL} flatShading roughness={0.5} />
      </mesh>
      <mesh position={[-1.0, 1.1, -0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.15, 0.18, 12]} />
        <meshStandardMaterial color={METAL} flatShading roughness={0.5} />
      </mesh>
    </group>
  )
}

function VcrTv() {
  return (
    <group>
      {/* trolley base */}
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[1.0, 0.1, 0.8]} />
        <meshStandardMaterial color={METAL} flatShading roughness={0.7} />
      </mesh>
      {/* 4 caster wheels */}
      {[[-0.4, 0, -0.3], [0.4, 0, -0.3], [-0.4, 0, 0.3], [0.4, 0, 0.3]].map(([x, , z], i) => (
        <mesh key={i} position={[x, 0.05, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.06, 12]} />
          <meshStandardMaterial color={RUBBER} flatShading roughness={0.95} />
        </mesh>
      ))}
      {/* posts */}
      <mesh position={[-0.4, 0.7, -0.3]}>
        <cylinderGeometry args={[0.03, 0.03, 1.3, 8]} />
        <meshStandardMaterial color={METAL} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[0.4, 0.7, -0.3]}>
        <cylinderGeometry args={[0.03, 0.03, 1.3, 8]} />
        <meshStandardMaterial color={METAL} flatShading roughness={0.6} />
      </mesh>
      {/* TV box (CRT) */}
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[1.0, 0.9, 0.9]} />
        <meshStandardMaterial color={WALL} flatShading roughness={0.95} />
      </mesh>
      {/* CRT screen */}
      <mesh position={[0, 1.5, 0.46]}>
        <planeGeometry args={[0.75, 0.6]} />
        <meshStandardMaterial color={SCREEN} emissive={SCREEN} emissiveIntensity={0.7} flatShading roughness={0.5} />
      </mesh>
      {/* scanline strip — purely decorative */}
      <mesh position={[0, 1.42, 0.47]}>
        <planeGeometry args={[0.75, 0.05]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.15} />
      </mesh>
      {/* antenna */}
      <mesh position={[-0.2, 2.1, -0.2]} rotation={[0, 0, -Math.PI / 6]}>
        <cylinderGeometry args={[0.01, 0.01, 0.6, 6]} />
        <meshStandardMaterial color={METAL} flatShading roughness={0.5} />
      </mesh>
      <mesh position={[ 0.2, 2.1, -0.2]} rotation={[0, 0,  Math.PI / 6]}>
        <cylinderGeometry args={[0.01, 0.01, 0.6, 6]} />
        <meshStandardMaterial color={METAL} flatShading roughness={0.5} />
      </mesh>
    </group>
  )
}

function GuardSilhouette() {
  return (
    <group>
      {/* legs */}
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[0.5, 1.2, 0.4]} />
        <meshStandardMaterial color={DARK} flatShading roughness={0.95} />
      </mesh>
      {/* torso */}
      <mesh position={[0, 1.55, 0]}>
        <boxGeometry args={[0.75, 0.7, 0.45]} />
        <meshStandardMaterial color={DARK} flatShading roughness={0.95} />
      </mesh>
      {/* head */}
      <mesh position={[0, 2.05, 0]}>
        <sphereGeometry args={[0.22, 12, 10]} />
        <meshStandardMaterial color={DARK} flatShading roughness={0.95} />
      </mesh>
      {/* peaked cap */}
      <mesh position={[0, 2.22, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.1, 16]} />
        <meshStandardMaterial color={DARK} flatShading roughness={0.95} />
      </mesh>
      <mesh position={[0, 2.22, 0.16]}>
        <boxGeometry args={[0.4, 0.04, 0.18]} />
        <meshStandardMaterial color={DARK} flatShading roughness={0.95} />
      </mesh>
    </group>
  )
}

export default function InterrogationHangar({ spec }) {
  // Chair position in local coords; +3 along X (toward door) so the player
  // walks in and sits facing the TV (-X direction).
  const chairX = 3
  const onSit = () => modal.open({ kind: 'briefPicker', mode: 'aptitudeSync' })

  return (
    <>
      {/* dramatic overhead spotlight pooled on desk */}
      <spotLight
        position={[0, spec.size[1] - 0.3, 0]}
        target-position={[0, 0, 0]}
        intensity={SPOT_INTENSITY}
        angle={0.6}
        penumbra={0.4}
        distance={12}
        decay={1.2}
        color="#ffeac7"
      />
      <group position={[chairX, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <Chair />
      </group>
      <InterrogationDesk />
      <group position={[-3, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <VcrTv />
      </group>
      <group position={[-5, 0, -4]}>
        <GuardSilhouette />
      </group>
      <group position={[-5, 0,  4]}>
        <GuardSilhouette />
      </group>
      <Interactable
        id="interrogation-chair"
        x={spec.center[0] + chairX}
        z={spec.center[2]}
        range={1.8}
        label="Sit down — Aptitude Sync"
        onActivate={onSit}
      />
    </>
  )
}
