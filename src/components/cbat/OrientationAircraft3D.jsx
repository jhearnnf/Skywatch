import { Suspense, Component, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { HORIZON_Y } from '../../utils/cbat/orientationScene'

// A GLB aircraft at a given attitude, for the Orientation pictures. Same
// fixed camera as the flat version in orientationScene.js (due south, a
// little above, looking north, the same vertical field of view), so the two
// renderers show the same picture and the theme backdrops line up.
//
// three.js is right-handed with the camera's default view down -Z, so here
// north is -Z, east +X and up +Y. The flat version's maths is written the
// other way round (north +Z) and mirrors on output; the pictures agree.
//
// Two variants, one per theme:
//   • cbat — the real test's red Hawk, plainly lit, on the grey tunnel the
//     card draws behind it.
//   • skywatch — the Typhoon with a cold key light, a blue rim from behind
//     and an emissive lift, so it reads as lit neon on the dark backdrop.

export const TYPHOON_URL = '/models/eurofighter typhoon fgr4.glb'
export const HAWK_URL = '/models/hawk t2.glb'

const VARIANTS = {
  cbat: {
    url: HAWK_URL,
    // Red Arrows red, flat like the real test's render: the Hawk's own
    // texture is dropped, or it multiplies the red down to maroon.
    tint: '#e0201f',
    dropMap: true,
    // Matte, and lit mostly from one side, so the shape reads through the
    // shading the way the real render's does rather than as a red blob.
    roughness: 0.65,
    metalness: 0.05,
    emissive: '#3a0606',
    emissiveIntensity: 0.3,
    lights: (
      <>
        <ambientLight intensity={0.55} color="#ffffff" />
        <hemisphereLight args={['#ffffff', '#4a4a4a', 0.5]} />
        <directionalLight position={[-14, 20, 18]} intensity={2.8} color="#ffffff" />
        <directionalLight position={[14, 4, -12]} intensity={0.5} color="#dfe6f0" />
      </>
    ),
  },
  skywatch: {
    url: TYPHOON_URL,
    tint: null,
    emissive: '#1d3d66',
    emissiveIntensity: 0.7,
    lights: (
      <>
        <ambientLight intensity={1.2} color="#9fc7ff" />
        <hemisphereLight args={['#cfe4ff', '#0c1f3c', 1.0]} />
        <directionalLight position={[-12, 20, 14]} intensity={2.6} color="#e6f1ff" />
        <directionalLight position={[10, 8, -18]} intensity={1.6} color="#5baaff" />
      </>
    ),
  },
}

// Match orientationScene: the horizon sits HORIZON_Y units down a 100-unit
// tall frame, which fixes the camera's elevation and vertical field of view.
// Width follows the card's aspect; three.js's fov is vertical, so a wider
// frame just shows more either side.
const CAM_DISTANCE = 40
const CAM_SCALE = 6.4   // frame units per aircraft unit at that distance
const FOV_DEG = 2 * Math.atan(50 / (CAM_DISTANCE * CAM_SCALE)) * 180 / Math.PI
const CAM_ELEVATION = Math.atan((50 - HORIZON_Y) / (CAM_DISTANCE * CAM_SCALE))
const CAM_POS = [0, CAM_DISTANCE * Math.sin(CAM_ELEVATION), CAM_DISTANCE * Math.cos(CAM_ELEVATION)]

// Longest dimension of the fitted model, in the same units the flat aircraft
// is drawn in (its span is 10).
const MODEL_SIZE = 12.5
const DEG = Math.PI / 180

// Every aircraft GLB we ship is authored nose-along -X (see ActPlayerCraft).
// Turned so the nose points north (-Z) and the right wing east (+X).
const ALIGN_Y = -Math.PI / 2

class ModelErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError?.() }
  render() { return this.state.failed ? null : this.props.children }
}

function AircraftModel({ attitude, variant, onFirstFrame }) {
  const cfg = VARIANTS[variant]
  const { scene } = useGLTF(cfg.url)
  const invalidate = useThree(s => s.invalidate)
  const drawnRef = useRef(false)
  const onFirstFrameRef = useRef(onFirstFrame)
  useEffect(() => { onFirstFrameRef.current = onFirstFrame }, [onFirstFrame])

  // The first frame with the model in it is the moment the picture exists;
  // until then the card shows the flat silhouette instead of a blank.
  useFrame(() => {
    if (drawnRef.current) return
    drawnRef.current = true
    onFirstFrameRef.current?.()
  })

  // Cloned with materials so the tint and lift below can't leak into the
  // cached GLTF that Target, DPT, Trace and the hangar draw from
  // (ActPlayerCraft does the same).
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const restyle = (mat) => {
        const m = mat.clone()
        if (cfg.tint) m.color = new THREE.Color(cfg.tint)
        if (cfg.dropMap) m.map = null
        if (cfg.roughness != null) m.roughness = cfg.roughness
        if (cfg.metalness != null) m.metalness = cfg.metalness
        m.emissive = new THREE.Color(cfg.emissive)
        m.emissiveIntensity = cfg.emissiveIntensity
        m.needsUpdate = true
        return m
      }
      o.material = Array.isArray(o.material) ? o.material.map(restyle) : restyle(o.material)
    })
    return clone
  }, [scene, cfg])

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model)
    const dims = new THREE.Vector3()
    const centre = new THREE.Vector3()
    box.getSize(dims)
    box.getCenter(centre)
    const scale = MODEL_SIZE / (Math.max(dims.x, dims.y, dims.z) || 1)
    return { scale, offset: [-centre.x * scale, -centre.y * scale, -centre.z * scale] }
  }, [model])

  // Demand frameloop: draw once the model is in and again whenever the
  // attitude changes, and otherwise leave the GPU alone.
  useEffect(() => { invalidate() }, [attitude, model, invalidate])

  // Yaw onto the heading, then pitch, then roll: heading is clockwise from
  // north, pitch positive nose up, bank positive right wing down.
  return (
    <group rotation={[0, -attitude.heading * DEG, 0]}>
      <group rotation={[attitude.pitch * DEG, 0, 0]}>
        <group rotation={[0, 0, -attitude.bank * DEG]}>
          <group rotation={[0, ALIGN_Y, 0]}>
            <group position={fit.offset} scale={fit.scale}>
              <primitive object={model} />
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

export default function OrientationAircraft3D({ attitude, variant = 'skywatch', onError, onFirstFrame }) {
  const cfg = VARIANTS[variant] ?? VARIANTS.skywatch
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: CAM_POS, fov: FOV_DEG, near: 1, far: 200 }}
      gl={{ alpha: true, antialias: true }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      {cfg.lights}
      <Suspense fallback={null}>
        <ModelErrorBoundary onError={onError}>
          <AircraftModel attitude={attitude} variant={variant in VARIANTS ? variant : 'skywatch'} onFirstFrame={onFirstFrame} />
        </ModelErrorBoundary>
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload(TYPHOON_URL)
useGLTF.preload(HAWK_URL)
