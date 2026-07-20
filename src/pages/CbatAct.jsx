import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAuth } from '../context/AuthContext'
import { submitCbatResult } from '../lib/cbatOutbox'
import { useAppSettings } from '../context/AppSettingsContext'
import { useCbatTracking } from '../utils/cbat/useCbatTracking'
import { useGameChrome } from '../context/GameChromeContext'
import usePagePresence from '../hooks/usePagePresence'
import SEO from '../components/SEO'
import CbatGameOver from '../components/CbatGameOver'
import SkywatchLogoIntro from '../components/SkywatchLogoIntro'
import {
  ActAudioEngine,
  CALLSIGNS,
  pickCallsigns,
  generateDistractorCallsign,
  buildAvoidSequence,
} from '../utils/cbat/actAudio'
import {
  RENDERED_AHEAD,
  AUDIO_WARMUP_T,
  CODE_LENGTH,
  CODE_ROUND_IDX,
  generateShapeEvents,
  generateAudioPlan,
  generateMemoryCode,
  scoreCodeRecall,
} from '../utils/cbat/cbatActPlan'
import CodeRecall from './CbatAct/CodeRecall'
import { pushCheatDigit, emptyCheatBuffer } from '../utils/cbat/actRoundCheat'

// ── Constants ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 5
const TUNNEL_RADIUS = 2.0
const BALL_RADIUS = 0.18
const SHAPE_RADIUS = 0.7                      // hoop/square half-size — small enough that the ball must be aimed
const TURN_RATE   = 0.006                     // radians per pixel of drag
const MAX_ROT_PER_TICK = 0.9                  // hard cap on per-tick rotation (rad) — large enough that real flicks don't clip; the forcedT floor in the game loop now protects t-progress regardless of orientation, so the old tight cap is unnecessary
const MAX_FWD_DEVIATION_RAD = Math.PI * 5 / 12   // 75° — half-angle of the cone the ball-forward must stay within around the tunnel's tangent, so the camera can never face perpendicular or backwards
const MAX_FWD_DEVIATION_COS = Math.cos(MAX_FWD_DEVIATION_RAD)
const KEYBOARD_RATE_PER_TICK = 4.5            // pixel-equivalent per 16ms keyboard tick
const MAX_ROUND_DURATION_S = 150              // safety net — force-end the round if the player gets stuck somehow
// AUDIO_WARMUP_T, generateShapeEvents, generateAudioPlan, RENDERED_AHEAD live
// in src/utils/cbat/cbatActPlan.js so they can be unit-tested without R3F.

// Per-round tuning. Speed = world units / second the ball moves along its
// own forward direction. Distractor density and turn intensity grow with
// round number.
const ROUND_CONFIG = [
  // `turns` doubled (was 4/5/6/7/8) so total iterations and curve length
  // double too, giving ~2× round duration at the same speeds.
  //
  // `shapes` was doubled when triangles were added — ~50% of stream events
  // are triangle filler, so to keep circle/square encounter density similar
  // to the pre-triangle stream we generate roughly twice as many events.
  // distractorOdds and bleepOdds were halved when `shapes` doubled — both are
  // applied per-event, so without the halving the round would have ~2× as
  // many distractor cues and bleeps as the original tuning intended.
  { speed: 4.0, shapes: 16, distractorOdds: 0.15, avoidOdds: 0.55, bleepOdds: 0.05, turns: 12, callsigns: 2 },
  { speed: 4.5, shapes: 20, distractorOdds: 0.20, avoidOdds: 0.60, bleepOdds: 0.06, turns: 14, callsigns: 2 },
  { speed: 5.0, shapes: 24, distractorOdds: 0.25, avoidOdds: 0.65, bleepOdds: 0.07, turns: 16, callsigns: 2 },
  { speed: 5.5, shapes: 28, distractorOdds: 0.28, avoidOdds: 0.70, bleepOdds: 0.08, turns: 18, callsigns: 3 },
  { speed: 6.5, shapes: 32, distractorOdds: 0.30, avoidOdds: 0.75, bleepOdds: 0.09, turns: 20, callsigns: 3 },
]

// Score deltas
const SCORE = {
  RING_THREADED:   20,
  RING_MISSED:     -10,
  AVOID_OBEYED:    25,
  AVOID_VIOLATED:  -25,
  WALL_PER_SECOND: -5,
  BLEEP_FAST:      25,   // < 500ms
  BLEEP_MED:       20,   // < 1000ms
  BLEEP_SLOW:      10,   // < 2000ms
  BLEEP_MISS:      -10,
  BLEEP_FALSE:     -10,  // tap with no bleep playing — selective-inhibition penalty
}

// ── Hooks ────────────────────────────────────────────────────────────────────

// True when the device is touch-first OR the viewport is mobile-narrow. The
// touch-steer pad renders on this; the canvas keeps its own pointer handlers
// regardless (the pad is additive). Re-evaluates on matchMedia change + resize
// so rotating/resizing a hybrid device updates the UI live.
function useIsTouch() {
  const compute = () => {
    if (typeof window === 'undefined') return false
    const coarse = typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none) and (pointer: coarse)').matches
    const narrow = window.innerWidth <= 600
    return coarse || narrow
  }
  const [isTouch, setIsTouch] = useState(compute)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setIsTouch(compute())
    const mql = typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: none) and (pointer: coarse)')
      : null
    mql?.addEventListener?.('change', update)
    window.addEventListener('resize', update)
    return () => {
      mql?.removeEventListener?.('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return isTouch
}

// ── Tunnel geometry ──────────────────────────────────────────────────────────

// Build a Catmull-Rom curve through random waypoints. Each "corner" is spread
// across 3–4 consecutive waypoints that bend the tunnel in the same axis and
// direction (a "streak"), so the curve sweeps through a long arc instead of
// lurching at a single waypoint. Per-waypoint magnitude stays moderate; the
// cumulative deflection across a streak is what produces the sharp-but-
// smoothed corners. `centripetal` keeps the smoothing well behaved without
// overshoot.
function buildTunnelCurve(roundIdx) {
  const cfg = ROUND_CONFIG[roundIdx]
  const turnMag = 7 + roundIdx * 2       // round 1=7 … round 5=15, lateral per waypoint INSIDE a streak
  const segmentLen = 14                   // forward units on a STRAIGHT waypoint
  const turnForwardFrac = 0.85            // forward fraction on a turn waypoint (cumulative arc shape)
  const points = [new THREE.Vector3(0, 0, 0)]
  let cursor = new THREE.Vector3(0, 0, 0)

  // Streak state: when active, every turn waypoint reuses these axis/dir
  // values so consecutive bends compound into a single sweeping arc. A
  // straight waypoint resets the streak so the next corner can pick a fresh
  // direction.
  let streakAxis = 'x'
  let streakDir = 1
  let streakRemaining = 0

  for (let i = 0; i < cfg.turns + 4; i++) {
    cursor = cursor.clone()
    // Keep the first two waypoints colinear with the start so the opening
    // ~28 world units of tunnel are straight — long enough to cover the 3s
    // callsign overlay at every round speed (max 6.5 u/s × 3s ≈ 20 units).
    const isTurn = i >= 2 && Math.random() < 0.95
    if (isTurn) {
      cursor.z += segmentLen * turnForwardFrac
      if (streakRemaining <= 0) {
        // Begin a fresh streak — pick a new axis/direction and commit for
        // 2–3 more turn waypoints after this one (3–4 total in the arc).
        streakAxis = Math.random() < 0.5 ? 'x' : 'y'
        streakDir  = Math.random() < 0.5 ? 1 : -1
        streakRemaining = 2 + Math.floor(Math.random() * 2)
      } else {
        streakRemaining--
      }
      cursor[streakAxis] += streakDir * turnMag * (0.75 + Math.random() * 0.35)
    } else {
      cursor.z += segmentLen
      streakRemaining = 0   // a straight pad breaks the streak
    }
    points.push(cursor.clone())
  }

  return new THREE.CatmullRomCurve3(points, false, 'centripetal')
}

// Per-round chatter-distraction density. Rounds 1 and 3 get nothing.
// Round 2 = audible-but-spaced; round 4 = near-continuous; round 5 = sparse
// because static is already playing there. The engine's same-voice rule
// caps actual density when attempts arrive faster than a clip's ~2–4 s length.
const DISTRACTION_PLAN = [
  null,                                       // round 1
  { startMs: 3000, gapMs: [3000, 7000] },     // round 2
  null,                                       // round 3
  { startMs: 1500, gapMs: [400,  1800] },     // round 4
  { startMs: 4000, gapMs: [5000, 11000] },    // round 5 (also has static)
]

const SHAPE_COLORS = [0x5baaff, 0xff7066, 0xffd166, 0x80f0a0]

// ── R3F components ───────────────────────────────────────────────────────────

// Shared GLSL fragment that injects a localized warning glow only near the
// ball's current position. Returns { warnColor, warnIntensity } in the
// caller's scope so the surrounding material can tint itself accordingly.
const WALL_WARN_FRAGMENT = `
  float dToBall = length(vWorldPos - uBallPos);
  // Falloff: full intensity within ~1.8 units of the ball, fading to 0 by ~7 units.
  float falloff = 1.0 - smoothstep(1.8, 7.0, dToBall);
  float warn = smoothstep(0.65, 1.0, uProximity);
  vec3 warnColor = mix(vec3(0.95, 0.55, 0.12), vec3(1.0, 0.13, 0.16), uScraping);
  float warnIntensity = max(warn, uScraping) * falloff;
`

function TunnelMesh({ curve, proximityRef, ballPosRef }) {
  const geometry = useMemo(
    () => new THREE.TubeGeometry(curve, 200, TUNNEL_RADIUS, 24, false),
    [curve]
  )
  const shaderRef = useRef(null)

  const material = useMemo(() => {
    // Opaque on purpose. Earlier transparency (opacity 0.85) caused shapes
    // sitting inside future curve sections to bleed through the nearer
    // wall when the tunnel bent — three.js alpha-blends the wall on top
    // of the further shape, so 15 % of the shape was always visible
    // through the wall. Going opaque restores correct depth occlusion;
    // the warning glow still works because it's emissive, not alpha-based.
    const mat = new THREE.MeshStandardMaterial({
      color: '#0c2a4a',
      side: THREE.BackSide,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBallPos   = { value: new THREE.Vector3() }
      shader.uniforms.uProximity = { value: 0 }
      shader.uniforms.uScraping  = { value: 0 }

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uBallPos;
          uniform float uProximity;
          uniform float uScraping;
          varying vec3 vWorldPos;`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          ${WALL_WARN_FRAGMENT}
          totalEmissiveRadiance += warnColor * warnIntensity * 1.6;`
        )
      shaderRef.current = shader
    }
    return mat
  }, [])

  useFrame(() => {
    const shader = shaderRef.current
    if (!shader || !ballPosRef?.current || !proximityRef?.current) return
    shader.uniforms.uBallPos.value.copy(ballPosRef.current)
    shader.uniforms.uProximity.value = proximityRef.current.value
    shader.uniforms.uScraping.value  = proximityRef.current.scraping ? 1 : 0
  })

  return <mesh geometry={geometry} material={material} />
}

function TunnelStripes({ curve, proximityRef, ballPosRef }) {
  const geometry = useMemo(
    () => new THREE.TubeGeometry(curve, 220, TUNNEL_RADIUS * 0.985, 16, false),
    [curve]
  )
  const shaderRef = useRef(null)

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#5baaff',
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBallPos   = { value: new THREE.Vector3() }
      shader.uniforms.uProximity = { value: 0 }
      shader.uniforms.uScraping  = { value: 0 }

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uBallPos;
          uniform float uProximity;
          uniform float uScraping;
          varying vec3 vWorldPos;`
        )
        .replace(
          '#include <dithering_fragment>',
          `${WALL_WARN_FRAGMENT}
          gl_FragColor.rgb = mix(gl_FragColor.rgb, warnColor, warnIntensity);
          gl_FragColor.a = clamp(gl_FragColor.a + warnIntensity * 0.45, 0.0, 1.0);
          #include <dithering_fragment>`
        )
      shaderRef.current = shader
    }
    return mat
  }, [])

  useFrame(() => {
    const shader = shaderRef.current
    if (!shader || !ballPosRef?.current || !proximityRef?.current) return
    shader.uniforms.uBallPos.value.copy(ballPosRef.current)
    shader.uniforms.uProximity.value = proximityRef.current.value
    shader.uniforms.uScraping.value  = proximityRef.current.scraping ? 1 : 0
  })

  return <mesh geometry={geometry} material={material} />
}

function ShapeGate({ event, curve, ballT }) {
  // Compute world position + orientation along the curve at this event's t.
  // Lateral offset (event.offsetU/V) is in the shape's local cross-section
  // frame — applying the quaternion rotates it into world space so shapes
  // sit off-centre in the tunnel instead of all on the centreline.
  const { position, quaternion } = useMemo(() => {
    const pos = curve.getPointAt(event.t)
    const tan = curve.getTangentAt(event.t).normalize()
    const up  = new THREE.Vector3(0, 1, 0)
    const m   = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), tan, up)
    const q   = new THREE.Quaternion().setFromRotationMatrix(m)
    const local = new THREE.Vector3(event.offsetU || 0, event.offsetV || 0, 0)
    pos.add(local.applyQuaternion(q))
    return { position: pos, quaternion: q }
  }, [event.t, event.offsetU, event.offsetV, curve])

  // Shapes ahead of the ball glow brighter; ones behind dim out.
  const passed = ballT > event.t
  const opacity = passed ? 0.15 : 1
  const color = SHAPE_COLORS[event.colorIdx % SHAPE_COLORS.length]

  // All three shapes are pure 3D borders (no inner fill / no invisible black
  // panel), rendered with an emissive standard material so the player sees the
  // chunky tube/bar shading rather than a flat ring.
  if (event.shape === 'circle') {
    return (
      <mesh position={position} quaternion={quaternion}>
        <torusGeometry args={[SHAPE_RADIUS, 0.13, 16, 64]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={passed ? 0.15 : 0.55}
          transparent
          opacity={opacity}
        />
      </mesh>
    )
  }
  if (event.shape === 'triangle') {
    // Three chunky 3D bars forming an equilateral triangle frame — vertex up.
    // Side length = SHAPE_RADIUS * sqrt(3) for an equilateral triangle whose
    // circumscribed circle has radius SHAPE_RADIUS, matching circle/square
    // visual size. Each bar is positioned at the midpoint of an edge and
    // rotated to lie along that edge.
    const barT = 0.13
    const sideLen = SHAPE_RADIUS * Math.sqrt(3) + barT
    // Vertices of the inscribed triangle (z=0 plane, vertex up).
    const v0 = [0,  SHAPE_RADIUS, 0]                                                // top
    const v1 = [-SHAPE_RADIUS * Math.sqrt(3) / 2, -SHAPE_RADIUS / 2, 0]              // bottom-left
    const v2 = [ SHAPE_RADIUS * Math.sqrt(3) / 2, -SHAPE_RADIUS / 2, 0]              // bottom-right
    const edges = [
      // [midpoint, rotation-z-radians-around-z-axis]
      [[(v0[0] + v1[0]) / 2, (v0[1] + v1[1]) / 2, 0], Math.atan2(v1[1] - v0[1], v1[0] - v0[0])],
      [[(v1[0] + v2[0]) / 2, (v1[1] + v2[1]) / 2, 0], 0],                            // horizontal bottom
      [[(v0[0] + v2[0]) / 2, (v0[1] + v2[1]) / 2, 0], Math.atan2(v2[1] - v0[1], v2[0] - v0[0])],
    ]
    return (
      <group position={position} quaternion={quaternion}>
        {edges.map(([pos, rotZ], i) => (
          <mesh key={i} position={pos} rotation={[0, 0, rotZ]}>
            <boxGeometry args={[sideLen, barT, barT]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={passed ? 0.15 : 0.55}
              transparent
              opacity={opacity}
            />
          </mesh>
        ))}
      </group>
    )
  }
  // Square: 4 chunky 3D bars forming a hollow frame — no inner panel.
  const barT = 0.13
  const barLen = SHAPE_RADIUS * 2 + barT
  return (
    <group position={position} quaternion={quaternion}>
      {[
        [0,  SHAPE_RADIUS, 0, barLen, barT,   barT],
        [0, -SHAPE_RADIUS, 0, barLen, barT,   barT],
        [ SHAPE_RADIUS, 0, 0, barT,   barLen, barT],
        [-SHAPE_RADIUS, 0, 0, barT,   barLen, barT],
      ].map((seg, i) => (
        <mesh key={i} position={[seg[0], seg[1], seg[2]]}>
          <boxGeometry args={[seg[3], seg[4], seg[5]]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={passed ? 0.15 : 0.55}
            transparent
            opacity={opacity}
          />
        </mesh>
      ))}
    </group>
  )
}

// The white player ball — reads ballPosRef directly (world coords).
function PlayerBall({ ballPosRef }) {
  const ref = useRef()
  useFrame(() => {
    if (!ref.current) return
    ref.current.position.copy(ballPosRef.current)
  })
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
      <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} />
    </mesh>
  )
}

// First-person chase camera — sits just behind the ball along the ball's own
// forward direction. Crucially, the camera follows the BALL (not the curve),
// so when the curve bends and the player doesn't turn, the player visually
// sees the tunnel drift to one side rather than the ball pinned to centre.
//
// However, the raw "behind-the-ball" position can land outside the tube on
// sharp bends, so we clamp the camera laterally to the nearest cross-section
// of the curve.
function ChaseCamera({ ballPosRef, ballForwardRef, ballTRef, curve }) {
  const { camera } = useThree()
  useFrame(() => {
    const pos = ballPosRef.current
    const fwd = ballForwardRef.current
    const ballT = ballTRef.current

    // World-Y is always our up reference. The tunnel curve never tilts more
    // than ~50° off horizontal and the ball-forward cone keeps fwd within
    // 75° of the tangent, so fwd.y can't approach the vertical singularity
    // that would justify swapping axes.
    const worldUp = new THREE.Vector3(0, 1, 0)
    const camRight = new THREE.Vector3().crossVectors(fwd, worldUp).normalize()
    const camUp    = new THREE.Vector3().crossVectors(camRight, fwd).normalize()

    const desiredPos = pos.clone()
      .addScaledVector(fwd,   -1.6)              // 1.6 units behind the ball
      .addScaledVector(camUp,  0.45)             // 0.45 units above

    // Sample the curve backward from ballT to find the nearest cross-section
    // for the camera, then clamp the camera's lateral offset to keep it safely
    // inside the tube (margin of 0.3 from the wall).
    //
    // Pass 1: coarse scan of 9 samples across a 0.05-t window behind the ball
    // to bracket the minimum. Pass 2: golden-section refine inside the bracket
    // so the anchor slides CONTINUOUSLY with desiredPos instead of snapping
    // between fixed sample points — that snap is what produces the judder you
    // can see when the ball scrapes a wall and desiredPos jitters frame-to-frame.
    const SAFE_RADIUS = TUNNEL_RADIUS - 0.3
    const COARSE_RANGE = 0.05
    const COARSE_SAMPLES = 8
    const coarseStep = COARSE_RANGE / COARSE_SAMPLES
    let bestT = Math.max(0, ballT - 0.012)
    let bestDist = Infinity
    for (let i = 0; i <= COARSE_SAMPLES; i++) {
      const ti = Math.max(0, ballT - coarseStep * i)
      const d = curve.getPointAt(ti).distanceTo(desiredPos)
      if (d < bestDist) { bestDist = d; bestT = ti }
    }
    let lo = Math.max(0, bestT - coarseStep)
    let hi = Math.min(ballT, bestT + coarseStep)
    if (hi > lo) {
      const GR = 0.6180339887   // (sqrt(5) - 1) / 2
      let xL = hi - (hi - lo) * GR
      let xR = lo + (hi - lo) * GR
      let dL = curve.getPointAt(xL).distanceTo(desiredPos)
      let dR = curve.getPointAt(xR).distanceTo(desiredPos)
      for (let i = 0; i < 4; i++) {
        if (dL < dR) {
          hi = xR
          xR = xL; dR = dL
          xL = hi - (hi - lo) * GR
          dL = curve.getPointAt(xL).distanceTo(desiredPos)
        } else {
          lo = xL
          xL = xR; dL = dR
          xR = lo + (hi - lo) * GR
          dR = curve.getPointAt(xR).distanceTo(desiredPos)
        }
      }
      if (dL < dR) { bestT = xL; bestDist = dL }
      else         { bestT = xR; bestDist = dR }
    }
    const cCurve = curve.getPointAt(bestT)
    const cTan   = curve.getTangentAt(bestT)
    const rel    = desiredPos.clone().sub(cCurve)
    const along  = rel.dot(cTan)
    const lateral = rel.clone().addScaledVector(cTan, -along)
    const lateralMag = lateral.length()
    if (lateralMag > SAFE_RADIUS) {
      lateral.multiplyScalar(SAFE_RADIUS / lateralMag)
      desiredPos.copy(cCurve).add(lateral).addScaledVector(cTan, along)
    }

    // Order matters: lookAt() consumes camera.up at call time to compute
    // roll, so writing camera.up AFTER lookAt would leave roll a frame stale.
    camera.position.copy(desiredPos)
    camera.up.copy(camUp)
    const lookTarget = pos.clone().addScaledVector(fwd, 5)
    camera.lookAt(lookTarget)
  })
  return null
}

// ── Game-state hook ──────────────────────────────────────────────────────────

// Tracks the live game state for one round. Exposes everything the React tree
// needs to render the canvas + HUD without re-rendering every frame.
function useActRoundState(roundIdx, audio, onRoundComplete, memoryCode) {
  const cfg     = ROUND_CONFIG[roundIdx]
  const userCallsign = useMemo(() => pickCallsigns(cfg.callsigns), [roundIdx])
  const curve   = useMemo(() => buildTunnelCurve(roundIdx), [roundIdx])
  const events  = useMemo(() => generateShapeEvents(curve.getLength(), cfg.shapes, roundIdx), [curve, cfg.shapes, roundIdx])
  const audioCues = useMemo(() => generateAudioPlan(events, cfg, userCallsign, roundIdx, curve.getLength(), memoryCode), [events, cfg, userCallsign, roundIdx, curve, memoryCode])

  const ballTRef       = useRef(0)
  const ballPosRef     = useRef(new THREE.Vector3())
  const ballForwardRef = useRef(new THREE.Vector3(0, 0, 1))
  const lastTickRef    = useRef(performance.now())
  const roundStartedAtRef = useRef(performance.now())
  // dx/dy here are in pixel-equivalent units; converted to rotations via TURN_RATE.
  const inputRef       = useRef({ dx: 0, dy: 0 })
  // Live wall-proximity feedback for visual glow. value: 0 (centred) → 1 (at wall).
  const proximityRef   = useRef({ value: 0, scraping: false })

  // Initialise ball pose at the start of the curve, looking along its initial tangent.
  useEffect(() => {
    ballPosRef.current.copy(curve.getPointAt(0))
    const t0 = curve.getTangentAt(0).normalize()
    ballForwardRef.current.copy(t0)
  }, [curve])

  // Snapshot state for React renders (HUD, callsign reminder, etc.)
  const [, forceTick] = useState(0)
  const renderEvery = useRef(0)

  // Active "avoid" instruction targeting the next matching shape, or null.
  const activeAvoidRef = useRef(null)

  // Per-round stats
  const statsRef = useRef({
    ringsThreaded: 0,
    ringsMissed: 0,
    avoidObeyed: 0,
    avoidViolated: 0,
    wallScrapeSeconds: 0,
    bleepHits: 0,
    bleepMisses: 0,
    bleepFalseAlarms: 0,
    reactionMsList: [],
    score: 0,
  })

  // Round-1 bleep tutorial. While `tutorialActiveRef.current` is true the
  // game loop pauses (no motion, no audio cues, no scoring) and the JSX
  // shows a "press the button when you hear a bleep" overlay + pulses the
  // bleep button. `onBleepTap` dismisses the tutorial. State mirrors the
  // ref so JSX can react to changes.
  const tutorialActiveRef = useRef(false)
  const [tutorialActive, setTutorialActive] = useState(false)

  // Pending bleep — set when a bleep fires; cleared on hit/miss.
  const pendingBleepRef = useRef(null)
  // Cue cursor — index of the next audio cue to fire.
  const cueIdxRef       = useRef(0)
  // Event cursor — index of the next shape event to evaluate (in order of t).
  const eventIdxRef     = useRef(0)
  // Wall-clock instant the memory-code readout finishes. Chatter stays silent
  // until then so nothing talks over the digits.
  const codeQuietUntilRef = useRef(0)

  const completedRef = useRef(false)

  // ── Pause when the player isn't there ──────────────────────────────────────
  // Locking the phone, switching app/tab, or clicking into another window all
  // drop presence. Without this the rAF loop stops (the browser stops calling
  // it) but the audio graph doesn't: the looping static and the chatter
  // setTimeout chain kept playing into a locked phone while the game itself sat
  // frozen.
  //
  // Coming back does NOT auto-resume — the player taps Resume. That's partly UX
  // (nobody wants to be dropped back into a moving tunnel mid-cue) and partly
  // necessity: iOS only lets a suspended AudioContext resume inside a user
  // gesture.
  const { present } = usePagePresence()
  const [paused, setPaused] = useState(false)
  const pausedRef   = useRef(false)
  const pausedAtRef = useRef(0)

  useEffect(() => {
    if (present || pausedRef.current || completedRef.current) return
    pausedRef.current = true
    pausedAtRef.current = performance.now()
    setPaused(true)
    audio.suspend()
  }, [present, audio])

  const resumeFromPause = useCallback(() => {
    if (!pausedRef.current) return
    const pausedMs = performance.now() - pausedAtRef.current
    // Every wall-clock deadline in the round has to move with the pause.
    // Otherwise a three-minute screen lock instantly trips the
    // MAX_ROUND_DURATION_S safety timer and scores a bleep the player never
    // had a chance to answer as a miss.
    roundStartedAtRef.current += pausedMs
    lastTickRef.current = performance.now()
    // The readout was frozen mid-sentence with the context; its quiet window
    // has to move with it or chatter resumes over the remaining digits.
    if (codeQuietUntilRef.current) codeQuietUntilRef.current += pausedMs
    pendingBleepRef.current = null
    // Drag/keyboard deltas banked while the overlay was up would otherwise
    // all apply on the first frame back.
    inputRef.current.dx = 0
    inputRef.current.dy = 0
    pausedRef.current = false
    setPaused(false)
    audio.resume()
  }, [audio])

  // If the round unmounts while paused (Instructions, navigation), thaw the
  // context on the way out — otherwise the next round starts silent.
  useEffect(() => () => { if (pausedRef.current) audio.resume() }, [audio])

  // Touch / pointer drag input. We pointer-capture on down so move/up keep
  // firing even when the cursor leaves the canvas — without capture, a
  // mid-drag exit would silently stop the input. Every move/up handler
  // gates on the captured pointerId; without that gate, a stray second
  // pointer (touch, tablet, R3F-internal synthetic event, etc.) would
  // overwrite lastPointer and the next real move would compute a delta
  // against the wrong reference, producing the "darting cursor" jitter.
  // While captured we also hide the OS cursor globally so the drag feels
  // seamless even if the cursor crosses the canvas edge.
  const pointerActiveRef  = useRef(false)
  const lastPointerRef    = useRef({ x: 0, y: 0 })
  const capturedPointerIdRef = useRef(null)
  // Mirrored as React state so the touch-steer pad can hide its idle hint
  // while any drag is active (whether on the canvas or the pad).
  const [isDragging, setIsDragging] = useState(false)

  const onPointerDown = useCallback((e) => {
    // Already dragging on a different pointer — ignore secondary inputs so
    // they can't reset lastPointer and cause a frame of huge dx/dy.
    if (capturedPointerIdRef.current != null) return
    pointerActiveRef.current = true
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId)
      capturedPointerIdRef.current = e.pointerId
    } catch {}
    document.body.style.cursor = 'none'
    setIsDragging(true)
  }, [])
  const onPointerMove = useCallback((e) => {
    if (!pointerActiveRef.current) return
    // Only the captured pointer is allowed to move the ball — everything
    // else is a stray that would corrupt the delta reference.
    const pid = capturedPointerIdRef.current
    if (pid != null && e.pointerId !== pid) return
    const dx = e.clientX - lastPointerRef.current.x   // raw pixel delta
    const dy = e.clientY - lastPointerRef.current.y
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    inputRef.current.dx += dx
    inputRef.current.dy += dy
  }, [])
  const onPointerUp = useCallback((e) => {
    // A different pointer going up shouldn't end the captured drag.
    const pid = capturedPointerIdRef.current
    if (pid != null && e?.pointerId != null && e.pointerId !== pid) return
    pointerActiveRef.current = false
    if (pid != null && e?.currentTarget?.releasePointerCapture) {
      try { e.currentTarget.releasePointerCapture(pid) } catch {}
    }
    capturedPointerIdRef.current = null
    document.body.style.cursor = ''
    setIsDragging(false)
  }, [])

  // Safety: if the round unmounts mid-drag (menu, navigation, errors),
  // restore the body cursor so the user isn't left with an invisible cursor.
  useEffect(() => () => { document.body.style.cursor = '' }, [])

  // Keyboard input. Each tick adds a fixed pixel-equivalent to the input
  // accumulator so keyboard and touch share the same TURN_RATE conversion.
  useEffect(() => {
    const keys = new Set()
    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
        keys.add(e.key)
        e.preventDefault()
      }
    }
    const onKeyUp = (e) => keys.delete(e.key)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    const interval = setInterval(() => {
      if (pausedRef.current) return
      const k = KEYBOARD_RATE_PER_TICK
      if (keys.has('ArrowLeft')  || keys.has('a') || keys.has('A')) inputRef.current.dx -= k
      if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) inputRef.current.dx += k
      if (keys.has('ArrowUp')    || keys.has('w') || keys.has('W')) inputRef.current.dy -= k   // up arrow = pitch up
      if (keys.has('ArrowDown')  || keys.has('s') || keys.has('S')) inputRef.current.dy += k
    }, 16)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      clearInterval(interval)
    }
  }, [])

  // Bleep button handler — exposed for the JSX.
  const onBleepTap = useCallback(() => {
    // Tutorial path: any tap during the round-1 tutorial dismisses it and
    // resumes gameplay. Doesn't count as a scored hit.
    if (tutorialActiveRef.current) {
      tutorialActiveRef.current = false
      setTutorialActive(false)
      return
    }
    const pending = pendingBleepRef.current
    if (!pending) {
      // False alarm — tap with no bleep playing. Tests selective inhibition;
      // every impulsive tap costs points, no debounce (spam-clicks compound).
      statsRef.current.score += SCORE.BLEEP_FALSE
      statsRef.current.bleepFalseAlarms += 1
      return
    }
    const reactionMs = performance.now() - pending.startedAt
    if (reactionMs > 2000) return     // shouldn't be possible (pending auto-clears) but defensive
    let delta
    if (reactionMs < 500) delta = SCORE.BLEEP_FAST
    else if (reactionMs < 1000) delta = SCORE.BLEEP_MED
    else delta = SCORE.BLEEP_SLOW
    statsRef.current.score += delta
    statsRef.current.bleepHits += 1
    statsRef.current.reactionMsList.push(reactionMs)
    pendingBleepRef.current = null
  }, [])

  // Trigger the round-1 bleep tutorial. Plays a single bleep, pauses the
  // game loop, and shows the overlay + button pulse until the player taps.
  // A separate effect (below) loops the bleep at ~1.4 s intervals while the
  // tutorial is active so the cue is unmissable for a player who didn't catch
  // the first one.
  const startBleepTutorial = useCallback(() => {
    tutorialActiveRef.current = true
    setTutorialActive(true)
    audio.playBleep()
    // Note: pendingBleepRef stays null so this isn't scored as a hit/miss.
  }, [audio])

  // While the bleep tutorial overlay is up, re-fire the bleep every ~1.4 s
  // (just longer than the bleep's 0.46 s tail, so consecutive bleeps don't
  // overlap). Cleared the moment the player taps BLEEP (onBleepTap flips
  // tutorialActive false) or the round unmounts.
  useEffect(() => {
    if (!tutorialActive) return
    const id = setInterval(() => {
      if (!tutorialActiveRef.current || pausedRef.current) return
      audio.playBleep()
    }, 1400)
    return () => clearInterval(id)
  }, [tutorialActive, audio])

  // Static-noise distractor on rounds 1, 3, 5 (roundIdx 0, 2, 4). Volume is
  // pulled from the engine's admin-configured value (set via setVolumes from
  // the main page) — same level as the voice clips by default so the static
  // genuinely masks voices instead of sitting underneath them.
  useEffect(() => {
    const useStatic = roundIdx % 2 === 0
    if (useStatic) audio.startStatic()
    return () => audio.stopStatic()
  }, [roundIdx, audio])

  // Chatter-distraction scheduler — rounds 2, 4, 5 (roundIdx 1, 3, 4).
  // Each tick attempts a play in a randomly picked voice; the audio engine
  // drops the call if that voice is still mid-clip, so per-round density is
  // bounded both by gap range and by the engine's same-voice rule.
  useEffect(() => {
    const plan = DISTRACTION_PLAN[roundIdx]
    if (!plan) return
    let cancelled = false
    let timer = null
    const fire = () => {
      if (cancelled) return
      // Keep the chain alive but silent while paused — the context is
      // suspended, so a play scheduled here would just queue up and land the
      // moment the player resumes. Same during the memory-code readout, which
      // the player has to hear cleanly.
      if (!pausedRef.current && performance.now() >= codeQuietUntilRef.current) {
        const voice = Math.random() < 0.5 ? 'male' : 'female'
        audio.playDistraction({ voice })
      }
      const [lo, hi] = plan.gapMs
      timer = setTimeout(fire, lo + Math.random() * (hi - lo))
    }
    timer = setTimeout(fire, plan.startMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [roundIdx, audio])

  // Main game loop — runs via requestAnimationFrame.
  useEffect(() => {
    let raf = null
    const totalLen = curve.getLength()
    const maxR = TUNNEL_RADIUS - BALL_RADIUS

    const tick = () => {
      const now = performance.now()

      // ── 0a. Presence pause. Only reachable when the window lost focus but
      // stayed visible — a hidden page stops getting rAF callbacks at all.
      // Re-base lastTick each frame so the paused interval never lands as one
      // giant dt when the player resumes.
      if (pausedRef.current) {
        lastTickRef.current = now
        raf = requestAnimationFrame(tick)
        return
      }

      const dt  = Math.min(0.05, (now - lastTickRef.current) / 1000)
      lastTickRef.current = now

      // ── 0. Tutorial pause — round-1 bleep teach moment. While active,
      // skip motion, audio cue firing, scoring, and shape evaluation.
      // Resumes on the next frame after the player taps BLEEP. dt is
      // already captured/clamped above so we don't accumulate a giant
      // delta when the loop unpauses.
      if (tutorialActiveRef.current) {
        raf = requestAnimationFrame(tick)
        return
      }

      // ── 1. Apply pending steering input as a rotation of the ball's forward ──
      // Yaw around world-up; pitch around camera-right. The per-tick magnitude
      // is capped at MAX_ROT_PER_TICK so a single frame can't spin the ball
      // through a half-revolution. Whatever pixels exceed the cap are KEPT in
      // the accumulator and applied next frame, so big flicks aren't silently
      // discarded — they just take an extra frame or two to fully play out.
      const fwd = ballForwardRef.current
      const worldUp = new THREE.Vector3(0, 1, 0)
      const camRight = new THREE.Vector3().crossVectors(fwd, worldUp).normalize()
      const wantedYaw   = -inputRef.current.dx * TURN_RATE
      const wantedPitch =  inputRef.current.dy * TURN_RATE   // dy>0 (drag down) pitches the ball downward
      const yaw   = Math.max(-MAX_ROT_PER_TICK, Math.min(MAX_ROT_PER_TICK, wantedYaw))
      const pitch = Math.max(-MAX_ROT_PER_TICK, Math.min(MAX_ROT_PER_TICK, wantedPitch))
      // Pixel-equivalents of what we just applied — pull only those out of the
      // accumulator. Anything left over rolls into the next frame.
      inputRef.current.dx -= -yaw   / TURN_RATE
      inputRef.current.dy -=  pitch / TURN_RATE
      if (yaw   !== 0) fwd.applyAxisAngle(worldUp,  yaw)
      if (pitch !== 0) fwd.applyAxisAngle(camRight, pitch)
      fwd.normalize()

      // Clamp ball-forward to stay inside a cone of MAX_FWD_DEVIATION_RAD
      // around the tunnel's tangent at the ball's current t. This prevents
      // any combination of player input + passive curve bend from rotating
      // the camera past perpendicular (let alone backwards). When fwd is
      // outside the cone, snap it back to the cone surface along its own
      // lateral direction — the player just stops turning further; pending
      // input keeps draining at the cap rate so they don't queue up rotation
      // that can't actually apply.
      const curveTan = curve.getTangentAt(ballTRef.current)
      const fwdDotTan = fwd.dot(curveTan)
      if (fwdDotTan < MAX_FWD_DEVIATION_COS) {
        const perp = fwd.clone().addScaledVector(curveTan, -fwdDotTan)
        const perpLen = perp.length()
        if (perpLen > 1e-6) {
          perp.divideScalar(perpLen)
          const sinDev = Math.sqrt(1 - MAX_FWD_DEVIATION_COS * MAX_FWD_DEVIATION_COS)
          fwd.copy(curveTan).multiplyScalar(MAX_FWD_DEVIATION_COS).addScaledVector(perp, sinDev)
        } else {
          fwd.copy(curveTan)
        }
      }

      // ── 2. Advance position along the ball's own forward direction. ───────
      ballPosRef.current.addScaledVector(fwd, cfg.speed * dt)

      // ── 3. Update curve-t. ───────────────────────────────────────────────
      // Two contributions:
      //   (a) Nearest-point search around the previous t — lets organic
      //       forward motion (ball-forward roughly aligned with the curve
      //       tangent) register at its natural rate.
      //   (b) A floor of cfg.speed/curveLen worth of t-advance per frame —
      //       guarantees forward progress even when the player is steering
      //       hard into a wall. Without this floor, a heavily-off-axis
      //       ball-forward yields near-zero tangent component, the snap
      //       step then resets ball-pos to curve(oldT)+lateral, and t
      //       stalls. With it, a wall-scraping player glides along the
      //       wall at the same forward rate as a clean run.
      // ballT only advances — it never regresses, so a player who turns
      // around still sees their progress preserved and the round can finish.
      const prevT = ballTRef.current
      let bestT = prevT
      let bestDist = curve.getPointAt(prevT).distanceTo(ballPosRef.current)
      const SEARCH_RADIUS = 0.06
      const SAMPLES = 12
      for (let i = 1; i <= SAMPLES; i++) {
        const off = SEARCH_RADIUS * (i / SAMPLES)
        for (const sign of [1, -1]) {
          const ti = Math.min(1, Math.max(0, prevT + sign * off))
          const d = curve.getPointAt(ti).distanceTo(ballPosRef.current)
          if (d < bestDist) { bestDist = d; bestT = ti }
        }
      }
      const forcedT = Math.min(1, prevT + (cfg.speed * dt) / totalLen)
      ballTRef.current = Math.max(prevT, bestT, forcedT)

      // ── 4. Wall collision: project ball-pos onto cross-section at new t. ──
      const c_new   = curve.getPointAt(ballTRef.current)
      const tan_new = curve.getTangentAt(ballTRef.current)
      const lateralVec = ballPosRef.current.clone().sub(c_new)
      lateralVec.addScaledVector(tan_new, -lateralVec.dot(tan_new))   // strip tangent component
      const lateralMag = lateralVec.length()
      let scraping = false
      if (lateralMag > maxR) {
        // Snap to wall — ball glides along (no bounce).
        lateralVec.multiplyScalar(maxR / lateralMag)
        ballPosRef.current.copy(c_new).add(lateralVec)
        scraping = true
      }
      if (scraping) {
        statsRef.current.wallScrapeSeconds += dt
        statsRef.current.score += SCORE.WALL_PER_SECOND * dt
      }

      // Update proximity ref for the wall-glow renderer.
      proximityRef.current.value = Math.min(1, lateralMag / maxR)
      proximityRef.current.scraping = scraping

      // ── 5. Fire audio cues whose t we just crossed. ───────────────────────
      // Instruction cues (avoid/distractor) are exclusive — if one is already
      // playing, the new one is silently dropped to avoid two voices overlapping.
      // For valid avoids that get dropped, we also skip arming activeAvoidRef
      // so the player isn't held to an instruction they never heard.
      while (cueIdxRef.current < audioCues.length && audioCues[cueIdxRef.current].t <= ballTRef.current) {
        const cue = audioCues[cueIdxRef.current++]
        if (cue.kind === 'avoid') {
          // Resolve the avoid target NOW so it matches what the player sees:
          // the first un-passed event of the cue's shape, with a small
          // lookahead so it can't land before the audio finishes. If nothing
          // valid is ahead, drop the cue silently (don't play audio that
          // can't be scored coherently).
          // Off-screen rule: the resolved target must be beyond the rendered
          // horizon (ActScene renders events[firstUpcoming..firstUpcoming+RENDERED_AHEAD]).
          // Picking a same-shape that's already rendered would let the player
          // mistake a visible non-target for the avoid target. The audio
          // planner already enforces this at scheduling time; this re-check
          // guards against runtime drift (e.g. player progressing faster than
          // planned past the cue's audioT).
          const minIdx = eventIdxRef.current + RENDERED_AHEAD
          let dynTargetId = null
          for (let k = minIdx; k < events.length; k++) {
            if (events[k].shape !== cue.shape) continue
            dynTargetId = events[k].id
            break
          }
          if (dynTargetId == null) continue
          const result = audio.playSequence(buildAvoidSequence(cue.callsigns, cue.shape), { exclusive: true })
          if (result.played) {
            activeAvoidRef.current = { targetId: dynTargetId, shape: cue.shape }
          }
        } else if (cue.kind === 'distractor') {
          audio.playSequence(buildAvoidSequence(cue.callsigns, cue.shape), { exclusive: true })
        } else if (cue.kind === 'bleep') {
          audio.playBleep()
          pendingBleepRef.current = { startedAt: performance.now() }
        } else if (cue.kind === 'code') {
          // Round-5 memory code. The planner reserves a cue-free block around
          // this, so nothing should be in flight to drop it; the chatter
          // scheduler is held off for the readout's real duration on top.
          const digits = cue.code.split('')
          audio.playCode(digits)
          codeQuietUntilRef.current = performance.now() + audio.codeDurationS(digits) * 1000
        }
      }

      // ── 6. Bleep timeout. ─────────────────────────────────────────────────
      if (pendingBleepRef.current) {
        const age = performance.now() - pendingBleepRef.current.startedAt
        if (age > 2000) {
          statsRef.current.bleepMisses += 1
          statsRef.current.score += SCORE.BLEEP_MISS
          pendingBleepRef.current = null
        }
      }

      // ── 7. Evaluate shape events as the ball passes them. ─────────────────
      while (eventIdxRef.current < events.length && events[eventIdxRef.current].t <= ballTRef.current) {
        const ev = events[eventIdxRef.current++]
        const shapeCentre  = curve.getPointAt(ev.t)
        const shapeTangent = curve.getTangentAt(ev.t)
        // Apply the same lateral offset the renderer uses so the threading
        // check matches what the player sees.
        if (ev.offsetU || ev.offsetV) {
          const upRef = new THREE.Vector3(0, 1, 0)
          const evMat = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), shapeTangent.clone().normalize(), upRef)
          const evQuat = new THREE.Quaternion().setFromRotationMatrix(evMat)
          const offsetLocal = new THREE.Vector3(ev.offsetU || 0, ev.offsetV || 0, 0).applyQuaternion(evQuat)
          shapeCentre.add(offsetLocal)
        }
        // Project ball→shape onto the cross-section perpendicular to the curve
        // at ev.t. This measures the LATERAL offset only — the same thing the
        // wall-snap uses — so a small tangential offset (which can happen when
        // the forcedT floor advances ballT slightly ahead of physical motion)
        // doesn't bloat the distance and falsely register a miss.
        const offset = ballPosRef.current.clone().sub(shapeCentre)
        offset.addScaledVector(shapeTangent, -offset.dot(shapeTangent))
        const lateralFromShape = offset.length()
        const threadedThrough = lateralFromShape < SHAPE_RADIUS - BALL_RADIUS
        const activeAvoid = activeAvoidRef.current && activeAvoidRef.current.targetId === ev.id

        if (activeAvoid) {
          if (threadedThrough) {
            statsRef.current.avoidViolated += 1
            statsRef.current.score += SCORE.AVOID_VIOLATED
          } else {
            statsRef.current.avoidObeyed += 1
            statsRef.current.score += SCORE.AVOID_OBEYED
          }
          activeAvoidRef.current = null
        } else {
          if (threadedThrough) {
            statsRef.current.ringsThreaded += 1
            statsRef.current.score += SCORE.RING_THREADED
          } else {
            statsRef.current.ringsMissed += 1
            statsRef.current.score += SCORE.RING_MISSED
          }
        }
        ev.threaded = threadedThrough
      }

      // Throttle React re-renders to ~10fps for HUD.
      renderEvery.current++
      if (renderEvery.current % 6 === 0) forceTick(t => t + 1)

      // End of round? Either the ball reached the curve end OR the safety
      // timer fired (something pathological glued the ball to a wall — bail
      // gracefully so the player isn't stuck on a dead level).
      const elapsedRoundS = (now - roundStartedAtRef.current) / 1000
      const forceEnd = elapsedRoundS > MAX_ROUND_DURATION_S
      if (forceEnd) ballTRef.current = 1
      if (ballTRef.current >= 1 && !completedRef.current) {
        completedRef.current = true
        // Flush any remaining pending bleep as a miss.
        if (pendingBleepRef.current) {
          statsRef.current.bleepMisses += 1
          statsRef.current.score += SCORE.BLEEP_MISS
          pendingBleepRef.current = null
        }
        audio.stopAll()
        audio.stopStatic()
        const reactionList = statsRef.current.reactionMsList
        const avgReaction = reactionList.length ? reactionList.reduce((a, b) => a + b, 0) / reactionList.length : 0
        onRoundComplete({
          ...statsRef.current,
          avgBleepReactionMs: Math.round(avgReaction),
          callsign: userCallsign,
        })
        return
      }

      raf = requestAnimationFrame(tick)
    }

    lastTickRef.current = performance.now()
    roundStartedAtRef.current = performance.now()
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [roundIdx])

  return {
    curve,
    events,
    userCallsign,
    ballTRef,
    ballPosRef,
    ballForwardRef,
    proximityRef,
    statsRef,
    pendingBleepRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    isDragging,
    onBleepTap,
    tutorialActive,
    startBleepTutorial,
    paused,
    resumeFromPause,
  }
}

// Wraps the canvas + ball/camera/shape components so they share the live
// refs without forcing top-level re-renders every frame.
function ActScene({ state }) {
  const [, forceFrameTick] = useState(0)
  useEffect(() => {
    let raf
    const loop = () => { forceFrameTick(t => (t + 1) % 1024); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const ballT = state.ballTRef.current

  return (
    <Canvas
      camera={{ fov: 70, near: 0.1, far: 200, position: [0, 0, -3] }}
      onPointerDown={state.onPointerDown}
      onPointerMove={state.onPointerMove}
      onPointerUp={state.onPointerUp}
      onPointerCancel={state.onPointerUp}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={['#020812']} />
      <fog attach="fog" args={['#020812', 12, 60]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={0.6} />

      <TunnelMesh    curve={state.curve} proximityRef={state.proximityRef} ballPosRef={state.ballPosRef} />
      <TunnelStripes curve={state.curve} proximityRef={state.proximityRef} ballPosRef={state.ballPosRef} />

      {/* Render only the just-passed shape (for smooth fade-out) + the next
          3 upcoming shapes. Anything further ahead is hidden so the player
          can't see through the tunnel walls to plan future moves. */}
      {(() => {
        const events = state.events
        let firstUpcoming = events.length
        for (let i = 0; i < events.length; i++) {
          if (events[i].t > ballT) { firstUpcoming = i; break }
        }
        const startIdx = Math.max(0, firstUpcoming - 1)
        const endIdx   = Math.min(events.length, firstUpcoming + 3)
        return events.slice(startIdx, endIdx).map(ev => (
          <ShapeGate key={ev.id} event={ev} curve={state.curve} ballT={ballT} />
        ))
      })()}

      <PlayerBall   ballPosRef={state.ballPosRef} />
      <ChaseCamera
        ballPosRef={state.ballPosRef}
        ballForwardRef={state.ballForwardRef}
        ballTRef={state.ballTRef}
        curve={state.curve}
      />
    </Canvas>
  )
}

// ── Touch steer pad ──────────────────────────────────────────────────────────

// Below-canvas drag surface for touch devices, so the player doesn't have to
// drag on top of the gameplay (which would obscure the tunnel with a finger).
// The same pointer handlers used by <Canvas> are bound here — pad input is
// additive, not exclusive. While idle (no active drag anywhere), a slow
// swipe-cue animates left↔right so first-time users discover the gesture.
function TouchSteerPad({ onPointerDown, onPointerMove, onPointerUp, isDragging }) {
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative w-full h-36 mt-3 bg-[#0a1628] border border-[#1a3a5c] rounded-xl overflow-hidden"
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
      aria-label="Touch steering pad — drag to steer"
      role="application"
    >
      <AnimatePresence>
        {!isDragging && (
          <motion.div
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          >
            <motion.div
              animate={{ x: [-44, 44, -44] }}
              transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
              className="flex items-center gap-2"
            >
              <motion.div
                animate={{ opacity: [0.55, 1, 0.55], scale: [0.92, 1.04, 0.92] }}
                transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
                className="w-9 h-9 rounded-full bg-brand-400/25 border-2 border-brand-300 shadow-[0_0_18px_rgba(91,170,255,0.45)]"
              />
            </motion.div>
            <p className="mt-3 text-[11px] uppercase tracking-widest text-slate-400">Drag to steer</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Round-end recap card ─────────────────────────────────────────────────────
function RoundRecap({ roundIdx, stats, codeResult, onContinue, isFinal }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Round {roundIdx + 1} of {TOTAL_ROUNDS} — debrief</p>
      <p className="text-xl font-extrabold text-white mb-4">
        Callsign was <span className="text-brand-300 uppercase tracking-wider">{stats.callsign.join(' ')}</span>
      </p>

      <div className="grid grid-cols-2 gap-2 mb-4 text-left">
        <Stat label="Threaded"        value={stats.ringsThreaded} good />
        <Stat label="Missed"          value={stats.ringsMissed} bad />
        <Stat label="Avoid obeyed"    value={stats.avoidObeyed} good />
        <Stat label="Avoid violated"  value={stats.avoidViolated} bad />
        <Stat label="Wall scrape"     value={`${stats.wallScrapeSeconds.toFixed(1)}s`} bad={stats.wallScrapeSeconds > 0} />
        <Stat label="Bleep hits"      value={`${stats.bleepHits}/${stats.bleepHits + stats.bleepMisses}`} good={stats.bleepHits > 0} />
        <Stat label="False taps"      value={stats.bleepFalseAlarms} bad={stats.bleepFalseAlarms > 0} />
      </div>

      {codeResult && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Memory code</p>
          <p className="font-mono text-xl font-extrabold tracking-[0.2em] mb-1">
            {codeResult.expected.split('').map((d, i) => (
              <span key={i} className={codeResult.entered[i] === d ? 'text-emerald-700' : 'text-rose-400'}>{d}</span>
            ))}
          </p>
          <p className="text-[11px] text-slate-500">
            {codeResult.allCorrect
              ? 'Perfect recall'
              : `You entered ${codeResult.entered} — ${codeResult.digitsCorrect}/${codeResult.expected.length} in position`}
          </p>
        </div>
      )}

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Round score</p>
        <p className="text-3xl font-mono font-extrabold text-brand-300">{Math.round(stats.score)}</p>
      </div>

      <button
        onClick={onContinue}
        className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
      >
        {isFinal ? 'View Final Results' : 'Continue'}
      </button>
    </motion.div>
  )
}

function Stat({ label, value, good, bad }) {
  const tone = good ? 'text-green-400' : bad ? 'text-red-400' : 'text-brand-300'
  return (
    <div className="bg-[#060e1a] rounded-md border border-[#1a3a5c] p-2">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-base font-mono font-bold ${tone}`}>{value}</p>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function CbatAct() {
  const { user, apiFetch, API } = useAuth()
  const { start: startTracking, setRound: trackRound, markCompleted: markGameCompleted } = useCbatTracking()
  const appSettings = useAppSettings()
  const settings = appSettings?.settings
  const [phase, setPhase] = useState('intro')   // intro | logoIntro | callsign | playing | recap | results
  const [roundIdx, setRoundIdx] = useState(0)
  const [allRoundStats, setAllRoundStats] = useState([])
  const [latestStats, setLatestStats]   = useState(null)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved]     = useState(false)
  const [queued, setQueued]             = useState(false)
  const [audioReady, setAudioReady]     = useState(false)
  const audioRef = useRef(null)

  // Round-5 memory code. Generated once per run and held here, above the round
  // component — ActRound unmounts when the round ends, but the answer is typed
  // in and scored after that.
  const [memoryCode, setMemoryCode]     = useState(null)
  const [pendingStats, setPendingStats] = useState(null)   // round-5 stats awaiting the recall
  const [codeResult, setCodeResult]     = useState(null)

  // Set when an admin uses the round-skip cheat. Permanent for the rest of the
  // run — the result is never submitted.
  const [debugUsed, setDebugUsed]       = useState(false)
  const [jumpNonce, setJumpNonce]       = useState(0)

  // Push admin-configured ACT volumes into the engine whenever settings or the
  // engine become available. Re-applies on settings refresh, so an admin
  // changing a slider in another tab + reloading takes effect on the next
  // round start (without needing a full page reload).
  useEffect(() => {
    if (!audioRef.current || !settings) return
    audioRef.current.setVolumes({
      volumes: {
        voiceCommand: (settings.volumeActVoiceCommand ?? 40) / 100,
        chatter:      (settings.volumeActChatter      ?? 40) / 100,
        staticNoise:  (settings.volumeActStatic       ?? 40) / 100,
        bleep:        (settings.volumeActBleep        ?? 22) / 100,
        code:         (settings.volumeActCode         ?? 85) / 100,
      },
      enabled: {
        voiceCommand: settings.soundEnabledActVoiceCommand !== false,
        chatter:      settings.soundEnabledActChatter      !== false,
        staticNoise:  settings.soundEnabledActStatic       !== false,
        bleep:        settings.soundEnabledActBleep        !== false,
        code:         settings.soundEnabledActCode         !== false,
      },
    })
  }, [audioReady, settings])

  // Skywatch logo curtain — plays once per page mount on the first
  // start. Subsequent Play Again's skip it for snappy replays.
  const logoPlayedRef = useRef(false)

  // Round-1 bleep tutorial: fires once per "session". A session ends when
  // the player explicitly returns to the instructions screen (handleMenu)
  // or navigates away from the page entirely (component unmount). Play
  // Again from the results screen does NOT reset the flag.
  const [tutorialDone, setTutorialDone] = useState(false)
  const onTutorialFired = useCallback(() => setTutorialDone(true), [])

  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'callsign' || phase === 'recap' || phase === 'codeRecall') enterImmersive()
    else exitImmersive()
    return exitImmersive
  }, [phase, enterImmersive, exitImmersive])

  // Fetch personal best
  useEffect(() => {
    if (!user) return
    apiFetch(`${API}/api/games/cbat/act/personal-best`)
      .then(r => r.json())
      .then(d => { if (d.data) setPersonalBest(d.data) })
      .catch(() => {})
  }, [user])

  const initAudio = useCallback(async () => {
    if (audioRef.current) return
    const eng = new ActAudioEngine()
    await eng.init()
    audioRef.current = eng
    setAudioReady(true)
  }, [])

  const startGame = useCallback(async () => {
    await initAudio()
    startTracking('act')
    setRoundIdx(0)
    setAllRoundStats([])
    setLatestStats(null)
    setScoreSaved(false)
    setMemoryCode(generateMemoryCode())
    setPendingStats(null)
    setCodeResult(null)
    setDebugUsed(false)
    setPhase(logoPlayedRef.current ? 'callsign' : 'logoIntro')
  }, [apiFetch, API, initAudio])

  const handleLogoComplete = useCallback(() => {
    logoPlayedRef.current = true
    setPhase('callsign')
  }, [])

  // ── Admin round-skip ───────────────────────────────────────────────────────
  // Jump straight into a round without playing the ones before it. Wipes the
  // run's stats (the earlier rounds never happened) and flags it as debug, so
  // the score is never submitted.
  const jumpToRound = useCallback(async (roundNum) => {
    await initAudio()
    if (phase === 'intro') startTracking('act')
    setDebugUsed(true)
    setRoundIdx(roundNum - 1)
    setAllRoundStats([])
    setLatestStats(null)
    setScoreSaved(false)
    setPendingStats(null)
    setCodeResult(null)
    setMemoryCode(prev => prev ?? generateMemoryCode())
    // Bumping the nonce remounts ActRound even when the jump targets the round
    // already on screen — without it, re-typing the current round's code does
    // nothing and reads as a broken cheat.
    setJumpNonce(n => n + 1)
    setPhase('callsign')
  }, [initAudio, phase, startTracking])

  // Typed cheat codes, DPT-style: 111 → round 1 … 555 → round 5. Admin +
  // desktop only, and never while the memory-code pad is up — those digit
  // presses belong to the player's answer.
  const isTouchDevice = useIsTouch()
  const cheatBufRef = useRef(emptyCheatBuffer())
  useEffect(() => {
    if (!user?.isAdmin || isTouchDevice || phase === 'codeRecall') return
    const onKeyDown = (e) => {
      const { buffer, round } = pushCheatDigit(cheatBufRef.current, e.key, Date.now())
      cheatBufRef.current = buffer
      if (round != null) jumpToRound(round)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [user, isTouchDevice, phase, jumpToRound])

  // Auto-advance from callsign reveal to playing after 3s.
  useEffect(() => {
    if (phase !== 'callsign') return
    const t = setTimeout(() => setPhase('playing'), 3000)
    return () => clearTimeout(t)
  }, [phase, roundIdx])

  useEffect(() => {
    if (phase === 'playing') trackRound(roundIdx + 1)
  }, [phase, roundIdx, trackRound])

  const commitRoundStats = useCallback((stats) => {
    setLatestStats(stats)
    setAllRoundStats(prev => [...prev, stats])
    setPhase('recap')
  }, [])

  const onRoundComplete = useCallback((stats) => {
    // Final round: the memory-code recall comes BEFORE the debrief, so a stats
    // screen can't sit between hearing the code and typing it back.
    if (roundIdx === CODE_ROUND_IDX && memoryCode) {
      setPendingStats(stats)
      setPhase('codeRecall')
      return
    }
    commitRoundStats(stats)
  }, [roundIdx, memoryCode, commitRoundStats])

  const onCodeSubmit = useCallback((entered) => {
    const result = scoreCodeRecall(memoryCode, entered)
    setCodeResult({ ...result, entered, expected: memoryCode })
    commitRoundStats({
      ...pendingStats,
      score: pendingStats.score + result.score,
      codeDigitsCorrect: result.digitsCorrect,
      codeRecalled: result.allCorrect,
    })
    setPendingStats(null)
  }, [memoryCode, pendingStats, commitRoundStats])

  const continueAfterRecap = useCallback(() => {
    if (roundIdx + 1 >= TOTAL_ROUNDS) {
      setPhase('results')
    } else {
      setRoundIdx(i => i + 1)
      setPhase('callsign')
    }
  }, [roundIdx])

  // Submit final score after results phase enters.
  useEffect(() => {
    if (phase !== 'results' || allRoundStats.length === 0 || scoreSaved) return
    // Debug run (admin skipped rounds) — never reaches the leaderboard.
    if (debugUsed) return
    const totals = allRoundStats.reduce((acc, s) => ({
      score: acc.score + s.score,
      ringsThreaded: acc.ringsThreaded + s.ringsThreaded,
      ringsMissed: acc.ringsMissed + s.ringsMissed,
      avoidObeyed: acc.avoidObeyed + s.avoidObeyed,
      avoidViolated: acc.avoidViolated + s.avoidViolated,
      wallScrapeSeconds: acc.wallScrapeSeconds + s.wallScrapeSeconds,
      bleepHits: acc.bleepHits + s.bleepHits,
      bleepMisses: acc.bleepMisses + s.bleepMisses,
      reactionList: [...acc.reactionList, ...s.reactionMsList],
    }), { score: 0, ringsThreaded: 0, ringsMissed: 0, avoidObeyed: 0, avoidViolated: 0, wallScrapeSeconds: 0, bleepHits: 0, bleepMisses: 0, reactionList: [] })
    const avgReaction = totals.reactionList.length ? totals.reactionList.reduce((a, b) => a + b, 0) / totals.reactionList.length : 0
    // Time = sum of round durations is hard to track precisely; use the total
    // configured speed-distance approximation.
    const totalTime = ROUND_CONFIG.reduce((sum, _, i) => {
      const curveLen = ROUND_CONFIG[i].speed > 0 ? 100 : 0   // rough constant per round
      return sum + curveLen / ROUND_CONFIG[i].speed
    }, 0)

    setQueued(false)
    markGameCompleted({ score: Math.max(0, Math.round(totals.score)), round: allRoundStats.length })
    submitCbatResult(`act`, {
        totalScore:         Math.max(0, Math.round(totals.score)),
        totalTime,
        finalRound:         allRoundStats.length,
        ringsThreaded:      totals.ringsThreaded,
        ringsMissed:        totals.ringsMissed,
        avoidObeyed:        totals.avoidObeyed,
        avoidViolated:      totals.avoidViolated,
        wallScrapeSeconds:  totals.wallScrapeSeconds,
        bleepHits:          totals.bleepHits,
        bleepMisses:        totals.bleepMisses,
        avgBleepReactionMs: Math.round(avgReaction),
        codeDigitsCorrect:  codeResult?.digitsCorrect ?? 0,
        codeRecalled:       !!codeResult?.allCorrect,
        codeAttempted:      !!codeResult,
      }, { apiFetch, API })
      .then((r) => {
        setScoreSaved(!!r?.synced)
        setQueued(!!r?.queued)
        apiFetch(`${API}/api/games/cbat/act/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [phase, allRoundStats, scoreSaved, codeResult, debugUsed, apiFetch, API])

  // Cleanup audio on unmount
  useEffect(() => () => { audioRef.current?.dispose() }, [])

  // Bail out of an in-progress run back to the intro / instructions screen.
  // Tutorial flag is NOT reset here — tutorial fires once per page mount,
  // surviving Play Again / Menu within the same /cbat/act visit. Only a
  // full page exit + return (component unmount → remount) resets it via
  // the useState initial value.
  const handleMenu = useCallback(() => {
    audioRef.current?.stopAll()
    audioRef.current?.stopStatic()
    setRoundIdx(0)
    setAllRoundStats([])
    setLatestStats(null)
    setScoreSaved(false)
    setMemoryCode(null)
    setPendingStats(null)
    setCodeResult(null)
    setPhase('intro')
  }, [])

  return (
    <div className="cbat-act-page">
      <SEO title="ACT — Auditory Capacity Test" description="Track callsigns, steer through rings, react to bleeps." />

      <div className="flex items-center gap-2 mb-2">
        {phase === 'intro'
          ? <Link to="/cbat" className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
          : <button onClick={handleMenu} className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer">&larr; Instructions</button>
        }
        <h1 className="text-sm font-extrabold text-slate-900">🎧 ACT</h1>
      </div>

      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to play</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {user && (
        <div className="flex flex-col items-center">
          {phase === 'intro' && (
            <IntroScreen
              personalBest={personalBest}
              onStart={startGame}
            />
          )}

          {phase === 'logoIntro' && (
            <SkywatchLogoIntro onComplete={handleLogoComplete} />
          )}

          {(phase === 'callsign' || phase === 'playing') && audioRef.current && (
            <ActRound
              key={`${roundIdx}-${jumpNonce}`}
              roundIdx={roundIdx}
              audio={audioRef.current}
              showCallsignOverlay={phase === 'callsign'}
              onRoundComplete={onRoundComplete}
              tutorialDone={tutorialDone}
              onTutorialFired={onTutorialFired}
              memoryCode={roundIdx === CODE_ROUND_IDX ? memoryCode : null}
              debug={debugUsed}
            />
          )}

          {phase === 'codeRecall' && (
            <CodeRecall codeLength={CODE_LENGTH} onSubmit={onCodeSubmit} />
          )}

          {phase === 'recap' && latestStats && (
            <RoundRecap
              roundIdx={roundIdx}
              stats={latestStats}
              codeResult={codeResult}
              onContinue={continueAfterRecap}
              isFinal={roundIdx + 1 >= TOTAL_ROUNDS}
            />
          )}

          {phase === 'results' && (
            <CbatGameOver
              gameKey="act"
              score={Math.max(0, Math.round(allRoundStats.reduce((acc, s) => acc + s.score, 0)))}
              scoreSaved={scoreSaved}
              queued={queued}
              personalBest={personalBest}
              onPlayAgain={startGame}
            >
              <FinalResults
                allRoundStats={allRoundStats}
                codeResult={codeResult}
                debug={debugUsed}
              />
            </CbatGameOver>
          )}
        </div>
      )}
    </div>
  )
}

// ── Intro screen ─────────────────────────────────────────────────────────────
function IntroScreen({ personalBest, onStart }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-4xl mb-3">🎧</p>
      <p className="text-xl font-extrabold text-white mb-2">Auditory Capacity Test</p>
      <p className="text-sm text-slate-400 mb-5">
        Steer the ball through every shape. Listen for your callsign — when you hear
        <span className="text-brand-300 font-bold"> "avoid the next circle/square" </span>
        with your full callsign, skip that one. Triangles are always default-thread.
      </p>

      <p className="text-sm text-slate-400 mb-5">
        On the final round you'll be read a <span className="text-brand-300 font-bold">{CODE_LENGTH}-digit code</span> —
        hold on to it. You'll be asked for it when the round ends.
      </p>

      <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 mb-5 flex items-start gap-2 text-left">
        <span className="text-lg shrink-0 leading-none mt-0.5">🎧</span>
        <p className="text-xs text-amber-800">
          <span className="font-bold text-amber-900">Headphones strongly recommended.</span>
          {' '}This game relies heavily on audio cues — you'll struggle to pick out your callsign or the BLEEP without them.
        </p>
      </div>

      <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-4 mb-5 text-left space-y-2">
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">🎯</span>
          <span>Default: thread every shape (+20 each, −10 if missed)</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">🔇</span>
          <span>"Avoid" instructions: skip = +25, miss = −25</span>
        </div>
        <div className="flex items-start gap-2 text-sm text-[#ddeaf8]">
          <span className="text-brand-300 font-bold shrink-0">⚡</span>
          <span>Tap BLEEP fast when you hear it (+25/+20/+10), miss or false tap = −10</span>
        </div>
        <div className="flex items-start gap-2 text-xs text-[#8a9bb5]">
          <span className="shrink-0">⚠️</span>
          <span>Scraping the tunnel wall costs −5 / second</span>
        </div>
      </div>

      {personalBest && (
        <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Personal Best</p>
          <p className="text-lg font-mono font-bold text-brand-300">{personalBest.bestScore}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{personalBest.attempts} attempt{personalBest.attempts !== 1 ? 's' : ''}</p>
        </div>
      )}

      <div className="text-center mb-4">
        <Link to="/cbat/act/leaderboard" className="text-xs text-brand-300 hover:text-brand-200 transition-colors">
          View Leaderboard →
        </Link>
      </div>

      <button
        onClick={onStart}
        className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg transition-colors text-sm"
      >
        Start Mission
      </button>
      <p className="text-[10px] text-slate-500 mt-3">Tap to enable audio.</p>
    </motion.div>
  )
}

// ── Round wrapper (mounts game-state hook + canvas + HUD) ────────────────────
function ActRound({ roundIdx, audio, showCallsignOverlay, onRoundComplete, tutorialDone, onTutorialFired, memoryCode, debug }) {
  const state = useActRoundState(roundIdx, audio, onRoundComplete, memoryCode)
  const stats = state.statsRef.current

  // Round-1 bleep tutorial: ~1.5 s after the callsign overlay disappears,
  // play one bleep and pause everything until the player taps the button.
  // The deliberate gap lets the player see the tunnel and start moving
  // before the prompt interrupts.
  //
  // Gating policy:
  //   - tutorialDone (parent state): "already fired during this /cbat/act
  //     page mount". Initialised false on every Cbat mount; sticky across
  //     Play Again, Menu→Start, and round changes within the same mount.
  //     Only resets when the page itself unmounts and the user returns.
  //   - scheduledRef (mount-local): protects the 1.5 s setTimeout from
  //     being scheduled multiple times if this effect re-runs before the
  //     timer fires (e.g., HUD-throttle re-renders).
  //
  // Robustness notes:
  //   - Deps include ONLY stable refs (the `startBleepTutorial` useCallback
  //     and the `onTutorialFired` useCallback) plus primitive flags, NOT
  //     the whole `state` object — `state` is a fresh object literal every
  //     render and would make this effect re-run constantly.
  //   - mountedRef is re-set on every mount (not just initialised) so
  //     StrictMode's mount→unmount→mount dance leaves it correctly true.
  const TUTORIAL_DELAY_MS = 1500
  const scheduledRef = useRef(false)
  const tutorialMountedRef = useRef(true)
  useEffect(() => {
    tutorialMountedRef.current = true
    return () => { tutorialMountedRef.current = false }
  }, [])
  const startBleepTutorial = state.startBleepTutorial
  useEffect(() => {
    if (showCallsignOverlay) return
    if (roundIdx !== 0) return
    if (tutorialDone) return
    if (scheduledRef.current) return
    scheduledRef.current = true
    setTimeout(() => {
      if (!tutorialMountedRef.current) return
      startBleepTutorial()
      onTutorialFired()
    }, TUTORIAL_DELAY_MS)
  }, [showCallsignOverlay, roundIdx, tutorialDone, startBleepTutorial, onTutorialFired])

  const tutorialActive = state.tutorialActive
  const isTouch = useIsTouch()

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
        <span className="text-slate-400">Round <span className="text-brand-300">{roundIdx + 1}</span>/{TOTAL_ROUNDS}</span>
        <span className="text-slate-400">
          Score <span className="text-brand-300">{Math.round(stats.score)}</span>
          {debug && <span className="ml-2 text-amber-400">DEBUG · NO SUBMIT</span>}
        </span>
      </div>

      <div className="relative aspect-square sm:aspect-[4/3] bg-[#020812] border border-[#1a3a5c] rounded-xl overflow-hidden">
        <ActScene state={state} />

        {showCallsignOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-20"
          >
            <div className="text-center px-6">
              <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">Your callsign for this round</p>
              <p className="text-3xl sm:text-5xl font-extrabold text-brand-300 uppercase tracking-[0.25em]">
                {state.userCallsign.join(' ')}
              </p>
              <p className="text-xs text-slate-500 mt-4">Memorise it — it won't be shown again until the debrief.</p>
            </div>
          </motion.div>
        )}

        {tutorialActive && !showCallsignOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-20"
          >
            <div className="text-center px-6">
              <p className="text-xs text-amber-400 uppercase tracking-widest mb-3">Reaction-time check</p>
              <p className="text-2xl sm:text-3xl font-extrabold text-amber-300">
                Press the button below when you hear a bleep
              </p>
            </div>
          </motion.div>
        )}

        {/* Pause — sits above the callsign/tutorial overlays (z-30) because it
            can come up during either. Resume runs off this tap so iOS lets the
            audio context restart. */}
        {state.paused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm z-30"
          >
            <div className="text-center px-6">
              <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">Paused</p>
              <p className="text-lg sm:text-xl font-bold text-slate-800 mb-1">You left the game</p>
              <p className="text-xs text-slate-500 mb-6">The round is on hold — nothing was scored while you were away.</p>
              <button
                onClick={state.resumeFromPause}
                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-extrabold uppercase tracking-widest rounded-xl transition-colors"
              >
                Resume
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Bleep button — large, mobile-friendly. Disabled while paused, and
          while the callsign overlay is showing at round start (no bleeps fire
          during warmup
          anyway, so a tap there has no game effect; the disabled state is
          a UX cue that the round hasn't begun). Pulses + brightens during
          the round-1 tutorial so the player knows where to tap. */}
      <button
        onClick={state.onBleepTap}
        disabled={showCallsignOverlay || state.paused}
        className={`w-full mt-3 py-5 border-2 font-extrabold text-lg uppercase tracking-widest rounded-xl transition-colors ${
          showCallsignOverlay || state.paused
            ? 'bg-slate-700/20 border-slate-600/30 text-slate-500 cursor-not-allowed'
            : tutorialActive
              ? 'bg-amber-500/40 border-amber-300 text-amber-100 ring-4 ring-amber-400/60 animate-pulse'
              : 'bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/40 border-amber-500/50 text-amber-300'
        }`}
      >
        BLEEP
      </button>

      {isTouch && (
        <TouchSteerPad
          onPointerDown={state.onPointerDown}
          onPointerMove={state.onPointerMove}
          onPointerUp={state.onPointerUp}
          isDragging={state.isDragging}
        />
      )}

      <p className="text-[10px] text-slate-500 text-center mt-2">
        {isTouch
          ? 'Tap on bleep • Drag the pad to steer • You can also drag on the tunnel'
          : 'Tap on bleep • Drag canvas to steer • Arrow keys also work'}
      </p>
    </div>
  )
}

// ── Final results ────────────────────────────────────────────────────────────
function FinalResults({ allRoundStats, codeResult, debug }) {
  const totals = allRoundStats.reduce((acc, s) => ({
    score: acc.score + s.score,
    ringsThreaded: acc.ringsThreaded + s.ringsThreaded,
    ringsMissed: acc.ringsMissed + s.ringsMissed,
    avoidObeyed: acc.avoidObeyed + s.avoidObeyed,
    avoidViolated: acc.avoidViolated + s.avoidViolated,
    wallScrapeSeconds: acc.wallScrapeSeconds + s.wallScrapeSeconds,
    bleepHits: acc.bleepHits + s.bleepHits,
    bleepMisses: acc.bleepMisses + s.bleepMisses,
    bleepFalseAlarms: acc.bleepFalseAlarms + (s.bleepFalseAlarms || 0),
  }), { score: 0, ringsThreaded: 0, ringsMissed: 0, avoidObeyed: 0, avoidViolated: 0, wallScrapeSeconds: 0, bleepHits: 0, bleepMisses: 0, bleepFalseAlarms: 0 })

  return (
    <div className="w-full bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center">
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Mission Debrief</p>
      <p className={`text-xl font-extrabold text-white ${debug ? 'mb-1' : 'mb-4'}`}>Final score</p>
      {debug && <p className="text-xs text-amber-400 mb-4">DEBUG MODE · run not submitted to leaderboard</p>}

      <div className="grid grid-cols-2 gap-2 text-left">
        <Stat label="Threaded"        value={totals.ringsThreaded} good />
        <Stat label="Missed"          value={totals.ringsMissed} bad />
        <Stat label="Avoid obeyed"    value={totals.avoidObeyed} good />
        <Stat label="Avoid violated"  value={totals.avoidViolated} bad />
        <Stat label="Wall scrape"     value={`${totals.wallScrapeSeconds.toFixed(1)}s`} bad={totals.wallScrapeSeconds > 0} />
        <Stat label="Bleep accuracy"  value={`${totals.bleepHits}/${totals.bleepHits + totals.bleepMisses}`} good={totals.bleepHits > 0} />
        <Stat label="False taps"      value={totals.bleepFalseAlarms} bad={totals.bleepFalseAlarms > 0} />
        {codeResult && (
          <Stat
            label="Memory code"
            value={`${codeResult.digitsCorrect}/${codeResult.expected.length}`}
            good={codeResult.allCorrect}
            bad={codeResult.digitsCorrect === 0}
          />
        )}
      </div>
    </div>
  )
}
