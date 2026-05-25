import { Canvas } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import { COMPOSITES, PRIMITIVES, compositeCorners } from '../../utils/cbat/visualisation3DPuzzle'

// Static fixed-camera Three Fiber canvas. Renders one composite shape with one
// highlighted-corner dot. Designed for the Visualisation 3D CBAT game where
// the page mounts ~12 of these per round (2 prompt + 5 options × 2 shapes).
// frameloop="demand" and dpr={1} keep mobile perf manageable.
//
// Props:
//   composite          — key into COMPOSITES (e.g. 'cubeStack')
//   rotation           — [rx, ry, rz] in radians applied to the whole composite
//   dotCornerId        — composite-corner id (e.g. 'p1_c4') to highlight
//   accent             — 'prompt' or 'option' (affects shape colour)
//   size               — canvas pixel size; default 140
export default function Visualisation3DShape({
  composite,
  rotation = [0, 0, 0],
  dotCornerId,
  accent = 'prompt',
  size = 140,
}) {
  const comp = COMPOSITES[composite]
  if (!comp) return null

  const corners = compositeCorners(composite)
  const dotCorner = corners.find((c) => c.id === dotCornerId)

  const shapeColor = accent === 'prompt' ? '#5baaff' : '#7e94b3'
  const edgeColor  = '#0a1424'

  return (
    <Canvas
      dpr={1}
      frameloop="demand"
      camera={{ position: [3, 2.6, 4.2], fov: 32 }}
      style={{ width: size, height: size }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 6]} intensity={0.9} />
      <directionalLight position={[-4, 2, -3]} intensity={0.25} />
      <group rotation={rotation}>
        {comp.parts.map((part, partIdx) => (
          <PrimitiveMesh
            key={partIdx}
            primKey={part.prim}
            offset={part.offset}
            scale={part.scale}
            color={shapeColor}
            edgeColor={edgeColor}
          />
        ))}
        {dotCorner && (
          <mesh position={dotCorner.pos} renderOrder={2}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshBasicMaterial color="#ff4444" depthTest={false} />
          </mesh>
        )}
      </group>
    </Canvas>
  )
}

function PrimitiveMesh({ primKey, offset, scale, color, edgeColor }) {
  const prim = PRIMITIVES[primKey]
  if (!prim) return null

  // Geometry rotations align Three.js geometry defaults with our axis-aligned
  // corner definitions in visualisation3DPuzzle.js. The X==Z scale on prism /
  // pyramid composites is uniform horizontally so this Y-rotation commutes
  // with mesh.scale and the corner positions stay consistent.
  let geometry
  let meshRotation = [0, 0, 0]
  if (prim.render.kind === 'box') {
    geometry = <boxGeometry args={[1, 1, 1]} />
  } else if (prim.render.kind === 'prism') {
    // CylinderGeometry(radius, radius, height, 3 segments) with radius =
    // 1/√3 gives a unit-edge equilateral triangular prism. Rotate -90° about
    // Y so the apex points +Z (matches our corner def).
    geometry = <cylinderGeometry args={[0.5774, 0.5774, 1, 3]} />
    meshRotation = [0, -Math.PI / 2, 0]
  } else if (prim.render.kind === 'pyramid') {
    // ConeGeometry(radius, height, 4 segments) with radius = √2/2 gives a
    // square pyramid of base side 1 at 45°; rotate +45° about Y to
    // align base corners to (±0.5, ±0.5).
    geometry = <coneGeometry args={[0.7071, 1, 4]} />
    meshRotation = [0, Math.PI / 4, 0]
  } else {
    return null
  }

  return (
    <mesh position={offset} scale={scale} rotation={meshRotation}>
      {geometry}
      <meshStandardMaterial color={color} flatShading roughness={0.85} />
      <Edges threshold={15} color={edgeColor} />
    </mesh>
  )
}
