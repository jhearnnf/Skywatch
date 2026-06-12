import { useEffect } from 'react'
import { registerCollider, unregisterCollider } from '../collision/colliders'

// Generic hangar shell: floor, walls (with door gap), simple roof, lintel
// above the door. Walls are registered as world-space AABB colliders so the
// character controller resolves against them every frame. The interior
// content is passed in as children; this component is purely the building.
//
// Visual style: matte slate boxes with a brand-blue accent strip along the
// roof line. Door gap is wide enough for the agent + camera to pass through
// without clipping.

const ACCENT = '#1a4e98'
const WALL = '#243650'
const ROOF = '#0d1625'
const FLOOR = '#0d1825'

export default function Hangar({ spec, children }) {
  const { id, center, size: [W, H, D], facing, doorWidth, walls, doorCenter } = spec

  // Register wall colliders once per spec.
  useEffect(() => {
    const ids = walls.map((w, i) => {
      const cid = `hangar-${id}-wall-${i}`
      registerCollider(cid, w)
      return cid
    })
    return () => { for (const cid of ids) unregisterCollider(cid) }
  }, [id, walls])

  // Door lintel: a short strip across the doorway gap, from y = doorHeight up
  // to y = H. Visual only.
  const doorHeight = 3.5
  const lintelHeight = H - doorHeight

  // Lintel is positioned at doorCenter, with orientation matching `facing`.
  let lintelPos, lintelSize
  if (facing === 'north' || facing === 'south') {
    lintelPos = [doorCenter[0] - center[0], doorHeight + lintelHeight / 2, doorCenter[2] - center[2]]
    lintelSize = [doorWidth, lintelHeight, 0.5]
  } else {
    lintelPos = [doorCenter[0] - center[0], doorHeight + lintelHeight / 2, doorCenter[2] - center[2]]
    lintelSize = [0.5, lintelHeight, doorWidth]
  }

  return (
    <group position={center}>
      {/* Floor */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={FLOOR} flatShading roughness={0.95} />
      </mesh>
      {/* Roof — slightly inset to suggest a slope without doing the geometry */}
      <mesh position={[0, H + 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W * 0.98, D * 0.98]} />
        <meshStandardMaterial color={ROOF} flatShading roughness={0.9} side={2} />
      </mesh>
      {/* Walls — visual boxes match collider rects */}
      {walls.map((w, i) => (
        <mesh key={`w-${i}`} position={[w.x - center[0], H / 2, w.z - center[2]]}>
          <boxGeometry args={[w.halfX * 2, H, w.halfZ * 2]} />
          <meshStandardMaterial color={WALL} flatShading roughness={0.9} />
        </mesh>
      ))}
      {/* Roof accent strip — top-of-wall colour bar so the world reads "hangar" at a distance */}
      <mesh position={[0, H + 0.15, 0]}>
        <boxGeometry args={[W + 0.4, 0.3, D + 0.4]} />
        <meshStandardMaterial color={ACCENT} flatShading roughness={0.6} />
      </mesh>
      {/* Door lintel — fills the gap above the door so the hangar looks closed */}
      <mesh position={lintelPos}>
        <boxGeometry args={lintelSize} />
        <meshStandardMaterial color={WALL} flatShading roughness={0.9} />
      </mesh>
      {children}
    </group>
  )
}
