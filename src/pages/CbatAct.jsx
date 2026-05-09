import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAuth } from '../context/AuthContext'
import { recordCbatStart } from '../utils/cbat/recordStart'
import { useGameChrome } from '../context/GameChromeContext'
import SEO from '../components/SEO'
import {
  ActAudioEngine,
  CALLSIGNS,
  pickCallsigns,
  generateDistractorCallsign,
  buildAvoidSequence,
} from '../utils/cbat/actAudio'

// ── Constants ────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 5
const TUNNEL_RADIUS = 2.0
const BALL_RADIUS = 0.18
const SHAPE_RADIUS = 0.7                      // hoop/square half-size — small enough that the ball must be aimed
const TURN_RATE   = 0.0035                    // radians per pixel of drag
const MAX_ROT_PER_TICK = 0.30                 // hard cap on per-tick rotation (rad) — prevents insta-flip from a fast drag
const KEYBOARD_RATE_PER_TICK = 4.5            // pixel-equivalent per 16ms keyboard tick
const AUDIO_WARMUP_T = 0.15                   // no audio cues until ball reaches this fraction along the curve
const MAX_ROUND_DURATION_S = 90               // safety net — force-end the round if the player gets stuck somehow

// Per-round tuning. Speed = world units / second the ball moves along its
// own forward direction. Distractor density and turn intensity grow with
// round number.
const ROUND_CONFIG = [
  { speed: 4.0, shapes: 12, distractorOdds: 0.30, avoidOdds: 0.18, bleepOdds: 0.10, turns: 4, callsigns: 2 },
  { speed: 4.5, shapes: 14, distractorOdds: 0.40, avoidOdds: 0.22, bleepOdds: 0.12, turns: 5, callsigns: 2 },
  { speed: 5.0, shapes: 16, distractorOdds: 0.50, avoidOdds: 0.25, bleepOdds: 0.14, turns: 6, callsigns: 2 },
  { speed: 5.5, shapes: 18, distractorOdds: 0.55, avoidOdds: 0.28, bleepOdds: 0.16, turns: 7, callsigns: 3 },
  { speed: 6.5, shapes: 20, distractorOdds: 0.60, avoidOdds: 0.30, bleepOdds: 0.18, turns: 8, callsigns: 3 },
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
}

// ── Tunnel geometry ──────────────────────────────────────────────────────────

// Build a smooth Catmull-Rom curve through random waypoints. The curve advances
// mainly along +Z but bends up/down/left/right by a controlled magnitude per
// round. The total length is roughly proportional to shapes-per-round so each
// shape sits on its own distinct segment.
function buildTunnelCurve(roundIdx) {
  const cfg = ROUND_CONFIG[roundIdx]
  const turnMag = 4 + roundIdx * 1.2
  const segmentLen = 14
  const points = [new THREE.Vector3(0, 0, 0)]
  let cursor = new THREE.Vector3(0, 0, 0)

  for (let i = 0; i < cfg.turns + 4; i++) {
    cursor = cursor.clone()
    cursor.z += segmentLen
    // Keep the first two waypoints colinear with the start so the opening
    // ~28 world units of tunnel are straight — long enough to cover the 3s
    // callsign overlay at every round speed (max 6.5 u/s × 3s ≈ 20 units).
    if (i >= 2 && Math.random() < 0.7) {
      const axis = Math.random() < 0.5 ? 'x' : 'y'
      const dir  = Math.random() < 0.5 ? 1 : -1
      cursor[axis] += dir * turnMag * (0.6 + Math.random() * 0.4)
    }
    points.push(cursor.clone())
  }

  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3)
}

// World-space buffer (in curve length units) before the first shape. Sized
// so the ball — which keeps moving forward during the 3-second callsign
// overlay — can't reach the first shape before the overlay disappears,
// regardless of round speed. ~45 units = ~7s at the slowest round speed.
const START_BUFFER_WORLD_UNITS = 45
const END_MARGIN_T = 0.05

// Place shape events along the curve, alternating circle/square with some
// randomness. `t` is the curve parameter (0..1).
function generateShapeEvents(curve, count) {
  const curveLen = curve.getLength()
  const startMarginT = Math.min(0.45, START_BUFFER_WORLD_UNITS / curveLen)
  const events = []
  for (let i = 0; i < count; i++) {
    const t = startMarginT + (1 - END_MARGIN_T - startMarginT) * (i / Math.max(1, count - 1))
    const shape = i % 2 === 0
      ? (Math.random() < 0.5 ? 'circle' : 'square')
      : (Math.random() < 0.5 ? 'square' : 'circle')
    const colorIdx = Math.floor(Math.random() * 4)
    events.push({ id: i, t, shape, colorIdx, threaded: null })
  }
  return events
}

// How many DECOY shapes (of the other type) can sit between an "avoid X"
// instruction and the actual target X. Higher rounds force the player to
// hold the instruction in working memory across multiple decoys.
const AVOID_LEAD_MIN = [0, 0, 0, 1, 1]   // by roundIdx
const AVOID_LEAD_MAX = [0, 1, 2, 3, 4]

// Minimum t-space gap between the START of an avoid-instruction's audio and
// the arrival of its target shape. The audio takes ~2–3s to play (callsigns
// + combined avoid clip), and the player needs additional processing time —
// 0.15 of t translates to ~3.5–4s at every round speed, so the audio always
// finishes with breathing room before the target arrives.
const MIN_AUDIO_TO_TARGET_GAP_T = 0.15

// Build the per-round audio plan: which shapes get an "avoid" instruction
// (with the player's callsign), which get a distractor, and where bleeps fire.
// Returns { audioCues } sorted by time-to-fire (curve-t at which to play).
function generateAudioPlan(events, roundCfg, userCallsign, roundIdx) {
  const cues = []

  // Step 1: pick which shapes will be avoid-targets for this round.
  const avoidIdxs = new Set()
  for (let i = 0; i < events.length; i++) {
    if (Math.random() < roundCfg.avoidOdds) avoidIdxs.add(i)
  }

  // Step 2: schedule each avoid cue with a lead window of N decoy shapes
  // (of the other type) before the actual target. Lead is capped by how many
  // consecutive non-matching shapes precede the target in the level.
  const ri = Math.min(roundIdx, 4)
  const minLead = AVOID_LEAD_MIN[ri]
  const maxLead = AVOID_LEAD_MAX[ri]
  let activeWindowEndT = AUDIO_WARMUP_T          // prevents two avoid cues from overlapping in time

  for (let i = 0; i < events.length; i++) {
    if (!avoidIdxs.has(i)) continue
    const ev = events[i]

    // Count consecutive non-matching shapes immediately preceding ev.
    let nonMatching = 0
    for (let j = i - 1; j >= 0; j--) {
      if (events[j].shape === ev.shape) break
      nonMatching += 1
    }

    const upperLead = Math.min(maxLead, nonMatching)
    const lowerLead = Math.min(minLead, upperLead)
    const lead = lowerLead + Math.floor(Math.random() * (upperLead - lowerLead + 1))

    // audioT is placed before the start of the lead window (or, when lead=0,
    // far enough before the target itself that the audio finishes with time
    // to spare). The MIN_AUDIO_TO_TARGET_GAP_T cap guarantees the player has
    // processing time after hearing the instruction before the shape arrives.
    const latestAudioT = ev.t - MIN_AUDIO_TO_TARGET_GAP_T
    let audioT
    if (lead === 0) {
      audioT = latestAudioT
    } else {
      const earliest = events[i - lead]
      audioT = Math.min(earliest.t - 0.04, latestAudioT)
    }
    const earliestAudioT = Math.max(AUDIO_WARMUP_T, activeWindowEndT)
    if (audioT < earliestAudioT) continue          // can't fit between warmup/prev-window and the gap
    if (audioT >= ev.t) continue                   // sanity

    cues.push({ t: audioT, kind: 'avoid', callsigns: userCallsign, shape: ev.shape, targetId: ev.id })
    activeWindowEndT = ev.t + 0.01
  }

  // Step 3: distractors — fire near a non-target shape, with a non-matching
  // callsign. The player should ignore these.
  for (let i = 0; i < events.length; i++) {
    if (avoidIdxs.has(i)) continue
    if (Math.random() >= roundCfg.distractorOdds) continue
    const distractorSet = generateDistractorCallsign(userCallsign)
    if (!distractorSet) continue
    const ev = events[i]
    const audioT = Math.max(AUDIO_WARMUP_T, ev.t - 0.06)
    if (audioT >= ev.t) continue
    const distractorShape = Math.random() < 0.5 ? 'circle' : 'square'
    cues.push({ t: audioT, kind: 'distractor', callsigns: distractorSet, shape: distractorShape, targetId: null })
  }

  // Step 4: bleeps — sprinkled randomly across the round, after warmup.
  const bleepCount = Math.round(roundCfg.shapes * roundCfg.bleepOdds)
  for (let i = 0; i < bleepCount; i++) {
    const t = AUDIO_WARMUP_T + Math.random() * (0.95 - AUDIO_WARMUP_T)
    cues.push({ t, kind: 'bleep' })
  }

  cues.sort((a, b) => a.t - b.t)
  return cues
}

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
    const mat = new THREE.MeshStandardMaterial({
      color: '#0c2a4a',
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.85,
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
  const { position, quaternion } = useMemo(() => {
    const pos = curve.getPointAt(event.t)
    const tan = curve.getTangentAt(event.t).normalize()
    const up  = new THREE.Vector3(0, 1, 0)
    const m   = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), tan, up)
    const q   = new THREE.Quaternion().setFromRotationMatrix(m)
    return { position: pos, quaternion: q }
  }, [event.t, curve])

  // Shapes ahead of the ball glow brighter; ones behind dim out.
  const passed = ballT > event.t
  const opacity = passed ? 0.15 : 1
  const color = SHAPE_COLORS[event.colorIdx % SHAPE_COLORS.length]

  // Both shapes are pure 3D borders (no inner fill / no invisible black panel),
  // rendered with an emissive standard material so the player sees the chunky
  // tube/bar shading rather than a flat ring.
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

    const worldUp = Math.abs(fwd.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
    const camRight = new THREE.Vector3().crossVectors(fwd, worldUp).normalize()
    const camUp    = new THREE.Vector3().crossVectors(camRight, fwd).normalize()

    const desiredPos = pos.clone()
      .addScaledVector(fwd,   -1.6)              // 1.6 units behind the ball
      .addScaledVector(camUp,  0.45)             // 0.45 units above

    // Sample the curve backward from ballT to find the nearest cross-section
    // for the camera, then clamp the camera's lateral offset to keep it safely
    // inside the tube (margin of 0.3 from the wall).
    const SAFE_RADIUS = TUNNEL_RADIUS - 0.3
    let bestT = Math.max(0, ballT - 0.012)
    let bestDist = Infinity
    for (let i = 0; i <= 8; i++) {
      const ti = Math.max(0, ballT - 0.05 * (i / 8))
      const d = curve.getPointAt(ti).distanceTo(desiredPos)
      if (d < bestDist) { bestDist = d; bestT = ti }
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

    camera.position.copy(desiredPos)
    const lookTarget = pos.clone().addScaledVector(fwd, 5)
    camera.lookAt(lookTarget)
    camera.up.copy(camUp)
  })
  return null
}

// ── Game-state hook ──────────────────────────────────────────────────────────

// Tracks the live game state for one round. Exposes everything the React tree
// needs to render the canvas + HUD without re-rendering every frame.
function useActRoundState(roundIdx, audio, onRoundComplete) {
  const cfg     = ROUND_CONFIG[roundIdx]
  const userCallsign = useMemo(() => pickCallsigns(cfg.callsigns), [roundIdx])
  const curve   = useMemo(() => buildTunnelCurve(roundIdx), [roundIdx])
  const events  = useMemo(() => generateShapeEvents(curve, cfg.shapes), [curve, cfg.shapes])
  const audioCues = useMemo(() => generateAudioPlan(events, cfg, userCallsign, roundIdx), [events, cfg, userCallsign, roundIdx])

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
    reactionMsList: [],
    score: 0,
  })

  // Pending bleep — set when a bleep fires; cleared on hit/miss.
  const pendingBleepRef = useRef(null)
  // Cue cursor — index of the next audio cue to fire.
  const cueIdxRef       = useRef(0)
  // Event cursor — index of the next shape event to evaluate (in order of t).
  const eventIdxRef     = useRef(0)

  const completedRef = useRef(false)

  // Touch / pointer drag input.
  const pointerActiveRef = useRef(false)
  const lastPointerRef   = useRef({ x: 0, y: 0 })

  const onPointerDown = useCallback((e) => {
    pointerActiveRef.current = true
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
  }, [])
  const onPointerMove = useCallback((e) => {
    if (!pointerActiveRef.current) return
    const dx = e.clientX - lastPointerRef.current.x   // raw pixel delta
    const dy = e.clientY - lastPointerRef.current.y
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    inputRef.current.dx += dx
    inputRef.current.dy += dy
  }, [])
  const onPointerUp = useCallback(() => {
    pointerActiveRef.current = false
  }, [])

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
    const pending = pendingBleepRef.current
    if (!pending) return
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

  // Static-noise distractor on rounds 1, 3, 5 (roundIdx 0, 2, 4).
  useEffect(() => {
    const useStatic = roundIdx % 2 === 0
    if (useStatic) audio.startStatic({ volume: 0.06 })
    return () => audio.stopStatic()
  }, [roundIdx, audio])

  // Main game loop — runs via requestAnimationFrame.
  useEffect(() => {
    let raf = null
    const totalLen = curve.getLength()
    const maxR = TUNNEL_RADIUS - BALL_RADIUS

    const tick = () => {
      const now = performance.now()
      const dt  = Math.min(0.05, (now - lastTickRef.current) / 1000)
      lastTickRef.current = now

      // ── 1. Apply pending steering input as a rotation of the ball's forward ──
      // Yaw around world-up; pitch around camera-right. The per-tick magnitude
      // is capped so a sudden 1000-px drag can't flip the ball backward in a
      // single frame (which previously could trap forwardProgress at ≤ 0).
      const fwd = ballForwardRef.current
      const worldUp = Math.abs(fwd.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
      const camRight = new THREE.Vector3().crossVectors(fwd, worldUp).normalize()
      let yaw   = -inputRef.current.dx * TURN_RATE
      let pitch =  inputRef.current.dy * TURN_RATE          // dy>0 (drag down) pitches the ball downward
      yaw   = Math.max(-MAX_ROT_PER_TICK, Math.min(MAX_ROT_PER_TICK, yaw))
      pitch = Math.max(-MAX_ROT_PER_TICK, Math.min(MAX_ROT_PER_TICK, pitch))
      inputRef.current.dx = 0
      inputRef.current.dy = 0
      if (yaw   !== 0) fwd.applyAxisAngle(worldUp,  yaw)
      if (pitch !== 0) fwd.applyAxisAngle(camRight, pitch)
      fwd.normalize()

      // ── 2. Advance position along the ball's own forward direction. ───────
      ballPosRef.current.addScaledVector(fwd, cfg.speed * dt)

      // ── 3. Update curve-t by nearest-point search (monotonic). ────────────
      // Sample around the previous t and pick the curve point closest to the
      // ball. ballT only advances — it never regresses, so a player who turns
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
      ballTRef.current = Math.max(prevT, bestT)

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
          const result = audio.playSequence(buildAvoidSequence(cue.callsigns, cue.shape), { exclusive: true })
          if (result.played) {
            activeAvoidRef.current = { targetId: cue.targetId, shape: cue.shape }
          }
        } else if (cue.kind === 'distractor') {
          audio.playSequence(buildAvoidSequence(cue.callsigns, cue.shape), { exclusive: true })
        } else if (cue.kind === 'bleep') {
          audio.playBleep()
          pendingBleepRef.current = { startedAt: performance.now() }
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
        const shapeCentre = curve.getPointAt(ev.t)
        const distToCentre = ballPosRef.current.distanceTo(shapeCentre)
        const threadedThrough = distToCentre < SHAPE_RADIUS - BALL_RADIUS
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
    onBleepTap,
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
      onPointerLeave={state.onPointerUp}
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

// ── Round-end recap card ─────────────────────────────────────────────────────
function RoundRecap({ roundIdx, stats, onContinue, isFinal }) {
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
      </div>

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
  const [phase, setPhase] = useState('intro')   // intro | callsign | playing | recap | results
  const [roundIdx, setRoundIdx] = useState(0)
  const [allRoundStats, setAllRoundStats] = useState([])
  const [latestStats, setLatestStats]   = useState(null)
  const [personalBest, setPersonalBest] = useState(null)
  const [scoreSaved, setScoreSaved]     = useState(false)
  const [audioReady, setAudioReady]     = useState(false)
  const audioRef = useRef(null)

  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (phase === 'playing' || phase === 'callsign' || phase === 'recap') enterImmersive()
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
    recordCbatStart('act', apiFetch, API)
    setRoundIdx(0)
    setAllRoundStats([])
    setLatestStats(null)
    setScoreSaved(false)
    setPhase('callsign')
  }, [apiFetch, API, initAudio])

  // Auto-advance from callsign reveal to playing after 3s.
  useEffect(() => {
    if (phase !== 'callsign') return
    const t = setTimeout(() => setPhase('playing'), 3000)
    return () => clearTimeout(t)
  }, [phase, roundIdx])

  const onRoundComplete = useCallback((stats) => {
    setLatestStats(stats)
    setAllRoundStats(prev => [...prev, stats])
    setPhase('recap')
  }, [])

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

    apiFetch(`${API}/api/games/cbat/act/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    })
      .then(r => r.json())
      .then(() => {
        setScoreSaved(true)
        apiFetch(`${API}/api/games/cbat/act/personal-best`)
          .then(r => r.json())
          .then(d => { if (d.data) setPersonalBest(d.data) })
          .catch(() => {})
      })
      .catch(() => {})
  }, [phase, allRoundStats, scoreSaved, apiFetch, API])

  // Cleanup audio on unmount
  useEffect(() => () => { audioRef.current?.dispose() }, [])

  // Bail out of an in-progress run back to the intro / instructions screen.
  const handleMenu = useCallback(() => {
    audioRef.current?.stopAll()
    audioRef.current?.stopStatic()
    setRoundIdx(0)
    setAllRoundStats([])
    setLatestStats(null)
    setScoreSaved(false)
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

          {(phase === 'callsign' || phase === 'playing') && audioRef.current && (
            <ActRound
              key={roundIdx}
              roundIdx={roundIdx}
              audio={audioRef.current}
              showCallsignOverlay={phase === 'callsign'}
              onRoundComplete={onRoundComplete}
            />
          )}

          {phase === 'recap' && latestStats && (
            <RoundRecap
              roundIdx={roundIdx}
              stats={latestStats}
              onContinue={continueAfterRecap}
              isFinal={roundIdx + 1 >= TOTAL_ROUNDS}
            />
          )}

          {phase === 'results' && (
            <FinalResults
              allRoundStats={allRoundStats}
              scoreSaved={scoreSaved}
              onPlayAgain={startGame}
            />
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
        Steer the ball through every ring and square. Listen for your callsign — when you hear
        <span className="text-brand-300 font-bold"> "avoid the next circle/square" </span>
        with your full callsign, skip that one. Ignore everything else.
      </p>

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
          <span>Tap BLEEP fast when you hear it (+25/+20/+10), miss = −10</span>
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
      <p className="text-[10px] text-slate-500 mt-3">Tap to enable audio. Headphones recommended.</p>
    </motion.div>
  )
}

// ── Round wrapper (mounts game-state hook + canvas + HUD) ────────────────────
function ActRound({ roundIdx, audio, showCallsignOverlay, onRoundComplete }) {
  const state = useActRoundState(roundIdx, audio, onRoundComplete)
  const stats = state.statsRef.current

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center justify-between text-xs font-mono mb-2 px-1">
        <span className="text-slate-400">Round <span className="text-brand-300">{roundIdx + 1}</span>/{TOTAL_ROUNDS}</span>
        <span className="text-slate-400">Score <span className="text-brand-300">{Math.round(stats.score)}</span></span>
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
      </div>

      {/* Bleep button — large, mobile-friendly */}
      <button
        onClick={state.onBleepTap}
        className="w-full mt-3 py-5 bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/40 border-2 border-amber-500/50 text-amber-300 font-extrabold text-lg uppercase tracking-widest rounded-xl transition-colors"
      >
        BLEEP
      </button>
      <p className="text-[10px] text-slate-500 text-center mt-2">Tap on bleep • Drag canvas to steer • Arrow keys also work</p>
    </div>
  )
}

// ── Final results ────────────────────────────────────────────────────────────
function FinalResults({ allRoundStats, scoreSaved, onPlayAgain }) {
  const totals = allRoundStats.reduce((acc, s) => ({
    score: acc.score + s.score,
    ringsThreaded: acc.ringsThreaded + s.ringsThreaded,
    ringsMissed: acc.ringsMissed + s.ringsMissed,
    avoidObeyed: acc.avoidObeyed + s.avoidObeyed,
    avoidViolated: acc.avoidViolated + s.avoidViolated,
    wallScrapeSeconds: acc.wallScrapeSeconds + s.wallScrapeSeconds,
    bleepHits: acc.bleepHits + s.bleepHits,
    bleepMisses: acc.bleepMisses + s.bleepMisses,
  }), { score: 0, ringsThreaded: 0, ringsMissed: 0, avoidObeyed: 0, avoidViolated: 0, wallScrapeSeconds: 0, bleepHits: 0, bleepMisses: 0 })

  const finalScore = Math.max(0, Math.round(totals.score))

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
    >
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Mission Debrief</p>
      <p className="text-xl font-extrabold text-white mb-4">Final score</p>
      <p className="text-5xl font-mono font-extrabold text-brand-300 mb-5">{finalScore}</p>

      <div className="grid grid-cols-2 gap-2 mb-5 text-left">
        <Stat label="Threaded"        value={totals.ringsThreaded} good />
        <Stat label="Missed"          value={totals.ringsMissed} bad />
        <Stat label="Avoid obeyed"    value={totals.avoidObeyed} good />
        <Stat label="Avoid violated"  value={totals.avoidViolated} bad />
        <Stat label="Wall scrape"     value={`${totals.wallScrapeSeconds.toFixed(1)}s`} bad={totals.wallScrapeSeconds > 0} />
        <Stat label="Bleep accuracy"  value={`${totals.bleepHits}/${totals.bleepHits + totals.bleepMisses}`} good={totals.bleepHits > 0} />
      </div>

      {scoreSaved && <p className="text-xs text-green-400 mb-4">✓ Score saved</p>}

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Play Again
        </button>
        <Link
          to="/cbat/act/leaderboard"
          className="px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline"
        >
          🏆 Leaderboard
        </Link>
      </div>
    </motion.div>
  )
}
