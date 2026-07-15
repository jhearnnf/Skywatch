import { useRef, useMemo, useEffect, Suspense, Component } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import { TRACE2_TURN_DEFS } from '../utils/cbat/trace2Generator'

// Trace 2 scene: four colour-tinted Hawk T2 aircraft, each flown with the EXACT
// same motion model as Trace 1's SmoothFlightAircraft — continuous flight along
// the nose with smooth quaternion banking. Each plane records its flight during
// the watch phase so the round can be replayed: rewound fast, then played back
// at normal speed (driven by <ReplayDriver> via a shared scrub ref).

const ARENA_Y = 4.5
const REWIND_SPEED = 5            // rewind runs 5× faster than real time

const MODEL_UP    = new THREE.Vector3(0, 1, 0)
const MODEL_RIGHT = new THREE.Vector3(0, 0, -1)
const MODEL_NOSE  = new THREE.Vector3(-1, 0, 0)
const AXIS = { up: MODEL_UP, right: MODEL_RIGHT }
const CAM_Z = 10
const HALF_TAN = Math.tan((55 / 2) * Math.PI / 180)

// Live per-aircraft replay counters — each a function of the scrub time `t`, so
// they count up during forward playback and down while rewinding.
function turnsUpTo(turns, t) { let n = 0; for (const tr of turns) if (tr.tMs <= t) n++; return n }
function turnsLRUpTo(turns, t) {
  let r = 0, l = 0
  for (const tr of turns) if (tr.tMs <= t) { if (tr.turnKey === 'yawR') r++; else if (tr.turnKey === 'yawL') l++ }
  return [r, l]
}
// How much the plane has CLIMBED, shown as a plausible height in feet. Under the
// hood it's the largest rise above an earlier low point (running-minimum
// draw-up) as a fraction of the half-screen at entry depth — mirroring the
// generator's `climbGain`, so the counter agrees with the "climbed the most /
// did not climb" answers. It rises whenever the plane gains altitude (even after
// a dive) and is 0 only if it never climbed at all. Scaled: a full half-screen
// climb ≈ 10,000 ft.
const CLIMB_FT_PER_UNIT = 10000     // feet per 1.0 of normalised climb-gain
function climbFtUpTo(rec, t) {
  let started = false, entryHalf = 1, minY = Infinity, mx = 0
  for (const s of rec) {
    if (s.t > t) break
    const half = HALF_TAN * (CAM_Z - s.p[2])
    const onScreen = Math.abs((s.p[1] - ARENA_Y) / half) < 1
    if (!started) { if (onScreen) { started = true; entryHalf = half } else continue }
    if (s.p[1] < minY) minY = s.p[1]
    const gain = (s.p[1] - minY) / entryHalf
    if (gain > mx) mx = gain
  }
  return Math.round(Math.max(0, mx) * CLIMB_FT_PER_UNIT / 100) * 100   // nearest 100 ft
}
function invertedSecUpTo(rec, t) {
  let ms = 0
  for (let i = 1; i < rec.length; i++) { if (rec[i].t > t) break; if (rec[i].inv) ms += rec[i].t - rec[i - 1].t }
  return ms / 1000
}
// Right / left turns get their own colours so the two tallies are easy to tell
// apart at a glance (R cyan, L amber).
const TURN_R_COLOR = '#38bdf8'
const TURN_L_COLOR = '#fbbf24'

function counterText(kind, spec, rec, t) {
  if (kind === 'turns')    return '↻ ' + turnsUpTo(spec.turns, t)
  if (kind === 'turnsLR')  { const [r, l] = turnsLRUpTo(spec.turns, t); return `R ${r}  L ${l}` }
  if (kind === 'height')   return '↑ ' + climbFtUpTo(rec, t).toLocaleString('en-US') + ' ft'
  if (kind === 'inverted') return '⟲ ' + invertedSecUpTo(rec, t).toFixed(1) + 's'
  return ''
}

// Writes the live counter into the label element. Most counters are a single
// colour (textContent), but the R/L turn tally colours each side separately.
function writeCounter(el, kind, spec, rec, t) {
  if (kind === 'turnsLR') {
    const [r, l] = turnsLRUpTo(spec.turns, t)
    el.innerHTML =
      `<span style="color:${TURN_R_COLOR}">R ${r}</span>` +
      '<span style="color:#64748b">&nbsp;&nbsp;</span>' +
      `<span style="color:${TURN_L_COLOR}">L ${l}</span>`
  } else {
    el.textContent = counterText(kind, spec, rec, t)
  }
}

class ErrorCatcher extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch() { this.props.onError?.() }
  render() { return this.state.hasError ? null : this.props.children }
}

function Trace2Aircraft({ url, hex, spec, active, replaying, replayStat, scrubRef, roundKey, onReady }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => {
    const c = scene.clone(true)
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

  const groupRef   = useRef()
  const meshRef    = useRef()
  const targetQuat = useRef(new THREE.Quaternion())
  const curQuat    = useRef(new THREE.Quaternion())
  const worldPos   = useRef(new THREE.Vector3())
  const fwdTmp     = useRef(new THREE.Vector3())
  const localTmp   = useRef(new THREE.Quaternion())
  const qa         = useRef(new THREE.Quaternion())
  const qb         = useRef(new THREE.Quaternion())
  const elapsed    = useRef(0)
  const turnIdx    = useRef(0)
  const rec        = useRef([])            // recorded flight for replay: {t, p[3], q[4], inv}
  const invTmp     = useRef(new THREE.Vector3())
  const labelRef   = useRef()
  const lastRound  = useRef(null)

  useEffect(() => { onReady?.() }, [onReady])

  const reset = () => {
    const q = spec.initialQuat
    targetQuat.current.set(q[0], q[1], q[2], q[3])
    curQuat.current.copy(targetQuat.current)
    worldPos.current.set(spec.startPos[0], spec.startPos[1], spec.startPos[2])
    elapsed.current = 0
    turnIdx.current = 0
    rec.current = []
  }
  useEffect(() => { reset(); lastRound.current = roundKey }, [spec]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (roundKey !== lastRound.current) { reset(); lastRound.current = roundKey } }, [roundKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    if (!groupRef.current || !meshRef.current) return

    // ── Replay: drive straight from the recording at the scrub time ──
    if (replaying) {
      const r = rec.current
      if (!r.length) { groupRef.current.visible = false; return }
      const t = Math.max(r[0].t, Math.min(r[r.length - 1].t, scrubRef.current.t))
      let lo = 0, hi = r.length - 1
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r[mid].t <= t) lo = mid; else hi = mid }
      const a = r[lo], b = r[hi]
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
      groupRef.current.visible = true
      groupRef.current.position.set(
        a.p[0] + (b.p[0] - a.p[0]) * u,
        a.p[1] + (b.p[1] - a.p[1]) * u,
        a.p[2] + (b.p[2] - a.p[2]) * u,
      )
      qa.current.set(a.q[0], a.q[1], a.q[2], a.q[3])
      qb.current.set(b.q[0], b.q[1], b.q[2], b.q[3])
      qa.current.slerp(qb.current, u)
      meshRef.current.quaternion.copy(qa.current)
      if (replayStat && labelRef.current) writeCounter(labelRef.current, replayStat, spec, r, t)
      return
    }

    groupRef.current.visible = true
    if (active) elapsed.current += dt * 1000
    const flying = elapsed.current >= (spec.startDelayMs || 0)

    // Apply scheduled turns whose time has passed (updates the TARGET; the mesh
    // slerps toward it, exactly like Trace 1).
    const turns = spec.turns
    while (flying && turnIdx.current < turns.length && elapsed.current >= turns[turnIdx.current].tMs) {
      const def = TRACE2_TURN_DEFS[turns[turnIdx.current].turnKey]
      localTmp.current.setFromAxisAngle(AXIS[def.axis], def.angle)
      targetQuat.current.multiply(localTmp.current).normalize()
      turnIdx.current++
    }

    curQuat.current.slerp(targetQuat.current, Math.min(0.3, dt * 9))
    meshRef.current.quaternion.copy(curQuat.current)

    if (active && flying) {
      fwdTmp.current.copy(MODEL_NOSE).applyQuaternion(curQuat.current).multiplyScalar(spec.speed * dt)
      worldPos.current.add(fwdTmp.current)
    }
    groupRef.current.position.copy(worldPos.current)

    // Record the played flight (only during the live watch) for replay.
    if (active) {
      const p = worldPos.current, q = curQuat.current
      invTmp.current.copy(MODEL_UP).applyQuaternion(q)
      rec.current.push({ t: elapsed.current, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], inv: invTmp.current.y < -0.2 })
    }
  })

  return (
    <group ref={groupRef}>
      <primitive ref={meshRef} object={cloned} scale={[0.7, 0.7, 0.7]} />
      {replaying && replayStat && (
        <Html position={[0, 0.65, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <span
            ref={labelRef}
            style={{
              display: 'inline-block', whiteSpace: 'nowrap',
              background: 'rgba(6,16,26,0.86)', border: `1.5px solid ${hex}`, color: '#fff',
              padding: '1px 7px', borderRadius: '8px', fontSize: '12px', fontWeight: 800,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.02em',
              boxShadow: '0 1px 5px rgba(0,0,0,0.45)',
            }}
          />
        </Html>
      )}
    </group>
  )
}

// Drives the shared scrub ref during a replay: rewind (fast, backwards) then
// forward (normal speed). Reports stage changes so the UI can label it.
function ReplayDriver({ replaying, replayKey, durationMs, scrubRef, onStage, onDone }) {
  const startedKey = useRef(null)
  const localMs = useRef(0)
  const stage = useRef('idle')
  const rewindFrom = useRef(0)
  useFrame((_, dt) => {
    if (!replaying) { scrubRef.current.t = 0; startedKey.current = replayKey; stage.current = 'idle'; return }
    if (startedKey.current !== replayKey) {
      startedKey.current = replayKey; localMs.current = 0
      // Rewind from where the aircraft currently are: the end of the round on
      // the first replay (jets are frozen there), or the live scrub position
      // when restarting mid-replay.
      rewindFrom.current = stage.current === 'idle' ? durationMs : scrubRef.current.t
      stage.current = 'rewind'; onStage?.('rewind')
    }
    localMs.current += dt * 1000
    if (stage.current === 'rewind') {
      scrubRef.current.t = Math.max(0, rewindFrom.current - localMs.current * REWIND_SPEED)
      if (localMs.current * REWIND_SPEED >= rewindFrom.current) { stage.current = 'forward'; localMs.current = 0; onStage?.('forward') }
    } else if (stage.current === 'forward') {
      scrubRef.current.t = Math.min(durationMs, localMs.current)
      if (localMs.current >= durationMs) { stage.current = 'done'; onDone?.() }
    }
  })
  return null
}

export default function Trace2Scene({ aircraft, modelUrl, active, roundKey, replaying, replayKey, replayStat, durationMs, onReplayStage, onReplayDone, onReady, onError }) {
  const scrubRef = useRef({ t: 0 })
  return (
    <Canvas
      camera={{ position: [0, ARENA_Y, 10], fov: 55, near: 0.1, far: 100 }}
      gl={{ alpha: true, antialias: true }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      onCreated={({ camera }) => camera.lookAt(0, ARENA_Y, 0)}
    >
      <ambientLight intensity={2.2} />
      <directionalLight position={[5, 8, 10]} intensity={2.4} color="#fff7e6" />
      <hemisphereLight args={['#bfe3ff', '#3a7bbf', 0.9]} />

      <ReplayDriver
        replaying={replaying}
        replayKey={replayKey}
        durationMs={durationMs}
        scrubRef={scrubRef}
        onStage={onReplayStage}
        onDone={onReplayDone}
      />

      {modelUrl && aircraft.map((a, idx) => (
        <Suspense key={a.colorKey} fallback={null}>
          <ErrorCatcher onError={onError}>
            <Trace2Aircraft
              url={modelUrl}
              hex={a.hex}
              spec={a}
              active={active}
              replaying={replaying}
              replayStat={replayStat}
              scrubRef={scrubRef}
              roundKey={roundKey}
              onReady={idx === 0 ? onReady : undefined}
            />
          </ErrorCatcher>
        </Suspense>
      ))}
    </Canvas>
  )
}
