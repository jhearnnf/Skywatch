import { Suspense, Component, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// ── Coordinate mapping ──────────────────────────────────────────────────────
// Aircraft live in the WORLD XZ plane (y = 0) and the camera sits at
// (0, 20, 0) looking down -y at the origin. This matches PlaneModel3D's
// working top-down setup: the GLB's local +y axis points up at the camera,
// so models render top-down (not side-on).
//
// Scope coords (SVG arena): 0..1000, y increases downward (south).
// World coords: ±10 on each axis. World -z = north (top of screen) — the
// camera's `up` vector is set to (0, 0, -1) so screen-up aligns with -z.
const SCOPE_HALF = 500
const WORLD_HALF = 10
function scopeToWorld(x, y) {
  return [
    (x - SCOPE_HALF) / 50,    // world X (east+)
    (y - SCOPE_HALF) / 50,    // world Z (south+; matches scope y direction)
  ]
}

// GLB models in this project are authored with the nose along local -x and
// local up along +y (matches PlaneModel3D's MODEL_NOSE convention). To make
// compass bearing h face direction (sin h, 0, -cos h) in world coords,
// rotate the model around +y by -(h + 90)°. Same formula PlaneModel3D uses.
function headingToYRot(headingDeg) {
  return -((headingDeg + 90) * Math.PI) / 180
}

// ── Single aircraft — clones the GLB scene per aircraft so multiple
//    instances of the same model render independently. ─────────────────────
class ErrorCatcher extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() { return this.state.hasError ? null : this.props.children }
}

// Default base scale for all aircraft GLBs. Admin size-cheat multiplies this.
const BASE_SCALE = 0.63

function AircraftMesh({ url, x, z, headingDeg, isEnemy, dim, scale }) {
  const { scene } = useGLTF(url)
  // Enemies get their materials tinted red, and `dim` aircraft (those that
  // have completed their gates / killed all enemies for the round) drop to
  // 20% opacity. We clone materials per instance so multiple aircraft
  // sharing the same GLB don't all share each other's appearance.
  const cloned = useMemo(() => {
    const c = scene.clone()
    if (isEnemy || dim) {
      const tint = isEnemy ? new THREE.Color('#ff4d4d') : null
      c.traverse(child => {
        if (child.isMesh && child.material) {
          child.material = child.material.clone()
          if (tint && child.material.color) child.material.color = tint.clone()
          if (isEnemy && 'emissive' in child.material && child.material.emissive) {
            child.material.emissive = new THREE.Color('#440000')
          }
          if (dim) {
            child.material.transparent = true
            child.material.opacity     = 0.2
          }
        }
      })
    }
    return c
  }, [scene, isEnemy, dim])
  return (
    <group position={[x, 0, z]} rotation={[0, headingToYRot(headingDeg), 0]} scale={[scale, scale, scale]}>
      <primitive object={cloned} />
    </group>
  )
}

// ── Layer ────────────────────────────────────────────────────────────────────
export default function DptAircraftLayer({ aircraftList, sizeMultiplier = 1.0, doneIds }) {
  const scale = BASE_SCALE * sizeMultiplier
  return (
    <div className="absolute inset-0 pointer-events-none">
      <Canvas
        orthographic
        camera={{
          position: [0, 20, 0],
          left:    -WORLD_HALF,
          right:    WORLD_HALF,
          top:      WORLD_HALF,
          bottom:  -WORLD_HALF,
          near:     0.1,
          far:     50,
        }}
        gl={{ alpha: true, antialias: true }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        onCreated={({ camera }) => {
          // up MUST be set before lookAt — without this the camera's view of
          // the xz plane ends up rotated arbitrarily relative to the SVG
          // arena chrome. Setting up = -z makes screen-up = north.
          camera.up.set(0, 0, -1)
          camera.lookAt(0, 0, 0)
          camera.updateProjectionMatrix()
          camera.updateMatrixWorld()
        }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[5, 10, 5]} intensity={1.6} color="#ffffff" />
        <pointLight position={[0, 8, 0]} intensity={0.8} color="#5baaff" />
        <Suspense fallback={null}>
          {aircraftList.map(a => {
            if (!a.modelUrl) return null
            const [wx, wz] = scopeToWorld(a.position.x, a.position.y)
            return (
              <ErrorCatcher key={a.id}>
                <AircraftMesh
                  url={a.modelUrl}
                  x={wx}
                  z={wz}
                  headingDeg={a.headingDeg}
                  isEnemy={a.kind === 'Enemy'}
                  dim={doneIds?.has(a.id) || false}
                  scale={scale}
                />
              </ErrorCatcher>
            )
          })}
        </Suspense>
      </Canvas>
    </div>
  )
}
