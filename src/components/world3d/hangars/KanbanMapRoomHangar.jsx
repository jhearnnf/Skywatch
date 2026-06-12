import Interactable from '../interaction/Interactable'
import { modal } from '../state/modalStore'

// Operations / map room. Big table in the centre with a stylised global map
// surface and decorative pins. Pin positions are deterministic but spread
// across the table so the room reads as "intel board" at a glance.

const WOOD     = '#1a2336'
const MAP_BG   = '#102040'
const LAND     = '#3d5a7a'
const PIN_RED  = '#f59e0b'
const PIN_BLUE = '#5baaff'
const METAL    = '#243650'

// Twelve pins scattered on the map surface (local table coords, table is
// 5×3 units). Mix of red/blue. Procedural — case files have no geo-coords
// on the schema; treat these as visual flavour.
const PINS = [
  { x: -1.9, z: -1.0, color: PIN_BLUE },
  { x: -1.2, z:  0.4, color: PIN_RED },
  { x: -0.5, z: -0.9, color: PIN_BLUE },
  { x:  0.1, z:  0.6, color: PIN_RED },
  { x:  0.9, z: -0.5, color: PIN_BLUE },
  { x:  1.4, z:  0.2, color: PIN_RED },
  { x:  1.9, z: -0.9, color: PIN_BLUE },
  { x: -2.1, z:  0.8, color: PIN_RED },
  { x: -0.1, z:  1.1, color: PIN_BLUE },
  { x:  1.7, z:  1.2, color: PIN_RED },
  { x: -1.5, z: -0.4, color: PIN_RED },
  { x:  0.5, z: -1.2, color: PIN_BLUE },
]

// Crude landmass blobs on the map surface — three big shapes evoking
// continents without committing to a real projection. Purely decorative.
const LAND_BLOBS = [
  { x: -1.6, z: -0.2, w: 2.0, h: 1.3 },
  { x:  0.6, z:  0.4, w: 1.8, h: 1.0 },
  { x:  1.8, z: -0.7, w: 0.9, h: 0.6 },
]

function MapTable() {
  return (
    <group>
      {/* table top */}
      <mesh position={[0, 0.82, 0]}>
        <boxGeometry args={[6.4, 0.1, 4.0]} />
        <meshStandardMaterial color={WOOD} flatShading roughness={0.9} />
      </mesh>
      {/* table legs */}
      {[[-3.0, 0, -1.8], [3.0, 0, -1.8], [-3.0, 0, 1.8], [3.0, 0, 1.8]].map(([x, , z], i) => (
        <mesh key={i} position={[x, 0.41, z]}>
          <boxGeometry args={[0.12, 0.82, 0.12]} />
          <meshStandardMaterial color={METAL} flatShading roughness={0.7} />
        </mesh>
      ))}
      {/* map surface (slightly above table top) */}
      <mesh position={[0, 0.88, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6.0, 3.6]} />
        <meshStandardMaterial color={MAP_BG} flatShading roughness={0.85} />
      </mesh>
      {/* fake continents */}
      {LAND_BLOBS.map((b, i) => (
        <mesh key={i} position={[b.x, 0.89, b.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[b.w, b.h]} />
          <meshStandardMaterial color={LAND} flatShading roughness={0.9} />
        </mesh>
      ))}
      {/* pins */}
      {PINS.map((p, i) => (
        <group key={i} position={[p.x, 0.9, p.z]}>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.16, 6]} />
            <meshStandardMaterial color={METAL} flatShading roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.18, 0]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={0.35} flatShading roughness={0.45} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function MagnifyingGlass() {
  return (
    <group position={[1.2, 0.9, 1.2]} rotation={[0, Math.PI / 6, 0]}>
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.16, 0.025, 8, 24]} />
        <meshStandardMaterial color="#aec0d8" flatShading roughness={0.4} />
      </mesh>
      <mesh position={[0.16, 0, 0.16]} rotation={[0, Math.PI / 4, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.32, 8]} />
        <meshStandardMaterial color="#aec0d8" flatShading roughness={0.4} />
      </mesh>
    </group>
  )
}

export default function KanbanMapRoomHangar({ spec }) {
  return (
    <>
      <MapTable />
      <MagnifyingGlass />
      <Interactable
        id="kanban-desk"
        x={spec.center[0]}
        z={spec.center[2]}
        range={2.4}
        label="Inspect case board"
        onActivate={() => modal.open({ kind: 'briefPicker', mode: 'caseFiles' })}
      />
    </>
  )
}
