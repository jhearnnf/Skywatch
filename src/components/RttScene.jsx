import { useRef, useMemo, useState, useEffect, Suspense, Component } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import {
  CAMERA_FOV_DEG, MAX_SLEW_DEG_PER_SEC, AZ_LIMIT_DEG, ELEV_MIN_DEG, ELEV_MAX_DEG,
  STATION_ALT_M, RTT_FRAMES_PER_TARGET, TARGET_EXIT_MS,
  advanceRtt, fireShutter, isRunOver,
  isTargetVisible, isTargetOccluded, targetDirectionAt, targetAngularSize,
  polarToWorld, angularError, occlusionSpan, mulberry32, airframeDisturbance,
} from '../utils/cbat/rttSim'
import { useCbatDemoCanvas } from '../utils/cbat/demoMode'

// The Rapid Tracking Test scene.
//
// The camera is a gimballed sensor: it sits at the origin and ONLY rotates —
// yaw and pitch, never position. That is both what a targeting pod actually does
// and why the whole game is cheap to render: nothing has to be culled, lit or
// re-sorted as the player moves, because the player never moves.
//
// The world is metres. The station is STATION_ALT_M above a flat ground plane,
// which is what makes a ground target's range fall out of its depression angle
// (see rttSim) instead of having to be invented per target.
//
// LEGIBILITY IS THE BRIEF. This is a spotting-and-tracking test, and a target is
// between about 10 and 60 pixels across. Everything below — the graded sky, the
// mid-tone ground, the fill light, the lifted target materials — exists so a
// silhouette reads against whatever is behind it. A prettier but flatter scene
// would make the game unfair rather than hard.
//
// The HUD is NOT in here. It is DOM laid over the canvas by CbatRtt, which
// writes it from the snapshot this component hands it every frame.

const DEG = Math.PI / 180
const AZ_LIMIT = AZ_LIMIT_DEG * DEG
const ELEV_MIN = ELEV_MIN_DEG * DEG
const ELEV_MAX = ELEV_MAX_DEG * DEG
const GROUND_Y = -STATION_ALT_M

// Model files, all already in public/models/. The two jets are the pair that
// ship precached for offline play (see lib/offlineAircraft.js), so a target pass
// never depends on a network fetch.
const MODEL_JET_A = '/models/hawk t2.glb'
const MODEL_JET_B = '/models/eurofighter typhoon fgr4.glb'
const MODEL_HELI = '/models/chinook hc6 6a.glb'

// Nose direction correction.
//
// Object3D.lookAt() (unlike Camera.lookAt) points an object's +Z at its target,
// so a target group that has been aimed down its track has +Z along travel. The
// aircraft GLBs are authored nose-along -X — the convention Trace2Scene's
// MODEL_NOSE records — so the nose needs a quarter turn onto +Z.
const YAW_AIRCRAFT = Math.PI / 2

// Dusk over a coastline. Deliberately not the near-black the rest of the app
// uses for surfaces: a sensor picture has to have enough tone in it for a small
// dark shape to sit against.
// Dusk over farmland. Authored to render close to face value: the lights below
// sum to roughly 1.6× on an upward-facing surface, deliberately, because the
// first pass ran at ~3× and every colour came out as something else on screen.
const COLORS = {
  skyTop: '#0b1f3a',
  skyHorizon: '#3a5f84',
  // Base terrain, seen only past the farmland and through heavy fog.
  ground: '#3a4430',
  scatter: '#2b3327',
  // Water must be LIGHTER than the ground. A dark patch on a dark plane reads
  // as a hole, not a lake — which is exactly how the first pass looked.
  water: '#3f6d92',
  cloud: '#93a8bd',
  // Weathered concrete, not the blue-grey the surfaces elsewhere in the app
  // use: against green fields a cool grey building reads as a black slab
  // dropped on the landscape.
  structure: '#6d6659',
  roof: '#3a3730',
  woodland: '#2b3d26',
  // Also the earth banks that hide a boat. Kept light enough to read as land
  // rather than a hole punched in the picture — it is cover, and cover the
  // player can't make sense of just looks like a rendering fault.
  scrub: '#4a5a38',
  tree: '#37503a',
  hedge: '#26331f',
  road: '#6a6354',
  // Targets have to separate from a green-brown landscape now, not a blue-grey
  // one — so they run cool and pale against it rather than olive, which is what
  // a real vehicle would be and what would make it invisible.
  hull: '#a3b0c0',
  vehicle: '#9fa894',
  person: '#c6cbb4',
}

// The field palette. Ordinary lowland farmland in late light: pasture, standing
// crop, stubble, ploughed earth, rough grazing. Kept deliberately down in value
// so the ground sits under a dusk sky rather than looking like noon terrain
// with a blue backdrop pasted behind it.
const FIELD_COLORS = [
  '#36402a', // pasture
  '#2d3a24', // lush grass
  '#4d4830', // ripening crop
  '#585038', // stubble
  '#41362b', // ploughed earth
  '#494334', // bare / fallow
  '#25311e', // dark rough grazing
  '#3c4728', // young growth
]

// Lifts every target model out of the shadows without recolouring it, so a jet
// crossing a dark ridge is still a jet rather than a silhouette that vanishes.
const TARGET_EMISSIVE = '#33465e'
const TARGET_EMISSIVE_INTENSITY = 0.7

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

class ErrorCatcher extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() { return this.state.hasError ? this.props.fallback ?? null : this.props.children }
}

// ── Sky ──────────────────────────────────────────────────────────────────────

// A graded sky, built by colouring the vertices of a big inverted sphere by
// height. No shader and no texture — which matters because a canvas-generated
// gradient is one more thing that can come back null in a headless or
// low-privilege context, and this is the backdrop for the entire game.
//
// The gradient earns its place: air targets are spotted against the sky, and a
// flat fill gives the eye no horizon to judge the camera's pitch against.
const SKY_RADIUS = 14000

function SkyDome() {
  const geometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(SKY_RADIUS, 24, 16)
    const pos = geo.attributes.position
    const top = new THREE.Color(COLORS.skyTop)
    const horizon = new THREE.Color(COLORS.skyHorizon)
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      // Bias the blend downward so the haze band hugs the horizon rather than
      // washing out the upper half of the frame.
      const t = clamp((pos.getY(i) / SKY_RADIUS) * 1.9 + 0.22, 0, 1)
      c.copy(horizon).lerp(top, t)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  )
}

// ── Static world ─────────────────────────────────────────────────────────────

// Ground clutter, purely for depth cues — without it a flat plane gives the eye
// nothing to judge the camera's motion against and slewing feels like nothing is
// happening. Deliberately kept beyond MIN_SCATTER_RANGE, which is further out
// than any target can ever be, so a block can never end up in front of one and
// hide it in a way the sim knows nothing about.
const MIN_SCATTER_RANGE = 1300
const MAX_SCATTER_RANGE = 6500

function Scatter() {
  const blocks = useMemo(() => {
    const rng = mulberry32(20260806)
    const out = []
    for (let i = 0; i < 54; i++) {
      const az = (rng() * 2 - 1) * Math.PI
      const range = MIN_SCATTER_RANGE + rng() * (MAX_SCATTER_RANGE - MIN_SCATTER_RANGE)
      const h = 6 + rng() * 30
      const w = 18 + rng() * 70
      const d = 18 + rng() * 70
      out.push({
        key: i,
        pos: [Math.sin(az) * range, GROUND_Y + h / 2, -Math.cos(az) * range],
        args: [w, h, d],
        rotY: rng() * Math.PI,
      })
    }
    return out
  }, [])

  return (
    <group>
      {blocks.map(b => (
        <mesh key={b.key} position={b.pos} rotation={[0, b.rotY, 0]}>
          <boxGeometry args={b.args} />
          <meshStandardMaterial color={COLORS.scatter} flatShading roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

// Farmland — the thing that makes the view read as "out of an aircraft" rather
// than "a plane with some marks on it".
//
// Built as a jittered grid of field polygons merged into ONE geometry with a
// per-field vertex colour, so ten thousand fields cost a single draw call. The
// grid shares its vertices between neighbouring fields, which is what keeps the
// jitter from opening gaps between them.
//
// It is all flat: coplanar decals a few centimetres above the ground plane, so
// none of it can ever occlude a target. That matters, because the 3D scatter
// has to stay beyond 1300 m for exactly that reason and would otherwise leave
// the near ground — everything you see looking steeply down at a vehicle or a
// foot patrol — completely bare.
const FARM_HALF = 4500      // metres from the station the patchwork extends
const FARM_CELL = 90        // rough field size
const HEDGE_RADIUS = 2200   // hedgerows only where they can actually be seen
const HEDGE_WIDTH = 5
const HEDGE_CHANCE = 0.45

// ── Depth ordering for the flat decals ───────────────────────────────────────
//
// UNITS ONLY, never `factor`. This is the difference between a working scene
// and one that eats its own targets.
//
// `polygonOffsetFactor` is scaled by the polygon's depth SLOPE, and ground seen
// at a shallow angle from 140 m up has an enormous one — a factor of 10 works
// out at roughly ten METRES of bias at 700 m range. That is what made a boat
// sitting on a lake invisible: the water was being pulled in front of it.
// `polygonOffsetUnits` is measured in units of the depth buffer's own
// resolution, so it is slope-independent, always beats z-fighting by exactly as
// much as asked, and stays sub-metre at every range in this scene.
//
// Each layer clears the one below it by 2 units, which is all it takes.
const OFFSET_FIELDS = -2
const OFFSET_WOODLAND = -4
const OFFSET_HEDGE = -6
const OFFSET_ROAD = -8

// Real height differences between the flat layers, in metres.
//
// The depth bias above is belt-and-braces; THIS is what actually orders them.
// Two surfaces at the same height separated only by bias will z-fight the
// moment they are seen at a shallow angle, which is exactly what fields and
// hedges did — they were both at +0.05. Every gap here is at least 7 cm, and
// with the near plane at 50 m the buffer resolves ~3 cm even at the far edge of
// the farmland, so nothing can flicker. All of it is invisible from 140 m up.
const Y_FIELDS = 0.08
const Y_WOODLAND = 0.16
const Y_HEDGE = 0.30
const Y_ROAD = 0.40
const Y_WATER = 0.52

// Where the watercraft passes run, as ellipses on the ground: long along the
// boat's track, narrow across it, so a pass gets a channel rather than a lake
// big enough to be a landmark two passes away.
const OFFSET_WATER = -6
const WATER_MARGIN_M = 45
const WATER_ACROSS = 0.34   // how narrow the channel is across its track

function waterZonesFor(targets) {
  return targets.filter(t => t.kind === 'boat').map((t) => {
    const mid = targetDirectionAt(t, t.tStartMs + t.windowMs / 2)
    const [x, , z] = polarToWorld(mid.az, mid.elev, t.range)
    const trackLength = Math.abs(t.endAz - t.startAz) * t.range
    return { x, z, az: mid.az, r: trackLength / 2 + WATER_MARGIN_M }
  })
}

function inWaterZone(x, z, zones) {
  for (const w of zones) {
    const dx = x - w.x
    const dz = z - w.z
    // Long axis runs along the boat's track — the azimuth tangent.
    const along = dx * Math.cos(w.az) + dz * Math.sin(w.az)
    const across = -dx * Math.sin(w.az) + dz * Math.cos(w.az)
    const a = along / w.r
    const b = across / (w.r * WATER_ACROSS)
    if (a * a + b * b <= 1) return true
  }
  return false
}

function buildFarmland(seed) {
  const rng = mulberry32(seed)
  const n = Math.ceil((FARM_HALF * 2) / FARM_CELL)
  const step = (FARM_HALF * 2) / n
  const jitter = step * 0.3
  const stride = n + 1

  // Shared vertex grid. Edges stay unjittered so the patchwork ends on a
  // straight line rather than a ragged one.
  const gx = new Float32Array(stride * stride)
  const gz = new Float32Array(stride * stride)
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const k = i * stride + j
      const edge = i === 0 || j === 0 || i === n || j === n
      gx[k] = -FARM_HALF + j * step + (edge ? 0 : (rng() - 0.5) * 2 * jitter)
      gz[k] = -FARM_HALF + i * step + (edge ? 0 : (rng() - 0.5) * 2 * jitter)
    }
  }

  const cells = n * n
  const pos = new Float32Array(cells * 6 * 3)
  const col = new Float32Array(cells * 6 * 3)
  const nrm = new Float32Array(cells * 6 * 3)
  const chosen = new Array(cells)
  const c = new THREE.Color()
  let o = 0

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Inherit a neighbour's colour a third of the time, so fields run to
      // several cells instead of every one being its own colour — real
      // farmland is a mix of big and small.
      let base
      if (j > 0 && rng() < 0.34) base = chosen[i * n + (j - 1)]
      else if (i > 0 && rng() < 0.34) base = chosen[(i - 1) * n + j]
      else base = FIELD_COLORS[Math.floor(rng() * FIELD_COLORS.length)]
      chosen[i * n + j] = base

      const a = i * stride + j
      const b = a + 1
      const d = a + stride
      const e = d + 1

      // A tonal wobble per cell, so a field spanning several cells still has
      // some life in it rather than reading as one flat slab.
      c.set(base).multiplyScalar(0.86 + rng() * 0.28)
      // Wound a-e-b / a-d-e so the normals point up (+Y).
      for (const v of [a, e, b, a, d, e]) {
        pos[o] = gx[v]; pos[o + 1] = 0; pos[o + 2] = gz[v]
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b
        nrm[o] = 0; nrm[o + 1] = 1; nrm[o + 2] = 0
        o += 3
      }
    }
  }

  const fields = new THREE.BufferGeometry()
  fields.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  fields.setAttribute('color', new THREE.BufferAttribute(col, 3))
  fields.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))

  // Hedgerows along a random subset of field boundaries, merged the same way.
  const hp = []
  const hn = []
  const ribbon = (x1, z1, x2, z2, w) => {
    const dx = x2 - x1, dz = z2 - z1
    const len = Math.hypot(dx, dz) || 1
    const px = (-dz / len) * (w / 2)
    const pz = (dx / len) * (w / 2)
    const q = [
      [x1 - px, z1 - pz], [x2 + px, z2 + pz], [x1 + px, z1 + pz],
      [x1 - px, z1 - pz], [x2 - px, z2 - pz], [x2 + px, z2 + pz],
    ]
    for (const [x, z] of q) { hp.push(x, 0, z); hn.push(0, 1, 0) }
  }
  const near = (k) => Math.hypot(gx[k], gz[k]) < HEDGE_RADIUS
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const k = i * stride + j
      if (!near(k)) continue
      if (j < n && rng() < HEDGE_CHANCE) ribbon(gx[k], gz[k], gx[k + 1], gz[k + 1], HEDGE_WIDTH)
      if (i < n && rng() < HEDGE_CHANCE) ribbon(gx[k], gz[k], gx[k + stride], gz[k + stride], HEDGE_WIDTH)
    }
  }
  const hedges = new THREE.BufferGeometry()
  hedges.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(hp), 3))
  hedges.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(hn), 3))

  return { fields, hedges }
}

function Farmland() {
  const { fields, hedges } = useMemo(() => buildFarmland(31415), [])
  useEffect(() => () => { fields.dispose(); hedges.dispose() }, [fields, hedges])

  // Fields and hedges are separate meshes at DIFFERENT heights on purpose —
  // they used to share one group and fought each other wherever the ground was
  // seen at a shallow angle.
  return (
    <>
      <mesh geometry={fields} position={[0, GROUND_Y + Y_FIELDS, 0]}>
        <meshStandardMaterial
          vertexColors roughness={1}
          polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={OFFSET_FIELDS}
        />
      </mesh>
      <mesh geometry={hedges} position={[0, GROUND_Y + Y_HEDGE, 0]}>
        <meshStandardMaterial
          color={COLORS.hedge} roughness={1}
          polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={OFFSET_HEDGE}
        />
      </mesh>
    </>
  )
}

// Lanes and farm tracks, cutting across the field pattern.
function Roads() {
  const roads = useMemo(() => {
    const rng = mulberry32(27182)
    const out = []
    for (let i = 0; i < 16; i++) {
      const az = (rng() * 2 - 1) * Math.PI
      const r = 150 + rng() * 4000
      out.push({
        key: i,
        // Same ladder trick as the woods: roads cross each other, and they are
        // all one colour so a tie would be invisible — but a road crossing a
        // wood is not, so they sit above everything except the water.
        pos: [Math.sin(az) * r, GROUND_Y + Y_ROAD + i * 0.002, -Math.cos(az) * r],
        args: [6 + rng() * 5, 400 + rng() * 1400],
        rotY: rng() * Math.PI,
      })
    }
    return out
  }, [])

  return (
    <group>
      {roads.map(t => (
        <mesh key={t.key} position={t.pos} rotation={[-Math.PI / 2, 0, t.rotY]}>
          <planeGeometry args={t.args} />
          <meshStandardMaterial
            color={COLORS.road} roughness={1}
            polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={OFFSET_ROAD}
          />
        </mesh>
      ))}
    </group>
  )
}

// Woodland, as flat patches. Same reasoning as the fields above — coplanar, so
// it cannot occlude anything — and it does most of the work of making the
// ground read as countryside rather than a painted plane.
function Woodland({ waterZones }) {
  const patches = useMemo(() => {
    const rng = mulberry32(2718)
    const out = []
    for (let i = 0; i < 34; i++) {
      const az = (rng() * 2 - 1) * Math.PI
      const r = 150 + rng() * 4200
      // Woods don't grow in the middle of a channel.
      if (inWaterZone(Math.sin(az) * r, -Math.cos(az) * r, waterZones)) continue
      // Two or three overlapping ellipses per patch, so a wood has a ragged
      // edge instead of being an obvious oval.
      const lobes = []
      const n = 2 + Math.floor(rng() * 2)
      const scale = 45 + rng() * 120
      for (let j = 0; j < n; j++) {
        lobes.push({
          dx: (rng() - 0.5) * scale,
          dz: (rng() - 0.5) * scale,
          r: scale * (0.4 + rng() * 0.35),
        })
      }
      out.push({
        key: i,
        // Each patch gets its own height in a 2 mm ladder. Woods overlap each
        // other, and two overlapping patches of DIFFERENT colours sharing a
        // height is a guaranteed flicker — the depth buffer has no way to pick a
        // winner, so it picks a different one per pixel and per frame.
        pos: [Math.sin(az) * r, GROUND_Y + Y_WOODLAND + i * 0.002, -Math.cos(az) * r],
        color: rng() < 0.6 ? COLORS.woodland : COLORS.scrub,
        lobes,
      })
    }
    return out
  }, [waterZones])

  return (
    <group>
      {patches.map(p => (
        <group key={p.key} position={p.pos}>
          {p.lobes.map((l, i) => (
            <mesh key={i} position={[l.dx, 0, l.dz]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[l.r, 16]} />
              <meshStandardMaterial
                color={p.color} roughness={1}
                polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={OFFSET_WOODLAND}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

// Standing trees, close enough in to give the near ground real scale.
//
// Safe to put this close because of the geometry of looking DOWN from altitude:
// the sightline to a target at range R passes STATION_ALT_M × (1 − d/R) above
// the ground at distance d, so a 10 m tree can only break it when d is within
// about 6% of R. Anything nearer sits far below the line of sight and cannot
// hide anything. The filter below rejects a tree within 12% of any target's
// range on a bearing anywhere near that target's track — twice the margin the
// geometry needs — so the picture can never disagree with the sim.
const TREE_RANGE_MARGIN = 0.12
const TREE_AZ_PAD = 4 * DEG
const TREE_MAX_H = 10

function treeBlocksATarget(az, range, targets) {
  for (const t of targets) {
    if (Math.abs(range - t.range) > t.range * TREE_RANGE_MARGIN) continue
    const lo = Math.min(t.startAz, t.endAz) - TREE_AZ_PAD
    const hi = Math.max(t.startAz, t.endAz) + TREE_AZ_PAD
    if (az >= lo && az <= hi) return true
  }
  return false
}

function Trees({ targets }) {
  const trees = useMemo(() => {
    const rng = mulberry32(1618)
    const out = []
    let attempts = 0
    while (out.length < 13 && attempts < 400) {
      attempts += 1
      const az = (rng() * 2 - 1) * Math.PI
      const range = 260 + rng() * 4500
      if (treeBlocksATarget(az, range, targets)) continue
      const cx = Math.sin(az) * range
      const cz = -Math.cos(az) * range
      // A copse, not a lone tree — a single cone at this range is a speck.
      const n = 3 + Math.floor(rng() * 3)
      const members = []
      for (let i = 0; i < n; i++) {
        const h = 6 + rng() * (TREE_MAX_H - 6)
        members.push({
          dx: (rng() - 0.5) * 70,
          dz: (rng() - 0.5) * 70,
          h,
          r: h * (0.32 + rng() * 0.14),
        })
      }
      out.push({ key: out.length, cx, cz, members })
    }
    return out
  }, [targets])

  return (
    <group>
      {trees.map(c => (
        <group key={c.key} position={[c.cx, GROUND_Y, c.cz]}>
          {c.members.map((m, i) => (
            <mesh key={i} position={[m.dx, m.h / 2, m.dz]}>
              <coneGeometry args={[m.r, m.h, 7]} />
              <meshStandardMaterial color={COLORS.tree} flatShading roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function World({ targets }) {
  const waterZones = useMemo(() => waterZonesFor(targets), [targets])
  return (
    <group>
      <mesh position={[0, GROUND_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[24000, 24000]} />
        <meshStandardMaterial color={COLORS.ground} roughness={1} />
      </mesh>
      <Farmland />
      <Woodland waterZones={waterZones} />
      <WaterPatches zones={waterZones} />
      <Roads />
      <Trees targets={targets} />
      <Scatter />
    </group>
  )
}

// ── Occluders ────────────────────────────────────────────────────────────────

// Air occluders sit well forward of their target so they read as weather;
// ground ones sit close to it, because a structure that hides a walker 300 m
// away has to be a building rather than a 100 m tower halfway to them.
const AIR_OCCLUDER_DIST = 0.6
const GROUND_OCCLUDER_DIST = 0.9

// The cue arrow disappears once the target is this close to centre — by then it
// is on screen and pointing at it would just clutter the picture.
const CUE_HIDE_RAD = 5 * DEG

// A cloud bank, as a run of overlapping lumps along the arc.
//
// Two rules it has to obey. It must span EXACTLY the width it is given — every
// lump satisfies |dx| + r ≤ h, so nothing overhangs the arc and hides a target
// the sim has already released. And it must not read as a ball: the lumps are
// smooth-shaded (a low-poly sphere with flatShading is unmistakably a golf
// ball), there are enough of them to make a mass rather than a shape, and the
// whole thing is flattened, because clouds are wide and low.
function cloudLumps(seed, halfWidth) {
  const rng = mulberry32(seed)
  const n = 9
  const out = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 - 1                       // -1 … 1 across the bank
    const r = halfWidth * (0.26 + rng() * 0.15)
    // Lumps thin out toward the ends, which is what stops the silhouette
    // looking like a row of identical beads.
    const taper = 1 - 0.45 * t * t
    out.push({
      dx: t * (halfWidth - r),
      dy: halfWidth * (rng() - 0.4) * 0.24,
      dz: halfWidth * (rng() - 0.5) * 0.22,
      r: r * taper,
    })
  }
  return out
}

function CloudBank({ width, seed }) {
  const lumps = useMemo(() => cloudLumps(seed, width / 2), [seed, width])
  return (
    <group scale={[1, 0.62, 1]}>
      {lumps.map((l, i) => (
        <mesh key={i} position={[l.dx, l.dy, l.dz]}>
          <sphereGeometry args={[l.r, 16, 12]} />
          <meshStandardMaterial
            color={COLORS.cloud}
            roughness={1}
            metalness={0}
            emissive={COLORS.cloud}
            emissiveIntensity={0.12}
          />
        </mesh>
      ))}
    </group>
  )
}

// Height the roof clears the line of sight by, in metres.
const OCCLUDER_HEAD_ROOM = 4

function GroundOccluder({ pos, az, width, waterside }) {
  const height = (pos[1] - GROUND_Y) + OCCLUDER_HEAD_ROOM
  const depth = Math.max(3, width * (waterside ? 1.3 : 0.6))

  // What hides a boat has to be part of the shoreline. A concrete shed standing
  // in the middle of a channel is the single most obviously wrong thing that
  // can appear in this scene — so a watercraft pass gets a wooded spit of land
  // instead, which is what a boat actually passes behind.
  if (waterside) {
    return (
      <group position={[pos[0], GROUND_Y, pos[2]]} rotation={[0, -az, 0]}>
        <mesh position={[0, height / 2 - 1, 0]}>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color={COLORS.scrub} flatShading roughness={1} />
        </mesh>
        {[-0.26, 0.05, 0.3].map((dx, i) => (
          <mesh key={i} position={[dx * width, height + width * 0.06, (i - 1) * depth * 0.18]}>
            <coneGeometry args={[width * 0.075, width * 0.2, 7]} />
            <meshStandardMaterial color={COLORS.tree} flatShading roughness={1} />
          </mesh>
        ))}
      </group>
    )
  }

  return (
    <group position={[pos[0], GROUND_Y, pos[2]]} rotation={[0, -az, 0]}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={COLORS.structure} flatShading roughness={1} />
      </mesh>
      {/* A shallow cap, so the block reads as a built thing rather than a cuboid
          dropped on the grass. Inset in width, so it never widens the
          silhouette past the arc the sim scores. */}
      <mesh position={[0, height + 0.6, 0]}>
        <boxGeometry args={[width * 0.82, 1.2, depth * 0.82]} />
        <meshStandardMaterial color={COLORS.roof} flatShading roughness={1} />
      </mesh>
    </group>
  )
}

function Occluders({ targets }) {
  const items = useMemo(() => {
    const out = []
    targets.forEach((target) => {
      target.occlusions.forEach((occ, j) => {
        const span = occlusionSpan(target, occ)
        const dist = target.range * (target.ground ? GROUND_OCCLUDER_DIST : AIR_OCCLUDER_DIST)
        // Half the arc the target walks behind it, plus half the target's own
        // width — so the target's leading edge clears cover at the instant the
        // sim stops calling it obscured. NOT clamped to a minimum: a wider
        // occluder would keep a target hidden after it had become shootable,
        // and a walker's arc is genuinely only a few metres.
        const half = span.halfArc + targetAngularSize(target) / 2
        out.push({
          key: `${target.id}-${j}`,
          seed: target.id * 977 + j * 31 + 7,
          ground: target.ground,
          waterside: target.kind === 'boat',
          pos: polarToWorld(span.az, span.elev, dist),
          az: span.az,
          width: Math.max(1.2, 2 * dist * Math.tan(half)),
        })
      })
    })
    return out
  }, [targets])

  return (
    <group>
      {items.map(o => (o.ground
        ? (
          // A structure rooted on the ground and rising past the line of sight
          // (o.pos[1] is exactly where the sightline crosses this distance), so
          // it reads as part of the landscape rather than a floating box.
          // Tall enough to break the line of sight and no taller. o.pos[1] is
          // exactly where the sightline crosses this distance, so the roof only
          // needs to clear it by a margin — the first pass made these twice
          // that height and every building came out a nine-storey tower next to
          // a five-metre truck.
          <GroundOccluder key={o.key} pos={o.pos} az={o.az} width={o.width} waterside={o.waterside} />
        )
        : (
          <group key={o.key} position={o.pos} rotation={[0, -o.az, 0]}>
            <CloudBank width={o.width} seed={o.seed} />
          </group>
        )
      ))}
    </group>
  )
}

// The channel each watercraft pass sails down.
//
// This is the surface that caused the "I can't see the target at all" bug, and
// the fix is entirely in HOW it wins its depth fight, not in what it is. It has
// to beat the field underneath it and lose to the boat on top of it, and a
// units-only offset does both: ~0.18 m of bias at 700 m clears the field it is
// coplanar with and leaves the boat's 1 m hull well clear. The original used
// polygonOffsetFactor, which is slope-scaled and worked out at metres — the
// water was rendering over its own target.
function WaterPatches({ zones }) {
  return (
    <group>
      {zones.map((w, i) => (
        <group key={i} position={[w.x, GROUND_Y + Y_WATER + i * 0.002, w.z]} rotation={[0, -w.az, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[1, WATER_ACROSS, 1]}>
            <circleGeometry args={[w.r, 40]} />
            <meshStandardMaterial
              color={COLORS.water} roughness={0.75} metalness={0.05}
              polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={OFFSET_WATER}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ── Target bodies ────────────────────────────────────────────────────────────

// Scale a loaded model so its longest dimension is exactly the target's real
// size in metres, and sit it on its own centre.
function useFittedModel(scene, size) {
  return useMemo(() => {
    if (!scene) return null
    const box = new THREE.Box3().setFromObject(scene)
    const dims = new THREE.Vector3()
    const centre = new THREE.Vector3()
    box.getSize(dims)
    box.getCenter(centre)
    const longest = Math.max(dims.x, dims.y, dims.z) || 1
    const scale = size / longest
    return { scale, offset: [-centre.x * scale, -centre.y * scale, -centre.z * scale] }
  }, [scene, size])
}

function GlbBody({ url, size, yaw }) {
  const { scene } = useGLTF(url)
  // Cloned — and its materials cloned with it — so lifting this target out of
  // the shadows can't leak back into the cached GLTF that Target, FLAG and DPT
  // also draw from.
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const lift = (mat) => {
        const m = mat.clone()
        m.emissive = new THREE.Color(TARGET_EMISSIVE)
        m.emissiveIntensity = TARGET_EMISSIVE_INTENSITY
        m.metalness = 0.15
        m.roughness = 0.6
        m.needsUpdate = true
        return m
      }
      o.material = Array.isArray(o.material) ? o.material.map(lift) : lift(o.material)
    })
    return clone
  }, [scene])
  const fit = useFittedModel(model, size)
  return (
    <group rotation={[0, yaw, 0]}>
      <group scale={fit.scale} position={fit.offset}>
        <primitive object={model} />
      </group>
    </group>
  )
}

// Primitive bodies for the kinds with no model, and the fallback for the kinds
// that have one if the GLB ever fails to load (offline, or a Railway deploy that
// never shipped public/).
//
// All of them are built LONG ALONG +Z, because that is the axis lookAt() puts
// down the direction of travel — a hull or a truck modelled along X drives
// permanently sideways.
//
// The walking figure is a primitive by choice rather than character.glb: at the
// ranges a person pass runs (~300 m) they are about ten pixels tall, where a
// rigged and animated model is indistinguishable from a capsule, costs a skinned
// clone (which breaks skeleton binding — see PlayerModel) and a fourth GLB
// fetch. What the target does need is tone, which this controls and the model
// did not.
function PrimitiveBody({ kind, size }) {
  if (kind === 'boat') {
    return (
      <group>
        <mesh position={[0, size * 0.05, 0]}>
          <boxGeometry args={[size * 0.26, size * 0.14, size]} />
          <meshStandardMaterial color={COLORS.hull} flatShading roughness={0.75} />
        </mesh>
        <mesh position={[0, size * 0.19, -size * 0.06]}>
          <boxGeometry args={[size * 0.2, size * 0.16, size * 0.3]} />
          <meshStandardMaterial color={COLORS.hull} flatShading roughness={0.75} />
        </mesh>
        <mesh position={[0, size * 0.33, -size * 0.06]}>
          <cylinderGeometry args={[size * 0.012, size * 0.012, size * 0.14, 6]} />
          <meshStandardMaterial color={COLORS.hull} flatShading roughness={0.75} />
        </mesh>
      </group>
    )
  }
  if (kind === 'static') {
    return (
      <group>
        <mesh position={[0, size * 0.14, 0]}>
          <boxGeometry args={[size * 0.55, size * 0.28, size]} />
          <meshStandardMaterial color={COLORS.structure} flatShading roughness={1} />
        </mesh>
        <mesh position={[0, size * 0.3, 0]}>
          <boxGeometry args={[size * 0.6, size * 0.05, size * 1.05]} />
          <meshStandardMaterial color={COLORS.roof} flatShading roughness={1} />
        </mesh>
        <mesh position={[0, size * 0.5, size * 0.3]}>
          <cylinderGeometry args={[size * 0.02, size * 0.02, size * 0.38, 8]} />
          <meshStandardMaterial color={COLORS.structure} flatShading roughness={1} />
        </mesh>
        <mesh position={[0, size * 0.7, size * 0.3]} rotation={[Math.PI / 5, 0, 0]}>
          <cylinderGeometry args={[size * 0.09, size * 0.02, size * 0.06, 12]} />
          <meshStandardMaterial color={COLORS.structure} flatShading roughness={1} />
        </mesh>
      </group>
    )
  }
  if (kind === 'person') {
    // A foot patrol. `size` is the GROUP's extent (see RTT_KINDS.person); each
    // figure is drawn at a real 1.8 m, so the scale stays honest and only the
    // silhouette gets big enough to find.
    const h = 1.8
    const spread = size / 2
    return (
      <group>
        {[[-spread * 0.8, -spread * 0.5], [0, spread * 0.35], [spread * 0.75, -spread * 0.15]].map(([dx, dz], i) => (
          <group key={i} position={[dx, 0, dz]}>
            <mesh position={[0, h * 0.46, 0]}>
              <capsuleGeometry args={[h * 0.13, h * 0.44, 4, 8]} />
              <meshStandardMaterial color={COLORS.person} flatShading roughness={1} />
            </mesh>
            <mesh position={[0, h * 0.88, 0]}>
              <sphereGeometry args={[h * 0.11, 8, 6]} />
              <meshStandardMaterial color={COLORS.person} flatShading roughness={1} />
            </mesh>
          </group>
        ))}
      </group>
    )
  }
  // A truck, cab forward (+Z is the direction of travel).
  const u = size / 5 // authored around a 5 m vehicle
  return (
    <group>
      <mesh position={[0, u * 0.9, -size * 0.15]}>
        <boxGeometry args={[u * 2.0, u * 1.2, size * 0.6]} />
        <meshStandardMaterial color={COLORS.vehicle} flatShading roughness={1} />
      </mesh>
      <mesh position={[0, u * 0.85, size * 0.32]}>
        <boxGeometry args={[u * 1.9, u * 1.1, size * 0.26]} />
        <meshStandardMaterial color={COLORS.vehicle} flatShading roughness={1} />
      </mesh>
      <mesh position={[0, u * 0.3, 0]}>
        <boxGeometry args={[u * 2.1, u * 0.5, size * 0.9]} />
        <meshStandardMaterial color={COLORS.scatter} flatShading roughness={1} />
      </mesh>
    </group>
  )
}

function TargetBody({ target }) {
  const { kind, size, id } = target
  if (kind === 'jet' || kind === 'helicopter') {
    const url = kind === 'helicopter' ? MODEL_HELI : (id % 2 === 0 ? MODEL_JET_A : MODEL_JET_B)
    return (
      <ErrorCatcher fallback={<PrimitiveBody kind="vehicle" size={size} />}>
        <Suspense fallback={null}>
          <GlbBody url={url} size={size} yaw={YAW_AIRCRAFT} />
        </Suspense>
      </ErrorCatcher>
    )
  }
  return <PrimitiveBody kind={kind} size={size} />
}

// Fades a target's whole body. Every material below a mounted target is a clone
// owned by that subtree (see GlbBody), so switching it to transparent affects
// nothing else in the app.
function applyOpacity(root, value) {
  if (!root) return
  const transparent = value < 1
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return
    const list = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of list) {
      m.transparent = transparent
      m.opacity = value
      m.depthWrite = !transparent
    }
  })
}

// The pass currently on screen. Only one target is ever mounted: passes never
// overlap, and mounting one at a time keeps the draw-call count flat.
//
// Once the window closes the target keeps travelling and fades out over
// TARGET_EXIT_MS. It is unshootable the whole time — the sim's window has not
// moved — but a target that vanishes mid-frame is indistinguishable from a
// broken game, and the player needs to see the pass end rather than infer it.
function ActiveTarget({ target, simRef }) {
  const groupRef = useRef(null)
  const aheadRef = useRef(new THREE.Vector3())
  const fadedRef = useRef(false)

  // Walked on demand rather than collected once into a ref: the materials only
  // need touching during the half-second a target is fading out, and caching
  // them in a ref that an effect had populated is the shape React 19's
  // react-hooks/immutability rule (rightly) refuses.
  const setOpacity = (value) => {
    // The common case — fully opaque — costs nothing at all.
    if (value >= 1 && !fadedRef.current) return
    fadedRef.current = value < 1
    applyOpacity(groupRef.current, value)
  }

  useFrame(() => {
    const g = groupRef.current
    const sim = simRef.current
    if (!g || !sim) return
    const t = sim.elapsedMs
    const live = isTargetVisible(target, t)
    const sinceEnd = t - target.tEndMs
    const exiting = !live && sinceEnd >= 0 && sinceEnd < TARGET_EXIT_MS
    if (!live && !exiting) { g.visible = false; return }

    g.visible = live ? !isTargetOccluded(target, t) : true
    setOpacity(exiting ? 1 - sinceEnd / TARGET_EXIT_MS : 1)

    // Unclamped during the exit, so the target carries on down its track
    // instead of freezing at the last frame of the window.
    const now = targetDirectionAt(target, t, !exiting)
    const [x, y, z] = polarToWorld(now.az, now.elev, target.range)
    g.position.set(x, y, z)

    if (target.startAz === target.endAz) {
      // A static installation has no track to face down, so it faces the
      // station — level, not tipped up at it.
      aheadRef.current.set(0, y, 0)
    } else {
      const soon = targetDirectionAt(target, t + 400, !exiting)
      const [ax, ay, az] = polarToWorld(soon.az, soon.elev, target.range)
      aheadRef.current.set(ax, ay, az)
    }
    if (aheadRef.current.distanceToSquared(g.position) > 1e-4) g.lookAt(aheadRef.current)
  })

  return (
    <group ref={groupRef} visible={false}>
      <TargetBody target={target} />
    </group>
  )
}

// ── Driver ───────────────────────────────────────────────────────────────────

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// The single frame loop: read the stick, slew the camera, advance the sim, take
// any pictures that were asked for, and hand the HUD its new numbers.
//
// The HUD values go out through `onHud` as a mutable snapshot object owned by
// this component, and CbatRtt writes them into its own DOM nodes. That split is
// not decoration: React 19's react-hooks/immutability rule forbids writing
// through a prop, and pushing 60 Hz of text through React state instead would
// cost a render a frame.
function RttDriver({ simRef, inputRef, sensitivityRef, runningRef, camRef, onHud, onShot, onEnd, setActiveIndex }) {
  const endedRef = useRef(false)
  const activeRef = useRef(-2)
  // Reused every frame so the loop allocates nothing.
  const hudOut = useRef({
    reticle: 'idle', stickX: 0, stickY: 0,
    clock: '0:00', score: '0', az: '000', elev: '+00',
    frames: '', label: 'STAND BY', count: '', window: '0%',
    cueOn: false, cueNext: false, cueAngle: '0deg', cueDeg: '',
  })
  // Yaw then pitch, the FPS convention. Built as a quaternion rather than by
  // setting camera.rotation.order, which would mean assigning to a value the
  // useThree hook returned.
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))

  useFrame((state, delta) => {
    const camera = state.camera
    const sim = simRef.current
    const input = inputRef.current
    if (!sim || !input || !runningRef.current) return
    // Clamped so a backgrounded tab doesn't return and teleport the run forward.
    const dt = Math.min(0.12, delta)

    input.poll()
    const { x, y } = input.axes()
    const rate = MAX_SLEW_DEG_PER_SEC * DEG * (sensitivityRef.current || 1)
    const cam = camRef.current
    cam.az = clamp(cam.az + x * rate * dt, -AZ_LIMIT, AZ_LIMIT)
    // Screen-Y grows downward, so pushing the stick down must lower the aim.
    cam.elev = clamp(cam.elev - y * rate * dt, ELEV_MIN, ELEV_MAX)
    cam.deflection = Math.min(1, Math.hypot(x, y))
    cam.stickX = x
    cam.stickY = y

    advanceRtt(sim, dt * 1000)

    // The airframe's residual motion, added on top of what the player commanded.
    // The result is the ACTUAL line of sight, and it drives both the camera and
    // the hit test below — if those two ever disagreed the game would be
    // scoring something other than what is on the screen.
    const shake = airframeDisturbance(sim.elapsedMs / 1000, sim.tuning.airframeScale ?? 1)
    const aimAz = clamp(cam.az + shake.az, -AZ_LIMIT, AZ_LIMIT)
    const aimElev = clamp(cam.elev + shake.elev, ELEV_MIN, ELEV_MAX)
    euler.current.set(aimElev, -aimAz, shake.roll)
    camera.quaternion.setFromEuler(euler.current)

    // Everything currently in the sky, with how far off centre it is. Built
    // every frame because it feeds both the shutter and the reticle state.
    const candidates = []
    for (let i = 0; i < sim.run.targets.length; i++) {
      const target = sim.run.targets[i]
      if (!isTargetVisible(target, sim.elapsedMs)) continue
      const d = targetDirectionAt(target, sim.elapsedMs)
      candidates.push({
        index: i,
        errorRad: angularError(aimAz, aimElev, d.az, d.elev),
        occluded: isTargetOccluded(target, sim.elapsedMs),
      })
    }

    const shots = input.consumeTriggerEdges()
    for (let s = 0; s < shots; s++) {
      const result = fireShutter(sim, candidates)
      if (result.kind !== 'cooldown') onShot?.(result)
    }

    // ── HUD ──────────────────────────────────────────────────────────────────
    const active = candidates.length ? candidates[0] : null

    // What is MOUNTED runs a little past what is shootable, so the target can be
    // seen to leave (see ActiveTarget). The two indices are deliberately
    // separate: `active` decides scoring and the reticle, `stageIndex` decides
    // what is on screen.
    let stageIndex = -1
    for (let i = 0; i < sim.run.targets.length; i++) {
      const tg = sim.run.targets[i]
      if (sim.elapsedMs >= tg.tStartMs && sim.elapsedMs < tg.tEndMs + TARGET_EXIT_MS) { stageIndex = i; break }
    }
    if (stageIndex !== activeRef.current) {
      activeRef.current = stageIndex
      setActiveIndex(stageIndex)
    }

    const done = !!active && sim.progress[active.index].frames >= RTT_FRAMES_PER_TARGET
    const onTarget = !!active && active.errorRad <= sim.captureRad && !active.occluded
    const obscured = !!active && active.occluded
    const hud = hudOut.current
    // 'done' is its own state on purpose: with three frames in the bag there is
    // nothing left to earn on this target, and a reticle still glowing green
    // would keep inviting shots that can only cost points.
    hud.reticle = done ? 'done' : onTarget ? 'lock' : obscured ? 'obscured' : 'idle'
    hud.stickX = cam.stickX
    hud.stickY = cam.stickY
    hud.clock = fmtClock(sim.durationMs - sim.elapsedMs)
    hud.score = String(Math.round(sim.score))
    // The readouts show the actual line of sight, drift included — that is what
    // the sensor is really pointing at.
    hud.az = (aimAz / DEG).toFixed(0).padStart(3, '0')
    hud.elev = `${(aimElev / DEG) >= 0 ? '+' : '-'}${Math.abs(aimElev / DEG).toFixed(0).padStart(2, '0')}`

    if (stageIndex >= 0) {
      const target = sim.run.targets[stageIndex]
      const frames = sim.progress[stageIndex].frames
      hud.frames = `${frames}/${RTT_FRAMES_PER_TARGET}`
      hud.count = `${stageIndex + 1} of ${sim.run.targets.length}`
      if (active) {
        hud.label = obscured ? `${target.hud} — OBSCURED` : target.hud
        // A visible countdown on the pass, so a target running out of time is
        // something the player watched happen rather than something that
        // happened to them.
        // Whole percent: the browser normalises '55.0%' to '55%' when it lands
        // on the element, so a fractional value would never match the guard in
        // writeHud and the bar would be rewritten every single frame.
        hud.window = `${Math.round(Math.max(0, Math.min(100, ((target.tEndMs - sim.elapsedMs) / target.windowMs) * 100)))}%`
      } else {
        // Past the window, still fading off the screen.
        hud.label = frames >= RTT_FRAMES_PER_TARGET ? 'PASS COMPLETE' : 'PASS ENDED'
        hud.window = '0%'
      }
    } else {
      hud.frames = `–/${RTT_FRAMES_PER_TARGET}`
      hud.label = 'STAND BY'
      hud.count = `– of ${sim.run.targets.length}`
      hud.window = '0%'
    }

    // ── Cue ──────────────────────────────────────────────────────────────────
    // Which way to slew to find the target. Without it a run is mostly spent
    // sweeping 300° of gimbal looking for something 20 px across, and the test
    // stops measuring tracking and starts measuring luck.
    //
    // It is not a cheat: a sensor operator is cued onto a target by the crew,
    // and the arrow only says WHERE — holding the target centred, which is
    // what actually scores, is untouched. Between passes it points at the next
    // target so the dead time can be spent getting ahead of it.
    let cueIndex = active ? active.index : -1
    let cueIsNext = false
    if (cueIndex < 0) {
      cueIndex = sim.run.targets.findIndex(tg => tg.tStartMs > sim.elapsedMs)
      cueIsNext = cueIndex >= 0
    }
    if (cueIndex >= 0) {
      const tg = sim.run.targets[cueIndex]
      const dir = targetDirectionAt(tg, Math.max(sim.elapsedMs, tg.tStartMs))
      const offRad = angularError(aimAz, aimElev, dir.az, dir.elev)
      hud.cueOn = offRad > CUE_HIDE_RAD
      hud.cueNext = cueIsNext
      // Screen space: +x right, +y DOWN, so a target above the aim needs a
      // negative y. CSS rotate() is clockwise from +x, which is the same frame.
      hud.cueAngle = `${(Math.atan2(-(dir.elev - aimElev), dir.az - aimAz) / DEG).toFixed(1)}deg`
      hud.cueDeg = `${Math.round(offRad / DEG)}°`
    } else {
      hud.cueOn = false
    }

    onHud?.(hud)

    if (isRunOver(sim) && !endedRef.current) {
      endedRef.current = true
      onEnd?.()
    }
  })

  return null
}

// ── Scene ────────────────────────────────────────────────────────────────────

// Only the active pass is mounted; the driver reports which one that is and this
// swaps the body over. Kept in its own component so a target change remounts the
// model without disturbing the driver.
//
// `sim` is passed as a plain prop as well as a ref: the render tree needs the
// run's target list, and React 19's react-hooks/refs rule (rightly) forbids
// reading simRef.current during render. Same object either way — the prop is for
// rendering, the ref is for the frame loop.
function TargetStage({ sim, simRef, activeIndex }) {
  if (!sim || activeIndex < 0) return null
  const target = sim.run.targets[activeIndex]
  if (!target) return null
  return <ActiveTarget key={target.id} target={target} simRef={simRef} />
}

// Which pass is on screen is scene-local state, deliberately held INSIDE the
// canvas subtree: keeping it here means a target change re-renders the three
// components below it and nothing else. Lifting it to the page would re-render
// <Canvas> itself a dozen times a run, and the HUD along with it — for a value
// the HUD already gets written directly by the frame loop.
function SceneContents({ sim, simRef, inputRef, sensitivityRef, runningRef, camRef, onHud, onShot, onEnd }) {
  const [activeIndex, setActiveIndex] = useState(-1)
  const targets = sim?.run?.targets ?? []

  return (
    <>
      <color attach="background" args={[COLORS.skyTop]} />
      {/* Fog is the horizon: the ground fades into the sky's haze band at
          distance instead of ending on a hard line. Near sits past the furthest
          target (about 1150 m) so nothing the player has to see is washed out,
          and far is close enough in that the farmland is fully hazed by the time
          it runs out at FARM_HALF — otherwise the edge of the patchwork shows
          as a ring on the ground. */}
      <fog attach="fog" args={[COLORS.skyHorizon, 1200, 5200]} />

      <SkyDome />

      {/* Dusk key from high and to the right, a cool fill from the opposite side
          so nothing's underside goes black, and a hemisphere to seat everything
          between sky and ground.
          These sum to roughly 1.6× on an upward-facing surface, ON PURPOSE. The
          first version totalled about 3×, which meant every colour in the file
          rendered as something noticeably different from what was written —
          a considered woodland green came out as vivid grass. Keeping the total
          near unity makes the palette mean what it says. */}
      <ambientLight intensity={0.3} />
      <hemisphereLight args={[COLORS.skyHorizon, COLORS.ground, 0.45]} />
      <directionalLight position={[900, 1400, 600]} intensity={0.95} color="#ffeeda" />
      {/* The fill matters more than it looks. Buildings and the earth banks that
          hide boats are boxes whose camera-facing side is often turned away from
          the key, and with a weaker fill they rendered as flat black slabs that
          read as holes in the landscape rather than as cover. */}
      <directionalLight position={[-800, 500, -700]} intensity={0.5} color="#8fb6e8" />

      <World targets={targets} />
      <Occluders targets={targets} />
      <TargetStage sim={sim} simRef={simRef} activeIndex={activeIndex} />

      <RttDriver
        simRef={simRef}
        inputRef={inputRef}
        sensitivityRef={sensitivityRef}
        runningRef={runningRef}
        camRef={camRef}
        onHud={onHud}
        onShot={onShot}
        onEnd={onEnd}
        setActiveIndex={setActiveIndex}
      />
    </>
  )
}

// Hoisted so <Canvas> gets the same objects on every render — R3F treats a new
// camera/gl object as a change and reapplies it, which would fight the driver
// for the camera's rotation.
// The near plane is the single most important number in this file for image
// stability, and it is worth spelling out why.
//
// Depth-buffer precision goes as roughly d² / (near × 2^bits): almost all of the
// buffer's resolution is spent on the space just in front of the camera. With
// near = 1 m — the value this started with — over 99% of the range was being
// spent on 1 m to 230 m of EMPTY AIR, because the camera is 140 m up and can
// only look down 38°, so nothing is ever visible closer than ~200 m. What was
// left could not separate two nearly-flat surfaces a few centimetres apart, and
// the ground flickered between field, hedge and road wherever it was seen at a
// shallow angle. Classic z-fighting.
//
// Moving near to 50 m — still four times closer than anything that can be
// rendered — multiplies the usable precision by fifty. It is what lets the flat
// decals be layered by honest height differences instead of depth bias, which
// in turn is what stops the bias swallowing targets (see OFFSET_* above).
const CAMERA_NEAR = 50
const CAMERA_PROPS = { position: [0, 0, 0], fov: CAMERA_FOV_DEG, near: CAMERA_NEAR, far: 20000 }
const GL_PROPS = { antialias: true, powerPreference: 'high-performance' }
// Capped rather than uncapped: the sensor picture is a low-contrast scene where
// extra pixels buy almost nothing, and this game has to stay playable on the
// phones the CBAT-only app runs on.
const DPR = [1, 1.5]
const CANVAS_STYLE = { width: '100%', height: '100%' }

export default function RttScene(props) {
  const demoCanvas = useCbatDemoCanvas()

  return (
    <Canvas
      {...demoCanvas}
      camera={CAMERA_PROPS}
      dpr={demoCanvas.dpr ?? DPR}
      gl={GL_PROPS}
      style={CANVAS_STYLE}
    >
      <SceneContents {...props} />
    </Canvas>
  )
}

useGLTF.preload(MODEL_JET_A)
useGLTF.preload(MODEL_JET_B)
useGLTF.preload(MODEL_HELI)
