import { Canvas } from '@react-three/fiber'
import { View } from '@react-three/drei'
import { COMPOSITES, PRIMITIVES, compositeCorners } from '../../utils/cbat/visualisation3DPuzzle'

// Visualisation 3D CBAT shapes — a round shows ~12 of these at once
// (2 prompt + 5 options × 2 shapes).
//
// Each shape used to be its own <Canvas>, i.e. its own WebGL context. Mobile
// browsers cap concurrent WebGL contexts hard (≈8 on iOS Safari, and mobile
// GPUs evict aggressively under memory pressure), so the surplus shapes had
// their context killed and rendered as the browser's "context lost"
// placeholder — a white square with a broken-image / sad-pixel face. Desktop
// allows ≈16 contexts, which is why it only showed on mobile.
//
// The fix: ONE shared WebGL context. drei's <View> renders a plain tracking
// <div> in the layout and tunnels its 3D scene into a single <Canvas> (which
// hosts <View.Port/>), scissoring one viewport per shape. The context cap no
// longer applies because there's only ever one context.
//
// Usage: render <VisualisationShapeCanvas /> once while shapes are on screen,
// then drop <Visualisation3DShape> into the layout exactly as before.

// Single shared context for every Visualisation3DShape on the page. Fixed,
// full-viewport and pointer-transparent: the Views scissor themselves to each
// shape's <div> rect, and clicks pass straight through to the answer buttons
// underneath. Mount it only while a 3D round is on screen so the overlay isn't
// live during results/menus.
export function VisualisationShapeCanvas() {
  return (
    <Canvas
      dpr={1}
      camera={{ position: [3, 2.6, 4.2], fov: 32 }}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 40,
      }}
    >
      <View.Port />
    </Canvas>
  )
}

// Static fixed-camera shape with one highlighted-corner dot. Renders a sized
// tracking <div> via <View>; the scene below is tunnelled into the shared
// VisualisationShapeCanvas. The camera/lighting match the old per-canvas setup
// so shapes look identical — every shape is square so the shared camera's
// per-view aspect (forced to 1 by <View>) stays consistent.
//
// Props:
//   composite          — key into COMPOSITES (e.g. 'cubeStack')
//   rotation           — [rx, ry, rz] in radians applied to the whole composite
//   dotCornerId        — composite-corner id (e.g. 'p1_c4') to highlight
//   accent             — 'prompt' or 'option' (affects shape colour)
//   size               — tracking-div pixel size; default 140
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

  const shapeColor = accent === 'prompt' ? '#5baaff' : '#94a8c4'

  return (
    <View style={{ width: size, height: size }}>
      {/* Lights live inside each View — every View renders into its own
          virtual scene, so they can't be shared from the canvas root. Low
          ambient keeps faces shaded enough to read silhouettes by contrast;
          the bright key light from the upper-right + softer back-fill carve
          each face with a distinct value so the union looks volumetric
          without any outline. */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 9, 5]}   intensity={1.4} />
      <directionalLight position={[-5, 3, -4]} intensity={0.35} />
      <group rotation={rotation}>
        {comp.parts.map((part, partIdx) => (
          <PrimitiveMesh
            key={partIdx}
            primKey={part.prim}
            offset={part.offset}
            scale={part.scale}
            color={shapeColor}
          />
        ))}
        {dotCorner && (
          <mesh position={dotCorner.pos} renderOrder={2}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshBasicMaterial color="#ff4444" depthTest={false} />
          </mesh>
        )}
      </group>
    </View>
  )
}

function PrimitiveMesh({ primKey, offset, scale, color }) {
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
      <meshStandardMaterial color={color} flatShading roughness={0.8} />
    </mesh>
  )
}
