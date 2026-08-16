import { Component, Suspense, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { createCraftAttitude, turnRates } from '../../utils/cbat/actCraftAttitude'

// What ACT draws at the player's position: the original white ball, or the
// aircraft GLB the player picked on the instructions screen (see actCraft.js).
//
// Nothing here touches the flight model. The position comes from ballPosRef and
// the heading from ballForwardRef, both written by the game loop — this
// component only reads them, so the aircraft is a skin over the ball and not a
// second thing to keep in sync.

// Longest dimension of the fitted model, in world units. The shape gates are
// 1.4 across (SHAPE_RADIUS × 2), so this has to stay well under that or an
// aircraft would look like it clipped a hoop the ball threaded cleanly.
const CRAFT_SIZE = 0.55

// Every aircraft GLB we ship is authored nose-along -X. RttScene's YAW_AIRCRAFT
// and Trace2Scene's MODEL_NOSE record the same convention.
const MODEL_NOSE = new THREE.Vector3(-1, 0, 0)

// Enough of a lift to read against the tunnel without looking lit from inside.
const CRAFT_EMISSIVE = '#25415f'
const CRAFT_EMISSIVE_INTENSITY = 0.55

// The white player ball — reads ballPosRef directly (world coords).
export function PlayerBall({ ballPosRef, radius }) {
  const ref = useRef()
  useFrame(() => {
    if (!ref.current) return
    ref.current.position.copy(ballPosRef.current)
  })
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} />
    </mesh>
  )
}

// A GLB that fails to load must not take the round down with it — an aircraft
// is decoration, and the ball flies the same game.
class CraftErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}

function CraftModel({ ballPosRef, ballForwardRef, url }) {
  const { scene } = useGLTF(url)
  const groupRef = useRef()

  // Cloned, materials included, so the emissive lift below can't leak back into
  // the cached GLTF that Target, DPT and the hangar draw from.
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const lift = (mat) => {
        const m = mat.clone()
        m.emissive = new THREE.Color(CRAFT_EMISSIVE)
        m.emissiveIntensity = CRAFT_EMISSIVE_INTENSITY
        m.needsUpdate = true
        return m
      }
      o.material = Array.isArray(o.material) ? o.material.map(lift) : lift(o.material)
    })
    return clone
  }, [scene])

  // Scale so the longest dimension is CRAFT_SIZE, and sit the model on its own
  // centre — the GLBs are authored at wildly different scales and none of them
  // is centred on its origin.
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model)
    const dims = new THREE.Vector3()
    const centre = new THREE.Vector3()
    box.getSize(dims)
    box.getCenter(centre)
    const longest = Math.max(dims.x, dims.y, dims.z) || 1
    const scale = CRAFT_SIZE / longest
    return { scale, offset: [-centre.x * scale, -centre.y * scale, -centre.z * scale] }
  }, [model])

  // Scratch vectors, allocated once — this runs every frame.
  const aft = useRef(new THREE.Vector3()).current
  const right = useRef(new THREE.Vector3()).current
  const up = useRef(new THREE.Vector3()).current
  const side = useRef(new THREE.Vector3()).current
  const craftFwd = useRef(new THREE.Vector3()).current
  const craftUp = useRef(new THREE.Vector3()).current
  const wing = useRef(new THREE.Vector3()).current
  const prevFwd = useRef(new THREE.Vector3()).current
  const basis = useRef(new THREE.Matrix4()).current
  const worldUp = useRef(new THREE.Vector3(0, 1, 0)).current
  const attitude = useRef(createCraftAttitude()).current
  // First frame has no previous heading to measure a turn against.
  const seeded = useRef(false)

  useFrame((_, dt) => {
    const g = groupRef.current
    if (!g) return
    g.position.copy(ballPosRef.current)

    // Build the same frame ChaseCamera builds — world-Y up, then a right and an
    // up perpendicular to the heading — so the aircraft and the camera agree on
    // which way is up and the model never rolls independently of the view. The
    // forward-deviation cone in the game loop keeps the heading clear of the
    // vertical singularity this would otherwise have.
    const fwd = ballForwardRef.current
    right.crossVectors(fwd, worldUp).normalize()
    up.crossVectors(right, fwd).normalize()

    // How hard the heading is being pulled around, and therefore how the
    // aircraft should be sitting while it happens. Measured off the heading
    // rather than off the input, so every steering device banks the aircraft
    // without this knowing any of them exist. See actCraftAttitude.js.
    if (!seeded.current) { prevFwd.copy(fwd); seeded.current = true }
    const { yawRate, pitchRate } = turnRates(prevFwd, fwd, right, up, dt)
    prevFwd.copy(fwd)
    const { bank, aoa } = attitude.update(yawRate, pitchRate, dt)

    // Roll about the direction of flight, then lift the nose off the flight
    // path about the rolled wing line — in that order, so the bank carries the
    // pitch with it the way it would on a real aircraft.
    craftFwd.copy(fwd)
    craftUp.copy(up).applyAxisAngle(fwd, bank)
    wing.crossVectors(craftFwd, craftUp).normalize()
    if (aoa !== 0) {
      craftFwd.applyAxisAngle(wing, aoa)
      craftUp.applyAxisAngle(wing, aoa)
    }

    // The models are authored nose-along -X, so the basis X axis is the tail
    // direction; +Y is up and +Z completes it.
    aft.copy(craftFwd).multiplyScalar(-1)
    side.crossVectors(aft, craftUp)
    basis.makeBasis(aft, craftUp, side)
    g.quaternion.setFromRotationMatrix(basis)
  })

  return (
    <group ref={groupRef}>
      <group scale={fit.scale} position={fit.offset}>
        <primitive object={model} />
      </group>
    </group>
  )
}

export default function ActPlayerCraft({ ballPosRef, ballForwardRef, modelUrl, radius }) {
  const ball = <PlayerBall ballPosRef={ballPosRef} radius={radius} />
  if (!modelUrl) return ball
  return (
    <CraftErrorBoundary key={modelUrl} fallback={ball}>
      {/* The ball stands in while the GLB streams, so the player always has
          something to fly rather than an empty tunnel. */}
      <Suspense fallback={ball}>
        <CraftModel ballPosRef={ballPosRef} ballForwardRef={ballForwardRef} url={modelUrl} />
      </Suspense>
    </CraftErrorBoundary>
  )
}
