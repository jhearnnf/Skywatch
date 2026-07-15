// CBAT "Trace 2" (TRAC2) round generator.
//
// Trace 2 is "Trace 1 with multiple aircraft": every jet flies with the EXACT
// same motion model as Trace 1 — continuous flight along the nose with smooth
// quaternion banking, turned by 90° yaw/pitch rotations. This module produces,
// per aircraft, a Trace 1-style flight (initial quaternion + a schedule of
// yaw/pitch turns) that the scene renders with Trace 1's integrator. Answers are
// derived by simulating that same flight here, so the generator stays pure and
// seedable (pass `rng`).
//
// The player watches four coloured jets manoeuvre, the picture clears, then they
// answer one multiple-choice question about what they did (most turns, which
// entered from a given edge, which two were facing each other, …). 8 rounds;
// easy question types rounds 1–4, hard rounds 5–8, each type used at most once
// per tier. Speed ramps up each round (round 8 = the base pace).

import * as THREE from 'three'

export const TRACE2_ROUNDS = 8

export const TRACE2_COLORS = [
  { key: 'red',    label: 'Red',    hex: '#ff4d4d' },
  { key: 'yellow', label: 'Yellow', hex: '#ffd23f' },
  { key: 'blue',   label: 'Blue',   hex: '#1e50d8' },  // bold cobalt — stands out from the sky-blue background
  { key: 'green',  label: 'Green',  hex: '#46d16b' },
]
const COLOR_KEYS = TRACE2_COLORS.map(c => c.key)
const HEX = Object.fromEntries(TRACE2_COLORS.map(c => [c.key, c.hex]))

// ── Flight model (identical to Trace 1 / CbatPlaneTurn) ──────────────────────
const MODEL_UP    = new THREE.Vector3(0, 1, 0)
const MODEL_RIGHT = new THREE.Vector3(0, 0, -1)
const MODEL_NOSE  = new THREE.Vector3(-1, 0, 0)
const DIR_VECS_WORLD = [
  new THREE.Vector3(0, 0, -1),  // 0 → -Z
  new THREE.Vector3(1, 0, 0),   // 1 → +X
  new THREE.Vector3(0, 0, 1),   // 2 → +Z
  new THREE.Vector3(-1, 0, 0),  // 3 → -X
]
// Turn keys and their local-frame rotation — same as Trace 1's TRACE1_TURN_DEFS.
export const TRACE2_TURN_DEFS = {
  yawL:   { axis: 'up',    angle:  Math.PI / 2 },
  yawR:   { axis: 'up',    angle: -Math.PI / 2 },
  pitchD: { axis: 'right', angle: -Math.PI / 2 },
  pitchU: { axis: 'right', angle:  Math.PI / 2 },
}
const AXIS_VEC = { up: MODEL_UP, right: MODEL_RIGHT }

function applyLocalRot(prev, axisKey, angle) {
  const q = new THREE.Quaternion(prev[0], prev[1], prev[2], prev[3])
  const local = new THREE.Quaternion().setFromAxisAngle(AXIS_VEC[axisKey], angle)
  q.multiply(local); q.normalize()
  return [q.x, q.y, q.z, q.w]
}
function forwardOf(quat) {
  return MODEL_NOSE.clone().applyQuaternion(new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]))
}
function upOf(quat) {
  return MODEL_UP.clone().applyQuaternion(new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]))
}
function quatFromFwdUp(forward, up) {
  const f = forward.clone().normalize()
  const u = up.clone().normalize()
  const right = new THREE.Vector3().crossVectors(f, u).normalize()
  const m = new THREE.Matrix4().makeBasis(f.clone().negate(), u, right.clone().negate())
  const q = new THREE.Quaternion().setFromRotationMatrix(m)
  return [q.x, q.y, q.z, q.w]
}
function initialPlaneQuat(dir) {
  return quatFromFwdUp(DIR_VECS_WORLD[dir].clone(), new THREE.Vector3(0, 1, 0))
}
// Orientation reflected across the screen-centre plane x=0 (nose & up have their
// x-component negated). Used to build a plane's mirror-image partner.
function mirrorQuatX(quat) {
  const f = forwardOf(quat), u = upOf(quat)
  return quatFromFwdUp(new THREE.Vector3(-f.x, f.y, f.z), new THREE.Vector3(-u.x, u.y, u.z))
}

// ── Scene / camera geometry (MUST match Trace2Scene.jsx) ─────────────────────
const CENTER_Y = 4.5
const CAM_Z    = 10
const FOV_DEG  = 55
const HALF_TAN = Math.tan((FOV_DEG / 2) * Math.PI / 180)  // on-screen half-extent ratio
const STEP     = 2            // world units flown per tick (Trace 1: 2 cells/turn)
const ENTRY_MARGIN = 1.6      // spawn this far beyond the screen edge (off-screen)
const WANDER    = 0.78        // keep manoeuvres inside this fraction of the frustum
const Z_MIN = -1, Z_MAX = 2.5 // depth band (kept close-ish to the camera)

const EDGES = ['top', 'bottom', 'left', 'right']
// On-screen half-extent (world units) at depth z.
const screenHalf = (z) => HALF_TAN * (CAM_Z - z)

// Project a world point to normalised screen coords ([-1,1] ≈ frustum edge on a
// square viewport). |sx|,|sy| < 1 ⇒ on screen.
function project(p) {
  const d = CAM_Z - p.z
  return { sx: p.x / (HALF_TAN * d), sy: (p.y - CENTER_Y) / (HALF_TAN * d), d }
}
const onScreen = (p, margin = 1) => {
  const s = project(p)
  return Math.abs(s.sx) < margin && Math.abs(s.sy) < margin && s.d > 6.5 && s.d < 12.5
}
function edgeCrossed(p) {
  const s = project(p)
  if (Math.abs(s.sx) >= Math.abs(s.sy)) return s.sx > 0 ? 'right' : 'left'
  return s.sy > 0 ? 'top' : 'bottom'
}

// ── RNG helpers ──────────────────────────────────────────────────────────────
const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1))
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]
function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// Initial quaternion + off-screen spawn for an entry edge. Horizontal edges fly
// level; vertical edges climb/dive in.
function entrySetup(edge, z, rng) {
  const half = screenHalf(z)
  const jitter = () => (rng() * 2 - 1) * half * 0.4
  let quat, pos
  if (edge === 'left')       { quat = initialPlaneQuat(1); pos = new THREE.Vector3(-(half + ENTRY_MARGIN), CENTER_Y + jitter(), z) }
  else if (edge === 'right') { quat = initialPlaneQuat(3); pos = new THREE.Vector3( (half + ENTRY_MARGIN), CENTER_Y + jitter(), z) }
  else if (edge === 'bottom'){ quat = applyLocalRot(initialPlaneQuat(1), 'right',  Math.PI / 2); pos = new THREE.Vector3(jitter(), CENTER_Y - (half + ENTRY_MARGIN), z) }
  else                       { quat = applyLocalRot(initialPlaneQuat(1), 'right', -Math.PI / 2); pos = new THREE.Vector3(jitter(), CENTER_Y + (half + ENTRY_MARGIN), z) }
  return { quat, pos }
}

// Dominant world axis of a (near-cardinal) forward vector → a stable key.
function axisKeyOf(v) {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z)
  if (ax >= ay && ax >= az) return v.x >= 0 ? 'PX' : 'NX'
  if (ay >= ax && ay >= az) return v.y >= 0 ? 'PY' : 'NY'
  return v.z >= 0 ? 'PZ' : 'NZ'
}
const OPP_AXIS = { PX: 'NX', NX: 'PX', PY: 'NY', NY: 'PY', PZ: 'NZ', NZ: 'PZ' }

// Simulate one aircraft's flight (piecewise-linear approximation of the smooth
// render, exactly like Trace 1's internal grid planner). Returns the spec the
// scene needs plus derived stats — or null if it can't stay in view.
//   opts: forceAllRight | forbidClimb | forceClimb | straightThrough | forceExit
//         | startDelayTicks (hold off-screen this many ticks before flying in,
//           so staggered planes enter the frame at visibly different times)
function simulatePlane(edge, z, nSeg, entryHold, tickMs, rng, opts = {}) {
  const { forceAllRight = false, forbidClimb = false, forceClimb = false,
          straightThrough = false, forceExit = false, startDelayTicks = 0, levelOnly = false } = opts
  const { quat: q0, pos: p0 } = entrySetup(edge, z, rng)
  let quat = q0
  const pos = p0.clone()
  const turns = []
  const traj = [{ t: 0, pos: pos.clone(), quat: [...quat] }]
  let exited = false, exitEdge = null, exitT = null, climbForced = false
  let entered = false, entryT = null

  const flyOne = () => { pos.addScaledVector(forwardOf(quat), STEP) }

  const aheadOK = (cand) => {
    let tq = cand === 'straight' ? [...quat] : applyLocalRot(quat, TRACE2_TURN_DEFS[cand].axis, TRACE2_TURN_DEFS[cand].angle)
    const tp = pos.clone()
    for (let s = 0; s < 2; s++) { tp.addScaledVector(forwardOf(tq), STEP); if (!onScreen(tp, WANDER)) return false }
    return true
  }

  for (let seg = 0; seg < nSeg; seg++) {
    const t = seg * tickMs
    // Hold off-screen at the spawn point until the start delay elapses.
    if (seg < startDelayTicks) { traj.push({ t: (seg + 1) * tickMs, pos: pos.clone(), quat: [...quat] }); continue }
    const activeSeg = seg - startDelayTicks
    if (activeSeg >= entryHold && !straightThrough) {
      let cands = forceAllRight ? ['straight', 'yawR'] : ['straight', 'yawL', 'yawR', 'pitchU', 'pitchD']
      if (levelOnly) cands = ['straight', 'yawL', 'yawR']       // stay level (no climb/dive)
      if (forbidClimb) cands = cands.filter(c => c !== 'pitchU')
      let chosen = null
      if (forceClimb && !climbForced && !forbidClimb && aheadOK('pitchU')) { chosen = 'pitchU'; climbForced = true }
      if (!chosen) {
        const turnCands = cands.filter(c => c !== 'straight' && aheadOK(c))
        // Bias toward flying straight so turn counts vary and turns interleave.
        if (rng() < 0.42 && aheadOK('straight')) chosen = 'straight'
        else if (turnCands.length) chosen = pick(rng, turnCands)
        else chosen = aheadOK('straight') ? 'straight' : null
      }
      if (chosen && chosen !== 'straight') {
        quat = applyLocalRot(quat, TRACE2_TURN_DEFS[chosen].axis, TRACE2_TURN_DEFS[chosen].angle)
        turns.push({ tMs: t, turnKey: chosen })
      }
    }
    flyOne()
    traj.push({ t: (seg + 1) * tickMs, pos: pos.clone(), quat: [...quat] })
    if (onScreen(pos, 1)) { if (!entered) { entered = true; entryT = (seg + 1) * tickMs } }
    else if (entered && !exited) { exited = true; exitEdge = edgeCrossed(pos); exitT = (seg + 1) * tickMs }
    if (exited) break
  }

  if (forceExit && !exited) return null

  // ── Derived stats ──
  let rightTurns = 0, leftTurns = 0, climbTurns = 0
  for (const tr of turns) {
    if (tr.turnKey === 'yawR') rightTurns++
    else if (tr.turnKey === 'yawL') leftTurns++
    else if (tr.turnKey === 'pitchU') climbTurns++
  }
  // "Climb" = upward movement at any point: the largest rise above an EARLIER
  // low point (a running-minimum draw-up), as a fraction of the half-screen at
  // entry depth. This is 0 only if the plane never gained altitude at all (it
  // only ever descended or held level) — so a plane that dives then pulls up
  // still counts as having climbed, matching what the player sees. NOT measured
  // relative to the entry height (a high top-entry that dives then climbs back
  // used to read as 0). The live replay counter (Trace2Scene.climbFtUpTo)
  // mirrors this exactly.
  const onSamples = traj.filter(s => onScreen(s.pos, 1))
  const entrySample = onSamples[0] ?? traj[0]
  const entryHalf = HALF_TAN * (CAM_Z - entrySample.pos.z)
  let minY = Infinity, climbGain = 0
  for (const s of onSamples) {
    if (s.pos.y < minY) minY = s.pos.y
    const g = (s.pos.y - minY) / entryHalf
    if (g > climbGain) climbGain = g
  }
  const climbed = climbGain > 0.18
  // Majority heading: which forward axis it spent the most segments flying.
  const counts = {}
  for (let i = 1; i < traj.length; i++) { const k = axisKeyOf(forwardOf(traj[i - 1].quat)); counts[k] = (counts[k] || 0) + 1 }
  let majorityHeading = null, best = -1, tied = false
  for (const [k, c] of Object.entries(counts)) { if (c > best) { best = c; majorityHeading = k; tied = false } else if (c === best) tied = true }
  if (tied) majorityHeading = null
  // Upside-down time: local up points below world up.
  let invertedSegs = 0
  for (let i = 1; i < traj.length; i++) if (upOf(traj[i].quat).y < -0.2) invertedSegs++
  const invertedMs = invertedSegs * tickMs
  const finalFwd = forwardOf(quat)
  const finalAxis = axisKeyOf(finalFwd)
  const finalPos = traj[traj.length - 1].pos

  return {
    spec: { initialQuat: q0, startPos: [p0.x, p0.y, p0.z], turns, speed: (STEP * 1000) / tickMs, startDelayMs: startDelayTicks * tickMs },
    turns: turns.length, rightTurns, leftTurns, climbTurns, climbed, climbGain,
    majorityHeading, invertedMs, entryEdge: edge, exitEdge, exitT, entryT,
    finalAxis, finalPos: [finalPos.x, finalPos.y, finalPos.z],
  }
}

// The "facing each other" pair. Rather than pop two planes in at the end, we fly
// ONE plane (A) as a normal on-screen level manoeuvre from the left that happens
// to end heading +X (nose pointing right) on the left half of the screen, then
// build its partner (B) as A's exact mirror image across the screen centre
// (x → −x). B is therefore on screen at every instant A is, ends heading −X on
// the right half, and at round-end the two sit on their own sides nose-to-nose —
// while the other two aircraft stay on screen the whole time too, so the pair
// isn't obvious just from "who's left in view".
const MIRROR_YAW = { yawL: 'yawR', yawR: 'yawL', pitchU: 'pitchU', pitchD: 'pitchD' }
const MIRROR_AXIS = { PX: 'NX', NX: 'PX', PZ: 'PZ', NZ: 'NZ', PY: 'PY', NY: 'NY' }
function mirrorPlaneX(a) {
  const sp = a.spec
  return {
    spec: {
      initialQuat: mirrorQuatX(sp.initialQuat),
      startPos: [-sp.startPos[0], sp.startPos[1], sp.startPos[2]],
      turns: sp.turns.map(tr => ({ tMs: tr.tMs, turnKey: MIRROR_YAW[tr.turnKey] })),
      speed: sp.speed, startDelayMs: sp.startDelayMs,
    },
    turns: a.turns, rightTurns: a.leftTurns, leftTurns: a.rightTurns, climbTurns: a.climbTurns,
    climbed: a.climbed, climbGain: a.climbGain,
    majorityHeading: a.majorityHeading ? MIRROR_AXIS[a.majorityHeading] : null,
    invertedMs: a.invertedMs, entryEdge: 'right', exitEdge: a.exitEdge, exitT: a.exitT, entryT: a.entryT,
    finalAxis: MIRROR_AXIS[a.finalAxis], finalPos: [-a.finalPos[0], a.finalPos[1], a.finalPos[2]],
  }
}
// Pre-validated level loiter schedules (length = round's tick count) for plane A:
// enter from the left, circle entirely on the LEFT of centre (never crossing
// x=0), and end heading +X. Staying left is essential: B is A's exact mirror, so
// if A ever reached x=0 the two would meet at the centre and fly through each
// other — these keep A ~1.7 units clear of centre throughout, so the pair never
// collides yet still ends nose-to-nose. 'S' = straight, otherwise a yaw. (Found
// by brute-force search across every depth layer.)
const FACING_SCHED = {
  8: ['yawL', 'yawR', 'yawR', 'yawL', 'yawL', 'yawL', 'yawL', 'yawL'],
  9: ['yawR', 'yawL', 'yawL', 'S', 'yawR', 'yawR', 'yawR', 'yawR', 'yawR'],
}
function facingPlaneFromSchedule(sched, z, tickMs) {
  const q0 = initialPlaneQuat(1)                    // heading +X (left entry)
  const startPos = [-(screenHalf(z) + ENTRY_MARGIN), CENTER_Y, z]
  let quat = q0
  const pos = new THREE.Vector3(startPos[0], startPos[1], startPos[2])
  const traj = [{ pos: pos.clone(), quat: [...quat] }]
  const turns = []
  let entered = false, entryT = null, exited = false, exitEdge = null, exitT = null
  let rightTurns = 0, leftTurns = 0
  for (let i = 0; i < sched.length; i++) {
    const mv = sched[i]
    if (mv !== 'S') {
      const def = TRACE2_TURN_DEFS[mv]
      quat = applyLocalRot(quat, def.axis, def.angle)
      turns.push({ tMs: i * tickMs, turnKey: mv })
      if (mv === 'yawR') rightTurns++; else if (mv === 'yawL') leftTurns++
    }
    pos.addScaledVector(forwardOf(quat), STEP)
    traj.push({ pos: pos.clone(), quat: [...quat] })
    if (onScreen(pos, 1)) { if (!entered) { entered = true; entryT = (i + 1) * tickMs } }
    else if (entered && !exited) { exited = true; exitEdge = edgeCrossed(pos); exitT = (i + 1) * tickMs }
  }
  const counts = {}
  for (let i = 1; i < traj.length; i++) { const k = axisKeyOf(forwardOf(traj[i - 1].quat)); counts[k] = (counts[k] || 0) + 1 }
  let majorityHeading = null, best = -1, tied = false
  for (const [k, c] of Object.entries(counts)) { if (c > best) { best = c; majorityHeading = k; tied = false } else if (c === best) tied = true }
  if (tied) majorityHeading = null
  const finalPos = traj[traj.length - 1].pos
  return {
    spec: { initialQuat: q0, startPos, turns, speed: (STEP * 1000) / tickMs, startDelayMs: 0 },
    turns: turns.length, rightTurns, leftTurns, climbTurns: 0, climbed: false, climbGain: 0,
    majorityHeading, invertedMs: 0, entryEdge: 'left', exitEdge, exitT, entryT,
    finalAxis: axisKeyOf(forwardOf(quat)), finalPos: [finalPos.x, finalPos.y, finalPos.z],
  }
}
function buildFacingPair(z, nSeg, tickMs) {
  const sched = FACING_SCHED[nSeg]
  if (!sched) return null
  const a = facingPlaneFromSchedule(sched, z, tickMs)
  if (a.exitEdge != null || a.finalAxis !== 'PX') return null   // safety (schedules are pre-validated)
  return [a, mirrorPlaneX(a)]
}

// ── One aircraft-set sample (4 planes), biased toward a target question ──────
function sampleSet(rng, nSeg, seed, tickMs) {
  let edges = shuffle(EDGES, rng)
  const zs = shuffle([0.4, 1.0, 1.6, 2.2], rng)               // depth layers (near camera)
  // Per-plane entry hold (1 or 2 ticks) staggers when each enters view and makes
  // its first turn, so they don't move in lockstep.
  const holds = [randInt(rng, 1, 2), randInt(rng, 1, 2), randInt(rng, 1, 2), randInt(rng, 1, 2)]
  const opts = [{}, {}, {}, {}]
  const builders = [null, null, null, null]   // 'facing' for the facing pair

  if (seed === 'did-not-climb') {
    // The non-climber enters level from a side and stays level (never changes
    // altitude → truly climbs 0). The other three are forced to climb. (An
    // earlier top-diving non-climber could still gain altitude via yaw/pitch
    // coupling and get wrongly flagged as the non-climber.)
    const non = randInt(rng, 0, 3)
    edges[non] = pick(rng, ['left', 'right']); opts[non].levelOnly = true
    const rest = shuffle(EDGES.filter(e => e !== edges[non]), rng); let ri = 0
    for (let i = 0; i < 4; i++) if (i !== non) { edges[i] = rest[ri++]; opts[i].forceClimb = true }
  } else if (seed === 'only-right-turns') {
    opts[randInt(rng, 0, 3)].forceAllRight = true
  } else if (seed === 'climbed-highest') {
    // No top entries — a plane entering from the top sits high without climbing,
    // which would read as "highest" while only ever descending. Force one clear
    // climber so a well-defined answer exists.
    edges = edges.map(e => e === 'top' ? pick(rng, ['bottom', 'left', 'right']) : e)
    opts[randInt(rng, 0, 3)].forceClimb = true
  } else if (seed === 'exited-same-side') {
    edges[0] = 'left'; edges[1] = 'left'
    opts[0].straightThrough = true; opts[0].forceExit = true; holds[0] = 1
    // Delay the second same-side plane so the two don't enter the shared edge
    // on top of each other — there's a clear gap between them.
    opts[1].straightThrough = true; opts[1].forceExit = true; holds[1] = 1; opts[1].startDelayTicks = 1
    const rest = shuffle(['top', 'bottom', 'right'], rng); edges[2] = rest[0]; edges[3] = rest[1]
  } else if (seed === 'exit-order') {
    opts[0].straightThrough = true; opts[0].forceExit = true; holds[0] = 1
    opts[1].straightThrough = true; opts[1].forceExit = true; holds[1] = 1; opts[1].startDelayTicks = randInt(rng, 1, 2)
  } else if (seed === 'enter-order') {
    // Entry order is otherwise indiscernible — every plane spawns just off its
    // edge and flies in at the same pace, so they all appear at once. Give each
    // a distinct start delay so they enter one-by-one, clearly staggered.
    const delays = shuffle([0, 1, 2, 3], rng)
    for (let i = 0; i < 4; i++) opts[i].startDelayTicks = delays[i]
  } else if (seed === 'facing-each-other') {
    // A mirror pair entering left & right; the other two fly their own bounded
    // manoeuvres and stay on screen, so the player must pick the nose-to-nose
    // pair out of four still-present aircraft (not the only two left).
    edges[0] = 'left'; edges[1] = 'right'
    builders[0] = 'facingA'; builders[1] = 'facingB'
    const rest = shuffle(EDGES.filter(e => e !== 'left' && e !== 'right'), rng)
    edges[2] = rest[0]; edges[3] = rest[1]
  }

  // The facing pair share a depth and are built together (B is A's mirror).
  let facingPair = null
  if (seed === 'facing-each-other') {
    facingPair = buildFacingPair(zs[0], nSeg, tickMs)
    if (!facingPair) return null
    zs[1] = zs[0]
  }

  const planes = []
  for (let i = 0; i < 4; i++) {
    let r
    if (builders[i] === 'facingA') r = facingPair[0]
    else if (builders[i] === 'facingB') r = facingPair[1]
    else r = simulatePlane(edges[i], zs[i], nSeg, holds[i], tickMs, rng, opts[i])
    if (!r) return null
    planes.push({
      colorKey: COLOR_KEYS[i], hex: HEX[COLOR_KEYS[i]], z: zs[i], entryHold: holds[i], ...r,
    })
  }
  return planes
}

// ── Question option builders ─────────────────────────────────────────────────
const cap = k => k[0].toUpperCase() + k.slice(1)
function singleOptions(answerKey, rng) {
  return shuffle(COLOR_KEYS, rng).map(k => ({ label: cap(k), colors: [k], correct: k === answerKey }))
}
function pairKey(a, b) { return [a, b].sort().join('+') }
function pairOptions(answerPair, rng) {
  const correct = pairKey(answerPair[0], answerPair[1])
  const all = []
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) all.push(pairKey(COLOR_KEYS[i], COLOR_KEYS[j]))
  const distractors = shuffle(all.filter(p => p !== correct), rng).slice(0, 3)
  return shuffle([correct, ...distractors], rng).map(p => {
    const [a, b] = p.split('+')
    return { label: `${cap(a)} & ${cap(b)}`, colors: [a, b], correct: p === correct }
  })
}
const withIndex = (options) => ({ options, correctIndex: options.findIndex(o => o.correct) })

function uniqueExtreme(planes, field, dir) {
  if (!planes.length) return null
  const sorted = [...planes].sort((a, b) => dir === 'max' ? b[field] - a[field] : a[field] - b[field])
  if (sorted.length > 1 && sorted[0][field] === sorted[1][field]) return null
  return sorted[0]
}

function evaluate(type, planes, rng, tickMs = 1350) {
  const present = planes.filter(p => p.exitEdge == null)
  const byColor = Object.fromEntries(planes.map(p => [p.colorKey, p]))

  switch (type) {
    case 'most-turns': {
      const w = uniqueExtreme(planes, 'turns', 'max')
      if (!w || w.turns < 2) return null
      return { id: type, prompt: 'Which aircraft made the most turns?', ...withIndex(singleOptions(w.colorKey, rng)) }
    }
    case 'fewest-turns': {
      const w = uniqueExtreme(planes, 'turns', 'min')
      if (!w) return null
      if (Math.max(...planes.map(p => p.turns)) - w.turns < 2) return null
      return { id: type, prompt: 'Which aircraft made the fewest turns?', ...withIndex(singleOptions(w.colorKey, rng)) }
    }
    case 'climbed-highest': {
      // Prompt is "climbed the MOST", not "highest" — the metric is altitude
      // GAINED (climbGain, mirrored by the feet counter), not absolute on-screen
      // position. "Highest" is ambiguous (a plane that entered high but never
      // climbed looks "highest"); "the most" points unambiguously at the biggest
      // climber. Winner must clearly out-climb the rest.
      const w = uniqueExtreme(planes.filter(p => p.climbed), 'climbGain', 'max')
      if (!w || w.climbGain < 0.3) return null   // winner clearly climbed
      const secondMax = Math.max(0, ...planes.filter(p => p !== w).map(p => p.climbGain))
      if (w.climbGain - secondMax < 0.2) return null   // and visibly above the rest
      return { id: type, prompt: 'Which aircraft climbed the most?', ...withIndex(singleOptions(w.colorKey, rng)) }
    }
    case 'did-not-climb': {
      // Exactly one plane held its altitude / descended while the other three
      // clearly climbed — so the answer is unambiguous.
      const non = planes.filter(p => !p.climbed)
      const climbers = planes.filter(p => p.climbed)
      if (non.length !== 1 || climbers.length !== 3) return null
      if (Math.min(...climbers.map(p => p.climbGain)) < 0.25) return null
      return { id: type, prompt: 'Which aircraft did NOT climb at any point?', ...withIndex(singleOptions(non[0].colorKey, rng)) }
    }
    case 'entered-edge': {
      const edge = pick(rng, EDGES)
      const matches = planes.filter(p => p.entryEdge === edge)
      if (matches.length !== 1) return null
      return { id: type, prompt: `Which aircraft entered from the ${edge} of the screen?`, ...withIndex(singleOptions(matches[0].colorKey, rng)) }
    }
    case 'only-right-turns': {
      const allRight = planes.filter(p => p.turns >= 2 && p.leftTurns === 0 && p.climbTurns === 0 && p.rightTurns === p.turns)
      const anyClean = planes.filter(p => p.turns >= 1 && p.leftTurns === 0 && p.climbTurns === 0)
      if (allRight.length !== 1 || anyClean.length !== 1) return null
      return { id: type, prompt: 'Which aircraft made only right turns?', ...withIndex(singleOptions(allRight[0].colorKey, rng)) }
    }
    case 'upside-down-longest': {
      const w = uniqueExtreme(planes, 'invertedMs', 'max')
      if (!w || w.invertedMs <= 0) return null
      return { id: type, prompt: 'Which aircraft was upside down for the longest?', ...withIndex(singleOptions(w.colorKey, rng)) }
    }
    case 'facing-each-other': {
      const pairs = []
      for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) {
        const a = present[i], b = present[j]
        if (OPP_AXIS[a.finalAxis] !== b.finalAxis) continue
        // Converging along the shared axis (each nose points toward the other).
        const ax = a.finalAxis
        let conv = false
        if (ax === 'PX' || ax === 'NX') { const px = ax === 'PX' ? a : b, nx = ax === 'PX' ? b : a; conv = px.finalPos[0] < nx.finalPos[0] }
        else if (ax === 'PY' || ax === 'NY') { const py = ax === 'PY' ? a : b, ny = ax === 'PY' ? b : a; conv = py.finalPos[1] < ny.finalPos[1] }
        else { const pz = ax === 'PZ' ? a : b, nz = ax === 'PZ' ? b : a; conv = pz.finalPos[2] < nz.finalPos[2] }
        if (conv) pairs.push([a.colorKey, b.colorKey])
      }
      // Require all four still on screen and exactly one converging pair, so the
      // player has to pick the nose-to-nose pair out of four — not the only two
      // aircraft left in view.
      if (present.length !== 4 || pairs.length !== 1) return null
      return { id: type, prompt: 'Which two aircraft were facing each other at the end of the round?', ...withIndex(pairOptions(pairs[0], rng)) }
    }
    case 'same-direction': {
      const pairs = []
      for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
        const a = planes[i], b = planes[j]
        if (a.majorityHeading && a.majorityHeading === b.majorityHeading) pairs.push([a.colorKey, b.colorKey])
      }
      if (pairs.length !== 1) return null
      return { id: type, prompt: 'Which two aircraft travelled in the same direction for most of the round?', ...withIndex(pairOptions(pairs[0], rng)) }
    }
    case 'exited-same-side': {
      const exited = planes.filter(p => p.exitEdge != null)
      if (exited.length < 2) return null
      const pairs = []
      for (let i = 0; i < exited.length; i++) for (let j = i + 1; j < exited.length; j++) {
        if (exited[i].exitEdge === exited[j].exitEdge) pairs.push([exited[i].colorKey, exited[j].colorKey])
      }
      if (pairs.length !== 1) return null
      const edge = byColor[pairs[0][0]].exitEdge
      if (exited.filter(p => p.exitEdge === edge).length !== 2) return null
      return { id: type, prompt: 'Which two aircraft exited from the same side of the screen?', ...withIndex(pairOptions(pairs[0], rng)) }
    }
    case 'enter-order': {
      // Real on-screen entry times (the staggered start delays make these
      // distinct). Need a clear gap between the winner and the next-earliest /
      // -latest so the player can actually tell which entered first / last.
      if (planes.some(p => p.entryT == null)) return null
      const sorted = [...planes].sort((a, b) => a.entryT - b.entryT)
      const first = rng() < 0.5
      const w = first ? sorted[0] : sorted[sorted.length - 1]
      const gap = first
        ? sorted[1].entryT - sorted[0].entryT
        : sorted[sorted.length - 1].entryT - sorted[sorted.length - 2].entryT
      if (gap < tickMs * 0.9) return null
      return { id: type, prompt: `Which aircraft was the ${first ? 'first' : 'last'} to enter the screen?`, ...withIndex(singleOptions(w.colorKey, rng)) }
    }
    case 'exit-order': {
      const exited = planes.filter(p => p.exitEdge != null)
      if (exited.length < 2) return null
      exited.sort((a, b) => a.exitT - b.exitT)
      // A clear gap so "first to leave" is discernible, not a photo finish.
      if (exited[1].exitT - exited[0].exitT < tickMs * 0.6) return null
      return { id: type, prompt: 'Which aircraft was the first to leave the screen?', ...withIndex(singleOptions(exited[0].colorKey, rng)) }
    }
    default: return null
  }
}

const EASY_TYPES = ['most-turns', 'fewest-turns', 'entered-edge', 'climbed-highest', 'did-not-climb']
const HARD_TYPES = ['only-right-turns', 'facing-each-other', 'same-direction', 'upside-down-longest', 'exited-same-side', 'enter-order', 'exit-order']

// Which per-aircraft live counter (if any) the replay should show for each
// question. Relational / one-time questions have no natural counter (null) —
// the replay itself reveals them.
const REPLAY_STAT = {
  'most-turns': 'turns', 'fewest-turns': 'turns',
  'climbed-highest': 'height', 'did-not-climb': 'height',
  'only-right-turns': 'turnsLR', 'upside-down-longest': 'inverted',
}
export const replayStatKind = (questionId) => REPLAY_STAT[questionId] ?? null

const BASE_TICK = 1350            // round-8 tick (the current pace)
const ROUND_SEGS = [6, 6, 7, 7, 8, 8, 9, 9]
const SPEED_MULT_MAX = 1.5        // round-1 tick multiplier (slowest)
function roundPacing(roundIndex) {
  const nSeg = ROUND_SEGS[roundIndex] ?? 8
  const t = roundIndex / (TRACE2_ROUNDS - 1)
  const tickMs = Math.round(BASE_TICK * (SPEED_MULT_MAX + (1 - SPEED_MULT_MAX) * t))
  return { nSeg, tickMs }
}

function buildRound(roundIndex, tier, pool, rng) {
  const { nSeg, tickMs } = roundPacing(roundIndex)
  const SAMPLES = 90
  const finish = (planes, q) => {
    // Normally watch a couple of ticks past the last turn (planes never stop —
    // they keep flying, off-screen if their heading leads out — so the picture
    // clears with everything still in motion). The facing pair is only
    // nose-to-nose AT its schedule end, though; two more ticks and the two fly
    // straight through each other, so those rounds end exactly on schedule.
    const onwardTicks = q.id === 'facing-each-other' ? 0 : 2
    const durationMs = (nSeg + onwardTicks) * tickMs
    return {
      roundIndex, tier, durationMs, tickMs,
      aircraft: planes.map(p => ({ colorKey: p.colorKey, hex: p.hex, ...p.spec })),
      question: { id: q.id, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex },
      stats: planes.map(p => ({
        colorKey: p.colorKey, turns: p.turns, rightTurns: p.rightTurns, leftTurns: p.leftTurns,
        climbTurns: p.climbTurns, climbed: p.climbed, climbGain: p.climbGain,
        majorityHeading: p.majorityHeading, invertedMs: p.invertedMs, entryEdge: p.entryEdge,
        exitEdge: p.exitEdge, finalAxis: p.finalAxis, entryHold: p.entryHold, entryT: p.entryT,
      })),
    }
  }

  for (let pi = 0; pi < pool.length; pi++) {
    const type = pool[pi]
    for (let s = 0; s < SAMPLES; s++) {
      const planes = sampleSet(rng, nSeg, type, tickMs)
      if (!planes) continue
      const q = evaluate(type, planes, rng, tickMs)
      if (!q) continue
      pool.splice(pi, 1)
      return finish(planes, q)
    }
  }
  // Fallback: a generic entered-edge round (entry edges are distinct).
  let planes = null
  while (!planes) planes = sampleSet(rng, nSeg, null, tickMs)
  const q = evaluate('entered-edge', planes, rng, tickMs) || {
    id: 'entered-edge', prompt: 'Which aircraft entered from the left of the screen?',
    ...withIndex(singleOptions(planes.find(p => p.entryEdge === 'left')?.colorKey ?? planes[0].colorKey, rng)),
  }
  return { ...finish(planes, q), stats: [] }
}

export function generateTrace2Game(rng = Math.random) {
  const easyPool = shuffle(EASY_TYPES, rng)
  const hardPool = shuffle(HARD_TYPES, rng)
  const rounds = []
  for (let i = 0; i < TRACE2_ROUNDS; i++) {
    const tier = i < 4 ? 'easy' : 'hard'
    rounds.push(buildRound(i, tier, tier === 'easy' ? easyPool : hardPool, rng))
  }
  return { rounds }
}

export const __test = { BASE_TICK, sampleSet, evaluate, EASY_TYPES, HARD_TYPES }
