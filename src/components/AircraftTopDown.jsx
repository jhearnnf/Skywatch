import { Suspense, Component, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useCbatDemoCanvas } from '../utils/cbat/demoMode'

class ErrorCatcher extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch() { this.props.onError?.() }
  render() { return this.state.hasError ? null : this.props.children }
}

// Every mesh in a silhouette render shares this one unlit material. The GLBs
// come from different authors with different textures, paint schemes and
// shading, and the Target scan is meant to be decided on SHAPE alone — a flat
// single-colour fill is what makes a Typhoon and a van comparable on equal
// terms, the way the real test's plain silhouettes are.
//
// The fill is a light electric blue (a shade above brand-600); the neon comes
// from SILHOUETTE_GLOW below, a drop-shadow on the canvas that hugs the
// shape's alpha. toneMapped off so R3F's default ACES pass doesn't grey the
// colour down.
const SILHOUETTE_MATERIAL = new THREE.MeshBasicMaterial({ color: '#7dbcff', toneMapped: false })
const SILHOUETTE_GLOW =
  'drop-shadow(0 0 2px rgba(91,170,255,0.6)) drop-shadow(0 0 7px rgba(59,140,235,0.45))'

// Every model is scaled so its longest dimension spans this many world units.
// The aircraft GLBs were pre-normalised to a ~2-unit box and drawn at ×2, so
// this keeps them exactly where they were; the vehicle GLBs are raw Sketchfab
// exports in anything from ~3 units to ~26,000, and would otherwise be either
// invisible or the size of the panel. FitCamera's halfExtent assumes this.
const MODEL_SPAN = 4

// Loads the GLB and normalises it: re-centred on its geometric centre (several
// of the vehicle files sit well off the origin), scaled to MODEL_SPAN, and for
// a side view turned so its long axis runs left-to-right on screen. Done on the
// world-space bounding box, so node matrices (Sketchfab wraps every export in
// one) are accounted for.
function Model({ url, yawDeg = 0, silhouette = false, view = 'top' }) {
  const { scene } = useGLTF(url)
  const { clonedScene, centre, scale, alignYaw } = useMemo(() => {
    const c = scene.clone()
    // clone() shares materials with the cached original, so this swap never
    // touches the textured version other callers render.
    if (silhouette) c.traverse(o => { if (o.isMesh) o.material = SILHOUETTE_MATERIAL })
    const box = new THREE.Box3().setFromObject(c)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    // Side-on: the camera looks along Z, so the length wants to be along X.
    const alignYaw = view === 'side' && size.z > size.x ? Math.PI / 2 : 0
    return { clonedScene: c, centre: box.getCenter(new THREE.Vector3()), scale: MODEL_SPAN / maxDim, alignYaw }
  }, [scene, silhouette, view])
  const yawRad = (yawDeg * Math.PI) / 180 + alignYaw
  return (
    <group scale={[scale, scale, scale]} rotation={[0, yawRad, 0]}>
      <primitive object={clonedScene} position={[-centre.x, -centre.y, -centre.z]} />
    </group>
  )
}

// Sizes the camera every frame so the whole model sits snugly in frame — full
// silhouette visible top-to-bottom and side-to-side, no cropping — regardless
// of the panel's on-screen aspect ratio. Used by the Target Scan panel, where
// the actual "letterbox" reveal (a thin strip sliding across) is a CSS
// clip-path applied to the DOM around this canvas: this camera's only job is
// to make sure that strip is always cutting into aircraft, not blank margin.
function FitCamera({ halfExtentWorld, view }) {
  const { camera } = useThree()
  useFrame(() => {
    const fovRad = (camera.fov * Math.PI) / 180
    // aspect >= 1 (wide panel): height is the binding constraint. aspect < 1
    // (tall panel): width is, so zoom out further to keep both axes inside.
    const dist = halfExtentWorld / (Math.tan(fovRad / 2) * Math.min(1, camera.aspect))
    if (view === 'side') camera.position.set(0, 0, dist)
    else camera.position.set(0, dist, 0)
    camera.lookAt(0, 0, 0)
  })
  return null
}

// Warm the GLTF cache so a model's first showing isn't a blank strip while it
// downloads — the Scan sweep starts the moment its panel mounts.
export function preloadModel(url) {
  if (url) useGLTF.preload(url)
}

// view — 'top' (the aircraft default: camera straight down) or 'side' (camera
// level with the model, for ground vehicles shown in profile).
export default function AircraftTopDown({
  modelUrl, onError, transparent = false, yawDeg = 0, fit = false, silhouette = false, view = 'top',
}) {
  // Sizing + pixel-ratio overrides for a canvas inside a demo tile; empty
  // for real players.
  const demoCanvas = useCbatDemoCanvas()
  if (!modelUrl) return null
  // `transparent` lets callers slot the canvas onto a coloured field (e.g.
  // the landing-page preview windows) without a hard-coded dark backdrop.
  const wrapperBg = transparent ? 'transparent' : '#020a18'
  const camPos = view === 'side' ? [0, 0, 13] : [0, 13, 0]
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 8, background: wrapperBg }}>
      {/* Absolutely positioned against the sized wrapper above rather than a
          plain 100%-height child: a percentage height only resolves against a
          DEFINITE ancestor height, and a CSS Grid row sized from a `%` track
          (see .cbat-target-grid) doesn't always count as definite in time for
          a canvas measuring its box on mount — R3F fell back to some other
          (much larger) size for this panel without it. */}
      <div style={{ position: 'absolute', inset: 0, filter: silhouette ? SILHOUETTE_GLOW : 'none' }}>
        <Canvas
          {...demoCanvas}
          camera={{ position: camPos, fov: 26, near: 0.1, far: 50 }}
          gl={{ alpha: true, antialias: true }}
          style={{ width: '100%', height: '100%', background: 'transparent' }}
          onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
        >
          <ambientLight intensity={1.4} />
          <directionalLight position={[0, 10, 0]} intensity={1.8} color="#5baaff" />
          <pointLight position={[2, 8, 2]} intensity={1.2} color="#ffffff" />
          {fit && <FitCamera halfExtentWorld={MODEL_SPAN / 2 + 0.15} view={view} />}
          <Suspense fallback={null}>
            <ErrorCatcher onError={onError}>
              <Model url={modelUrl} yawDeg={yawDeg} silhouette={silhouette} view={view} />
            </ErrorCatcher>
          </Suspense>
        </Canvas>
      </div>
    </div>
  )
}
