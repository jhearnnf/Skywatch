import { Component, Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { RING_COUNT, RING_RADIUS, BULLSEYE_RADIUS, worldY, makeRng } from '../../utils/cbat/instrumentsDrill'
import { TYPHOON_URL, HAWK_URL } from './OrientationAircraft3D'

// The practice drill's view out of the window: the player's aircraft from a
// chase camera, a ground grid far below, clouds to show height and speed, and
// the gates of the current course.
//
// Nothing here owns game state. Each frame calls `onFrame(dt)`, which steps
// the drill (see instrumentsDrill.js) and hands back what happened, then draws
// whatever `drillRef` now says. One loop, so the picture and the dials can
// never disagree.
//
// Two looks:
//   skywatch  the gamified one. Gates are the SkyWatch crosshair logo (the
//             inner circle is the bullseye), they burst when flown through,
//             speed streaks rush past, the aircraft has an afterburner and
//             wingtip trails, and the sky is a gradient dome. Any aircraft
//             from the picker.
//   cbat      plain, like the real test: grey-blue sky, white hoops with a
//             faint inner circle (the bullseye scores on both themes, since
//             both post to one board), and always the red Hawk.

const DEG = Math.PI / 180
const CRAFT_SIZE = 1.6
// Every aircraft GLB we ship is authored nose-along -X (see ActPlayerCraft).
const ALIGN_Y = -Math.PI / 2

const GRID_CELL = 40
const GRID_SIZE = 1600
const CLOUD_COUNT = 36
const CLOUD_FIELD = 700

// The crosshair logo is drawn on a 40-unit box: outer circle r17, inner r7,
// centre dot r2.5, and four ticks from r8 out to r19. Scaled so the outer
// circle is the gate.
const LOGO = RING_RADIUS / 17

const LOOKS = {
  skywatch: {
    sky: '#081a33',
    fogNear: 160,
    fogFar: 720,
    ground: '#06101e',
    gridMajor: '#2f6fb8',
    gridMinor: '#15335a',
    cloud: '#3d6ea8',
    cloudOpacity: 0.35,
    emissive: '#1d3d66',
  },
  cbat: {
    sky: '#8fb4d9',
    fogNear: 200,
    fogFar: 800,
    ground: '#55624a',
    gridMajor: '#6f7d63',
    gridMinor: '#5f6c55',
    cloud: '#ffffff',
    cloudOpacity: 0.7,
    ring: '#f2f2f2',
    ringNext: '#e0201f',
    emissive: '#200808',
  },
}

// Gate colours, from the logo: the deep blue ring, the light blue centre.
const GATE_OUTER = new THREE.Color('#3f8cff')
const GATE_INNER = new THREE.Color('#8cc8ff')
const GATE_NEXT = new THREE.Color('#ffd166')
const BURST_HIT = new THREE.Color('#5baaff')
const BURST_BULLSEYE = new THREE.Color('#ffd166')

// Where the aircraft is in the world, and which way it is pointing.
function placeCraft(obj, f) {
  obj.position.set(f.x, worldY(f.altitude), f.z)
  obj.rotation.set(f.pitchDeg * DEG, -f.headingDeg * DEG, -f.bankDeg * DEG, 'YXZ')
}

// A gate's orientation: it faces along the course (its normal is nx, nz).
const gateYaw = (nx, nz) => Math.atan2(nx, nz)

class ModelBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

// A plain dart, for while the GLB streams in or if it will not load.
function FallbackCraft({ colour }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.25, 1.6, 8]} />
        <meshStandardMaterial color={colour} />
      </mesh>
      <mesh position={[0, 0, 0.2]}>
        <boxGeometry args={[1.8, 0.06, 0.5]} />
        <meshStandardMaterial color={colour} />
      </mesh>
    </group>
  )
}

function CraftModel({ url, emissive, tint }) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const lift = (mat) => {
        const m = mat.clone()
        if (tint) { m.map = null; m.color = new THREE.Color(tint) }
        m.emissive = new THREE.Color(emissive)
        m.emissiveIntensity = 0.6
        return m
      }
      o.material = Array.isArray(o.material) ? o.material.map(lift) : lift(o.material)
    })
    return clone
  }, [scene, emissive, tint])
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model)
    const dims = new THREE.Vector3()
    const centre = new THREE.Vector3()
    box.getSize(dims)
    box.getCenter(centre)
    const scale = CRAFT_SIZE / (Math.max(dims.x, dims.y, dims.z) || 1)
    return { scale, offset: [-centre.x * scale, -centre.y * scale, -centre.z * scale] }
  }, [model])
  return (
    <group rotation={[0, ALIGN_Y, 0]}>
      <group scale={fit.scale} position={fit.offset}>
        <primitive object={model} />
      </group>
    </group>
  )
}

// The engine glow at the tail, brighter and longer with more throttle.
function Afterburner({ drillRef }) {
  const core = useRef()
  const flame = useRef()
  useFrame(({ clock }) => {
    const t = drillRef.current.flight.throttle
    const flicker = 0.9 + Math.sin(clock.elapsedTime * 43) * 0.06 + Math.sin(clock.elapsedTime * 71) * 0.04
    const len = (0.35 + t * 1.1) * flicker
    if (flame.current) {
      flame.current.scale.set(0.16 + t * 0.06, 0.16 + t * 0.06, len)
      flame.current.position.z = CRAFT_SIZE * 0.42 + len * 0.5
      flame.current.material.opacity = 0.35 + t * 0.45
    }
    if (core.current) core.current.material.opacity = 0.6 + t * 0.4
  })
  return (
    <group>
      <mesh ref={core} position={[0, 0, CRAFT_SIZE * 0.42]}>
        <sphereGeometry args={[0.11, 12, 10]} />
        <meshBasicMaterial color="#e8f4ff" transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={flame}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshBasicMaterial color="#5baaff" transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Craft({ drillRef, url, emissive, tint, fallbackColour, craftRef, gamified }) {
  useFrame(() => { if (craftRef.current) placeCraft(craftRef.current, drillRef.current.flight) })
  const fallback = <FallbackCraft colour={fallbackColour} />
  return (
    <group ref={craftRef}>
      <ModelBoundary key={url} fallback={fallback}>
        <Suspense fallback={fallback}>
          <CraftModel url={url} emissive={emissive} tint={tint} />
        </Suspense>
      </ModelBoundary>
      {gamified && <Afterburner drillRef={drillRef} />}
    </group>
  )
}

// Two fading ribbons off the wingtips. Each frame the tips' world positions
// are pushed onto the head of a fixed buffer; alpha falls off down the tail.
const TRAIL_POINTS = 48
const WINGTIPS = [new THREE.Vector3(-CRAFT_SIZE * 0.42, 0, CRAFT_SIZE * 0.2), new THREE.Vector3(CRAFT_SIZE * 0.42, 0, CRAFT_SIZE * 0.2)]

function WingTrails({ craftRef }) {
  const lines = useMemo(() => WINGTIPS.map(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(TRAIL_POINTS * 3)
    const col = new Float32Array(TRAIL_POINTS * 4)
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const a = (1 - i / TRAIL_POINTS) ** 1.6
      col.set([0.62, 0.82, 1, a * 0.85], i * 4)
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4))
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const line = new THREE.Line(geo, mat)
    line.frustumCulled = false
    return { line, pos, seeded: false }
  }), [])
  const tip = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const craft = craftRef.current
    if (!craft) return
    craft.updateMatrixWorld()
    lines.forEach((l, k) => {
      tip.copy(WINGTIPS[k]).applyMatrix4(craft.matrixWorld)
      if (!l.seeded) {
        for (let i = 0; i < TRAIL_POINTS; i++) l.pos.set([tip.x, tip.y, tip.z], i * 3)
        l.seeded = true
      } else {
        l.pos.copyWithin(3, 0, (TRAIL_POINTS - 1) * 3)
        l.pos.set([tip.x, tip.y, tip.z], 0)
      }
      l.line.geometry.attributes.position.needsUpdate = true
    })
  })
  return <>{lines.map((l, k) => <primitive key={k} object={l.line} />)}</>
}

// Behind and a little above, following heading and pitch but never the bank,
// so a bank shows as the aircraft rolling against a level horizon, the same
// picture the attitude indicator draws.
function ChaseCamera({ drillRef }) {
  const { camera } = useThree()
  const want = useRef(new THREE.Vector3()).current
  const look = useRef(new THREE.Vector3()).current
  const seeded = useRef(false)
  useFrame((_, dt) => {
    const f = drillRef.current.flight
    const h = f.headingDeg * DEG
    const p = f.pitchDeg * DEG
    const fx = Math.sin(h) * Math.cos(p)
    const fy = Math.sin(p)
    const fz = -Math.cos(h) * Math.cos(p)
    const y = worldY(f.altitude)
    want.set(f.x - fx * 7, y - fy * 7 + 1.8, f.z - fz * 7)
    look.set(f.x + fx * 12, y + fy * 12 + 0.6, f.z + fz * 12)
    if (!seeded.current) { camera.position.copy(want); seeded.current = true }
    camera.position.lerp(want, 1 - Math.exp(-dt * 8))
    camera.lookAt(look)
  })
  return null
}

// A gradient dome that rides with the camera: deep navy overhead, a lit band
// at the horizon. Drawn behind everything and ignored by the fog.
function SkyDome() {
  const ref = useRef()
  const material = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#020915') },
      horizon: { value: new THREE.Color('#1a4a86') },
      below: { value: new THREE.Color('#06101e') },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 below;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 2.2, 1.0), 0.7)) : mix(horizon, below, min(-h * 6.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }), [])
  useFrame(({ camera }) => { if (ref.current) ref.current.position.copy(camera.position) })
  return (
    <mesh ref={ref} renderOrder={-1} material={material}>
      <sphereGeometry args={[1000, 32, 16]} />
    </mesh>
  )
}

// A grid that follows the aircraft in whole cells, so it looks endless.
function Ground({ drillRef, look }) {
  const ref = useRef()
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(GRID_SIZE, GRID_SIZE / GRID_CELL, look.gridMajor, look.gridMinor)
    g.position.y = 0.05
    return g
  }, [look])
  useFrame(() => {
    const f = drillRef.current.flight
    if (!ref.current) return
    ref.current.position.x = Math.round(f.x / GRID_CELL) * GRID_CELL
    ref.current.position.z = Math.round(f.z / GRID_CELL) * GRID_CELL
  })
  return (
    <group ref={ref}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[GRID_SIZE * 2, GRID_SIZE * 2]} />
        <meshBasicMaterial color={look.ground} />
      </mesh>
      <primitive object={grid} />
    </group>
  )
}

// The same sky every run: fixed positions in a box that wraps round the aircraft.
const CLOUD_SEEDS = (() => {
  const r = makeRng(12345)
  return Array.from({ length: CLOUD_COUNT }, () => ({
    x: r() * CLOUD_FIELD, z: r() * CLOUD_FIELD, y: worldY(1500 + r() * 6500), s: 4 + r() * 8,
  }))
})()

const wrapAround = (v, centre, size) => {
  const half = size / 2
  return centre - half + ((((v - (centre - half)) % size) + size) % size)
}

// Clouds scattered through a box that wraps round the aircraft, at fixed
// heights, so climbing and descending move them past the window.
function Clouds({ drillRef, look }) {
  const ref = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const f = drillRef.current.flight
    CLOUD_SEEDS.forEach((c, i) => {
      dummy.position.set(wrapAround(c.x, f.x, CLOUD_FIELD), c.y, wrapAround(c.z, f.z, CLOUD_FIELD))
      dummy.scale.set(c.s * 1.8, c.s * 0.5, c.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[null, null, CLOUD_COUNT]}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshBasicMaterial color={look.cloud} transparent opacity={look.cloudOpacity} depthWrite={false} />
    </instancedMesh>
  )
}

// Thin streaks in a box round the aircraft, fixed in the world and wrapped, so
// they rush past at the aircraft's own speed. Longer and brighter when faster.
const STREAK_COUNT = 70
const STREAK_BOX = 44
const STREAK_SEEDS = (() => {
  const r = makeRng(987)
  return Array.from({ length: STREAK_COUNT }, () => ({ x: r() * STREAK_BOX, y: r() * STREAK_BOX, z: r() * STREAK_BOX }))
})()

function SpeedStreaks({ drillRef }) {
  const ref = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const f = drillRef.current.flight
    const y0 = worldY(f.altitude)
    const len = 0.6 + (f.speed / 340) * 3.2
    STREAK_SEEDS.forEach((s, i) => {
      dummy.position.set(wrapAround(s.x, f.x, STREAK_BOX), wrapAround(s.y, y0, STREAK_BOX), wrapAround(s.z, f.z, STREAK_BOX))
      dummy.rotation.set(f.pitchDeg * DEG, -f.headingDeg * DEG, 0, 'YXZ')
      dummy.scale.set(1, 1, len)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.material.opacity = 0.12 + (f.speed / 340) * 0.3
  })
  return (
    <instancedMesh ref={ref} args={[null, null, STREAK_COUNT]} frustumCulled={false}>
      <boxGeometry args={[0.025, 0.025, 1]} />
      <meshBasicMaterial color="#9fd0ff" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  )
}

// ── Gates ────────────────────────────────────────────────────────────────────

const TICK_LEN = (19 - 8) * LOGO
const TICK_MID = ((19 + 8) / 2) * LOGO
const TICKS = [[0, 1], [0, -1], [1, 0], [-1, 0]]

// One crosshair-logo gate. Its materials are its own, so each slot can fade
// and light independently.
function CrosshairGate({ gateRef, mats }) {
  return (
    <group ref={gateRef} visible={false}>
      <mesh material={mats.outer}>
        <torusGeometry args={[RING_RADIUS, 0.15, 12, 56]} />
      </mesh>
      {TICKS.map(([x, y], i) => (
        <mesh key={i} material={mats.outer} position={[x * TICK_MID, y * TICK_MID, 0]}>
          <boxGeometry args={x ? [TICK_LEN, 0.16, 0.16] : [0.16, TICK_LEN, 0.16]} />
        </mesh>
      ))}
      <mesh material={mats.inner}>
        <torusGeometry args={[BULLSEYE_RADIUS, 0.08, 10, 40]} />
      </mesh>
      <mesh material={mats.dot}>
        <sphereGeometry args={[2.5 * LOGO, 12, 10]} />
      </mesh>
    </group>
  )
}

const glow = (color) => new THREE.MeshBasicMaterial({
  color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
})

function CrosshairGates({ drillRef }) {
  const refs = useRef([])
  const slots = useMemo(() => Array.from({ length: RING_COUNT }, () => ({
    outer: glow(GATE_OUTER), inner: glow(GATE_INNER), dot: glow(GATE_INNER),
  })), [])
  useFrame(({ clock }) => {
    const rings = drillRef.current.rings
    const nextIdx = rings.findIndex(r => r.state === 'open')
    const t = clock.elapsedTime
    for (let i = 0; i < RING_COUNT; i++) {
      const g = refs.current[i]
      if (!g) continue
      const ring = rings[i]
      if (!ring || ring.state !== 'open') { g.visible = false; continue }
      g.visible = true
      g.position.set(ring.x, ring.y, ring.z)
      const isNext = i === nextIdx
      // The next gate turns slowly and breathes, so it reads as the target.
      g.rotation.set(0, gateYaw(ring.nx, ring.nz), isNext ? t * 0.8 : Math.PI / 4)
      const pulse = isNext ? 1 + Math.sin(t * 5) * 0.04 : 1
      g.scale.setScalar(pulse)
      // Through the meshes: children are the hoop, four ticks (sharing the
      // hoop's material), the inner circle and the dot. See CrosshairGate.
      const [hoop, , , , , inner, dot] = g.children
      hoop.material.color.copy(isNext ? GATE_NEXT : GATE_OUTER)
      hoop.material.opacity = isNext ? 1 : 0.4
      inner.material.opacity = isNext ? 0.95 : 0.3
      dot.material.opacity = isNext ? 0.7 : 0.2
    }
  })
  return (
    <>
      {slots.map((mats, i) => (
        <CrosshairGate key={i} mats={mats} gateRef={el => { refs.current[i] = el }} />
      ))}
    </>
  )
}

// A gate flown through leaves a ring that swells and fades: blue for a hit,
// gold for a bullseye. A small pool, reused round-robin.
const BURST_POOL = 4
const BURST_S = 0.55

function GateBursts({ eventsRef }) {
  const refs = useRef([])
  const state = useRef(Array.from({ length: BURST_POOL }, () => ({ start: -1 }))).current
  const next = useRef(0)
  const mats = useMemo(() => Array.from({ length: BURST_POOL }, () => glow(BURST_HIT)), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const queue = eventsRef.current
    while (queue.length) {
      const e = queue.shift()
      if (e.type !== 'ring' || e.result === 'missed') continue
      const k = next.current
      next.current = (k + 1) % BURST_POOL
      state[k] = { start: t, ...e }
      refs.current[k]?.material.color.copy(e.result === 'bullseye' ? BURST_BULLSEYE : BURST_HIT)
    }
    for (let k = 0; k < BURST_POOL; k++) {
      const m = refs.current[k]
      if (!m) continue
      const age = t - state[k].start
      if (state[k].start < 0 || age > BURST_S) { m.visible = false; continue }
      const u = age / BURST_S
      m.visible = true
      m.position.set(state[k].x, state[k].y, state[k].z)
      m.rotation.set(0, gateYaw(state[k].nx, state[k].nz), 0)
      m.scale.setScalar(1 + u * 1.6)
      m.material.opacity = (1 - u) ** 2
    }
  })
  return (
    <>
      {mats.map((mat, k) => (
        <mesh key={k} ref={el => { refs.current[k] = el }} material={mat} visible={false}>
          <torusGeometry args={[RING_RADIUS, 0.22, 10, 48]} />
        </mesh>
      ))}
    </>
  )
}

// The Real CBAT theme's plain hoops, with a faint inner circle for the
// bullseye that scores on both themes.
function PlainRings({ drillRef, look }) {
  const refs = useRef([])
  const next = useMemo(() => new THREE.Color(look.ringNext), [look])
  const idle = useMemo(() => new THREE.Color(look.ring), [look])
  useFrame(() => {
    const rings = drillRef.current.rings
    const nextIdx = rings.findIndex(r => r.state === 'open')
    for (let i = 0; i < RING_COUNT; i++) {
      const g = refs.current[i]
      if (!g) continue
      const ring = rings[i]
      if (!ring || ring.state !== 'open') { g.visible = false; continue }
      g.visible = true
      g.position.set(ring.x, ring.y, ring.z)
      g.rotation.set(0, gateYaw(ring.nx, ring.nz), 0)
      const isNext = i === nextIdx
      g.children.forEach((m, j) => {
        m.material.color.copy(isNext ? next : idle)
        m.material.opacity = (isNext ? 1 : 0.45) * (j === 0 ? 1 : 0.5)
      })
    }
  })
  return (
    <>
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <group key={i} ref={el => { refs.current[i] = el }} visible={false}>
          <mesh>
            <torusGeometry args={[RING_RADIUS, 0.16, 10, 40]} />
            <meshBasicMaterial transparent color={look.ring} fog={false} />
          </mesh>
          <mesh>
            <torusGeometry args={[BULLSEYE_RADIUS, 0.05, 8, 32]} />
            <meshBasicMaterial transparent color={look.ring} fog={false} />
          </mesh>
        </group>
      ))}
    </>
  )
}

// Steps the drill first, so everything after it draws this frame's state, and
// queues what happened for the effects that react to it. Only when there are
// effects to drain the queue (`collect`), or it would grow for the whole run.
function Stepper({ onFrame, eventsRef, collect }) {
  useFrame((_, dt) => {
    const events = onFrame(dt)
    if (collect && events && events.length) eventsRef.current.push(...events)
  })
  return null
}

export default function InstrumentsDrillScene({ drillRef, onFrame, realCbat = false, craftUrl = TYPHOON_URL }) {
  const look = realCbat ? LOOKS.cbat : LOOKS.skywatch
  const craftRef = useRef()
  const eventsRef = useRef([])
  return (
    <Canvas
      camera={{ fov: 60, near: 0.1, far: 2200, position: [0, worldY(3000) + 2, 8] }}
      dpr={[1, 2]}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[look.sky]} />
      <fog attach="fog" args={[look.sky, look.fogNear, look.fogFar]} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#cfe4ff', '#1b2a3c', 0.9]} />
      <directionalLight position={[-20, 40, 20]} intensity={2.2} />
      <Stepper onFrame={onFrame} eventsRef={eventsRef} collect={!realCbat} />
      {!realCbat && <SkyDome />}
      <Ground drillRef={drillRef} look={look} />
      <Clouds drillRef={drillRef} look={look} />
      {realCbat
        ? <PlainRings drillRef={drillRef} look={look} />
        : (
          <>
            <CrosshairGates drillRef={drillRef} />
            <GateBursts eventsRef={eventsRef} />
            <SpeedStreaks drillRef={drillRef} />
            <WingTrails craftRef={craftRef} />
          </>
        )}
      <Craft
        drillRef={drillRef}
        craftRef={craftRef}
        url={realCbat ? HAWK_URL : craftUrl}
        emissive={look.emissive}
        tint={realCbat ? '#e0201f' : null}
        fallbackColour={realCbat ? '#e0201f' : '#ffd166'}
        gamified={!realCbat}
      />
      <ChaseCamera drillRef={drillRef} />
    </Canvas>
  )
}
