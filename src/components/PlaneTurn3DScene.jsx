import { useRef, useEffect, Suspense, Component, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const GRID = 10
const LAYERS = 10

function toWorld(r, c, layer) {
  return [c - 4.5, layer, r - 4.5]
}

const DIR_VECS = [
  { dr: -1, dc: 0 },
  { dr: 0,  dc: 1 },
  { dr: 1,  dc: 0 },
  { dr: 0,  dc: -1 },
]

// Aircraft local nose direction (matches CbatPlaneTurn's MODEL_NOSE).
const MODEL_NOSE = new THREE.Vector3(-1, 0, 0)

// Soft arena bounds for smooth flight — match the schedule generator's
// 1-cell margin (world ±3.5, layer 1–8) so the plane visibly stays away
// from the wireframe walls.
const ARENA_HALF  = GRID / 2 - 1.5
const ARENA_FLOOR = 1
const ARENA_CEIL  = LAYERS - 2

class ErrorCatcher extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch() { this.props.onError?.() }
  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

function AircraftModel3D({ url, quat, onReady }) {
  const { scene } = useGLTF(url)
  // Clone once — re-cloning every render resets rotation and causes spinning
  const clonedScene = useMemo(() => scene.clone(), [scene])
  const meshRef = useRef()
  // Target quaternion comes from the parent. Each user input multiplies it by a
  // model-local 90° rotation, so consecutive targets always differ by a single
  // 90° rotation around one world axis. Slerp follows that axis cleanly.
  const targetQuatRef  = useRef(new THREE.Quaternion())
  const currentQuatRef = useRef(new THREE.Quaternion())
  const _initialised   = useRef(false)

  useEffect(() => { onReady?.() }, [onReady])

  useEffect(() => {
    if (!quat || quat.length < 4) return
    targetQuatRef.current.set(quat[0], quat[1], quat[2], quat[3])
    if (!_initialised.current) {
      currentQuatRef.current.copy(targetQuatRef.current)
      _initialised.current = true
    }
  }, [quat])

  useFrame(() => {
    if (!meshRef.current) return
    currentQuatRef.current.slerp(targetQuatRef.current, 0.18)
    meshRef.current.quaternion.copy(currentQuatRef.current)
  })

  return <primitive ref={meshRef} object={clonedScene} scale={[0.7, 0.7, 0.7]} />
}

// Marks the aircraft the player is currently being scored on. Billboarded to
// the camera so it always reads as a flat ring, and drawn with depthTest off so
// it stays visible when another jet crosses in front.
//
// White rather than the jet's own tint: the ring is a cursor, not a label, so it
// has to stay legible over every airframe colour and against the bright sky.
function SelectionRing() {
  const ringRef = useRef()
  const { camera } = useThree()
  useFrame(({ clock }) => {
    if (!ringRef.current) return
    ringRef.current.quaternion.copy(camera.quaternion)
    ringRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.08)
  })
  return (
    <mesh ref={ringRef} renderOrder={10}>
      <ringGeometry args={[0.86, 0.92, 64]} />
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.95}
        side={THREE.DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}

// Dollies the camera between framings without remounting the Canvas (the
// `camera` prop is only read at creation). Lerped so the pull-back when extra
// aircraft join reads as a smooth dolly rather than a cut.
function CameraRig({ z, fov, lookY }) {
  // The camera comes off the per-frame state rather than useThree() so it stays
  // a plain callback argument — the same shape as the Canvas onCreated handler.
  // useFrame re-subscribes when the callback identity changes, so the closure
  // always sees the current target without stashing it in a ref.
  useFrame(({ camera }) => {
    const dz = z   - camera.position.z
    const df = fov - camera.fov
    if (Math.abs(dz) < 0.005 && Math.abs(df) < 0.02) return
    camera.position.z += dz * 0.06
    camera.fov        += df * 0.06
    camera.updateProjectionMatrix()
    camera.lookAt(0, lookY, 0)
  })
  return null
}

// Smooth-flight aircraft used by Trace 1: position integrates each frame so
// the plane visibly flies between rotation events instead of teleporting
// grid-cell to grid-cell. Rotation still slerps to the target quaternion.
//
// `hex` tints the airframe so multiple jets can be told apart (null = the
// model's own livery, used for the single-aircraft rounds). `startWorld` is the
// spawn point, which must match the schedule generator's start slot so the
// planner's bounds projections and the visible position stay aligned.
function SmoothFlightAircraft({ url, quat, hex, startWorld, selected, speed, active, resetKey, onReady }) {
  const { scene } = useGLTF(url)
  const clonedScene = useMemo(() => {
    const c = scene.clone(true)
    if (!hex) return c
    const tint = new THREE.Color(hex)
    c.traverse(o => {
      if (!o.isMesh || !o.material) return
      const applyTo = (mat) => {
        const m = mat.clone()
        m.color = tint.clone()
        m.emissive = tint.clone().multiplyScalar(0.4)
        m.emissiveIntensity = 0.6
        m.metalness = 0.1
        m.roughness = 0.55
        m.map = null
        m.needsUpdate = true
        return m
      }
      o.material = Array.isArray(o.material) ? o.material.map(applyTo) : applyTo(o.material)
    })
    return c
  }, [scene, hex])

  const meshRef     = useRef()
  const groupRef    = useRef()
  const targetQuat  = useRef(new THREE.Quaternion())
  const currentQuat = useRef(new THREE.Quaternion())
  const spawn       = startWorld || [0.5, 5, 0.5]
  const worldPos    = useRef(new THREE.Vector3(spawn[0], spawn[1], spawn[2]))
  const forwardTmp  = useRef(new THREE.Vector3())
  const initialised = useRef(false)
  const lastReset   = useRef(resetKey)

  useEffect(() => { onReady?.() }, [onReady])

  useEffect(() => {
    if (resetKey !== lastReset.current) {
      worldPos.current.set(spawn[0], spawn[1], spawn[2])
      lastReset.current = resetKey
    }
  }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quat || quat.length < 4) return
    targetQuat.current.set(quat[0], quat[1], quat[2], quat[3])
    if (!initialised.current) {
      currentQuat.current.copy(targetQuat.current)
      initialised.current = true
    }
  }, [quat])

  useFrame((_, dt) => {
    if (!meshRef.current || !groupRef.current) return
    // Slerp rotation — slightly faster than the legacy 0.18-per-frame so the
    // turn reads clearly within the smaller per-tick window at higher rounds.
    currentQuat.current.slerp(targetQuat.current, Math.min(0.3, dt * 9))
    meshRef.current.quaternion.copy(currentQuat.current)

    if (!active || !speed) {
      groupRef.current.position.copy(worldPos.current)
      return
    }

    // Advance position along the current (slerped) forward direction.
    forwardTmp.current.copy(MODEL_NOSE).applyQuaternion(currentQuat.current)
    forwardTmp.current.multiplyScalar(speed * dt)
    worldPos.current.add(forwardTmp.current)

    // Soft-clamp to arena bounds so the model never punches through the wall.
    if (worldPos.current.x >  ARENA_HALF)  worldPos.current.x =  ARENA_HALF
    if (worldPos.current.x < -ARENA_HALF)  worldPos.current.x = -ARENA_HALF
    if (worldPos.current.z >  ARENA_HALF)  worldPos.current.z =  ARENA_HALF
    if (worldPos.current.z < -ARENA_HALF)  worldPos.current.z = -ARENA_HALF
    if (worldPos.current.y > ARENA_CEIL)   worldPos.current.y = ARENA_CEIL
    if (worldPos.current.y < ARENA_FLOOR)  worldPos.current.y = ARENA_FLOOR

    groupRef.current.position.copy(worldPos.current)
  })

  return (
    <group ref={groupRef}>
      <primitive ref={meshRef} object={clonedScene} scale={[1.05, 1.05, 1.05]} />
      {selected && <SelectionRing />}
    </group>
  )
}

function ArenaWireframe() {
  const geom = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(GRID, LAYERS, GRID)),
    []
  )
  return (
    <lineSegments position={[0, LAYERS / 2 - 0.5, 0]} geometry={geom}>
      <lineBasicMaterial color="#1a3a5c" transparent opacity={0.55} />
    </lineSegments>
  )
}

function CarePackage({ r, c, layer }) {
  const meshRef = useRef()
  const [x, y, z] = toWorld(r, c, layer)
  useFrame((_, dt) => { if (meshRef.current) meshRef.current.rotation.y += dt * 1.5 })
  return (
    <group position={[x, y, z]}>
      <mesh ref={meshRef}>
        <boxGeometry args={[0.38, 0.38, 0.38]} />
        <meshStandardMaterial color="#ffcc44" emissive="#ffcc44" emissiveIntensity={0.5} />
      </mesh>
      <pointLight intensity={0.9} color="#ffcc44" distance={3} />
    </group>
  )
}

// Subtle wireframe grid perpendicular to the movement axis, at the aircraft's
// next grid position. Green when the next move stays in bounds, red when it
// would hit the wall. Helps the player perceive depth/position before each tick.
function NextPosPlane({ position, axis, inBounds }) {
  let rotation = [0, 0, 0]
  if (axis === 'x')      rotation = [0, Math.PI / 2, 0]
  else if (axis === 'y') rotation = [Math.PI / 2, 0, 0]
  const color = inBounds ? '#4ade80' : '#ef4444'
  const geom = useMemo(() => {
    const positions = []
    const half = GRID / 2
    for (let i = 0; i <= GRID; i++) {
      const t = i - half
      // horizontal line
      positions.push(-half, t, 0, half, t, 0)
      // vertical line
      positions.push(t, -half, 0, t, half, 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return g
  }, [])
  return (
    <lineSegments position={position} rotation={rotation} geometry={geom}>
      <lineBasicMaterial color={color} transparent opacity={0.25} depthWrite={false} />
    </lineSegments>
  )
}

export default function PlaneTurn3DScene({
  plane, pkg, modelUrl, onError, onReady,
  // Trace 1 smooth-flight overrides — when traceFlight is true, the aircraft
  // integrate position continuously inside the scene rather than snapping to
  // grid cells. NextPosPlane (a discrete-grid concept) is suppressed.
  traceFlight = false,
  // [{ id, hex, quat, startWorld }] — one entry per aircraft on screen.
  traceAircraft = [],
  // Index into traceAircraft of the jet the player is being scored on.
  traceSelected = 0,
  traceFlightSpeed = 0,
  traceFlightActive = false,
  traceFlightResetKey = 0,
}) {
  const [px, py, pz] = toWorld(plane.r, plane.c, plane.layer)

  // Movement direction (decoupled from visual pitch):
  //   0 = forward per yaw | 1 = vertical up | 2 = backward | 3 = vertical down
  const mm = plane.moveMode ?? 0
  let nextR, nextC, nextLayer
  if (mm === 1) {
    nextR = plane.r; nextC = plane.c; nextLayer = plane.layer + 1
  } else if (mm === 3) {
    nextR = plane.r; nextC = plane.c; nextLayer = plane.layer - 1
  } else {
    const sign = mm === 2 ? -1 : 1
    const { dr, dc } = DIR_VECS[plane.dir]
    nextR     = plane.r + dr * sign
    nextC     = plane.c + dc * sign
    nextLayer = plane.layer
  }
  // Arena centre Y = (LAYERS - 1) / 2
  const arenaY = (LAYERS - 1) / 2

  // Next-position highlight plane: perpendicular to whichever axis the aircraft
  // is moving along, positioned at the next grid value. Capped at the wall when
  // the next position would be out of bounds.
  let nextAxis, nextPlanePos, nextPlaneInBounds
  if (mm === 1 || mm === 3) {
    nextAxis = 'y'
    nextPlaneInBounds = nextLayer >= 0 && nextLayer < LAYERS
    const yPos = nextPlaneInBounds ? nextLayer : (nextLayer < 0 ? -0.5 : LAYERS - 0.5)
    nextPlanePos = [0, yPos, 0]
  } else if (plane.dir === 0 || plane.dir === 2) {
    nextAxis = 'z'
    nextPlaneInBounds = nextR >= 0 && nextR < GRID
    const zPos = nextPlaneInBounds ? (nextR - 4.5) : (nextR < 0 ? -GRID / 2 : GRID / 2)
    nextPlanePos = [0, arenaY, zPos]
  } else {
    nextAxis = 'x'
    nextPlaneInBounds = nextC >= 0 && nextC < GRID
    const xPos = nextPlaneInBounds ? (nextC - 4.5) : (nextC < 0 ? -GRID / 2 : GRID / 2)
    nextPlanePos = [xPos, arenaY, 0]
  }

  // Trace mode dollies the camera in and narrows the FOV slightly so the
  // Hawk T2 reads as a larger, more cinematic subject. Practise keeps the
  // legacy framing so existing scores stay comparable.
  //
  // Constraint: the plane's smooth-flight range is world ±2.9 on x/z and
  // y ∈ [1.6, 7.4] (margin=2 plus ~0.4 cells of slerp drift). With camera at
  // (0, 4.5, camera_z) and a vertical FOV, the worst-case visible half-width
  // at the plane's closest z (+2.9) is (camera_z - 2.9) * tan(fov/2).
  // We need that ≥ 2.9 with at least ~0.8 cells of margin so the plane
  // never clips at the corners. z=10 + fov=55 → (10-2.9)*tan(27.5°)=3.70 →
  // 0.80 of safe margin. Plane appears ~33% larger than the legacy framing.
  //
  // Multiple aircraft spread to the full soft-clamp box (x/z ±3.5, y 1–8), so
  // the tight single-jet framing would crop the corners. Pulling back to z=12.5
  // gives (12.5-3.5)*tan(27.5°)=4.69 — comfortably past the 3.5 needed. The
  // dolly between the two framings is lerped by <CameraRig>.
  const multiPlane = traceFlight && traceAircraft.length > 1
  const traceCamZ  = multiPlane ? 12.5 : 10
  const cameraPos = traceFlight ? [0, arenaY, traceCamZ] : [0, arenaY, 12]
  const cameraFov = traceFlight ? 55 : 60

  return (
    <Canvas
      camera={{ position: cameraPos, fov: cameraFov, near: 0.1, far: 100 }}
      gl={{ alpha: true, antialias: true }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      onCreated={({ camera }) => camera.lookAt(0, arenaY, 0)}
    >
      {/* Trace 1+ uses a brighter sky-toned lighting; Practise keeps the
          legacy electric-blue point light against the dark grid. */}
      <ambientLight intensity={traceFlight ? 2.2 : 1.5} />
      <directionalLight position={[5, 8, 10]} intensity={traceFlight ? 2.4 : 2} color={traceFlight ? '#fff7e6' : '#ffffff'} />
      {!traceFlight && <pointLight position={[0, arenaY, 6]} intensity={1} color="#5baaff" />}
      {traceFlight && <hemisphereLight args={['#bfe3ff', '#3a7bbf', 0.9]} />}

      {/* Wireframe arena + grids only in Practise mode — Trace flies through
          an open sky, so the cage is hidden and the package never renders. */}
      {!traceFlight && (
        <>
          <ArenaWireframe />
          <gridHelper args={[GRID, GRID, '#13294a', '#0f2440']} position={[0, -0.5, 0]} />
          <gridHelper
            args={[GRID, GRID, '#13294a', '#0f2440']}
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, arenaY, -GRID / 2]}
          />
          <CarePackage r={pkg.r} c={pkg.c} layer={pkg.layer} />
          <NextPosPlane position={nextPlanePos} axis={nextAxis} inBounds={nextPlaneInBounds} />
        </>
      )}

      {traceFlight && <CameraRig z={traceCamZ} fov={cameraFov} lookY={arenaY} />}

      {modelUrl && (
        traceFlight ? (
          traceAircraft.map((a, idx) => (
            <Suspense key={`${modelUrl}-${a.id}`} fallback={null}>
              <ErrorCatcher onError={onError}>
                <SmoothFlightAircraft
                  url={modelUrl}
                  quat={a.quat}
                  hex={a.hex}
                  startWorld={a.startWorld}
                  // A lone aircraft is implicitly the tracked one — no ring.
                  selected={multiPlane && idx === traceSelected}
                  speed={traceFlightSpeed}
                  active={traceFlightActive}
                  resetKey={traceFlightResetKey}
                  onReady={idx === 0 ? onReady : undefined}
                />
              </ErrorCatcher>
            </Suspense>
          ))
        ) : (
          <group position={[px, py, pz]}>
            <Suspense fallback={null}>
              <ErrorCatcher onError={onError}>
                <AircraftModel3D
                  key={modelUrl}
                  url={modelUrl}
                  quat={plane.quat}
                  onReady={onReady}
                />
              </ErrorCatcher>
            </Suspense>
          </group>
        )
      )}
    </Canvas>
  )
}
