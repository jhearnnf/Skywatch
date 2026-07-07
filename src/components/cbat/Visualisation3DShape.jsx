import { Canvas } from '@react-three/fiber'
import { View } from '@react-three/drei'
import { COMPOSITES, compositeCorners } from '../../utils/cbat/visualisation3DPuzzle'
import { getCompositeGeometry } from '../../utils/cbat/visualisation3DGeometry'

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
      // Pulled in from [3,2.6,4.2]/fov32 along the same iso direction so shapes
      // fill more of each box and read clearly. Distance ~4.7 + fov 26 keeps
      // even a shape rotated onto its space diagonal (~1.96 across) inside the
      // frame — closer/wider than this clips rotated answer options.
      camera={{ position: [2.44, 2.11, 3.42], fov: 26 }}
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

  const geometry = getCompositeGeometry(composite)
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
        {/* One unioned solid per composite (see visualisation3DGeometry.js):
            the two primitives are merged into a single watertight geometry so
            the shape reads as one cohesive object, not two overlapping blocks. */}
        <mesh geometry={geometry}>
          <meshStandardMaterial color={shapeColor} flatShading roughness={0.8} />
        </mesh>
        {dotCorner && (
          // The marked corner must ALWAYS be readable (this is a rotation test,
          // not a hidden-object test) while still conveying depth. So we draw
          // the dot twice:
          //   • a faint "ghost" that ignores depth and always paints — so a dot
          //     on a BACK corner stays visible instead of vanishing;
          //   • a bright solid dot that IS depth-tested and draws on top — so a
          //     dot on a FRONT corner reads as a crisp solid marker covering
          //     the ghost.
          // Net effect: front corners = solid red, back corners = faint red.
          // Never "on top of the wrong corner" (the old always-on-top bug) and
          // never invisible (fully-occluded bug).
          <group position={dotCorner.pos}>
            <mesh renderOrder={1}>
              <sphereGeometry args={[0.1, 16, 16]} />
              <meshBasicMaterial
                color="#ff4444"
                transparent
                opacity={0.32}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <mesh renderOrder={2}>
              <sphereGeometry args={[0.11, 16, 16]} />
              <meshBasicMaterial color="#ff4444" />
            </mesh>
          </group>
        )}
      </group>
    </View>
  )
}
