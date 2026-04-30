import { useRef, useEffect, useState, useMemo, useImperativeHandle, forwardRef, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// ── Constants ────────────────────────────────────────────────────────────────
const AIRCRAFT_SPEED = 20          // px/s
const AIRCRAFT_RADIUS = 25         // circle ring radius in px
const AIRCRAFT_SIZE = 28           // target visual size px
const AIRCRAFT_LIFETIME = 20       // seconds
const AIRCRAFT_EXIT_START = 17     // switch to exit mode at this age
const STATE_INTERVAL_MIN = 2.5
const STATE_INTERVAL_MAX = 4.0
const SHAPE_INSET = 0.18           // fraction from each edge shapes' centres are biased toward
const SHAPE_EDGE_PAD = 36          // hard min px between shape edge and screen edge
// Per-shape stretch range (applied to width and height independently). Wider
// than 1 keeps the duplicate-colour pair visually distinguishable without
// breaking hit detection's bounding-radius approximation.
const SHAPE_STRETCH_MIN = 0.75
const SHAPE_STRETCH_MAX = 1.25
// Cap simultaneous circle/shape overlaps. Aircraft past the cap are deflected
// radially outward; slot priority is by overlap entry time. Hysteresis pad
// stops shapes flickering hot when an aircraft skims the boundary.
const MAX_OVERLAPPERS_PER_SHAPE = 2
const OVERLAP_HYSTERESIS = 10
const OVERLAP_DEFLECT_RATE = 3.5

// ── Polygon geometry helpers ─────────────────────────────────────────────────
// Returns vertices of a polygon shape in centred screen-space (relative to the
// shape centre), after scale(wS, hS) and outer rotate(rotation°) are applied.
// Matches the SVG transform chain: scale → outer-rotate → translate(cx,cy).
// Diamond's inner rotate(45°) is baked into the pre-scale vertex positions.
// Circle shapes return null — they use a radius check instead.
function shapePolyVerts(s) {
  const r = s.radius
  const wS = s.widthScale ?? 1
  const hS = s.heightScale ?? 1
  const ang = (s.rotation ?? 0) * Math.PI / 180
  const cosA = Math.cos(ang)
  const sinA = Math.sin(ang)
  const rot = (x, y) => [x * cosA - y * sinA, x * sinA + y * cosA]

  if (s.kind === 'square') {
    return [rot(r*wS, r*hS), rot(-r*wS, r*hS), rot(-r*wS, -r*hS), rot(r*wS, -r*hS)]
  }
  if (s.kind === 'diamond') {
    // SVG inner rotate(45°) maps rect corners (±r,±r) → (±r√2,0) and (0,±r√2),
    // then the group's scale(wS,hS) stretches independently per axis.
    const d = r * Math.SQRT2
    return [rot(d*wS, 0), rot(0, d*hS), rot(-d*wS, 0), rot(0, -d*hS)]
  }
  // triangle
  const apex = (2 * r) / Math.sqrt(3)
  const base = r / Math.sqrt(3)
  return [rot(0, -apex*hS), rot(-r*wS, base*hS), rot(r*wS, base*hS)]
}

function distToSegSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
}

// Minimum distance from point (px,py) to the polygon. Returns 0 if inside.
function pointPolyDist(px, py, verts) {
  let inside = false
  const n = verts.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = verts[i], [xj, yj] = verts[j]
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside
  }
  if (inside) return 0
  let minSq = Infinity
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = verts[i], [xj, yj] = verts[j]
    minSq = Math.min(minSq, distToSegSq(px, py, xi, yi, xj, yj))
  }
  return Math.sqrt(minSq)
}

// Per-stage spawn pressure. Stage schedule: easy/medium/hard/medium/easy across
// 12s windows. maxAircraft is the soft cap on simultaneous on-screen aircraft;
// spawnInterval is the average gap between spawn attempts when below the cap.
function stageConfig(gameTime) {
  if (gameTime < 12)  return { max: 4,  spawn: 2.2 }
  if (gameTime < 24)  return { max: 8,  spawn: 1.3 }
  if (gameTime < 36)  return { max: 14, spawn: 0.55 }
  if (gameTime < 48)  return { max: 8,  spawn: 1.3 }
  return                       { max: 4,  spawn: 2.2 }
}

// ── Shared geometry for aircraft count ───────────────────────────────────────
const uidAc = (() => { let i = 0; return () => ++i })()
const uidSh = (() => { let i = 0; return () => ++i })()

function randRange(lo, hi) { return lo + Math.random() * (hi - lo) }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// Spawn position: random edge, heading inward
function spawnAircraft(fieldW, fieldH) {
  const edge = Math.floor(Math.random() * 4)
  let x, y, heading
  if (edge === 0) { x = Math.random() * fieldW; y = 0;       heading = Math.PI / 2 + (Math.random() - 0.5) * 0.8 }
  else if (edge === 1) { x = fieldW; y = Math.random() * fieldH; heading = Math.PI + (Math.random() - 0.5) * 0.8 }
  else if (edge === 2) { x = Math.random() * fieldW; y = fieldH;  heading = -Math.PI / 2 + (Math.random() - 0.5) * 0.8 }
  else { x = 0; y = Math.random() * fieldH; heading = (Math.random() - 0.5) * 0.8 }

  return {
    id: uidAc(),
    x, y,
    heading,
    state: 'STRAIGHT',
    stateTimer: randRange(STATE_INTERVAL_MIN, STATE_INTERVAL_MAX),
    age: 0,
    hasCircle: Math.random() < 0.5,
    symbol: null,
    symbolFlashAt: randRange(2, 15),
    symbolFlashEnd: 0,
    cumTurn: 0,            // accumulated heading delta within current state
    uTurnRemaining: 0,     // radians left in an in-progress U-turn
    uTurnDir: 0,           // -1 / +1 — direction of the in-progress U-turn
    exiting: false,
  }
}

// Build the 4-shape spec list from a 3-entry palette: each palette entry is
// used once, then a random palette entry is duplicated, and the result is
// shuffled so the duplicate doesn't always land in the same slot.
function buildShapeSpecs(palette) {
  if (!palette || palette.length < 3) return []
  const dupIdx = Math.floor(Math.random() * 3)
  const specs = [palette[0], palette[1], palette[2], palette[dupIdx]]
  for (let i = specs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[specs[i], specs[j]] = [specs[j], specs[i]]
  }
  return specs
}

// ── Shape placement with rejection sampling ───────────────────────────────────
function placeShapes(fieldW, fieldH, palette) {
  const specs = buildShapeSpecs(palette)
  if (specs.length === 0) return []
  const shapeCount = specs.length
  const minDim = Math.min(fieldW, fieldH)
  // Edge clearance scales with field — smaller fields get proportionally more
  // padding so even diamond corners (worst case extent = r·√2) sit well off the
  // visible edge.
  const edgePad = Math.max(SHAPE_EDGE_PAD, minDim * 0.13)
  // Inset where shape centres can sit. Tighter shapes hugging the centre on
  // smaller fields means more reliable clearance from edges.
  const inset = minDim < 450 ? 0.24 : SHAPE_INSET
  // Smaller shape footprint on smaller fields so 4 shapes + their separation
  // fit comfortably inside the inset region.
  const areaFraction = minDim < 450 ? 0.14 : 0.22
  const targetArea = fieldW * fieldH * areaFraction
  const perArea = targetArea / shapeCount
  let desiredRadius = Math.sqrt(perArea / Math.PI) * 0.85
  // Hard cap on small fields — keeps shapes visually proportionate to the
  // available space rather than dominating it.
  if (minDim < 450) desiredRadius = Math.min(desiredRadius, minDim * 0.075)

  // Cap radius so 4 non-touching shapes can actually fit inside the playable
  // region (square/diamond use diagonal extent ≈ r·√2; need at least a 2-shape
  // separation along the smaller axis plus a small visual gap).
  const usableMin = minDim - 2 * edgePad
  const maxRadiusByFit = usableMin / (2 * Math.SQRT2 + 0.6)

  // Try at progressively smaller radii until rejection sampling succeeds.
  for (let radius = Math.min(desiredRadius, maxRadiusByFit); radius >= 12; radius *= 0.92) {
    const extent = radius * Math.SQRT2
    const minX = Math.max(fieldW * inset, extent + edgePad)
    const maxX = Math.min(fieldW * (1 - inset), fieldW - extent - edgePad)
    const minY = Math.max(fieldH * inset, extent + edgePad)
    const maxY = Math.min(fieldH * (1 - inset), fieldH - extent - edgePad)
    if (maxX <= minX || maxY <= minY) continue

    // shapeDist = no shape-on-shape overlap (use diagonal + gap)
    // circleDist = aircraft target circle can't touch two shapes simultaneously
    const minDist = Math.max(2 * extent + 18, 2 * (radius + AIRCRAFT_RADIUS))

    const placed = []
    let allFit = true
    for (let k = 0; k < shapeCount; k++) {
      let cx, cy, ok = false
      for (let tries = 0; tries < 400; tries++) {
        cx = randRange(minX, maxX)
        cy = randRange(minY, maxY)
        if (!placed.some(p => Math.hypot(p.cx - cx, p.cy - cy) < minDist)) {
          ok = true
          break
        }
      }
      if (!ok) { allFit = false; break }
      const spec = specs[k]
      const rotation = Math.random() * 360
      const widthScale = randRange(SHAPE_STRETCH_MIN, SHAPE_STRETCH_MAX)
      const heightScale = randRange(SHAPE_STRETCH_MIN, SHAPE_STRETCH_MAX)
      const sh = {
        id: uidSh(),
        kind: spec.kind,
        color: spec.color,
        cx, cy,
        radius,
        rotation,
        widthScale,
        heightScale,
        hot: false,
        flashGreen: false,
        flashRed: false,
        lockedUntil: 0,
      }
      // Precompute polygon vertices once — geometry never changes after placement.
      if (sh.kind !== 'circle') sh.verts = shapePolyVerts(sh)
      placed.push(sh)
    }
    if (allFit) return placed
  }
  return []  // field too small — render no shapes rather than overlap
}

// ── Aircraft state-machine heading delta ─────────────────────────────────────
function headingDelta(ac, shapes, dt) {
  const nearest = shapes.length
    ? shapes.reduce((best, s) => {
        const d = Math.hypot(s.cx - ac.x, s.cy - ac.y)
        return d < best.d ? { s, d } : best
      }, { s: null, d: Infinity })
    : { s: null, d: Infinity }

  const turnTo = (targetAngle) => {
    let diff = targetAngle - ac.heading
    while (diff > Math.PI) diff -= 2 * Math.PI
    while (diff < -Math.PI) diff += 2 * Math.PI
    return Math.sign(diff) * Math.min(Math.abs(diff), 2.5 * dt)
  }

  if (ac.state === 'WANDER') {
    return (Math.random() - 0.5) * 1.2 * dt
  }
  if (ac.state === 'LOCK_ON' && nearest.s) {
    const angle = Math.atan2(nearest.s.cy - ac.y, nearest.s.cx - ac.x)
    return turnTo(angle)
  }
  if (ac.state === 'EVADE' && nearest.s) {
    const angle = Math.atan2(nearest.s.cy - ac.y, nearest.s.cx - ac.x) + Math.PI
    return turnTo(angle)
  }
  if (ac.state === 'U_TURN') {
    // Stateful one-shot 180° turn — never exceeds π radians regardless of
    // how long the state window lasts.
    if (ac.uTurnRemaining <= 0) return 0
    const step = Math.min(ac.uTurnRemaining, 4.5 * dt)
    ac.uTurnRemaining -= step
    return step * ac.uTurnDir
  }
  return 0
}

function pickState(hasCircle) {
  const weights = hasCircle
    ? [10, 15, 35, 30, 10]
    : [20, 25, 20, 20, 15]
  const states = ['STRAIGHT', 'WANDER', 'LOCK_ON', 'EVADE', 'U_TURN']
  const total = weights.reduce((s, w) => s + w, 0)
  let r = Math.random() * total
  for (let i = 0; i < states.length; i++) {
    r -= weights[i]
    if (r <= 0) return states[i]
  }
  return 'STRAIGHT'
}

// ── THREE: single shared scene rendering all aircraft ────────────────────────
function AircraftInstances({ modelUrl, aircraftRef, fieldW, fieldH }) {
  const { scene: gltfScene } = useGLTF(modelUrl)
  const groupRef = useRef()
  const instancesRef = useRef({})  // id -> THREE.Group

  // Compute centring offset once. Camera is set up so 1 world unit ≈ 20 px
  // (camera y = fieldH / 20 * 1.05, fov 50). Scale the model so its largest
  // horizontal dimension occupies AIRCRAFT_SIZE pixels on screen.
  const { centre, scale } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltfScene)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.z, 0.01)
    const targetWorldSize = AIRCRAFT_SIZE / 20
    const sc = targetWorldSize / maxDim
    return {
      centre: box.getCenter(new THREE.Vector3()),
      scale: sc,
    }
  }, [gltfScene, fieldW, fieldH])

  // Blue-tint material applied to every mesh
  const tintMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#5baaff',
    emissive: '#1a3a5c',
    emissiveIntensity: 0.4,
    roughness: 0.5,
    metalness: 0.6,
  }), [])

  useFrame(() => {
    const aircraft = aircraftRef.current
    if (!groupRef.current) return

    const existingIds = new Set(Object.keys(instancesRef.current).map(Number))
    const liveIds = new Set(aircraft.map(a => a.id))

    // Remove departed aircraft
    for (const id of existingIds) {
      if (!liveIds.has(id)) {
        const mesh = instancesRef.current[id]
        groupRef.current.remove(mesh)
        delete instancesRef.current[id]
      }
    }

    // Add/update aircraft
    for (const ac of aircraft) {
      if (!instancesRef.current[ac.id]) {
        const cloned = gltfScene.clone(true)
        cloned.traverse(child => {
          if (child.isMesh) child.material = tintMaterial
        })
        const g = new THREE.Group()
        g.add(cloned)
        // Centre the model
        cloned.position.set(-centre.x, -centre.y, -centre.z)
        g.scale.setScalar(scale)
        groupRef.current.add(g)
        instancesRef.current[ac.id] = g
      }

      const g = instancesRef.current[ac.id]
      // Convert px coords to world coords — origin at field centre
      const wx = (ac.x - fieldW / 2) / 20
      const wz = (ac.y - fieldH / 2) / 20
      g.position.set(wx, 0, wz)
      // Match the plane-turn game's GLB rotation convention: rotation.y =
      // -angle_radians - π/2 where angle is clockwise-from-up. Our heading is
      // clockwise-from-right, so heading = angle - π/2 → rotation = -heading - π.
      g.rotation.y = -ac.heading - Math.PI
    }
  })

  return <group ref={groupRef} />
}

function FlagScene({ modelUrl, aircraftRef, fieldW, fieldH }) {
  const { camera } = useThree()

  // Camera is orthographic (set on the parent Canvas) with zoom=20, so
  // 1 world unit projects to exactly 20 px on screen. This guarantees the
  // SVG-overlaid white circles align perfectly with the 3D aircraft. We
  // re-aim the camera here in case fieldW/fieldH change after mount.
  useEffect(() => {
    camera.position.set(0, 50, 0)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, fieldW, fieldH])

  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[0, 10, 0]} intensity={1.8} color="#5baaff" />
      <pointLight position={[2, 8, 2]} intensity={1.2} color="#ffffff" />
      <Suspense fallback={null}>
        <AircraftInstances
          modelUrl={modelUrl}
          aircraftRef={aircraftRef}
          fieldW={fieldW}
          fieldH={fieldH}
        />
      </Suspense>
    </>
  )
}

// ── Shape SVG overlay ────────────────────────────────────────────────────────
function ShapeOverlay({ shapes, fieldW, fieldH, onShapeClick }) {
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={fieldW}
      height={fieldH}
      viewBox={`0 0 ${fieldW} ${fieldH}`}
    >
      {shapes.map(s => {
        const r = s.radius
        const fill = s.color
        // Inner shape never changes on flash — that prevents a noisy colour
        // swap on green/red shapes. The whole click cue lives in the outer
        // halo: a light pastel ring (mint/coral) that contrasts cleanly with
        // every palette colour.
        const flashing = s.flashGreen || s.flashRed
        const flashColor = s.flashGreen ? '#86efac' : s.flashRed ? '#fca5a5' : null
        // Render the shape centred at (0,0); the wrapping <g> translates,
        // rotates, then scales so width/height stretch is independent of
        // rotation. Diamond gets an extra inner 45° rotation so its corners
        // sit on the cardinal axes by default.
        let path = null
        let haloPath = null
        if (s.kind === 'square') {
          path = <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={fill} fillOpacity={0.55} stroke={s.color} strokeWidth="2.5" />
          if (flashing) haloPath = <rect x={-r} y={-r} width={r * 2} height={r * 2} fill="none" stroke={flashColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        } else if (s.kind === 'circle') {
          path = <circle cx={0} cy={0} r={r} fill={fill} fillOpacity={0.55} stroke={s.color} strokeWidth="2.5" />
          if (flashing) haloPath = <circle cx={0} cy={0} r={r} fill="none" stroke={flashColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        } else if (s.kind === 'triangle') {
          const apex = (r * 2) / Math.sqrt(3)
          const base = r / Math.sqrt(3)
          path = <polygon points={`0,${-apex} ${-r},${base} ${r},${base}`} fill={fill} fillOpacity={0.55} stroke={s.color} strokeWidth="2.5" />
          if (flashing) haloPath = <polygon points={`0,${-apex} ${-r},${base} ${r},${base}`} fill="none" stroke={flashColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        } else if (s.kind === 'diamond') {
          path = <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={fill} fillOpacity={0.55} stroke={s.color} strokeWidth="2.5" transform="rotate(45)" />
          if (flashing) haloPath = <rect x={-r} y={-r} width={r * 2} height={r * 2} fill="none" stroke={flashColor} strokeWidth="2" transform="rotate(45)" vectorEffect="non-scaling-stroke" />
        }
        return (
          <g
            key={s.id}
            transform={`translate(${s.cx},${s.cy}) rotate(${s.rotation}) scale(${s.widthScale},${s.heightScale})`}
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
            onClick={() => onShapeClick(s.id)}
          >
            <circle cx={0} cy={0} r={r + 10} fill="transparent" />
            {haloPath && (
              <g transform="scale(1.14)" style={{ filter: `drop-shadow(0 0 3px ${flashColor})` }}>
                {haloPath}
              </g>
            )}
            {path}
          </g>
        )
      })}
    </svg>
  )
}

// ── Symbol overlay (above aircraft) ─────────────────────────────────────────
function SymbolOverlay({ aircraft, fieldW, fieldH }) {
  return (
    <svg className="absolute inset-0 pointer-events-none" width={fieldW} height={fieldH} viewBox={`0 0 ${fieldW} ${fieldH}`}>
      {aircraft.map(ac => {
        const showCircle = ac.hasCircle
        // symbolFlashEnd is set from performance.now()/1000 in the rAF loop —
        // compare against the same time base, NOT Date.now().
        const showSymbol = ac.symbol && performance.now() / 1000 < ac.symbolFlashEnd
        return (
          <g key={ac.id}>
            {showCircle && (
              <circle
                cx={ac.x} cy={ac.y} r={AIRCRAFT_RADIUS}
                fill="none" stroke="#ddeaf8" strokeWidth="1.5" opacity="0.8"
              />
            )}
            {showSymbol && (
              <text
                x={ac.x} y={ac.y - AIRCRAFT_RADIUS - 6}
                textAnchor="middle"
                fontSize="11"
                fontWeight="bold"
                fontFamily="monospace"
                fill="#ddeaf8"
                style={{ textShadow: '0 0 4px #000' }}
              >
                {ac.symbol}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── Main PlayField ────────────────────────────────────────────────────────────
function PlayFieldImpl({
  modelUrl,
  symbols,
  palette,
  gameTimeRef,
  onScoreEvent,
  onAircraftSeen,
  onAircraftSpawn,
  onAircraftDespawn,
  active,
}, ref) {
  const fieldRef = useRef(null)
  // Start at 0×0 so shape placement waits for the real ResizeObserver
  // measurement instead of seeding shapes for a phantom default size and
  // locking them in via shapesInitRef before mobile dimensions arrive.
  const [fieldSize, setFieldSize] = useState({ w: 0, h: 0 })
  const aircraftRef = useRef([])
  const shapesRef = useRef([])
  const [displayAircraft, setDisplayAircraft] = useState([])
  const [displayShapes, setDisplayShapes] = useState([])
  const rafRef = useRef(null)
  const lastTimeRef = useRef(null)
  const symbolsRef = useRef(symbols)
  const symbolIdxRef = useRef(0)
  const spawnTimerRef = useRef(randRange(1.5, 3.5))
  const shapeLockRef = useRef({})   // id -> unlockTime (250ms anti-double-click)
  const shapeClaimRef = useRef({})  // shapeId -> { [acId]: claimedAtMs } per-aircraft claims while in slot
  const acShapeEntryRef = useRef({}) // acId -> { [shapeId]: enteredAtMs } slot-priority by entry time
  const shapeSlotsRef = useRef({})   // shapeId -> [acId, acId] live slot holders (≤2)

  useEffect(() => { symbolsRef.current = symbols }, [symbols])

  // Measure field size
  useEffect(() => {
    if (!fieldRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setFieldSize({ w: e.contentRect.width, h: e.contentRect.height })
      }
    })
    ro.observe(fieldRef.current)
    return () => ro.disconnect()
  }, [])

  // Initialise shapes when field size and palette are both ready.
  const shapesInitRef = useRef(false)
  useEffect(() => {
    if (shapesInitRef.current || fieldSize.w < 10) return
    if (!palette || palette.length < 3) return
    shapesInitRef.current = true
    const placed = placeShapes(fieldSize.w, fieldSize.h, palette)
    shapesRef.current = placed
    setDisplayShapes([...placed])
  }, [fieldSize, palette])

  // Main rAF loop
  useEffect(() => {
    if (!active) return
    lastTimeRef.current = performance.now()

    const tick = (now) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1)
      lastTimeRef.current = now
      const gameTime = gameTimeRef.current
      const { w, h } = fieldSize

      // Spawn timer with stage-based cap & cadence. Skip entirely after t=55
      // so the field can clear before the timer ends.
      if (gameTime < 55) {
        const { max, spawn } = stageConfig(gameTime)
        spawnTimerRef.current -= dt
        if (spawnTimerRef.current <= 0 && aircraftRef.current.length < max) {
          const sym = symbolsRef.current[symbolIdxRef.current % symbolsRef.current.length]
          symbolIdxRef.current++
          const ac = spawnAircraft(w, h)
          ac.symbol = sym
          ac.symbolFlashAt = randRange(0, 14)
          aircraftRef.current = [...aircraftRef.current, ac]
          onAircraftSpawn?.(sym)
          spawnTimerRef.current = randRange(spawn * 0.7, spawn * 1.3)
        } else if (spawnTimerRef.current <= 0) {
          // Cap reached — re-arm the timer with a short retry so we spawn
          // promptly once an aircraft despawns.
          spawnTimerRef.current = 0.4
        }
      }

      const nowSec = performance.now() / 1000

      // Update aircraft
      const surviving = []
      for (const ac of aircraftRef.current) {
        const next = { ...ac }
        next.age += dt
        next.stateTimer -= dt

        // State transition
        if (next.stateTimer <= 0 && !next.exiting) {
          next.state = pickState(next.hasCircle)
          next.stateTimer = randRange(STATE_INTERVAL_MIN, STATE_INTERVAL_MAX)
          next.cumTurn = 0
          if (next.state === 'U_TURN') {
            next.uTurnRemaining = Math.PI
            next.uTurnDir = Math.random() < 0.5 ? -1 : 1
          } else {
            next.uTurnRemaining = 0
          }
        }

        // Safety net — if cumulative rotation in any non-U_TURN state exceeds
        // π radians, force STRAIGHT so we never visually loop a full circle.
        if (!next.exiting && next.state !== 'U_TURN' && Math.abs(next.cumTurn) > Math.PI) {
          next.state = 'STRAIGHT'
          next.stateTimer = randRange(STATE_INTERVAL_MIN, STATE_INTERVAL_MAX)
          next.cumTurn = 0
        }

        // Exit mode
        if (next.age >= AIRCRAFT_EXIT_START && !next.exiting) {
          next.exiting = true
          next.state = 'STRAIGHT'
          // Head toward nearest edge
          const toLeft = next.x
          const toRight = w - next.x
          const toTop = next.y
          const toBottom = h - next.y
          const minEdge = Math.min(toLeft, toRight, toTop, toBottom)
          if (minEdge === toTop) next.heading = -Math.PI / 2
          else if (minEdge === toBottom) next.heading = Math.PI / 2
          else if (minEdge === toLeft) next.heading = Math.PI
          else next.heading = 0
        }

        // Symbol flash trigger
        if (!next.flashTriggered && next.age >= next.symbolFlashAt) {
          next.flashTriggered = true
          next.symbolFlashEnd = nowSec + 5
          onAircraftSeen?.(next.symbol)
        }

        // State-driven heading change
        const delta = headingDelta(next, shapesRef.current, dt)
        next.heading += delta
        next.cumTurn += delta

        // Soft boundary nudge — when not yet in exit mode, blend a gentle
        // turn toward field centre proportional to how close we are to an
        // edge. Without this, planes straight-line off screen long before
        // their 20-second lifetime ends and the field stays empty.
        if (!next.exiting) {
          const boundary = 70
          const distFromEdge = Math.min(next.x, w - next.x, next.y, h - next.y)
          if (distFromEdge < boundary) {
            const angleToCenter = Math.atan2(h / 2 - next.y, w / 2 - next.x)
            let diff = angleToCenter - next.heading
            while (diff > Math.PI) diff -= 2 * Math.PI
            while (diff < -Math.PI) diff += 2 * Math.PI
            const strength = (boundary - distFromEdge) / boundary
            next.heading += Math.sign(diff) * Math.min(Math.abs(diff), 3.5 * dt * strength)
          }
        }

        next.x += Math.cos(next.heading) * AIRCRAFT_SPEED * dt
        next.y += Math.sin(next.heading) * AIRCRAFT_SPEED * dt

        // Despawn if off screen or too old
        const margin = 60
        const offScreen = next.x < -margin || next.x > w + margin || next.y < -margin || next.y > h + margin
        if (offScreen || next.age >= AIRCRAFT_LIFETIME) {
          onAircraftDespawn?.(next.symbol)
          continue
        }
        surviving.push(next)
      }
      aircraftRef.current = surviving

      // Per-shape overlap pass. Circle shapes use bounding-circle; polygons use
      // exact polygon-circle distance (pointPolyDist) so every part of the shape
      // — sides and corners alike — triggers overlap precisely when the aircraft
      // ring visually touches it. Hysteresis on exit prevents boundary flutter;
      // first ≤2 overlappers by entry time hold the slots and count for
      // hot/scoring; any 3rd+ aircraft is deflected radially.
      const overlappersByShape = {}
      for (const ac of surviving) {
        if (!ac.hasCircle) continue
        const acEntries = acShapeEntryRef.current[ac.id]
        for (const s of shapesRef.current) {
          const wasInside = acEntries?.[s.id] != null
          const hyst = wasInside ? OVERLAP_HYSTERESIS : 0
          let isInside
          if (s.kind === 'circle') {
            const eff = s.radius * Math.max(s.widthScale ?? 1, s.heightScale ?? 1)
            isInside = Math.hypot(ac.x - s.cx, ac.y - s.cy) < AIRCRAFT_RADIUS + eff + hyst
          } else {
            isInside = pointPolyDist(ac.x - s.cx, ac.y - s.cy, s.verts) < AIRCRAFT_RADIUS + hyst
          }
          if (isInside) {
            if (!acShapeEntryRef.current[ac.id]) acShapeEntryRef.current[ac.id] = {}
            if (!wasInside) acShapeEntryRef.current[ac.id][s.id] = now
            const enteredAt = acShapeEntryRef.current[ac.id][s.id]
            if (!overlappersByShape[s.id]) overlappersByShape[s.id] = []
            overlappersByShape[s.id].push({ ac, enteredAt })
          } else if (wasInside) {
            delete acShapeEntryRef.current[ac.id][s.id]
          }
        }
      }

      const slotsByShape = {}
      for (const shapeIdStr of Object.keys(overlappersByShape)) {
        const list = overlappersByShape[shapeIdStr]
        list.sort((a, b) => a.enteredAt - b.enteredAt || a.ac.id - b.ac.id)
        slotsByShape[shapeIdStr] = list.slice(0, MAX_OVERLAPPERS_PER_SHAPE).map(o => o.ac.id)
        if (list.length > MAX_OVERLAPPERS_PER_SHAPE) {
          const shape = shapesRef.current.find(s => String(s.id) === shapeIdStr)
          if (shape) {
            for (let i = MAX_OVERLAPPERS_PER_SHAPE; i < list.length; i++) {
              const ac = list[i].ac
              const angleAway = Math.atan2(ac.y - shape.cy, ac.x - shape.cx)
              let diff = angleAway - ac.heading
              while (diff > Math.PI) diff -= 2 * Math.PI
              while (diff < -Math.PI) diff += 2 * Math.PI
              ac.heading += Math.sign(diff) * Math.min(Math.abs(diff), OVERLAP_DEFLECT_RATE * dt)
              if (ac.state === 'LOCK_ON') {
                ac.state = 'STRAIGHT'
                ac.stateTimer = randRange(STATE_INTERVAL_MIN, STATE_INTERVAL_MAX)
                ac.cumTurn = 0
              }
            }
          }
        }
      }

      const updatedShapes = shapesRef.current.map(s => ({
        ...s,
        hot: (slotsByShape[String(s.id)] || []).length > 0,
      }))
      shapesRef.current = updatedShapes
      shapeSlotsRef.current = slotsByShape

      // Drop entry tracking for despawned aircraft.
      const liveAcIds = new Set(surviving.map(a => a.id))
      for (const acIdStr of Object.keys(acShapeEntryRef.current)) {
        if (!liveAcIds.has(Number(acIdStr))) {
          delete acShapeEntryRef.current[acIdStr]
        }
      }

      // Per-aircraft claims drop when their owner leaves the slot list — that
      // covers exiting the zone, getting demoted past slot-2, and despawn.
      for (const shapeIdStr of Object.keys(shapeClaimRef.current)) {
        const claims = shapeClaimRef.current[shapeIdStr]
        const slots = new Set(slotsByShape[shapeIdStr] || [])
        for (const acIdStr of Object.keys(claims)) {
          if (!slots.has(Number(acIdStr))) {
            delete claims[acIdStr]
          }
        }
        if (Object.keys(claims).length === 0) {
          delete shapeClaimRef.current[shapeIdStr]
        }
      }

      setDisplayAircraft([...surviving])
      setDisplayShapes([...updatedShapes])

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [active, fieldSize, gameTimeRef, onAircraftSpawn, onAircraftDespawn, onAircraftSeen, onScoreEvent])

  const flashShape = (shapeId, kind) => {
    const field = kind === 'green' ? 'flashGreen' : 'flashRed'
    shapesRef.current = shapesRef.current.map(s =>
      s.id === shapeId ? { ...s, flashGreen: false, flashRed: false, [field]: true } : s
    )
    setDisplayShapes([...shapesRef.current])
    setTimeout(() => {
      shapesRef.current = shapesRef.current.map(s =>
        s.id === shapeId ? { ...s, [field]: false } : s
      )
      setDisplayShapes([...shapesRef.current])
    }, 300)
  }

  const handleShapeClick = (shapeId) => {
    const nowMs = performance.now()
    if (shapeLockRef.current[shapeId] && nowMs < shapeLockRef.current[shapeId]) return
    shapeLockRef.current[shapeId] = nowMs + 250

    const shape = shapesRef.current.find(s => s.id === shapeId)
    if (!shape) return

    if (!shape.hot) {
      onScoreEvent?.({ type: 'targetMiss' })
      flashShape(shapeId, 'red')
      return
    }

    // Hot. Each slot-holder aircraft is independently claimable once per
    // overlap; the rAF loop drops a claim when its aircraft leaves the slot.
    // Click awards the first unclaimed slot holder. If all are already
    // claimed, repeat clicks within 2s of the latest claim are silent;
    // after 2s they count as misses.
    const slotAcIds = shapeSlotsRef.current[String(shapeId)] || []
    if (!shapeClaimRef.current[shapeId]) shapeClaimRef.current[shapeId] = {}
    const claims = shapeClaimRef.current[shapeId]
    const unclaimed = slotAcIds.find(acId => claims[acId] == null)

    if (unclaimed != null) {
      claims[unclaimed] = nowMs
      onScoreEvent?.({ type: 'targetHit' })
      flashShape(shapeId, 'green')
      return
    }
    const latest = slotAcIds.reduce((m, acId) => Math.max(m, claims[acId] || 0), 0)
    if (nowMs - latest < 2000) return
    onScoreEvent?.({ type: 'targetMiss' })
    flashShape(shapeId, 'red')
  }

  // Flash every shape of a given colour simultaneously — used when the user
  // taps a colour button with no matching hot shape on screen.
  const flashShapesByColor = (color, kind) => {
    const field = kind === 'green' ? 'flashGreen' : 'flashRed'
    shapesRef.current = shapesRef.current.map(s =>
      s.color === color ? { ...s, flashGreen: false, flashRed: false, [field]: true } : s
    )
    setDisplayShapes([...shapesRef.current])
    setTimeout(() => {
      shapesRef.current = shapesRef.current.map(s =>
        s.color === color ? { ...s, [field]: false } : s
      )
      setDisplayShapes([...shapesRef.current])
    }, 300)
  }

  // Colour-button click — equivalent to clicking any hot shape of that colour.
  // Anti-double-click is keyed per colour (independent of per-shape locks).
  const handleColorClick = (color) => {
    const nowMs = performance.now()
    const lockKey = `color:${color}`
    if (shapeLockRef.current[lockKey] && nowMs < shapeLockRef.current[lockKey]) return
    shapeLockRef.current[lockKey] = nowMs + 250

    // With a duplicate-colour palette there can be two hot shapes sharing
    // this colour. Prefer the first one with an unclaimed slot — otherwise
    // the user can't score the second shape's aircraft until the first one
    // goes cold (which felt like a wrongful miss in playtesting).
    const hotShapes = shapesRef.current.filter(s => s.color === color && s.hot)
    if (hotShapes.length === 0) {
      onScoreEvent?.({ type: 'targetMiss' })
      flashShapesByColor(color, 'red')
      return
    }
    for (const target of hotShapes) {
      const slotAcIds = shapeSlotsRef.current[String(target.id)] || []
      if (!shapeClaimRef.current[target.id]) shapeClaimRef.current[target.id] = {}
      const claims = shapeClaimRef.current[target.id]
      const unclaimed = slotAcIds.find(acId => claims[acId] == null)
      if (unclaimed != null) {
        claims[unclaimed] = nowMs
        onScoreEvent?.({ type: 'targetHit' })
        flashShape(target.id, 'green')
        return
      }
    }
    // Every hot shape of this colour is fully claimed — anti-spam against
    // the most recent claim across them; otherwise count as a miss.
    let latest = 0
    for (const s of hotShapes) {
      const claims = shapeClaimRef.current[s.id] || {}
      for (const t of Object.values(claims)) {
        if (t > latest) latest = t
      }
    }
    if (nowMs - latest < 2000) return
    onScoreEvent?.({ type: 'targetMiss' })
    flashShape(hotShapes[0].id, 'red')
  }

  useImperativeHandle(ref, () => ({
    clickColor: handleColorClick,
  }))

  return (
    <div
      ref={fieldRef}
      className="relative w-full h-full bg-[#020a18] rounded-lg overflow-hidden border border-[#1a3a5c]"
    >
      <ShapeOverlay
        shapes={displayShapes}
        fieldW={fieldSize.w}
        fieldH={fieldSize.h}
        onShapeClick={handleShapeClick}
      />

      {modelUrl && fieldSize.w > 10 && (
        <Canvas
          orthographic
          camera={{ position: [0, 50, 0], near: 0.1, far: 200, zoom: 20, up: [0, 0, -1] }}
          gl={{ alpha: true, antialias: true }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          <FlagScene
            modelUrl={modelUrl}
            aircraftRef={aircraftRef}
            fieldW={fieldSize.w}
            fieldH={fieldSize.h}
          />
        </Canvas>
      )}

      <SymbolOverlay
        aircraft={displayAircraft}
        fieldW={fieldSize.w}
        fieldH={fieldSize.h}
      />
    </div>
  )
}

const PlayField = forwardRef(PlayFieldImpl)
export default PlayField
