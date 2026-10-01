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
// Everything angular is in RADIANS unless a name says Deg. Azimuth 0 looks along
// -Z (the way the aircraft is flying), positive azimuth is to the right, positive
// elevation is up. That matches a three.js camera with rotation order 'YXZ',
// rotation.y = -az and rotation.x = elev.
//
// THE PLATFORM MOVES. The sensor station flies straight ahead along -Z at
// PLATFORM_SPEED_MPS (player report, 2026-10-01: the real camera moves through
// the scene "as if it was bolted to a helicopter"). So every target lives in
// WORLD space, as a track of points, and where it appears is worked out from
// where the station is at that moment. A static installation therefore slides
// across the picture as the aircraft goes past it, which is the point.

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
// Height of the sensor station above the ground, in metres. A ground target's
// range at the start of its pass FALLS OUT of its depression angle
// (range = alt / sin(depression)), which is what keeps them all sitting on one
// flat ground plane in the scene instead of floating at whatever distance the
// generator felt like.
export const STATION_ALT_M = 140

// How fast the station flies, in m/s. About 23 knots: a helicopter working an
// area slowly. Fast enough that the parallax is plain (a building 700 m off the
// beam drifts about 1°/s), slow enough that a foot patrol close in is still
// trackable rather than a blur.
export const PLATFORM_SPEED_MPS = 12

// Dead air before the first target, and between one pass ending and the next
// beginning. Passes never overlap — the gap is what makes each target a
// discrete acquire-track-shoot problem, which is how the real test reads.
export const RTT_LEAD_IN_MS = 1600
export const RTT_GAP_MS = 1500

// SkyWatch scoring: frames are scored where the shutter fires.
//
// Raised from 20 + 20 when the platform started moving (2026-10-01). Moving
// made the test harder, and the boards are shared with every run ever flown, so
// a perfect target went from 150 to 165 points. Without the rise, the old
// scores would sit at the top of the board for good.
export const RTT_SCORE = {
  // A frame on target is worth frameBase, plus up to frameCentreBonus more the
  // closer it was to dead centre. Centring is the thing the test actually
  // measures, so it is worth about as much as taking the picture at all.
  frameBase: 22,
  frameCentreBonus: 23,
  // Landing the third frame completes the target.
  targetComplete: 30,
  // Firing at nothing, or through an obstruction. Small, because the shutter
  // cooldown already punishes spraying by costing time on a live target.
  wastedFrame: -8,
  // Per frame still owed when a target's window closes. A completely missed
  // target therefore costs 30 — the same as the completion bonus it denied.
  missedFrame: -10,
}

// Real CBAT scoring. The real test wants the target kept inside the box for the
// WHOLE pass (player report, 2026-10-01): lining the camera up on the edge of
// cover and snapping frames as the target came out "wouldn't suffice". So:
//
//   • a frame only counts once the target has been held in the box for
//     RTT_LOCK_MS without a break (the box turns green when it has);
//   • time in the box is scored for the whole pass, from first contact.
//
// A perfect target is 3 × 30 + 45 + 30 = 165, the same as SkyWatch's, because
// both themes share one board.
export const RTT_LOCK_MS = 600
export const RTT_TRACK_SCORE = {
  frameBase: 15,
  frameCentreBonus: 15,
  trackMax: 45,
  // Full tracking points at 85% of the pass in the box, not 100%. The same
  // player reported targets turning too tightly to hold every moment and
  // still scoring very well, so a short slip must cost little.
  trackFullAt: 0.85,
  // Tracking is measured from first contact, but over at least half the
  // window, so picking a target up in its last second can't score as a
  // perfectly held pass.
  minTrackedFrac: 0.5,
}

// Per-kind character.
//
// Each kind carries a real LINEAR speed in m/s. The angular rate the player
// has to match is speed / range, plus whatever the platform's own motion adds,
// so a walker 300 m away crawls across the frame while a jet at 700 m tears
// through it, without either number being hand-tuned. `windowMs` is how long
// the pass is available.
//
// `size` is metres across (the scene scales its model to it) and `elevDeg` is
// the depression/elevation band the pass starts in. Ground kinds get their range
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

// How each kind is able to move, for the manoeuvres (Real CBAT only). Real
// limits, so nothing does what its real counterpart couldn't (user, 2026-10-01:
// "a truck can't immediately start reversing without first going down to 0
// movement speed first ... a helicopter / aircraft can't just switch direction
// mid air"):
//
//   accel        m/s², the fastest it can brake or speed up. A jet's is 0: it
//                does not slow down to manoeuvre.
//   aLat         m/s², the sideways acceleration it can turn with — a truck's
//                tyres, a boat's hull, a helicopter's 55° bank, a jet's 5.6 g.
//   maxTurnDegS  °/s, the fastest its heading can swing at any speed.
//   turnDeg      how far a turn changes its heading, [min, max].
//   turnSpeed    the share of its speed it slows to through a turn. A foot
//                patrol all but stops to turn round; aircraft hold their speed.
//   slowTo       how far a slow-down drops it, as a share of its speed, or
//                null if it never does one.
//
// Nothing ever reverses. A target that comes back the way it went has turned
// round, along a curve its turning limits allow.
export const KIND_MOTION = {
  person: { accel: 1.5, aLat: 2, maxTurnDegS: 120, turnDeg: [100, 180], turnSpeed: 0.3, slowTo: [0, 0.3] },
  vehicle: { accel: 5, aLat: 4, maxTurnDegS: 35, turnDeg: [30, 80], turnSpeed: 0.6, slowTo: [0.35, 0.6] },
  boat: { accel: 2.5, aLat: 2.5, maxTurnDegS: 20, turnDeg: [25, 60], turnSpeed: 0.75, slowTo: [0.5, 0.75] },
  helicopter: { accel: 3, aLat: 14, maxTurnDegS: 20, turnDeg: [15, 35], turnSpeed: 1, slowTo: [0.75, 0.9] },
  jet: { accel: 0, aLat: 55, maxTurnDegS: 25, turnDeg: [20, 60], turnSpeed: 1, slowTo: null },
}
const GRAVITY = 9.81
// The steepest a model is drawn banking into a turn.
const MAX_BANK_DEG = 75

// How long before its pass a moving target is already out there, travelling
// (user, 2026-10-01: the next target should be in the world well before the
// current pass ends, not appear the moment the camera arrives at it). With
// passes of 7 to 9 s and a 1.5 s gap, it turns up about halfway through the
// pass before. Static installations are there from the start of the run.
export const TARGET_PREVIEW_MS = 6000
// It fades in over this, rather than popping into being.
export const TARGET_FADE_IN_MS = 600

// ── Airframe motion ──────────────────────────────────────────────────────────
//
// On top of the platform's steady flight, the airframe never sits still: the
// AIM wanders, and the player has to trim it out.
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

// ── Zoom and stabiliser (Real CBAT) ──────────────────────────────────────────
//
// The real sensor is wide and coarse while it is searching, then zooms in and
// steadies itself a little once it is on the next target (player report,
// 2026-10-01). It still takes the player's hands to keep the target in the box.
//
// The zoom changes nothing about scoring: the capture cone is an angle, so the
// box simply looks bigger when zoomed in. What it changes is the slew rate,
// which scales with the field of view, so a wide view turns fast and a zoomed
// one turns finely.
export const WIDE_FOV_DEG = 36
export const ZOOM_IN_DEG = 6
export const ZOOM_OUT_DEG = 12
export const ZOOM_TIME_MS = 450
// The share of the target's own apparent motion the stabiliser takes off the
// player, when fully zoomed. "Slightly", in the report's words.
export const STABILISER_GAIN = 0.35

// One step of the zoom. `z` is 0 (wide) … 1 (zoomed in). `errorRad` is how far
// the live target is from the aim, or null when there is no live target, which
// zooms out so the next one can be found. Between the two thresholds the zoom
// carries on the way it was going, so it does not flicker at the edge.
export function zoomStep(z, errorRad, dtMs, wasZoomingIn) {
  let zoomingIn = wasZoomingIn
  if (errorRad == null || errorRad > ZOOM_OUT_DEG * DEG) zoomingIn = false
  else if (errorRad <= ZOOM_IN_DEG * DEG) zoomingIn = true
  const step = dtMs / ZOOM_TIME_MS
  const next = zoomingIn ? Math.min(1, z + step) : Math.max(0, z - step)
  return { z: next, zoomingIn }
}

// Field of view for a zoom level, eased so the change starts and ends gently.
export function fovForZoom(z) {
  const e = z * z * (3 - 2 * z)
  return WIDE_FOV_DEG + (CAMERA_FOV_DEG - WIDE_FOV_DEG) * e
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

// Offset of a point at (az, elev, range) from wherever the station is.
export function polarToWorld(az, elev, range) {
  const [x, y, z] = lookVector(az, elev)
  return [x * range, y * range, z * range]
}

// The look direction and range of an offset vector — polarToWorld backwards.
export function directionOf(dx, dy, dz) {
  return {
    az: Math.atan2(dx, -dz),
    elev: Math.atan2(dy, Math.hypot(dx, dz)),
    range: Math.hypot(dx, dy, dz),
  }
}

// Where the sensor station is at a moment of the run. It flies straight and
// level along -Z, the way azimuth 0 looks.
export function stationAt(tMs) {
  return [0, 0, -PLATFORM_SPEED_MPS * (tMs / 1000)]
}

// How far the station flies in a run, for the scene to lay the world out under.
export function platformPathLength(durationMs) {
  return PLATFORM_SPEED_MPS * (durationMs / 1000)
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
// Measured against the target's FASTEST apparent rate in the pass, platform
// motion and manoeuvres included.
export const MAX_OCCLUSION_ARC_FRAC = 0.55
// No manoeuvre comes this close to a stretch of cover, so a target is never
// hidden while it turns or brakes, and the cover's edges stay where the player
// expects.
const MANOEUVRE_COVER_CLEAR_MS = 400

// Widest arc a single pass may cover. See draftPass. Sized against the field
// of view: at 18° across, 90° of arc over a 7.5s window is about 1.3s to cross
// the frame — demanding, which is the point of fast air, but trackable.
export const MAX_ARC_DEG = 90

// How far the next pass starts from where the last one ended. See draftPass.
// The separation is what the generator asks for; a pass whose own arc runs up
// against the gimbal limits can be forced further out, bounded by
// MAX_SEPARATION_DEG + MAX_ARC_DEG in the worst case.
export const MIN_SEPARATION_DEG = 25
export const MAX_SEPARATION_DEG = 70

// What every pass has to satisfy over its whole window, seen from the moving
// station. The margins keep a target off the hard stops of the gimbal; the
// range cap keeps it short of the fog, which starts at 1200 m.
const GIMBAL_MARGIN_DEG = 3
const ELEV_MARGIN_DEG = 1
export const MAX_TARGET_RANGE_M = 1150
const MIN_TARGET_RANGE_M = 180
// How finely a track is stored. Linear between points, so a turn is a corner
// at most this long.
const TRACK_STEP_MS = 100
// How finely cover is checked when it is worked out from the geometry.
const OCCLUSION_STEP_MS = 10
// Attempts at a legal pass before falling back to a plain one.
const PASS_ATTEMPTS = 30

// Where cover sits along the sightline, as a fraction of the way to the target.
// Air cover sits well forward so it reads as weather; ground cover sits close,
// because a structure that hides a walker 300 m away has to be a building
// rather than a 100 m tower halfway to them.
export const AIR_COVER_FRAC = 0.6
export const GROUND_COVER_FRAC = 0.9
// Height a building's roof clears the highest sightline it hides by, in metres.
export const COVER_HEAD_ROOM_M = 4
// Vertical margin either side of the sightlines a cloud hides, in metres.
const CLOUD_MARGIN_M = 3

// A moving target's track, by actually driving (or flying) it.
//
// It starts at its polar position from where the station is when its pass
// begins, heading across the line of sight, and steers a gentle constant
// curve that would hold it at a constant distance from that point. That curve
// is a real one: a jet on it pulls about 2 g, a truck barely turns the wheel.
//
// Manoeuvres change its speed and heading smoothly, inside the kind's limits
// (see KIND_MOTION and manoeuvreDurationMs). Integrated every 10 ms and stored
// every 100 ms, with how far an aircraft is banked at each point so the scene
// can roll the model into its turns.
//
// The track also runs back TARGET_PREVIEW_MS before the pass, on the same
// steady curve, so the target is already out there and moving before it
// becomes the one to shoot.
function designTrack(d, manoeuvres) {
  const SUB = 10
  const rh = d.range * Math.cos(d.startElev)
  const o = polarToWorld(d.startAz, d.startElev, d.range)
  const p0 = [d.s0[0] + o[0], d.s0[1] + o[1], d.s0[2] + o[2]]
  // Heading as an angle in the ground plane: travel is along (cos θ, sin θ)
  // in (x, z), so a growing θ is a turn to the right seen from above.
  const theta0 = d.dir > 0 ? d.startAz : d.startAz + Math.PI
  const curve = d.dir / rh            // per metre travelled
  const bankAt = (speed, rate) => {
    if (d.ground) return 0
    const lat = (speed * 1000) * (rate * 1000)
    return clamp(Math.atan(lat / GRAVITY), -MAX_BANK_DEG * DEG, MAX_BANK_DEG * DEG)
  }

  const vyAt = (t) => {
    let vy = d.vy
    for (const m of manoeuvres) {
      if (m.vyAfter == null || t < m.atMs) continue
      if (t >= m.atMs + m.durMs) { vy = m.vyAfter; continue }
      const k = (t - m.atMs) / m.durMs
      vy += (m.vyAfter - vy) * k * k * (3 - 2 * k)
      break
    }
    return vy
  }
  const motionAt = (t) => {
    let speed = d.vh
    let extra = 0
    for (const m of manoeuvres) {
      if (t < m.atMs || t >= m.atMs + m.durMs) continue
      const k = (t - m.atMs) / m.durMs
      const dip = Math.sin(Math.PI * k)
      speed = d.vh * (1 - (1 - m.speedFrac) * dip * dip)
      extra = (m.dPsi / m.durMs) * (1 - Math.cos(2 * Math.PI * k))
    }
    return { speed, rate: speed * curve + extra }
  }

  const ahead = []
  let x = p0[0], y = p0[1], z = p0[2], th = theta0
  for (let t = 0; t <= d.windowMs; t += SUB) {
    const { speed, rate } = motionAt(t)
    if (t % TRACK_STEP_MS === 0) ahead.push({ t, p: [x, y, z], bank: bankAt(speed, rate) })
    x += Math.cos(th) * speed * SUB
    z += Math.sin(th) * speed * SUB
    if (!d.ground) y += vyAt(t) * SUB
    th += rate * SUB
  }

  // Backwards from the start, on the plain curve at the plain speed.
  const behind = []
  x = p0[0]; y = p0[1]; z = p0[2]; th = theta0
  const baseRate = d.vh * curve
  for (let t = -SUB; t >= -TARGET_PREVIEW_MS; t -= SUB) {
    th -= baseRate * SUB
    x -= Math.cos(th) * d.vh * SUB
    z -= Math.sin(th) * d.vh * SUB
    if (!d.ground) y -= d.vy * SUB
    if (t % TRACK_STEP_MS === 0) behind.push({ t, p: [x, y, z], bank: bankAt(d.vh, baseRate) })
  }
  return behind.reverse().concat(ahead)
}

// How long a manoeuvre needs, in ms, to stay inside the kind's limits, given
// its speed (m/s) and the curve (1/m) it is already on. A turn eases in and
// out, and a slow-down eases the speed down and back up, so the limits are
// checked across the whole manoeuvre rather than at one moment: the heading
// rate, the sideways acceleration and the braking each set a floor, and the
// longest wins. Null if it can't be done at all.
//
// The curve is signed, like the turn (positive is to the right). A turn the
// same way as the curve adds to it, so it gets only what is left of the
// limits; a turn the other way first unwinds the curve, so it gets more.
export function manoeuvreDurationMs(motion, vMps, curvePerM, dPsi, speedFrac) {
  const turn = Math.abs(dPsi)
  // How much of the curve the turn is fighting: + when it adds to it.
  const along = Math.sign(dPsi) * curvePerM
  if (speedFrac < 1 && !motion.accel) return null
  let sec = 0.8
  // Braking: the speed's rate of change peaks at π(1 − f)v / D.
  if (speedFrac < 1) sec = Math.max(sec, (Math.PI * (1 - speedFrac) * vMps) / motion.accel)
  if (turn > 0) {
    for (let k = 0.02; k < 1; k += 0.02) {
      const s2 = Math.sin(Math.PI * k) ** 2
      const v = vMps * (1 - (1 - speedFrac) * s2)
      // The turn's own heading rate is 2·turn·s2 / D on top of the curve.
      const rateLeft = motion.maxTurnDegS * DEG - v * along
      const latLeft = motion.aLat - v * v * along
      if (rateLeft <= 0 || latLeft <= 0) return null
      sec = Math.max(sec, (2 * turn * s2) / rateLeft, (2 * turn * s2 * v) / latLeft)
    }
  }
  return Math.ceil((sec * 1000) / TRACK_STEP_MS) * TRACK_STEP_MS
}

// Where a target is in the world at a moment. `clampToWindow` false lets the
// scene extrapolate past the end of the window along the last stretch of
// track, so a target that has run out of time keeps travelling while it fades
// rather than freezing in place. Scoring always uses the clamped default.
export function targetWorldAt(target, tMs, clampToWindow = true) {
  const pts = target.track
  const raw = tMs - target.tStartMs
  const local = clampToWindow ? clamp(raw, 0, target.windowMs) : raw
  if (pts.length === 1) return pts[0].p
  // Evenly spaced from the first point (which is before the pass, for a
  // target that is out there early), so the segment is a straight division.
  // Past either end it carries on along the end segment.
  let i = clamp(Math.floor((local - pts[0].t) / TRACK_STEP_MS), 0, pts.length - 2)
  while (i > 0 && pts[i].t > local) i--
  while (i < pts.length - 2 && pts[i + 1].t < local) i++
  const a = pts[i], b = pts[i + 1]
  const k = (local - a.t) / (b.t - a.t)
  return [
    a.p[0] + (b.p[0] - a.p[0]) * k,
    a.p[1] + (b.p[1] - a.p[1]) * k,
    a.p[2] + (b.p[2] - a.p[2]) * k,
  ]
}

// Where a target appears from the station: azimuth, elevation and range.
// `stationMs` is when to look from, which defaults to the same moment — the cue
// arrow passes the current time to point from where the station is now at a
// target that has not started yet.
export function targetDirectionAt(target, tMs, clampToWindow = true, stationMs = tMs) {
  const w = targetWorldAt(target, tMs, clampToWindow)
  const s = stationAt(stationMs)
  return directionOf(w[0] - s[0], w[1] - s[1], w[2] - s[2])
}

// Where the sightline from the station to a point crosses a piece of cover, in
// the cover's own coordinates — `u` across it and `y` up — or null if it does
// not cross the cover's plane between the two.
function crossing(cover, s, w) {
  const dx = w[0] - s[0], dy = w[1] - s[1], dz = w[2] - s[2]
  const denom = dx * cover.n[0] + dz * cover.n[2]
  if (Math.abs(denom) < 1e-9) return null
  const k = ((cover.p[0] - s[0]) * cover.n[0] + (cover.p[2] - s[2]) * cover.n[2]) / denom
  if (k <= 0 || k >= 1) return null
  const qx = s[0] + dx * k, qy = s[1] + dy * k, qz = s[2] + dz * k
  return {
    u: (qx - cover.p[0]) * cover.u[0] + (qz - cover.p[2]) * cover.u[2],
    y: qy,
  }
}

// Whether a piece of cover blocks the sightline from the station to a point.
// `pad` widens it, for checks that have to allow for what the scene draws.
export function coverBlocks(cover, s, w, pad = 0) {
  const c = crossing(cover, s, w)
  if (!c) return false
  return c.u > cover.uMin - pad && c.u < cover.uMax + pad
    && c.y > cover.yMin - pad && c.y < cover.yMax + pad
}

// Builds the cover that hides a target across [fromMs, toMs] of its pass. It
// stands in a vertical plane across the sightline at the middle of the
// stretch, exactly as wide as the sightlines that sweep through it in that
// time, so it hides the target from the moment `fromMs` to the moment `toMs`
// and not a millisecond either side. Built from where the station actually is
// at each moment, so the motion of the platform is part of the fit.
function buildCover(target, occ) {
  const frac = target.ground ? GROUND_COVER_FRAC : AIR_COVER_FRAC
  const tm = target.tStartMs + (occ.fromMs + occ.toMs) / 2
  const sm = stationAt(tm)
  const wm = targetWorldAt(target, tm)
  const p = [
    sm[0] + (wm[0] - sm[0]) * frac,
    sm[1] + (wm[1] - sm[1]) * frac,
    sm[2] + (wm[2] - sm[2]) * frac,
  ]
  const h = Math.hypot(wm[0] - sm[0], wm[2] - sm[2]) || 1
  const n = [(wm[0] - sm[0]) / h, 0, (wm[2] - sm[2]) / h]
  // Across the sightline, pointing the way azimuth increases.
  const u = [-n[2], 0, n[0]]
  const cover = { p, n, u, uMin: 0, uMax: 0, yMin: 0, yMax: 0 }

  const at = (local) => {
    const t = target.tStartMs + local
    return crossing(cover, stationAt(t), targetWorldAt(target, t))
  }
  const a = at(occ.fromMs)
  const b = at(occ.toMs)
  // A sightline that misses the plane leaves the cover zero-width, and the
  // caller drops it.
  if (!a || !b) return cover
  cover.uMin = Math.min(a.u, b.u)
  cover.uMax = Math.max(a.u, b.u)
  let yLo = Infinity, yHi = -Infinity
  for (let t = occ.fromMs; t <= occ.toMs; t += OCCLUSION_STEP_MS) {
    const c = at(t)
    if (!c) continue
    yLo = Math.min(yLo, c.y)
    yHi = Math.max(yHi, c.y)
  }
  if (target.ground) {
    cover.yMin = -STATION_ALT_M - 1
    cover.yMax = yHi + COVER_HEAD_ROOM_M
  } else {
    cover.yMin = yLo - CLOUD_MARGIN_M
    cover.yMax = yHi + CLOUD_MARGIN_M
  }
  cover.air = !target.ground
  cover.waterside = target.kind === 'boat'
  // Half the target's own width, as it appears at the cover's distance. The
  // scene draws the cover this much wider each side, so a target's leading edge
  // clears it at the instant the sim stops calling it obscured.
  cover.pad = (target.size / 2) * frac
  return cover
}

// Plans the stretches of a pass that go behind cover. Timing only; the cover
// itself is built to fit afterwards.
function planOcclusions(windowMs, peakRatePerMs, tuning, rng, blocked = []) {
  const max = tuning.maxOcclusions ?? 0
  if (max <= 0) return []

  const lo = OCCLUSION_HEAD_MS
  const hi = windowMs - OCCLUSION_TAIL_MS
  if (hi - lo < MIN_USEFUL_OCCLUSION_MS) return []

  // How long the target may be hidden before it would re-emerge outside the
  // frame, at the fastest it moves anywhere in the pass.
  const maxByArc = peakRatePerMs > 0
    ? (MAX_OCCLUSION_ARC_FRAC * CAMERA_FOV_DEG * DEG) / peakRatePerMs
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
    // Twelve attempts at a slot that doesn't crowd an existing one or sit on a
    // manoeuvre; a pass that can't fit a second occlusion simply gets one.
    let placed = false
    for (let attempt = 0; attempt < 12 && !placed; attempt++) {
      // On a 10 ms grid, the same grid the cover is checked on afterwards, so
      // the stretch that comes back out is the one that went in.
      const from = Math.ceil(rand(rng, lo, hi - dur) / OCCLUSION_STEP_MS) * OCCLUSION_STEP_MS
      const to = Math.floor((from + dur) / OCCLUSION_STEP_MS) * OCCLUSION_STEP_MS
      if (to - from < MIN_USEFUL_OCCLUSION_MS || to > hi) continue
      const clash = spans.some(s => from < s.toMs + OCCLUSION_GAP_MS && to > s.fromMs - OCCLUSION_GAP_MS)
        || blocked.some(b => from < b.toMs && to > b.fromMs)
      if (!clash) {
        spans.push({ fromMs: from, toMs: to })
        used += to - from
        placed = true
      }
    }
  }
  return spans.sort((a, b) => a.fromMs - b.fromMs)
}

// Plans a pass's manoeuvres (Real CBAT only): turns, and for anything that can
// brake, slow-downs. Never on a static target, never in the opening or closing
// stretch, never two on top of each other, and never inside `blocked` — the
// stretches already planned to go behind cover, so a target is never hidden
// while it manoeuvres. A manoeuvre too big to fit is made smaller; one that
// still can't fit is left out.
const MANOEUVRE_HEAD_MS = 1200
const MANOEUVRE_TAIL_MS = 1500
const MANOEUVRE_GAP_MS = 1000

function planManoeuvres(kind, d, tuning, rng, blocked = []) {
  const range = tuning.manoeuvres
  const motion = KIND_MOTION[kind]
  if (!range || !motion) return []
  const vMps = d.vh * 1000
  // Signed: the steady curve bends the way the target is travelling round.
  const curve = d.dir / (d.range * Math.cos(d.startElev))
  const room = d.windowMs - MANOEUVRE_HEAD_MS - MANOEUVRE_TAIL_MS
  const count = randInt(rng, range[0], range[1])
  const out = []
  for (let i = 0; i < count; i++) {
    const turn = !motion.slowTo || rng() < 0.6
    let dPsi = turn ? (rng() < 0.5 ? -1 : 1) * rand(rng, motion.turnDeg[0], motion.turnDeg[1]) * DEG : 0
    let speedFrac = turn ? motion.turnSpeed : rand(rng, motion.slowTo[0], motion.slowTo[1])
    let durMs = manoeuvreDurationMs(motion, vMps, curve, dPsi, speedFrac)
    // A turn that won't fit one way may fit the other, against the curve.
    if (turn && (durMs == null || durMs > room)) {
      const other = manoeuvreDurationMs(motion, vMps, curve, -dPsi, speedFrac)
      if (other != null && (durMs == null || other < durMs)) { dPsi = -dPsi; durMs = other }
    }
    for (let shrink = 0; shrink < 4 && (durMs == null || durMs > room); shrink++) {
      if (turn) dPsi *= 0.7
      else speedFrac = (1 + speedFrac) / 2
      durMs = manoeuvreDurationMs(motion, vMps, curve, dPsi, speedFrac)
    }
    if (durMs == null || durMs > room) continue
    // Air targets come out of a turn climbing or descending a little.
    const vyAfter = d.ground || !turn ? undefined : ((rand(rng, -3, 5) * DEG) / d.windowMs) * d.range
    for (let attempt = 0; attempt < 8; attempt++) {
      const latest = d.windowMs - MANOEUVRE_TAIL_MS - durMs
      const atMs = Math.round(rand(rng, MANOEUVRE_HEAD_MS, latest) / TRACK_STEP_MS) * TRACK_STEP_MS
      if (out.some(m => atMs < m.atMs + m.durMs + MANOEUVRE_GAP_MS && atMs + durMs + MANOEUVRE_GAP_MS > m.atMs)) continue
      if (blocked.some(bk => atMs < bk.toMs && atMs + durMs > bk.fromMs)) continue
      out.push({ type: turn ? 'turn' : 'slow', atMs, durMs, dPsi, speedFrac, vyAfter })
      break
    }
  }
  return out.sort((x, y) => x.atMs - y.atMs)
}

// Samples a pass from the moving station: is it inside the gimbal and the
// visible range for its whole window, and what is the fastest it moves across
// the sky?
function surveyPass(target) {
  let peak = 0
  let prev = null
  // Over the window, not the stored points: a static target has only one, and
  // it is the aircraft's motion that carries it towards the limits.
  for (let local = 0; local <= target.windowMs; local += TRACK_STEP_MS) {
    const pt = { t: local, p: targetWorldAt(target, target.tStartMs + local) }
    const t = target.tStartMs + pt.t
    const s = stationAt(t)
    const d = directionOf(pt.p[0] - s[0], pt.p[1] - s[1], pt.p[2] - s[2])
    if (Math.abs(d.az) > (AZ_LIMIT_DEG - GIMBAL_MARGIN_DEG) * DEG) return { ok: false }
    if (d.elev < (ELEV_MIN_DEG + ELEV_MARGIN_DEG) * DEG) return { ok: false }
    if (d.elev > (ELEV_MAX_DEG - ELEV_MARGIN_DEG) * DEG) return { ok: false }
    // 15 m inside the cap: the track is checked at its stored points, and a
    // target can stray a little further between them.
    if (d.range > MAX_TARGET_RANGE_M - 15 || d.range < MIN_TARGET_RANGE_M) return { ok: false }
    if (prev) {
      const rate = angularError(prev.d.az, prev.d.elev, d.az, d.elev) / (pt.t - prev.t)
      peak = Math.max(peak, rate)
    }
    prev = { d, t: pt.t }
  }
  return { ok: true, peakRatePerMs: peak }
}

// Does any of `covers` cut a sightline to `target` during its window? Checked
// with the scene's drawn width (the pad) plus a margin, so a building put up
// for one pass can never stand in front of another.
function coverCrossesPass(target, covers) {
  if (!covers.length) return false
  // On the same 10 ms grid the hidden stretches are worked out on, or a cover
  // that only grazes a sightline for a moment slips between the checks.
  for (let t = 0; t <= target.windowMs; t += OCCLUSION_STEP_MS) {
    const abs = target.tStartMs + t
    const s = stationAt(abs)
    const w = targetWorldAt(target, abs)
    for (const c of covers) if (coverBlocks(c, s, w, c.pad + 2)) return true
  }
  return false
}

// One attempt at a pass.
function draftPass(id, kind, tuning, startAfterMs, prevEndAz, rng, plain) {
  const spec = RTT_KINDS[kind]
  const windowMs = spec.windowMs

  const startElev = rand(rng, spec.elevDeg[0] * DEG, spec.elevDeg[1] * DEG)
  // Ground kinds are pinned to the ground plane, so their range is whatever the
  // depression angle implies. Air kinds pick one.
  const range = spec.ground
    ? STATION_ALT_M / Math.sin(-startElev)
    : rand(rng, spec.range[0], spec.range[1])

  // Small-angle rate for a target crossing the line of sight. Capped so that no
  // single pass can demand most of the gimbal's travel — a close jet works out
  // at over 180° of arc, which leaves no room to place the pass inside the
  // limits and turns tracking into a sprint rather than a skill.
  const rawArc = (spec.speedMps * (tuning.speedScale ?? 1) / range) * (windowMs / 1000)
  const arc = Math.min(rawArc, MAX_ARC_DEG * DEG)
  const dir = rng() < 0.5 ? -1 : 1

  const azLimit = (AZ_LIMIT_DEG - GIMBAL_MARGIN_DEG) * DEG
  // Where the pass begins, relative to where the last one left the player
  // pointing. Bounded at BOTH ends, and that is the point:
  //
  //   • a minimum, so every pass demands a real slew rather than starting
  //     already on target;
  //   • a maximum, because without one the generator would happily put the next
  //     target 200° away and the run turned into hunting for something that was
  //     nowhere on screen. This test measures tracking, not searching.
  //
  // A plain fallback pass goes off the beam instead, where the platform's
  // motion carries it away rather than over the top of it.
  const lo = dir > 0 ? -azLimit : -azLimit + arc
  const hi = dir > 0 ? azLimit - arc : azLimit
  let startAz
  if (plain) {
    startAz = clamp((rng() < 0.5 ? -1 : 1) * 95 * DEG, lo, hi)
  } else {
    const gap = rand(rng, MIN_SEPARATION_DEG * DEG, MAX_SEPARATION_DEG * DEG)
    const side = rng() < 0.5 ? -1 : 1
    // Both directions, each pulled back inside the legal range, and whichever
    // lands closest to the gap actually asked for wins.
    const options = [prevEndAz + side * gap, prevEndAz - side * gap].map(v => clamp(v, lo, hi))
    startAz = options.reduce((best, v) =>
      Math.abs(Math.abs(v - prevEndAz) - gap) < Math.abs(Math.abs(best - prevEndAz) - gap) ? v : best)
  }

  // Ground movers stay on the ground plane. Air movers climb or descend a
  // little across the pass.
  const elevRate = spec.ground ? 0 : (rand(rng, -3, 5) * DEG) / windowMs
  const s0 = stationAt(startAfterMs)
  // Everything designTrack and planManoeuvres need. Speeds are m/ms: `vh`
  // across the ground, chosen so the target sweeps `arc` of azimuth in its
  // window; `vy` climbing.
  const design = {
    s0, startAz, startElev, range, dir, windowMs, ground: !!spec.ground,
    vh: (arc * range * Math.cos(startElev)) / windowMs,
    vy: elevRate * range,
  }
  const layTrack = (manoeuvres) => {
    target.manoeuvres = manoeuvres
    if (kind === 'static') {
      const o = polarToWorld(startAz, startElev, range)
      target.track = [{ t: 0, p: [s0[0] + o[0], s0[1] + o[1], s0[2] + o[2]], bank: 0 }]
    } else {
      target.track = designTrack(design, manoeuvres)
    }
  }

  const target = {
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
    track: [],
    manoeuvres: [],
    occlusions: [],
    cover: [],
    requiredFrames: RTT_FRAMES_PER_TARGET,
  }
  layTrack([])
  return { target, layTrack, design }
}

// One target pass: drafted until it is legal from the moving station, then
// given its cover. `placed` is every pass before it, whose cover it must not
// stand behind and whose sightlines its own cover must not cross.
function buildTarget(id, kind, tuning, startAfterMs, prevEndAz, rng, placed) {
  const earlierCover = placed.flatMap(t => t.cover)
  for (let attempt = 0; attempt < PASS_ATTEMPTS; attempt++) {
    const { target, layTrack, design } = draftPass(id, kind, tuning, startAfterMs, prevEndAz, rng, false)
    let survey = surveyPass(target)
    if (!survey.ok) continue

    // Something that isn't moving under its own power can't go behind cover.
    // The cover is fixed, and a stationary target behind it would be hidden
    // in a way no amount of prediction gets back. Player report: static
    // targets "flickering in and out of existence".
    let plan = []
    if (kind !== 'static') {
      // Cover and manoeuvres can't overlap, so whichever is planned first
      // gets the pick of the window. Real CBAT takes turns: half its passes
      // plan the manoeuvres first, half the cover, so both turn up. SkyWatch
      // has no manoeuvres and always plans cover. No manoeuvre can happen
      // while the target is hidden, so the rate it is hidden at is its plain
      // one; the 10% is for the small shift a turn earlier in the pass makes
      // to the geometry, and fitCover measures the finished track anyway.
      const clearOf = spans => spans.map(o => ({
        fromMs: o.fromMs - MANOEUVRE_COVER_CLEAR_MS,
        toMs: o.toMs + MANOEUVRE_COVER_CLEAR_MS,
      }))
      const margin = tuning.manoeuvres ? 1.1 : 1
      if (tuning.manoeuvres && rng() < 0.5) {
        const manoeuvres = planManoeuvres(kind, design, tuning, rng)
        if (manoeuvres.length) {
          layTrack(manoeuvres)
          survey = surveyPass(target)
          if (!survey.ok) continue
        }
        const busy = manoeuvres.map(m => ({ fromMs: m.atMs, toMs: m.atMs + m.durMs }))
        plan = planOcclusions(target.windowMs, survey.peakRatePerMs * margin, tuning, rng, clearOf(busy))
      } else {
        plan = planOcclusions(target.windowMs, survey.peakRatePerMs * margin, tuning, rng)
        const manoeuvres = planManoeuvres(kind, design, tuning, rng, clearOf(plan))
        if (manoeuvres.length) {
          layTrack(manoeuvres)
          survey = surveyPass(target)
          if (!survey.ok) continue
        }
      }
    }
    if (coverCrossesPass(target, earlierCover)) continue
    if (plan.length) target.cover = fitCover(target, plan, placed)
    return target
  }
  // Nothing legal in thirty tries: a plain pass off the beam, with no turns and
  // no cover, which the platform carries away from rather than over.
  let plain = null
  for (let attempt = 0; attempt < 10; attempt++) {
    plain = draftPass(id, kind, tuning, startAfterMs, prevEndAz, rng, true).target
    if (surveyPass(plain).ok && !coverCrossesPass(plain, earlierCover)) break
  }
  return plain
}

// Builds the cover for a pass's planned stretches, keeping only cover that
// hides the target for exactly the stretch it was planned for and nothing
// else. Cover that would stand in front of an earlier pass goes too.
function fitCover(target, plan, placed) {
  const matches = (spans, wanted) => spans.length === wanted.length
    && spans.every((sp, i) => Math.abs(sp.fromMs - wanted[i].fromMs) <= OCCLUSION_STEP_MS
      && Math.abs(sp.toMs - wanted[i].toMs) <= OCCLUSION_STEP_MS)

  const kept = []
  const keptPlan = []
  const capRad = MAX_OCCLUSION_ARC_FRAC * CAMERA_FOV_DEG * DEG
  plan.forEach((occ) => {
    // Measured on the finished track, so a turn earlier in the pass can't
    // have stretched a hidden arc past the cap.
    const a = targetDirectionAt(target, target.tStartMs + occ.fromMs)
    const b = targetDirectionAt(target, target.tStartMs + occ.toMs)
    if (angularError(a.az, a.elev, b.az, b.elev) > capRad) return
    const cover = buildCover(target, occ)
    if (!(cover.uMax - cover.uMin > 0.5)) return
    if (!matches(deriveOcclusions(target, [cover]), [occ])) return
    if (placed.some(p => coverCrossesPass(p, [cover]))) return
    kept.push(cover)
    keptPlan.push(occ)
  })
  // Together as well as one at a time.
  return matches(deriveOcclusions(target, kept), keptPlan) ? kept : []
}

// Works out from the geometry exactly when a target is behind ANY cover in the
// run. The sim scores from this list and the scene draws the cover, so what is
// hidden on screen and what the sim calls hidden are the same thing.
function deriveOcclusions(target, covers) {
  const spans = []
  let open = null
  for (let t = 0; t <= target.windowMs; t += OCCLUSION_STEP_MS) {
    const abs = target.tStartMs + t
    const s = stationAt(abs)
    const w = targetWorldAt(target, abs)
    // Shrunk by a hair so a sightline exactly on the cover's edge counts as
    // clear: the planned stretch comes back out on the same 10 ms grid it was
    // planned on, never a step longer.
    const hidden = covers.some(c => coverBlocks(c, s, w, -1e-6))
    if (hidden && open == null) open = t
    if (!hidden && open != null) { spans.push({ fromMs: open, toMs: t }); open = null }
  }
  if (open != null) spans.push({ fromMs: open, toMs: target.windowMs })
  return spans
}

// Aircraft that fly through the area and are NOT targets (Real CBAT only). The
// player reported other aircraft in the scene moving about like the targets do,
// so the player has to stay on the right one. They are always further away
// than any target can be, so they pass behind a target and never in front of
// it, and they can't be scored: a frame taken of one is a frame of nothing.
const DECOY_RANGE_M = [1500, 2600]
const DECOY_MIN_RANGE_M = 1300
const DECOY_LIFE_MS = [9000, 15000]
const DECOY_SPEED_MPS = { jet: 160, helicopter: 45 }
const DECOY_SIZE_M = { jet: 15, helicopter: 16 }

function buildDecoys(tuning, durationMs, rng) {
  const gap = tuning.decoyGapMs
  if (!gap) return []
  const out = []
  let t = rand(rng, 500, 3000)
  while (t < durationMs - 3000) {
    let made = null
    for (let attempt = 0; attempt < 8 && !made; attempt++) {
      const kind = rng() < 0.6 ? 'jet' : 'helicopter'
      const lifeMs = Math.min(rand(rng, DECOY_LIFE_MS[0], DECOY_LIFE_MS[1]), durationMs - t)
      const az = rand(rng, -140, 140) * DEG
      const elev = rand(rng, 3, 12) * DEG
      const range = rand(rng, DECOY_RANGE_M[0], DECOY_RANGE_M[1])
      const dir = rng() < 0.5 ? -1 : 1
      const s0 = stationAt(t)
      const o = polarToWorld(az, elev, range)
      const p0 = [s0[0] + o[0], s0[1] + o[1], s0[2] + o[2]]
      const v = DECOY_SPEED_MPS[kind] * (lifeMs / 1000) * dir
      const p1 = [p0[0] + Math.cos(az) * v, p0[1], p0[2] + Math.sin(az) * v]
      const decoy = {
        id: out.length, kind, size: DECOY_SIZE_M[kind],
        tStartMs: Math.round(t), tEndMs: Math.round(t + lifeMs), windowMs: Math.round(lifeMs),
        track: [{ t: 0, p: p0 }, { t: Math.round(lifeMs), p: p1 }],
      }
      let ok = true
      for (let k = 0; k <= decoy.windowMs && ok; k += 250) {
        const w = targetWorldAt(decoy, decoy.tStartMs + k)
        const s = stationAt(decoy.tStartMs + k)
        if (Math.hypot(w[0] - s[0], w[1] - s[1], w[2] - s[2]) < DECOY_MIN_RANGE_M) ok = false
      }
      if (ok) made = decoy
    }
    if (made) {
      out.push(made)
      t = made.tEndMs + rand(rng, gap[0], gap[1])
    } else {
      t += 2000
    }
  }
  return out
}

export function generateRttRun(tuning, rng = Math.random) {
  const kinds = kindSequence(tuning.kinds, tuning.targets, rng)
  const targets = []
  let t = RTT_LEAD_IN_MS
  // Seeded with where the camera actually starts, so the FIRST pass is placed
  // relative to the player rather than anywhere in 300° of gimbal.
  let prevEndAz = 0
  kinds.forEach((kind, i) => {
    const target = buildTarget(i, kind, tuning, t, prevEndAz, rng, targets)
    targets.push(target)
    prevEndAz = targetDirectionAt(target, target.tEndMs).az
    t = target.tEndMs + RTT_GAP_MS
  })

  // Last line of defence: cover that stands in front of any OTHER pass is
  // taken away from the pass it was built for. Each pass checks the ones
  // before it as it is built, and this catches the rare case that gets past
  // that, so every pass is only ever hidden by its own cover.
  for (let changed = true; changed;) {
    changed = false
    for (const owner of targets) {
      const clear = owner.cover.filter(c => !targets.some(tg => tg !== owner && coverCrossesPass(tg, [c])))
      if (clear.length !== owner.cover.length) { owner.cover = clear; changed = true }
    }
  }

  const allCover = targets.flatMap(tg => tg.cover)
  for (const target of targets) {
    target.occlusions = deriveOcclusions(target, allCover)
    // Where the pass starts and ends on the gimbal, for the HUD, the tests and
    // the next pass's placement.
    const a = targetDirectionAt(target, target.tStartMs)
    const b = targetDirectionAt(target, target.tEndMs)
    target.startAz = a.az
    target.startElev = a.elev
    target.endAz = b.az
    target.endElev = b.elev
  }

  const durationMs = targets.length ? targets[targets.length - 1].tEndMs + 900 : 0
  return { targets, decoys: buildDecoys(tuning, durationMs, rng), durationMs }
}

// ── Target state at a moment ─────────────────────────────────────────────────

export function isTargetVisible(target, tMs) {
  return tMs >= target.tStartMs && tMs < target.tEndMs
}

export function isTargetOccluded(target, tMs) {
  const local = tMs - target.tStartMs
  return target.occlusions.some(o => local >= o.fromMs && local < o.toMs)
}

// How wide the target itself looks from the station at the start of its pass,
// in radians.
export function targetAngularSize(target) {
  return target.size / target.range
}

// ── Presentation (SkyWatch only) ─────────────────────────────────────────────
//
// How a SkyWatch run looks, and what each target is called. Neither touches
// scoring. Real CBAT always flies the plain dusk look with no names, because
// it is meant to look like the real test.

// The light a run is flown in. Thermal is the rare one: a white-hot sensor
// picture, roughly one run in five.
export const RTT_LOOKS = ['dusk', 'dawn', 'overcast', 'rain', 'thermal']
const THERMAL_CHANCE = 0.2

export function pickLook(tuning, rng = Math.random) {
  if (tuning.realCbat) return 'dusk'
  if (rng() < THERMAL_CHANCE) return 'thermal'
  const plain = ['dusk', 'dawn', 'overcast', 'rain']
  return plain[Math.floor(rng() * plain.length)]
}

// The banner each SkyWatch run opens with, naming its conditions. Plain words a
// newcomer understands; no em dashes (on-screen copy rule).
export const LOOK_TITLES = {
  dusk: { title: 'Dusk', line: 'Fading evening light over the fields.' },
  dawn: { title: 'Dawn', line: 'Low morning sun and a warm horizon.' },
  overcast: { title: 'Cloudy', line: 'Grey sky and flat light. The haze sits closer in.' },
  rain: { title: 'Rainy', line: 'Rain falling and heavy cloud. Stay on your target.' },
  thermal: { title: 'Thermal', line: 'White-hot sensor on. Targets glow white against the cold ground.' },
}

// What the pass card calls each target. Plain names a newcomer understands.
export const TARGET_NAMES = {
  static: ['Radar site', 'Fuel depot', 'Radio mast', 'Supply dump'],
  person: ['Foot patrol', 'Recce team', 'Patrol on foot'],
  boat: ['Patrol boat', 'Fast boat', 'Supply boat'],
  vehicle: ['Convoy truck', 'Supply truck', 'Armoured car'],
  helicopter: ['Transport helicopter', 'Utility helicopter'],
  jet: ['Fast jet', 'Strike jet'],
}

function nameTargets(targets, tuning, rng) {
  if (tuning.realCbat) return
  for (const t of targets) {
    const list = TARGET_NAMES[t.kind]
    t.name = list[Math.floor(rng() * list.length)]
  }
}

// ── Sim ──────────────────────────────────────────────────────────────────────

export function makeRttSim(tuning, rng = Math.random) {
  const run = generateRttRun(tuning, rng)
  // After the run itself, so a seed still reproduces the same targets.
  const look = pickLook(tuning, rng)
  nameTargets(run.targets, tuning, rng)
  return {
    tuning,
    run,
    look,
    // Frames captured, as small pictures for the results screen's contact
    // sheet (SkyWatch only; filled by the scene).
    photos: [],
    durationMs: run.durationMs,
    captureRad: captureRadius(tuning),
    elapsedMs: 0,
    score: 0,
    framesTaken: 0,
    framesOnTarget: 0,
    targetsCompleted: 0,
    errorRadSum: 0,
    // Per-target progress, parallel to run.targets. The tracking fields are
    // only ever filled on Real CBAT.
    progress: run.targets.map(() => ({
      frames: 0, resolved: false,
      acquired: false, holdMs: 0, inBoxMs: 0, trackMs: 0, trackFrac: null,
    })),
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

// Tracking points for a closed pass (Real CBAT).
export function trackingPoints(p, windowMs) {
  const denom = Math.max(p.trackMs, windowMs * RTT_TRACK_SCORE.minTrackedFrac)
  const frac = denom > 0 ? Math.min(1, p.inBoxMs / denom) : 0
  const points = Math.round(RTT_TRACK_SCORE.trackMax * Math.min(1, frac / RTT_TRACK_SCORE.trackFullAt))
  return { frac, points }
}

// Advances the clock and closes any pass whose window has just ended: books the
// penalty for frames still owed and, on Real CBAT, the tracking points. Called
// from the render loop with the frame's delta; safe to call with a large dt
// after a tab blur.
export function advanceRtt(sim, dtMs) {
  sim.elapsedMs += dtMs
  const tracked = !!sim.tuning.trackScoring
  sim.run.targets.forEach((target, i) => {
    const p = sim.progress[i]
    if (p.resolved || sim.elapsedMs < target.tEndMs) return
    p.resolved = true
    const owed = target.requiredFrames - p.frames
    if (owed > 0) {
      const delta = owed * RTT_SCORE.missedFrame
      sim.score += delta
      pushEvent(sim, `${target.hud} lost, ${owed} frame${owed === 1 ? '' : 's'} short`, delta)
    }
    if (tracked) {
      const { frac, points } = trackingPoints(p, target.windowMs)
      p.trackFrac = frac
      sim.score += points
      pushEvent(sim, `${target.hud} held in the box ${Math.round(frac * 100)}%`, points)
    }
  })
  return sim
}

// Real CBAT: counts the time each live target spends inside the box. Called
// once a frame, after advanceRtt, with the same candidates the shutter sees.
// Behind cover still counts if the box is on where the target really is: that
// is prediction, which is what cover tests.
export function trackRtt(sim, candidates, dtMs) {
  if (!sim.tuning.trackScoring) return
  for (const c of candidates) {
    const p = sim.progress[c.index]
    if (!p || p.resolved) continue
    const inBox = c.errorRad <= sim.captureRad
    if (inBox) {
      p.acquired = true
      p.inBoxMs += dtMs
      p.holdMs += dtMs
    } else {
      p.holdMs = 0
    }
    if (p.acquired) p.trackMs += dtMs
  }
}

// Has the target been held in the box long enough for a frame to count?
// Always true on SkyWatch, which scores wherever the shutter fires.
export function isLocked(sim, index) {
  if (!sim.tuning.trackScoring) return true
  return (sim.progress[index]?.holdMs ?? 0) >= RTT_LOCK_MS
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
  let unsteady = false
  for (const c of candidates) {
    const p = sim.progress[c.index]
    if (!p || p.resolved || p.frames >= RTT_FRAMES_PER_TARGET) continue
    if (c.errorRad > sim.captureRad) continue
    if (c.occluded) { blockedByOcclusion = true; continue }
    if (!isLocked(sim, c.index)) { unsteady = true; continue }
    if (!best || c.errorRad < best.errorRad) best = c
  }

  if (!best) {
    sim.score += RTT_SCORE.wastedFrame
    const kind = blockedByOcclusion ? 'occluded' : unsteady ? 'unsteady' : 'miss'
    const text = blockedByOcclusion ? 'Frame wasted, target obscured'
      : unsteady ? 'Frame wasted, hold the target in the box first'
        : 'Frame wasted, off target'
    pushEvent(sim, text, RTT_SCORE.wastedFrame)
    return { kind, points: RTT_SCORE.wastedFrame, targetIndex: -1, errorRad: 0 }
  }

  const tracked = !!sim.tuning.trackScoring
  const scoring = tracked ? RTT_TRACK_SCORE : RTT_SCORE
  const target = sim.run.targets[best.index]
  const p = sim.progress[best.index]
  p.frames += 1
  sim.framesOnTarget += 1
  sim.errorRadSum += best.errorRad

  // 1 at dead centre, 0 at the edge of the capture cone.
  const centring = 1 - best.errorRad / sim.captureRad
  let points = scoring.frameBase + Math.round(scoring.frameCentreBonus * centring)
  let completed = false
  if (p.frames >= RTT_FRAMES_PER_TARGET) {
    // On Real CBAT the pass stays open after the third frame: keeping the
    // target in the box still scores until the window closes.
    if (!tracked) p.resolved = true
    completed = true
    sim.targetsCompleted += 1
    points += RTT_SCORE.targetComplete
  }
  sim.score += points
  pushEvent(
    sim,
    completed
      ? `${target.hud} complete, 3 of 3`
      : `${target.hud} frame ${p.frames} of 3`,
    points,
  )
  return { kind: 'hit', points, targetIndex: best.index, errorRad: best.errorRad, completed, frames: p.frames }
}

export function rttStats(sim) {
  const tracked = sim.progress.filter(p => p.trackFrac != null)
  return {
    totalScore: Math.round(sim.score),
    framesTaken: sim.framesTaken,
    framesOnTarget: sim.framesOnTarget,
    targetsCompleted: sim.targetsCompleted,
    totalTargets: sim.run.targets.length,
    avgCentringErrorDeg: sim.framesOnTarget
      ? Number(((sim.errorRadSum / sim.framesOnTarget) / DEG).toFixed(2))
      : 0,
    // Real CBAT only: the average share of each pass spent in the box.
    timeInBoxPct: sim.tuning.trackScoring && tracked.length
      ? Math.round((tracked.reduce((n, p) => n + p.trackFrac, 0) / tracked.length) * 100)
      : null,
  }
}

// A perfect run, for the results screen's "x of y" line. Every target: three
// dead-centre frames plus the completion bonus, plus (Real CBAT) full tracking.
// Both themes come to the same figure, because they share a board.
export function maxRttScore(tuning) {
  const perTarget = tuning.trackScoring
    ? RTT_FRAMES_PER_TARGET * (RTT_TRACK_SCORE.frameBase + RTT_TRACK_SCORE.frameCentreBonus)
      + RTT_TRACK_SCORE.trackMax + RTT_SCORE.targetComplete
    : RTT_FRAMES_PER_TARGET * (RTT_SCORE.frameBase + RTT_SCORE.frameCentreBonus) + RTT_SCORE.targetComplete
  return tuning.targets * perTarget
}

// How tall the reticle box is, as a percentage of the picture's height, for a
// capture cone and a vertical field of view. Both are angles, so their tangent
// ratio is the fraction of the frame the cone covers: the box needs no
// measuring and no resize handler. The SVG inside draws its circle at half the
// box width, so the box is twice the cone.
export function reticleHeightPercent(captureRad, fovDeg) {
  return 2 * 100 * (Math.tan(captureRad) / Math.tan((fovDeg / 2) * DEG))
}
