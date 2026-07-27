import * as THREE from 'three'

// Trace 1 — recall test schedule generator.
//
// An autopilot flies one or more Hawk T2s through the arena, turning on a fixed
// tick. The player presses the arrow matching the turn the TRACKED aircraft just
// made. From round 3 extra aircraft join and all of them turn every tick, so the
// player has to filter competing motion and answer only for the ringed jet.
//
// Everything here is pure and takes an injectable `rng`, so the whole schedule
// (flight paths + which aircraft is tracked) is testable without rendering R3F.

export const TRACE1_ROUNDS          = 5
export const TRACE1_TURNS_PER_ROUND = 8
export const TRACE1_TOTAL_TURNS     = TRACE1_ROUNDS * TRACE1_TURNS_PER_ROUND

// Speed ramps to round 2 and then HOLDS. From round 3 onward the difficulty
// comes from extra aircraft, not extra pace — a player already at their reaction
// limit shouldn't also be asked to track four jets.
export const TRACE1_SPEED_TABLE = [1870, 1635, 1635, 1635, 1635] // ms between turns

// Aircraft on screen per round (index = 0-based round).
export const TRACE1_PLANE_COUNT = [1, 1, 2, 3, 4]

// Tint order is fixed: red, blue, green, yellow. Hexes match TRACE2_COLORS so a
// "red" jet reads the same across both Trace games.
export const TRACE1_COLORS = [
  { key: 'red',    label: 'Red',    hex: '#ff4d4d' },
  { key: 'blue',   label: 'Blue',   hex: '#1e50d8' },
  { key: 'green',  label: 'Green',  hex: '#46d16b' },
  { key: 'yellow', label: 'Yellow', hex: '#ffd23f' },
]

// How much quiet gap the player gets between the ring moving to a new aircraft
// and that aircraft's next turn. Capped at 45% of the tick so the answer window
// for the preceding turn never collapses.
export const TRACE1_SWITCH_PREVIEW_MS = 700

// A round always contains at least this many ring switches, so a multi-aircraft
// round can never degenerate into "watch one jet for 8 turns".
const TRACE1_SWITCH_MIN = 2
const TRACE1_SWITCH_MAX = 3

const GRID   = 10
const LAYERS = 10

// Keep the plane at least two cells away from each wall at every projected turn
// moment. With slerp lag the plane can drift up to ~0.4 cells past the
// projection in the old direction, so margin=2 leaves a full cell of buffer
// between the worst-case excursion and the scene's soft-clamp.
export const TRACE1_WALL_MARGIN = 2

// ── Aircraft frame ───────────────────────────────────────────────────────────
// Pitch (climb/dive) rotates around the local right axis, yaw around the local
// up axis. Both are LOCAL, so at vertical pitch states yawing rotates around the
// aircraft's own up axis and the motion reads correctly from the pilot's POV.
export const MODEL_UP    = new THREE.Vector3(0, 1, 0)   // local up
export const MODEL_RIGHT = new THREE.Vector3(0, 0, -1)  // local right
export const MODEL_NOSE  = new THREE.Vector3(-1, 0, 0)  // local nose

export const DIR_VECS_WORLD = [
  new THREE.Vector3(0, 0, -1),  // DIR 0 → world -Z
  new THREE.Vector3(1, 0, 0),   // DIR 1 → world +X
  new THREE.Vector3(0, 0, 1),   // DIR 2 → world +Z
  new THREE.Vector3(-1, 0, 0),  // DIR 3 → world -X
]

export function applyLocalRot(prevArr, axis, angle) {
  const q = new THREE.Quaternion(prevArr[0], prevArr[1], prevArr[2], prevArr[3])
  const local = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  q.multiply(local)
  q.normalize()
  return [q.x, q.y, q.z, q.w]
}

export function getForward(quatArr) {
  const q = new THREE.Quaternion(quatArr[0], quatArr[1], quatArr[2], quatArr[3])
  return MODEL_NOSE.clone().applyQuaternion(q)
}

export function initialPlaneQuat(dir) {
  // Level forward in `dir` with body upright (up = world +Y).
  const forward = DIR_VECS_WORLD[dir].clone()
  const up = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(forward, up).normalize()
  const m = new THREE.Matrix4().makeBasis(
    forward.clone().negate(),
    up,
    right.clone().negate(),
  )
  const q = new THREE.Quaternion().setFromRotationMatrix(m)
  return [q.x, q.y, q.z, q.w]
}

// Each turn is a single 90° local-frame rotation around one axis.
export const TRACE1_TURN_DEFS = {
  yawL:   { axis: MODEL_UP,    angle:  Math.PI / 2, key: 'ArrowLeft',  label: '←' },
  yawR:   { axis: MODEL_UP,    angle: -Math.PI / 2, key: 'ArrowRight', label: '→' },
  pitchD: { axis: MODEL_RIGHT, angle: -Math.PI / 2, key: 'ArrowUp',    label: '↑' }, // stick: forward = dive
  pitchU: { axis: MODEL_RIGHT, angle:  Math.PI / 2, key: 'ArrowDown',  label: '↓' }, // stick: back = climb
}
export const TRACE1_TURN_KEYS = ['yawL', 'yawR', 'pitchD', 'pitchU']

export function trace1KeyToTurn(key) {
  switch (key) {
    case 'ArrowLeft':  return 'yawL'
    case 'ArrowRight': return 'yawR'
    case 'ArrowUp':    return 'pitchD'
    case 'ArrowDown':  return 'pitchU'
    default: return null
  }
}

// ── Start slots ──────────────────────────────────────────────────────────────
// Grid coords + initial heading, spread across the arena so multiple aircraft
// don't spawn stacked. Distinct headings decorrelate their paths. A single
// aircraft keeps the legacy centre spawn so rounds 1–2 are unchanged.
const TRACE1_SOLO_SLOT = { r: 5, c: 5, layer: 5, dir: 0 }
const TRACE1_START_SLOTS = [
  { r: 4, c: 3, layer: 6, dir: 1 },  // red    — upper left,  heading +X
  { r: 6, c: 6, layer: 4, dir: 3 },  // blue   — lower right, heading -X
  { r: 6, c: 3, layer: 4, dir: 0 },  // green  — lower left,  heading -Z
  { r: 4, c: 6, layer: 6, dir: 2 },  // yellow — upper right, heading +Z
]

export function trace1StartSlot(planeIndex, planeCount) {
  if (planeCount <= 1) return TRACE1_SOLO_SLOT
  return TRACE1_START_SLOTS[planeIndex % TRACE1_START_SLOTS.length]
}

// Grid → world, matching PlaneTurn3DScene's toWorld().
function toWorld({ r, c, layer }) {
  return [c - 4.5, layer, r - 4.5]
}

// Fresh flight state for `planeCount` aircraft: quaternion, grid position, the
// recent-turn tail (used to forbid three identical turns in a row), the world
// spawn point for the scene, and the tint.
export function trace1InitialPlaneStates(planeCount) {
  return Array.from({ length: planeCount }, (_, i) => {
    const slot = trace1StartSlot(i, planeCount)
    return {
      quat: initialPlaneQuat(slot.dir),
      pos:  { r: slot.r, c: slot.c, layer: slot.layer },
      tail: [],
      startWorld: toWorld(slot),
      // A lone aircraft stays in the model's own livery — rounds 1–2 look
      // exactly as they always have. Tinting only starts once telling jets
      // apart actually matters.
      color: planeCount <= 1 ? null : TRACE1_COLORS[i % TRACE1_COLORS.length],
    }
  })
}

// ── Flight scheduling ────────────────────────────────────────────────────────

// Simulate `steps` forward cells along `quat`'s heading. Returns the final grid
// position, or null if any step would cross the margin-tightened bound.
export function simulateForwardSteps(quat, startPos, steps, margin = TRACE1_WALL_MARGIN) {
  const fwd = getForward(quat)
  const x = Math.round(fwd.x), y = Math.round(fwd.y), z = Math.round(fwd.z)
  const out = { r: startPos.r, c: startPos.c, layer: startPos.layer }
  const min = margin
  const maxR = GRID   - 1 - margin
  const maxC = GRID   - 1 - margin
  const maxL = LAYERS - 1 - margin
  for (let i = 0; i < steps; i++) {
    out.layer += y
    out.c     += x
    out.r     += z
    if (out.r < min || out.r > maxR || out.c < min || out.c > maxC || out.layer < min || out.layer > maxL) return null
  }
  return out
}

// Choose the next turn for one aircraft. All four candidates are scored by
// whether they keep the projected path inside the margin; we pick at random from
// the safe pool. With a 10-cell arena and the candidates covering 4 of the 6
// cardinal axes, at least one always stays in bounds from a legal position.
function pickTurn(quat, pos, tail, rng) {
  const evaluated = TRACE1_TURN_KEYS.map(cand => {
    const def     = TRACE1_TURN_DEFS[cand]
    const newQuat = applyLocalRot(quat, def.axis, def.angle)
    return { cand, newQuat, stepped: simulateForwardSteps(newQuat, pos, 2) }
  })

  // If the last two turns were the same, that direction is now forbidden —
  // taking it would make three in a row.
  const forbidden = (tail.length >= 2 && tail[tail.length - 1] === tail[tail.length - 2])
    ? tail[tail.length - 1]
    : null
  const dropForbidden = (list) => forbidden ? list.filter(e => e.cand !== forbidden) : list

  const valid    = dropForbidden(evaluated.filter(e => e.stepped))
  const looseSet = valid.length ? valid : dropForbidden(evaluated.map(e => ({
    ...e,
    // Force-walked fallback: re-simulate without margin, clamp inside.
    stepped: simulateForwardSteps(e.newQuat, pos, 2, 0) || pos,
  })))
  // Safety net: if the forbidden filter wipes the set (shouldn't happen with
  // four turn options) fall back to the unfiltered list.
  const finalSet = looseSet.length ? looseSet : evaluated

  const chosen = finalSet[Math.floor(rng() * finalSet.length)]
  return { turnKey: chosen.cand, quat: chosen.newQuat, pos: chosen.stepped || pos }
}

// ── Ring / tracked-aircraft schedule ─────────────────────────────────────────

// Pick `k` distinct values from [0, m) as a sorted array.
function pickDistinct(k, m, rng) {
  const pool = Array.from({ length: m }, (_, i) => i)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (m - i))
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t
  }
  return pool.slice(0, k).sort((a, b) => a - b)
}

// Which aircraft is tracked for each turn of a round.
//
// Switches never land on consecutive turns, so after every switch the player
// always gets at least one full, undisturbed turn on the new aircraft. Positions
// are chosen up front from the non-adjacent combinations of [1, turns-1] — turn
// 0 is never a switch because the round opens on whoever is already ringed.
export function buildTrace1Selection(planeCount, turns = TRACE1_TURNS_PER_ROUND, rng = Math.random) {
  if (planeCount <= 1 || turns <= 1) return new Array(Math.max(0, turns)).fill(0)

  const slots       = turns - 1                      // candidate switch turns: 1..turns-1
  const maxSwitches = Math.ceil(slots / 2)           // most non-adjacent picks that fit
  const wanted      = TRACE1_SWITCH_MIN + Math.floor(rng() * (TRACE1_SWITCH_MAX - TRACE1_SWITCH_MIN + 1))
  const k           = Math.max(1, Math.min(maxSwitches, wanted))

  // Choose k values from a range shrunk by (k-1), then fan them back out — the
  // standard bijection between combinations and non-adjacent combinations.
  const chosen    = pickDistinct(k, slots - (k - 1), rng)
  const positions = new Set(chosen.map((v, i) => v + i + 1))

  const sel = new Array(turns)
  let cur = Math.floor(rng() * planeCount)
  for (let i = 0; i < turns; i++) {
    if (positions.has(i)) {
      // Always move to a DIFFERENT aircraft.
      let next = Math.floor(rng() * (planeCount - 1))
      if (next >= cur) next++
      cur = next
    }
    sel[i] = cur
  }
  return sel
}

// Build one round: a turn schedule per aircraft plus the tracked-aircraft track.
//
// `planeStates` are the flight states to continue from (see
// trace1InitialPlaneStates). They are not mutated — the post-round states come
// back as `states`, ready to feed the next round.
export function buildTrace1Round(planeStates, rng = Math.random) {
  const states = planeStates.map(p => ({
    ...p,
    quat: [...p.quat],
    pos:  { ...p.pos },
    tail: (p.tail || []).slice(-2),
  }))
  const schedules = states.map(() => [])

  for (let t = 0; t < TRACE1_TURNS_PER_ROUND; t++) {
    states.forEach((st, i) => {
      const next = pickTurn(st.quat, st.pos, st.tail, rng)
      schedules[i].push(next.turnKey)
      st.quat = next.quat
      st.pos  = next.pos
      st.tail.push(next.turnKey)
      if (st.tail.length > 2) st.tail.shift()
    })
  }

  return {
    schedules,
    selection: buildTrace1Selection(states.length, TRACE1_TURNS_PER_ROUND, rng),
    states,
  }
}
