// The Spatial Integration Test's clip, rendered in 3D.
//
// From the guide corpus: "Afterwards you get a 3D rendered VIDEO of the scene
// and about 50 seconds of true/false questions on it, with no replay." The clip
// was a flat top-down map turned 90°, 180° or 270° — which is the same
// information, but the real test does not give it to you as a map. Reading a
// scene off an oblique camera pass is a materially different job from reading it
// off a plan view, and it is the job the test is measuring.
//
// WHAT THIS DOES AND DOES NOT CHANGE
//
// The generator is untouched: `clip` still arrives with its cells already turned
// by `rotation`. Rendering pre-turned ground from a fixed camera bearing is
// exactly equivalent to rendering true ground from a turned camera — the same
// scene either way — and keeping the transform in the generator is what lets it
// stay pure, seedable and tested. What changes here is only how it is drawn.
//
// So the player still studies plan-view layers and still meets the ground
// re-oriented; they now also have to cope with perspective, foreshortening and
// occlusion on the way. The hills remain the anchor, and are drawn as the
// largest landform in the scene for that reason.
//
// NO COMPASS, NO GRID LABELS, AND NO GRID. Working out which way round the
// ground has ended up is the task. The clip carried grid lines for a while on
// the reasoning that position had to stay judgeable — but the corpus puts the
// grid on the STUDY displays ("displays showing where things sit on a grid") and
// describes the clip only as "a 3D rendered video of the environment". More to
// the point, the technique the corpus calls the difference between passing and
// failing is "use fixed terrain like hills as reference points", and that is not
// a technique at all while there is a grid to read off instead.
//
// What replaces it is the FIELD: a hedged boundary around the same 12 × 12, so
// "near the top-left corner of the field" is still a thing you can see. That is
// a real frame of reference rather than a survey overlay, and it is the sort of
// thing you would actually navigate by.
//
// Airborne contacts get a drop line to the ground. Without one there is no way
// to tell which cell an aircraft is over, and its position would be unanswerable
// rather than hard.
//
// THE WORLD RUNS PAST THE FRAME. The clip was a 12 × 12 slab in the void, which
// read as a board being turned rather than a place being flown over. The terrain
// now rolls out to 240 units with a lake and woodland on it and haze beyond, so
// no edge is ever in shot. The field stays flat and hedged inside all of it —
// see terrainHeight in sitClipGeometry.js for why that part cannot roll.
//
// EVERY MODEL IS BUILT FROM PRIMITIVES, with no loaded assets and the grass and
// sky drawn into canvases at mount. CBAT play is offline-capable, and a clip
// that waits on a network fetch has already lost most of the two and a half
// seconds it gets.

import { useRef, useMemo, useEffect, useLayoutEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useCbatDemoCanvas } from '../../utils/cbat/demoMode'
import { CLASS_STYLE } from './sitClassStyle'
// Cell placement and heading maths live outside this file so they can be tested
// without standing up WebGL — see utils/cbat/sitClipGeometry.js for why the
// heading spin is negated.
import {
  CELL, CAMERA, FIELD_HALF, LAKE,
  cellToWorld, headingSpin, terrainHeight,
} from '../../utils/cbat/sitClipGeometry'

// How far the ground runs, and how far the haze lets you see. Terrain has to
// outrun the fog or the far edge appears as a hard line in the murk.
const WORLD = 240
const WORLD_SEGMENTS = 160
const HAZE = '#263a52'
const FOG_NEAR = 42
const FOG_FAR = 135

// The camera arc. A slow pan rather than a static frame, because the corpus
// calls it a video — and because a moving camera is what makes occlusion happen
// at all. Kept narrow: this is a pass over the ground, not an orbit, and a wide
// sweep would hand the player the parallax to solve the layout for free.
//
// The numbers live in sitClipGeometry.js alongside `fitsInFrame`, which pins
// them against the board size — the first cut of this scene clipped an aircraft
// off the edge of the picture, and only a screenshot caught it.
const CAM_ELEVATION = CAMERA.elevationDeg * Math.PI / 180
const CAM_SWEEP = CAMERA.sweepDeg * Math.PI / 180
// Aimed ABOVE the field rather than at it — see CAMERA.lookAtY, which
// `fitsInFrame` accounts for. Raise it further and the field runs off the
// bottom of the frame; that guard is what will say so.
const LOOK_AT = new THREE.Vector3(0, CAMERA.lookAtY, 0)

// ── Grass ────────────────────────────────────────────────────────────────────
// Drawn into a canvas rather than shipped as an image: a texture file is another
// thing to fetch, and this scene has to come up inside a clip that lasts two and
// a half seconds. Kept dark and desaturated so it sits inside the app's night
// palette instead of turning the panel into a golf course.
function makeGrassTexture(size = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#1c2a17'
  ctx.fillRect(0, 0, size, size)

  // Gentle patches only. A strong large-scale blotch is exactly what makes a
  // tile visible as a tile once it repeats sixty times across the world, and the
  // first cut of this was legible as a repeating pattern from the air. The big
  // variation now comes from the terrain's own shading instead.
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 20 + Math.random() * 40
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, Math.random() < 0.5 ? 'rgba(50,74,36,0.2)' : 'rgba(20,32,16,0.22)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  }

  // Then blades, for texture close up.
  for (let i = 0; i < 5000; i++) {
    const shade = 0.65 + Math.random() * 0.7
    ctx.fillStyle = `rgba(${Math.round(46 * shade)},${Math.round(70 * shade)},${Math.round(33 * shade)},0.55)`
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 2 + Math.random() * 2)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  // One tile every 4 world units. It was one tile every 48, which smeared the
  // blades into soft blotches and made the ground look like painted card.
  const tiles = WORLD / 4
  texture.repeat.set(tiles, tiles)
  return texture
}

// ── Camera ───────────────────────────────────────────────────────────────────
// Driven off elapsed time rather than off a frame counter, so the pass covers
// the same arc whatever the frame rate — a player on a slow device must not get
// a different view of the same clip from a player on a fast one.
function CameraPass({ durationMs }) {
  const startRef = useRef(null)
  useFrame(({ camera, clock }) => {
    if (startRef.current === null) startRef.current = clock.elapsedTime
    const t = Math.min(1, ((clock.elapsedTime - startRef.current) * 1000) / durationMs)
    const az = -CAM_SWEEP / 2 + CAM_SWEEP * t
    const horiz = CAMERA.radius * Math.cos(CAM_ELEVATION)
    camera.position.set(horiz * Math.sin(az), CAMERA.radius * Math.sin(CAM_ELEVATION), horiz * Math.cos(az))
    camera.lookAt(LOOK_AT)
  })
  return null
}

// A vertical gradient standing in for sky: haze at the horizon easing up to the
// app's night blue. Painted rather than loaded, same reasoning as the grass.
function makeSkyTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, '#050c16')
  g.addColorStop(0.62, '#132132')
  g.addColorStop(1, HAZE)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 128)
  return new THREE.CanvasTexture(canvas)
}

function Sky() {
  const texture = useMemo(() => makeSkyTexture(), [])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[WORLD * 0.75, 24, 16]} />
      {/* `fog={false}`: the sky IS the thing the fog fades into, so fogging it
          washes the horizon out to a flat slab of nothing. */}
      <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  )
}

// ── Ground ───────────────────────────────────────────────────────────────────
function Terrain() {
  const grass = useMemo(() => makeGrassTexture(), [])
  useEffect(() => () => grass.dispose(), [grass])

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, WORLD_SEGMENTS, WORLD_SEGMENTS)
    // Rotate the GEOMETRY rather than the mesh, so the displacement below can be
    // written against world x/z directly and matches terrainHeight's arguments.
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)))
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial map={grass} roughness={1} />
    </mesh>
  )
}

function Lake() {
  return (
    <group position={[LAKE.x, 0, LAKE.z]}>
      {/* A muddy shore ring, slightly wider than the water and slightly below
          it. Without one the water is a bright disc lying on top of the grass
          with a hard cut edge, which reads as paint rather than as a lake. */}
      <mesh position={[0, LAKE.level - 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[LAKE.radius + 1.5, 48]} />
        <meshStandardMaterial color="#3d3a26" roughness={1} />
      </mesh>
      <mesh position={[0, LAKE.level, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[LAKE.radius, 48]} />
      {/* Mostly NON-metal. The first cut used metalness 0.85, which needs an
          environment map to reflect anything — with none in the scene it had
          nothing to mirror and rendered as a black hole in the hillside. A
          little metalness plus low roughness gives the sun's specular; the
          emissive keeps it from going flat black in shadow. */}
        <meshStandardMaterial
          color="#1d4560"
          roughness={0.16}
          metalness={0.2}
          emissive="#08151f"
          emissiveIntensity={0.5}
          transparent
          opacity={0.93}
        />
      </mesh>
    </group>
  )
}

// The hedge round the field. This is what replaced the grid: a real boundary you
// can place things against, rather than a survey overlay. It also stops the
// scored objects inside from being confused with the scenery outside.
function Hedgerow() {
  const span = FIELD_HALF * 2
  const sides = [
    { p: [0, 0.17, -FIELD_HALF], a: [span + 0.34, 0.34, 0.34] },
    { p: [0, 0.17, FIELD_HALF], a: [span + 0.34, 0.34, 0.34] },
    { p: [-FIELD_HALF, 0.17, 0], a: [0.34, 0.34, span + 0.34] },
    { p: [FIELD_HALF, 0.17, 0], a: [0.34, 0.34, span + 0.34] },
  ]
  return (
    <group>
      {sides.map(({ p, a }, i) => (
        <mesh key={i} position={p} castShadow receiveShadow>
          <boxGeometry args={a} />
          <meshStandardMaterial color="#2c4526" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  )
}

// Woodland out in the landscape, instanced so a few hundred trees cost two draw
// calls. Deliberately BIGGER than the tree stands inside the field and always
// outside the hedge, so there is never a question about which trees are the ones
// being asked about.
function DistantWoods() {
  const trunks = useRef()
  const canopies = useRef()

  const items = useMemo(() => {
    // Hashed off the index rather than walked from a running seed: pure, so the
    // landscape is identical every run and on every device. A clip that
    // reshuffled its world between two players would not be the same test.
    const rnd = (i, salt) => {
      let h = Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503)
      h = Math.imul(h ^ (h >>> 15), 2246822519)
      return ((h ^ (h >>> 13)) >>> 0) / 4294967296
    }
    const out = []
    for (let i = 0; i < 260; i++) {
      const angle = rnd(i, 0) * Math.PI * 2
      // Well back from the hedge. At 19 the woods crowded right up to the field
      // and filled the top of the frame, which made the world feel smaller
      // rather than bigger — the opposite of the point.
      const dist = 30 + rnd(i, 1) * 92
      const x = Math.cos(angle) * dist
      const z = Math.sin(angle) * dist
      // Never in the lake, and never standing in the water's edge.
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 1.35) continue
      // A canopy cone of 2.1 at scale 1 is already a tall tree next to a barn
      // that is 0.6 high. The first cut ran to scale 2.9 and grew redwoods.
      out.push({ x, z, y: terrainHeight(x, z), s: 0.8 + rnd(i, 2) * 0.8, r: rnd(i, 3) * Math.PI })
    }
    return out
  }, [])

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    items.forEach((it, i) => {
      dummy.rotation.set(0, it.r, 0)
      dummy.scale.setScalar(it.s)
      dummy.position.set(it.x, it.y + 0.35 * it.s, it.z)
      dummy.updateMatrix()
      trunks.current.setMatrixAt(i, dummy.matrix)
      dummy.position.set(it.x, it.y + 1.35 * it.s, it.z)
      dummy.updateMatrix()
      canopies.current.setMatrixAt(i, dummy.matrix)
    })
    trunks.current.instanceMatrix.needsUpdate = true
    canopies.current.instanceMatrix.needsUpdate = true
  }, [items])

  return (
    <group>
      {/* No castShadow: the shadow camera only covers the field, and shadows
          from 200 trees it can never reach are pure cost. */}
      <instancedMesh ref={trunks} args={[undefined, undefined, items.length]}>
        <cylinderGeometry args={[0.13, 0.19, 0.8, 5]} />
        <meshStandardMaterial color="#39291b" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={canopies} args={[undefined, undefined, items.length]}>
        <coneGeometry args={[0.8, 2.1, 7]} />
        <meshStandardMaterial color="#2b4527" roughness={1} flatShading />
      </instancedMesh>
    </group>
  )
}

// ── Per-class models ─────────────────────────────────────────────────────────
// Each class is a distinct silhouette from a low angle, not just a distinct
// colour: at 34° of elevation a flat marker is nearly edge-on, and colour is the
// first thing a poor screen loses. Everything also has to stay inside its own
// cell, or which square it is in stops being answerable.

function Hill({ style }) {
  // A smooth mound rather than a faceted cone, and the biggest thing standing on
  // the ground — it is the reference terrain the whole test hangs off, so it has
  // to be the feature you find first.
  return (
    <group>
      <mesh scale={[0.92, 0.62, 0.92]} castShadow receiveShadow>
        <sphereGeometry args={[1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={style.fill} roughness={1} />
      </mesh>
      {/* A grassed crown, so it reads as a landform rather than a bare pile. */}
      <mesh position={[0, 0.34, 0]} scale={[0.62, 0.34, 0.62]} castShadow>
        <sphereGeometry args={[1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#3c5a2e" roughness={1} />
      </mesh>
    </group>
  )
}

// A gable roof, built from two slabs leaning against each other. `w` is the span
// across the building, `d` its length, `rise` how far the ridge sits above the
// eaves.
function GableRoof({ w, d, rise, color, y }) {
  const slope = Math.hypot(w / 2, rise)
  const pitch = Math.atan2(rise, w / 2)
  return (
    <group position={[0, y, 0]}>
      {[-1, 1].map(side => (
        <mesh
          key={side}
          position={[side * (w / 4), rise / 2, 0]}
          rotation={[0, 0, -side * pitch]}
          castShadow
        >
          <boxGeometry args={[slope, 0.07, d]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

function Farm({ style }) {
  return (
    <group>
      {/* Barn: red timber walls, gable roof, big door on the gable end. */}
      <mesh position={[0, 0.3, 0.06]} castShadow receiveShadow>
        <boxGeometry args={[0.86, 0.6, 0.7]} />
        <meshStandardMaterial color={style.fill} roughness={0.85} />
      </mesh>
      <GableRoof w={0.98} d={0.8} rise={0.3} color={style.stroke} y={0.6} />
      <mesh position={[0, 0.2, 0.42]} castShadow>
        <boxGeometry args={[0.32, 0.4, 0.03]} />
        <meshStandardMaterial color="#2a1712" roughness={0.9} />
      </mesh>

      {/* Silo alongside. Two farm buildings of different shapes read as a farm
          from much further off than one barn does. */}
      <mesh position={[-0.6, 0.42, -0.3]} castShadow receiveShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.84, 14]} />
        <meshStandardMaterial color="#9aa0a6" roughness={0.7} metalness={0.15} />
      </mesh>
      <mesh position={[-0.6, 0.86, -0.3]} castShadow>
        <sphereGeometry args={[0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#c0c6cc" roughness={0.6} metalness={0.2} />
      </mesh>
    </group>
  )
}

function Truck({ style }) {
  const wheels = [[-0.24, -0.28], [0.24, -0.28], [-0.24, 0.18], [0.24, 0.18], [-0.24, 0.44], [0.24, 0.44]]
  return (
    <group>
      {/* Low and long. An earlier cut was tall enough to read as a pillar from
          the camera's elevation, which is the one silhouette that must not be
          confused with a stand of trees. */}
      <mesh position={[0, 0.3, -0.3]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.28, 0.34]} />
        <meshStandardMaterial color={style.stroke} roughness={0.6} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.26, 0.22]} castShadow receiveShadow>
        <boxGeometry args={[0.48, 0.28, 0.74]} />
        <meshStandardMaterial color={style.fill} roughness={0.7} metalness={0.2} />
      </mesh>
      {wheels.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.11, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.11, 0.11, 0.07, 10]} />
          <meshStandardMaterial color="#1a1a1e" roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function Troops({ style }) {
  // A section of three, each a body and a head, so they read as people rather
  // than as three more markers.
  const spots = [[0, -0.28], [-0.28, 0.22], [0.28, 0.22]]
  return (
    <group>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.28, 0]} castShadow>
            <capsuleGeometry args={[0.11, 0.26, 4, 10]} />
            <meshStandardMaterial color={style.stroke} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.5, 0]} castShadow>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshStandardMaterial color={style.fill} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Trees({ style }) {
  // Narrow and tall, with a layered canopy, so a stand of trees is never
  // mistaken for a hill from the side — the one confusion that would cost a
  // player their anchor.
  const spots = [[0, 0, 1], [-0.36, 0.3, 0.8], [0.34, -0.28, 0.88]]
  const canopy = [[0.52, 0.36, 0.44], [0.78, 0.29, 0.38], [1.0, 0.2, 0.3]]
  return (
    <group>
      {spots.map(([x, z, s], i) => (
        <group key={i} position={[x, 0, z]} scale={s} rotation={[0, i * 1.1, 0]}>
          <mesh position={[0, 0.19, 0]} castShadow>
            <cylinderGeometry args={[0.055, 0.08, 0.38, 6]} />
            <meshStandardMaterial color="#4a3524" roughness={1} />
          </mesh>
          {canopy.map(([y, r, h], j) => (
            <mesh key={j} position={[0, y, 0]} castShadow>
              <coneGeometry args={[r, h, 8]} />
              <meshStandardMaterial color={j === 2 ? style.stroke : style.fill} roughness={0.9} flatShading />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

// Airborne contacts sit above the ground and carry a heading. The drop line and
// the ground ring are what make their POSITION readable — the marker alone tells
// you nothing about which cell it is over once perspective is involved.
function Airborne({ style, height, children }) {
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.02, 0.02, height, 4]} />
        <meshBasicMaterial color={style.stroke} transparent opacity={0.45} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.3, 0.42, 20]} />
        <meshBasicMaterial color={style.stroke} transparent opacity={0.75} side={THREE.DoubleSide} />
      </mesh>
      <group position={[0, height, 0]}>{children}</group>
    </group>
  )
}

function Aircraft({ style }) {
  return (
    <Airborne style={style} height={2.6}>
      {/* Nose along −Z, which is north on the plan view. Wings and tail surfaces
          are flat triangular prisms, so the planform is what reads from the
          camera's angle rather than the fuselage. */}
      <group>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <capsuleGeometry args={[0.1, 0.68, 4, 10]} />
          <meshStandardMaterial color={style.stroke} roughness={0.45} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0, -0.52]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <coneGeometry args={[0.1, 0.26, 10]} />
          <meshStandardMaterial color={style.stroke} roughness={0.45} metalness={0.4} />
        </mesh>
        <mesh position={[0, -0.02, 0.08]} castShadow>
          <cylinderGeometry args={[0.5, 0.5, 0.05, 3]} />
          <meshStandardMaterial color={style.fill} roughness={0.55} metalness={0.3} flatShading />
        </mesh>
        <mesh position={[0, -0.01, 0.42]} castShadow>
          <cylinderGeometry args={[0.22, 0.22, 0.04, 3]} />
          <meshStandardMaterial color={style.fill} roughness={0.55} metalness={0.3} flatShading />
        </mesh>
        <mesh position={[0, 0.13, 0.42]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.16, 0.04, 3]} />
          <meshStandardMaterial color={style.fill} roughness={0.55} metalness={0.3} flatShading />
        </mesh>
      </group>
    </Airborne>
  )
}

function Helicopter({ style }) {
  return (
    <Airborne style={style} height={1.8}>
      <group>
        <mesh castShadow>
          <capsuleGeometry args={[0.2, 0.32, 4, 10]} />
          <meshStandardMaterial color={style.fill} roughness={0.55} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.02, 0.48]} castShadow>
          <boxGeometry args={[0.08, 0.08, 0.6]} />
          <meshStandardMaterial color={style.fill} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.13, 0.76]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <cylinderGeometry args={[0.11, 0.11, 0.03, 3]} />
          <meshStandardMaterial color={style.stroke} roughness={0.6} flatShading />
        </mesh>
        {/* Skids, so it reads as a helicopter rather than a floating pod. */}
        {[-0.16, 0.16].map(x => (
          <mesh key={x} position={[x, -0.26, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.58, 6]} />
            <meshStandardMaterial color="#2a2a2e" roughness={0.9} />
          </mesh>
        ))}
        {/* Rotor: a blurred disc plus two blades, kept inside the cell — at 0.72
            it spilled into the squares either side and made the helicopter's
            position ambiguous. */}
        <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.12, 0.5, 24]} />
          <meshBasicMaterial color={style.stroke} transparent opacity={0.14} side={THREE.DoubleSide} />
        </mesh>
        {/* Blades sit clear ABOVE the cabin on a mast. Flush with the body they
            merged into one solid disc and the whole thing read as a lampshade
            rather than an aircraft. */}
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.045, 0.18, 6]} />
          <meshStandardMaterial color="#2a2a2e" roughness={0.8} />
        </mesh>
        {[0, Math.PI / 2].map(r => (
          <mesh key={r} position={[0, 0.4, 0]} rotation={[0, r, 0]} castShadow>
            <boxGeometry args={[0.94, 0.02, 0.05]} />
            <meshStandardMaterial color={style.stroke} roughness={0.6} />
          </mesh>
        ))}
      </group>
    </Airborne>
  )
}

const MODELS = {
  hill: Hill, farm: Farm, truck: Truck, troops: Troops,
  trees: Trees, aircraft: Aircraft, helicopter: Helicopter,
}

function SceneObject({ o, grid }) {
  const Model = MODELS[o.cls]
  const style = CLASS_STYLE[o.cls]
  const { x, z } = cellToWorld(o.col, o.row, grid)
  const spin = headingSpin(o.heading)
  if (!Model || !style) return null
  return (
    <group position={[x, 0, z]} rotation={[0, spin, 0]}>
      <Model style={style} />
    </group>
  )
}

export default function SitClipScene({ objects, grid, durationMs, onReady }) {
  // Sizing + pixel-ratio overrides for a canvas inside a demo tile; empty for
  // real players.
  const demoCanvas = useCbatDemoCanvas()
  // The scene is static for the length of the clip — only the camera moves — so
  // the object list is built once and never rebuilt on a frame.
  const meshes = useMemo(
    () => objects.map(o => <SceneObject key={o.id} o={o} grid={grid} />),
    [objects, grid],
  )

  return (
    <Canvas
      {...demoCanvas}
      shadows
      camera={{ position: [0, 15, 21], fov: CAMERA.fovDeg, near: 0.1, far: 160 }}
      gl={{ antialias: true }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      // The clip is two and a half seconds long. If the renderer spends the
      // first second of that coming up, the player has been shown a shorter
      // clip than the one they were promised — and on a slow device, a much
      // shorter one. The page holds its countdown until this fires.
      onCreated={() => onReady?.()}
    >
      <fog attach="fog" args={[HAZE, FOG_NEAR, FOG_FAR]} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#bfe3ff', '#243b1e', 1.0]} />
      {/* Shadows are not decoration here: a cast shadow is the strongest cue
          for which square something is standing in once perspective is in play,
          and judging exactly that is what the questions ask.
          The light is kept NEARLY OVERHEAD for the same reason. Off to one side
          it threw an aircraft's shadow two squares from the drop ring marking
          where the aircraft actually was, giving the player two position cues
          that disagreed — worse than having none. */}
      <directionalLight
        position={[2.5, 20, 3.5]}
        intensity={2.1}
        color="#fff4e0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={40}
      />
      <CameraPass durationMs={durationMs} />
      <Sky />
      <Terrain />
      <Lake />
      <DistantWoods />
      <Hedgerow />
      {meshes}
    </Canvas>
  )
}
