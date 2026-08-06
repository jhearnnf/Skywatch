// CBAT "Rapid Tracking Test" (RTT) run generator + scoring.
//
// Mirrors the real RAF RTT: the candidate looks out of an aircraft through a
// gimballed sensor, slews the camera onto each target in turn, and takes THREE
// pictures of it with the target in the centre of the frame. Targets range from
// static installations through walking personnel, boats and vehicles up to fast
// air, and every so often one passes behind something and has to be re-acquired
// on the far side.
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) to reproduce a whole
// run in tests. Defaults to Math.random for live play.
//
// Lives in its own module rather than in the page for the same two reasons
// cutSim.js does: react-refresh/only-export-components forbids non-component
// exports from a page file, and the whole game is testable here without ever
// mounting a WebGL canvas.
//
// Everything angular is in RADIANS unless a name says Deg. The camera sits at
// the origin and only rotates — azimuth 0 looks along -Z, positive azimuth is
// to the right, positive elevation is up. That matches a three.js camera with
// rotation order 'YXZ', rotation.y = -az and rotation.x = elev.

const DEG = Math.PI / 180

// ── Constants ────────────────────────────────────────────────────────────────

export const RTT_FRAMES_PER_TARGET = 3
// The shutter can't be machine-gunned. Without this, holding the trigger over a
// target would collect three frames in three frames of animation and the whole
// tracking task would evaporate.
export const SHUTTER_COOLDOWN_MS = 350
// Half-angle of the capture cone. A frame counts if the target is inside it;
// how close to dead centre it was decides how much the frame is worth. At the
// sizes and ranges below this makes the reticle roughly three times the width
// of a typical target — generous enough to be fair, tight enough that holding
// centre is the whole job.
export const BASE_CAPTURE_DEG = 1.8
// Slew rate at full stick deflection, before the player's sensitivity setting.
export const MAX_SLEW_DEG_PER_SEC = 55
// A narrow field of view — this is a zoomed targeting pod, not a window.
//
// Note that the field of view does NOT change the difficulty: the capture cone
// and a target's own width are both angles, so zooming scales them together and
// their ratio is fixed. It only changes how big everything is on screen, and at
// the first setting of 26° a truck was about 12 px and unidentifiable. 18° is
// the compromise — everything is ~1.4× larger, and a fast mover still has room
// to cross the frame rather than flicking through it.
export const CAMERA_FOV_DEG = 18
// How long a target keeps running after its window closes, purely so it can be
// SEEN to leave. It is unshootable throughout (the sim's window is unchanged) —
// this exists because a target that blinks out of existence reads as a bug, and
// a player can't tell "the pass ended" from "the game broke".
export const TARGET_EXIT_MS = 550
// The gimbal's limits. Azimuth is generous but not unlimited (the sensor is
// under an aircraft, it cannot look at its own tail); elevation is asymmetric
// because most of the work is below the horizon.
export const AZ_LIMIT_DEG = 150
export const ELEV_MIN_DEG = -38
export const ELEV_MAX_DEG = 34
// Where the sensor is looking when a run starts. Level was wrong: every ground
// target sits between 7° and 34° BELOW the horizon, so a run opened by pitching
// down before anything could be found at all.
export const START_ELEV_DEG = -12
// Height of the sensor station above the ground, in metres. Ground targets
// don't carry a range of their own — it FALLS OUT of their depression angle
// (range = alt / sin(depression)), which is what keeps them all sitting on one
// flat ground plane in the scene instead of floating at whatever distance the
// generator felt like. A low-level pass, so the numbers stay legible: at 25°
// down a target is ~330 m out, at 8° it's ~1 km.
export const STATION_ALT_M = 140

// Dead air before the first target, and between one pass ending and the next
// beginning. Passes never overlap — the gap is what makes each target a
// discrete acquire-track-shoot problem, which is how the real test reads.
export const RTT_LEAD_IN_MS = 1600
export const RTT_GAP_MS = 1500

export const RTT_SCORE = {
  // A frame on target is worth frameBase, plus up to frameCentreBonus more the
  // closer it was to dead centre — so a scraped frame pays 20 and a perfect one
  // pays 40. Centring is the thing the test actually measures, so it is worth
  // as much as taking the picture at all.
  frameBase: 20,
  frameCentreBonus: 20,
  // Landing the third frame completes the target.
  targetComplete: 30,
  // Firing at nothing, or through an obstruction. Small, because the shutter
  // cooldown already punishes spraying by costing time on a live target.
  wastedFrame: -8,
  // Per frame still owed when a target's window closes. A completely missed
  // target therefore costs 30 — the same as the completion bonus it denied.
  missedFrame: -10,
}

// Per-kind character.
//
// Each kind carries a real LINEAR speed in m/s, not an angular one. The angular
// rate the player actually has to match is then speed / range — which is why a
// walker 300 m away crawls across the frame while a jet at 700 m tears through
// it, without either number being hand-tuned. `windowMs` is how long the pass is
// available, so speed × window ÷ range is the arc it covers.
//
// `size` is metres across (the scene scales its model to it) and `elevDeg` is
// the depression/elevation band the pass sits in. Ground kinds get their range
// from that band via STATION_ALT_M; air kinds carry an explicit one.
export const RTT_KINDS = {
  static: {
    label: 'Installation', hud: 'STATIC', speedMps: 0, windowMs: 7000,
    elevDeg: [-12, -7], size: 20, ground: true,
  },
  // A foot patrol, not a lone walker. One 1.8 m figure at the range this pass
  // runs is about five pixels tall — not a hard target, an invisible one. A
  // small group spread over a few metres is both what "slow moving people"
  // actually looks like from the air and a findable shape, and it keeps the
  // range honest rather than inflating one person to the size of a truck.
  // `size` is therefore the group's extent; the scene draws the figures inside
  // it at their real height.
  person: {
    label: 'Personnel', hud: 'PERSONNEL', speedMps: 1.4, windowMs: 9000,
    elevDeg: [-34, -27], size: 4.5, ground: true,
  },
  boat: {
    label: 'Watercraft', hud: 'WATERCRAFT', speedMps: 9, windowMs: 9000,
    elevDeg: [-15, -9], size: 9, ground: true,
  },
  vehicle: {
    label: 'Vehicle', hud: 'VEHICLE', speedMps: 14, windowMs: 8500,
    elevDeg: [-24, -16], size: 5, ground: true,
  },
  helicopter: {
    label: 'Rotary', hud: 'ROTARY', speedMps: 55, windowMs: 8000,
    elevDeg: [-5, 9], range: [340, 620], size: 16, ground: false,
  },
  jet: {
    label: 'Fast Air', hud: 'FAST AIR', speedMps: 220, windowMs: 7500,
    elevDeg: [2, 22], range: [520, 950], size: 15, ground: false,
  },
}

// ── Airframe motion ──────────────────────────────────────────────────────────
//
// The sensor is bolted to an aircraft, and an aircraft never sits still. The
// station itself stays at the origin — the whole target model is polar around a
// fixed point, and a constant angular rate is what makes a target trackable by a
// hand on a rate control at all — but the AIM wanders, and the player has to
// trim it out. That is the honest half of "you are on a moving platform", and
// it is the half that is actually a psychomotor skill.
//
// The disturbance is added to the commanded aim and then used for BOTH the
// camera and the hit test, so what is scored is always what is on screen.
//
// Amplitudes are set against the capture cone: the wander is about a fifth of
// it, so it visibly pulls a target off centre and costs centring bonus without
// making a hit impossible. The vibration is far too small to affect scoring —
// it is there so the picture feels like it is bolted to an engine.
export const AIRFRAME = {
  wanderDeg: 0.35,
  wanderRollDeg: 0.6,
  vibrationDeg: 0.045,
}

// Sums of sines at deliberately incommensurate frequencies, so the motion never
// settles into a rhythm the player can memorise instead of flying. Pure and
// stateless: a function of elapsed time only, so it reproduces exactly in tests.
export function airframeDisturbance(tSec, scale = 1) {
  const w = AIRFRAME.wanderDeg * scale * DEG
  const v = AIRFRAME.vibrationDeg * scale * DEG
  const r = AIRFRAME.wanderRollDeg * scale * DEG
  return {
    az: w * (0.62 * Math.sin(tSec * 0.57) + 0.38 * Math.sin(tSec * 0.23 + 1.7))
      + v * Math.sin(tSec * 71),
    elev: w * (0.55 * Math.sin(tSec * 0.41 + 0.9) + 0.45 * Math.sin(tSec * 0.79 + 2.4))
      + v * Math.sin(tSec * 83 + 1.1),
    // Roll turns the horizon, not the boresight, so it costs nothing in scoring
    // and does more than anything else to sell the platform.
    roll: r * (0.7 * Math.sin(tSec * 0.31 + 0.4) + 0.3 * Math.sin(tSec * 0.13 + 2.2)),
  }
}

// ── Seeded helpers ───────────────────────────────────────────────────────────

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = (rng, min, max) => min + rng() * (max - min)
const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1))

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// ── Geometry ─────────────────────────────────────────────────────────────────

// Unit vector for an (azimuth, elevation) look direction, in the camera's own
// convention: -Z forward, +X right, +Y up.
export function lookVector(az, elev) {
  const ce = Math.cos(elev)
  return [Math.sin(az) * ce, Math.sin(elev), -Math.cos(az) * ce]
}

// World position of a point at (az, elev, range) from the station.
export function polarToWorld(az, elev, range) {
  const [x, y, z] = lookVector(az, elev)
  return [x * range, y * range, z * range]
}

// Angle between two look directions. This is the hit test: a reticle pinned to
// the centre of the frame means "in the reticle" is exactly "within N degrees of
// where the camera is pointing", with no projection and no pixels involved — so
// it survives any window size and tests without a canvas.
export function angularError(azA, elevA, azB, elevB) {
  const a = lookVector(azA, elevA)
  const b = lookVector(azB, elevB)
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)
  return Math.acos(dot)
}

export function captureRadius(tuning) {
  return BASE_CAPTURE_DEG * (tuning?.captureScale ?? 1) * DEG
}

// ── Run generation ───────────────────────────────────────────────────────────

// The order of kinds in a run. The first cycle through the difficulty's kind
// list runs in order, slowest first, so every run opens on something gentle and
// ramps; later cycles are shuffled so a long run isn't a visible loop.
function kindSequence(kinds, count, rng) {
  const out = []
  let cycle = 0
  while (out.length < count) {
    const batch = cycle === 0 ? kinds : shuffle(kinds, rng)
    for (const k of batch) {
      if (out.length >= count) break
      out.push(k)
    }
    cycle += 1
  }
  return out
}

// ── Occlusion fairness ───────────────────────────────────────────────────────
//
// Going behind cover has to be a test of prediction, not a way to lose a target
// for good. Everything here exists to guarantee that a player who was on the
// target when it disappeared still gets a real chance at every frame they are
// owed once it comes back.
//
// The clear stretch at the START, before any cover can begin — enough to find
// the target in the first place.
export const OCCLUSION_HEAD_MS = 1600
// The clear stretch at the END, after the last cover ends. Sized to re-acquire
// AND take all three frames from scratch: two shutter cooldowns is 700 ms, so
// this leaves ~1.3 s to pick the target back up. A player who has taken nothing
// yet is still not out of the game.
export const OCCLUSION_TAIL_MS = 2000
// Clear time between two stretches of cover — long enough to re-acquire and
// take at least one frame.
export const OCCLUSION_GAP_MS = 900
const OCCLUSION_MS = [1100, 2100]
// Below this an occlusion is a blink, not an event; a pass that can't fit a
// meaningful one simply gets none.
const MIN_USEFUL_OCCLUSION_MS = 600
// No pass may spend more than this fraction of its window hidden.
export const MAX_OCCLUDED_FRACTION = 0.3
// THE important one. A target must never be hidden for so long that it
// re-emerges outside the frame the player was watching it in — at that point it
// is not "behind cover", it is gone, and the run is a search again. Capping the
// arc it covers while hidden to a little over half the field of view means it
// always comes back within sight of where it went in. It scales itself: a jet
// gets a fraction of a second behind a cloud, a walker can be gone for two.
export const MAX_OCCLUSION_ARC_FRAC = 0.55

// Widest arc a single pass may cover. See buildTarget. Sized against the field
// of view: at 18° across, 90° of arc over a 7.5s window is about 1.3s to cross
// the frame — demanding, which is the point of fast air, but trackable.
export const MAX_ARC_DEG = 90

// How far the next pass starts from where the last one ended. See buildTarget.
// The separation is what the generator asks for; a pass whose own arc runs up
// against the gimbal limits can be forced further out, bounded by
// MAX_SEPARATION_DEG + MAX_ARC_DEG in the worst case.
export const MIN_SEPARATION_DEG = 25
export const MAX_SEPARATION_DEG = 70

function buildOcclusions(windowMs, arc, tuning, rng) {
  const max = tuning.maxOcclusions ?? 0
  if (max <= 0) return []

  const lo = OCCLUSION_HEAD_MS
  const hi = windowMs - OCCLUSION_TAIL_MS
  if (hi - lo < MIN_USEFUL_OCCLUSION_MS) return []

  // How long the target may be hidden before it would re-emerge outside the
  // frame. Infinite for something that isn't going anywhere.
  const ratePerMs = Math.abs(arc) / windowMs
  const maxByArc = ratePerMs > 0
    ? (MAX_OCCLUSION_ARC_FRAC * CAMERA_FOV_DEG * DEG) / ratePerMs
    : Infinity
  if (maxByArc < MIN_USEFUL_OCCLUSION_MS) return []

  const budget = windowMs * MAX_OCCLUDED_FRACTION
  const count = randInt(rng, 0, max)
  const spans = []
  let used = 0

  for (let i = 0; i < count; i++) {
    const wanted = rand(rng, OCCLUSION_MS[0], OCCLUSION_MS[1]) * (tuning.occlusionScale ?? 1)
    const dur = Math.min(wanted, maxByArc, budget - used, hi - lo)
    if (dur < MIN_USEFUL_OCCLUSION_MS) break
    // Twelve attempts at a slot that doesn't crowd an existing one; a pass that
    // can't fit a second occlusion simply gets one.
    let placed = false
    for (let attempt = 0; attempt < 12 && !placed; attempt++) {
      const from = rand(rng, lo, hi - dur)
      const to = from + dur
      const clash = spans.some(s => from < s.toMs + OCCLUSION_GAP_MS && to > s.fromMs - OCCLUSION_GAP_MS)
      if (!clash) {
        spans.push({ fromMs: Math.round(from), toMs: Math.round(to) })
        used += dur
        placed = true
      }
    }
  }
  return spans.sort((a, b) => a.fromMs - b.fromMs)
}

// One target pass. Azimuth and elevation both sweep linearly across the window,
// which is what makes the target trackable at all — a constant angular rate is
// something a hand on a rate control can actually match.
function buildTarget(id, kind, tuning, startAfterMs, prevEndAz, rng) {
  const spec = RTT_KINDS[kind]
  const windowMs = spec.windowMs

  const elevLo = spec.elevDeg[0] * DEG
  const elevHi = spec.elevDeg[1] * DEG
  const startElev = rand(rng, elevLo, elevHi)
  // Ground kinds are pinned to the ground plane, so their range is whatever the
  // depression angle implies. Air kinds pick one.
  const range = spec.ground
    ? Math.round(STATION_ALT_M / Math.sin(-startElev))
    : Math.round(rand(rng, spec.range[0], spec.range[1]))

  // Small-angle rate for a target crossing the line of sight. Capped so that no
  // single pass can demand most of the gimbal's travel — a close jet works out
  // at over 180° of arc, which leaves no room to place the pass inside the
  // limits and turns tracking into a sprint rather than a skill.
  const rawArc = (spec.speedMps * (tuning.speedScale ?? 1) / range) * (windowMs / 1000)
  const arc = Math.min(rawArc, MAX_ARC_DEG * DEG)
  const dir = rng() < 0.5 ? -1 : 1

  const azLimit = AZ_LIMIT_DEG * DEG
  // Where the pass begins, relative to where the last one left the player
  // pointing. Bounded at BOTH ends, and that is the point:
  //
  //   • a minimum, so every pass demands a real slew rather than starting
  //     already on target;
  //   • a maximum, because without one the generator would happily put the next
  //     target 200° away and the run turned into hunting for something that was
  //     nowhere on screen. This test measures tracking, not searching.
  //
  // Constructed directly from a chosen gap rather than sampled-and-rejected, so
  // it always lands inside the band instead of settling for the best of twenty
  // guesses.
  const lo = dir > 0 ? -azLimit : -azLimit + arc
  const hi = dir > 0 ? azLimit - arc : azLimit
  let startAz = rand(rng, lo, hi)
  if (prevEndAz != null && hi > lo) {
    const gap = rand(rng, MIN_SEPARATION_DEG * DEG, MAX_SEPARATION_DEG * DEG)
    const side = rng() < 0.5 ? -1 : 1
    // Both directions, each pulled back inside the legal range, and whichever
    // lands closest to the gap actually asked for wins. A pass whose arc eats
    // most of the gimbal can leave no legal point at the requested distance —
    // then the best available is taken rather than a wild one accepted.
    const options = [prevEndAz + side * gap, prevEndAz - side * gap].map(v => clamp(v, lo, hi))
    startAz = options.reduce((best, v) =>
      Math.abs(Math.abs(v - prevEndAz) - gap) < Math.abs(Math.abs(best - prevEndAz) - gap) ? v : best)
  }
  const endAz = clamp(startAz + dir * arc, -azLimit, azLimit)

  // Ground movers hold their depression angle — they are circling the station
  // at a fixed range, which is exactly what a flat ground plane looks like.
  // Air movers climb or descend a little across the pass.
  const elevDrift = spec.ground ? 0 : rand(rng, -3, 5) * DEG
  const endElev = clamp(startElev + elevDrift, ELEV_MIN_DEG * DEG, ELEV_MAX_DEG * DEG)

  return {
    id,
    kind,
    label: spec.label,
    hud: spec.hud,
    size: spec.size,
    ground: !!spec.ground,
    range,
    tStartMs: startAfterMs,
    tEndMs: startAfterMs + windowMs,
    windowMs,
    startAz, endAz, startElev, endElev,
    // The arc it ACTUALLY travels, after the gimbal limits have had their say —
    // not the one that was asked for.
    occlusions: buildOcclusions(windowMs, endAz - startAz, tuning, rng),
    requiredFrames: RTT_FRAMES_PER_TARGET,
  }
}

export function generateRttRun(tuning, rng = Math.random) {
  const kinds = kindSequence(tuning.kinds, tuning.targets, rng)
  const targets = []
  let t = RTT_LEAD_IN_MS
  // Seeded with where the camera actually starts, so the FIRST pass is placed
  // relative to the player rather than anywhere in 300° of gimbal.
  let prevEndAz = 0
  kinds.forEach((kind, i) => {
    const target = buildTarget(i, kind, tuning, t, prevEndAz, rng)
    targets.push(target)
    prevEndAz = target.endAz
    t = target.tEndMs + RTT_GAP_MS
  })
  return { targets, durationMs: targets.length ? targets[targets.length - 1].tEndMs + 900 : 0 }
}

// ── Target state at a moment ─────────────────────────────────────────────────

// `clampToWindow` false lets the scene extrapolate past the end of the window,
// so a target that has run out of time keeps travelling while it fades rather
// than freezing in place. Scoring always uses the clamped default.
export function targetDirectionAt(target, tMs, clampToWindow = true) {
  const raw = (tMs - target.tStartMs) / target.windowMs
  const p = clampToWindow ? clamp(raw, 0, 1) : raw
  return {
    az: target.startAz + (target.endAz - target.startAz) * p,
    elev: target.startElev + (target.endElev - target.startElev) * p,
  }
}

export function isTargetVisible(target, tMs) {
  return tMs >= target.tStartMs && tMs < target.tEndMs
}

export function isTargetOccluded(target, tMs) {
  const local = tMs - target.tStartMs
  return target.occlusions.some(o => local >= o.fromMs && local < o.toMs)
}

// How wide the target itself looks from the station, in radians.
export function targetAngularSize(target) {
  return target.size / target.range
}

// Where an occluded stretch happens in the sky, so the scene can put something
// solid there. The sim is authoritative about WHEN a target is hidden; this is
// what lets the picture agree with it, by describing exactly the arc the target
// walks behind — place a slab covering that arc (plus the target's own width)
// and what the player sees matches what the sim scores.
export function occlusionSpan(target, occ) {
  const a = targetDirectionAt(target, target.tStartMs + occ.fromMs)
  const b = targetDirectionAt(target, target.tStartMs + occ.toMs)
  return {
    az: (a.az + b.az) / 2,
    elev: (a.elev + b.elev) / 2,
    halfArc: angularError(a.az, a.elev, b.az, b.elev) / 2,
  }
}

// ── Sim ──────────────────────────────────────────────────────────────────────

export function makeRttSim(tuning, rng = Math.random) {
  const run = generateRttRun(tuning, rng)
  return {
    tuning,
    run,
    durationMs: run.durationMs,
    captureRad: captureRadius(tuning),
    elapsedMs: 0,
    score: 0,
    framesTaken: 0,
    framesOnTarget: 0,
    targetsCompleted: 0,
    errorRadSum: 0,
    // Per-target progress, parallel to run.targets.
    progress: run.targets.map(() => ({ frames: 0, resolved: false })),
    lastShotAt: -Infinity,
    // Newest-first list of scoring events for the HUD ticker.
    events: [],
  }
}

function pushEvent(sim, text, delta) {
  sim.events.unshift({ id: `${sim.elapsedMs}-${sim.events.length}`, text, delta, atMs: sim.elapsedMs })
  if (sim.events.length > 8) sim.events.length = 8
}

// Index of the pass currently on screen, or -1 in a gap. Passes never overlap,
// so this is unambiguous.
export function activeTargetIndex(sim) {
  return sim.run.targets.findIndex(t => isTargetVisible(t, sim.elapsedMs))
}

// Advances the clock and books the penalty for any pass whose window has just
// closed with frames still owed. Called from the render loop with the frame's
// delta; safe to call with a large dt after a tab blur.
export function advanceRtt(sim, dtMs) {
  sim.elapsedMs += dtMs
  sim.run.targets.forEach((target, i) => {
    const p = sim.progress[i]
    if (p.resolved || sim.elapsedMs < target.tEndMs) return
    p.resolved = true
    const owed = target.requiredFrames - p.frames
    if (owed > 0) {
      const delta = owed * RTT_SCORE.missedFrame
      sim.score += delta
      pushEvent(sim, `${target.hud} lost — ${owed} frame${owed === 1 ? '' : 's'} short`, delta)
    }
  })
  return sim
}

export function isRunOver(sim) {
  return sim.elapsedMs >= sim.durationMs
}

// Takes a picture.
//
// `candidates` is what the caller can see right now: one entry per visible
// target, carrying its index, how far off the camera's centre it is, and whether
// something is in the way. Passing them in (rather than having the sim work out
// the camera) is what keeps this function pure — and it means the same call
// handles a future where two passes overlap, since the best eligible candidate
// wins.
export function fireShutter(sim, candidates = []) {
  if (sim.elapsedMs - sim.lastShotAt < SHUTTER_COOLDOWN_MS) {
    return { kind: 'cooldown', points: 0, targetIndex: -1, errorRad: 0 }
  }
  sim.lastShotAt = sim.elapsedMs
  sim.framesTaken += 1

  let best = null
  let blockedByOcclusion = false
  for (const c of candidates) {
    const p = sim.progress[c.index]
    if (!p || p.resolved || p.frames >= RTT_FRAMES_PER_TARGET) continue
    if (c.errorRad > sim.captureRad) continue
    if (c.occluded) { blockedByOcclusion = true; continue }
    if (!best || c.errorRad < best.errorRad) best = c
  }

  if (!best) {
    sim.score += RTT_SCORE.wastedFrame
    const kind = blockedByOcclusion ? 'occluded' : 'miss'
    pushEvent(sim, blockedByOcclusion ? 'Frame wasted — target obscured' : 'Frame wasted — off target', RTT_SCORE.wastedFrame)
    return { kind, points: RTT_SCORE.wastedFrame, targetIndex: -1, errorRad: 0 }
  }

  const target = sim.run.targets[best.index]
  const p = sim.progress[best.index]
  p.frames += 1
  sim.framesOnTarget += 1
  sim.errorRadSum += best.errorRad

  // 1 at dead centre, 0 at the edge of the capture cone.
  const centring = 1 - best.errorRad / sim.captureRad
  let points = RTT_SCORE.frameBase + Math.round(RTT_SCORE.frameCentreBonus * centring)
  let completed = false
  if (p.frames >= RTT_FRAMES_PER_TARGET) {
    p.resolved = true
    completed = true
    sim.targetsCompleted += 1
    points += RTT_SCORE.targetComplete
  }
  sim.score += points
  pushEvent(
    sim,
    completed
      ? `${target.hud} complete — 3 of 3`
      : `${target.hud} frame ${p.frames} of 3`,
    points,
  )
  return { kind: 'hit', points, targetIndex: best.index, errorRad: best.errorRad, completed, frames: p.frames }
}

export function rttStats(sim) {
  return {
    totalScore: Math.round(sim.score),
    framesTaken: sim.framesTaken,
    framesOnTarget: sim.framesOnTarget,
    targetsCompleted: sim.targetsCompleted,
    totalTargets: sim.run.targets.length,
    avgCentringErrorDeg: sim.framesOnTarget
      ? Number(((sim.errorRadSum / sim.framesOnTarget) / DEG).toFixed(2))
      : 0,
  }
}

// A perfect run, for the results screen's "x of y" line. Every target: three
// dead-centre frames plus the completion bonus.
export function maxRttScore(tuning) {
  const perTarget = RTT_FRAMES_PER_TARGET * (RTT_SCORE.frameBase + RTT_SCORE.frameCentreBonus) + RTT_SCORE.targetComplete
  return tuning.targets * perTarget
}
