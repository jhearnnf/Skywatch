// Rapid Tracking Test difficulty tuning.
//
// Hard is the test as designed — every value here is what the game shipped
// with. Easier keeps the control law, the slew ceiling, the three frames per
// target and the shutter cooldown exactly the same; what changes is how much
// tracking work a run asks for:
//
//   • 8 target passes instead of 12, so a run is ~1:40 rather than ~2:30.
//   • no fast-jet pass. The jet is the only kind that crosses faster than the
//     camera can comfortably lead, and it is the single biggest cause of a
//     zero-frame target.
//   • every pass crosses at 70% of its Hard rate, so there is more time on each
//     target rather than a longer window (the windows are identical).
//   • at most one occluded stretch per pass instead of two, and each is shorter.
//   • a slightly wider capture cone, so a frame that is visibly on the target
//     counts.
//   • the airframe wanders less under you, so there is less drift to trim out.
//
// The grade bands were estimates until 2026-10-17, when they were reseated on
// the real runs flown since the 2026-10-01 update (SkyWatch Hard: median 1737,
// upper quartile 1894; Easier: median 1080, upper quartile 1270). The old
// bands had Outstanding at about half a perfect run, so nearly every run
// earned it. Retune them and the demo boards in cbatFakeLeaderboard.js
// together, as CUT's notes say.
//
// Everything else is deliberately shared — the scene, the scoring, the HUD, the
// input handling — so the two difficulties stay the same test at different
// loads (the rule FLAG, CUT, Numerical Operations and SAT all follow).

export const DEFAULT_RTT_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the game
// actually begins. Matches the other split games' — the sequence should feel
// the same wherever it appears.
export const RTT_LAUNCH_MS = 1000

export const RTT_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'rtt-easier',
    bars: 1,
    blurb: 'Fewer, slower targets',

    targets: 8,
    speedScale: 0.7,
    // Ordered slowest to fastest; the generator walks this list so a run always
    // opens on something gentle and works up.
    kinds: ['static', 'person', 'boat', 'vehicle', 'helicopter'],
    maxOcclusions: 1,
    occlusionScale: 0.6,
    captureScale: 1.25,
    // A steadier platform to shoot from — the airframe still wanders, just less
    // of it (see airframeDisturbance in rttSim).
    airframeScale: 0.6,
    // Wide and fast while searching, zoomed in and lightly stabilised on the
    // target (see zoomStep in rttSim). Both themes since 2026-10-17; it came
    // in on Real CBAT first, from a player's account of the real test.
    zoom: true,

    // Score accumulates and has no shared ceiling: a perfect Easier run is
    // 8 × 150 = 1200 where a perfect Hard run is 12 × 150 = 1800. The bands
    // therefore move DOWN, the same way FLAG's and CUT's do — the opposite of
    // Numerical Operations and SAT, which score a percentage of a fixed
    // question count and so must demand more accuracy on Easier.
    grades: { outstanding: 1230, good: 1060, needsWork: 760 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'rtt',
    bars: 3,
    blurb: 'Full target set, jets included',

    targets: 12,
    speedScale: 1,
    kinds: ['static', 'person', 'boat', 'vehicle', 'helicopter', 'jet'],
    maxOcclusions: 2,
    occlusionScale: 1,
    captureScale: 1,
    airframeScale: 1,
    zoom: true,

    grades: { outstanding: 1840, good: 1600, needsWork: 1150 },
  },
}

// Ordered for the intro screen: easier sits left of the title, hard sits right.
export const RTT_DIFFICULTIES = [RTT_TUNING.easier, RTT_TUNING.hard]

// What the Real CBAT theme adds on top of each difficulty, from players'
// accounts of the real test (survey and DMs, 2026-10). Same boards as
// SkyWatch, so the same perfect score (see maxRttScore).
//
//   • trackScoring: time in the box is scored for the whole pass;
//   • photoLimit: three photos per target, and every press spends one, hit or
//     miss ("you would only have 3 opportunities per object");
//   • manoeuvres: tight turns and bursts of speed, [min, max] per pass;
//   • decoyGapMs: other aircraft flying through, this far apart;
//   • flight: the aircraft speeds up, slows down and swings its heading
//     rather than flying straight (see buildFlight in rttSim), and
//     airframeScale shakes it harder;
//   • terrain: hills and ridges round the valley the targets are in.
//
// The grade bands are the real Real CBAT runs since 2026-10-01 (Hard: median
// 1819, upper quartile 1870; Easier: median 1120 over 16 runs), less about 5%
// for the photo limit and the rougher flight that came in on 2026-10-17. That
// 5% is an estimate: reseat it once there are runs flown on the new version.
export const REAL_CBAT_RTT = {
  easier: {
    trackScoring: true,
    photoLimit: true,
    manoeuvres: [0, 1],
    decoyGapMs: [6000, 12000],
    airframeScale: 0.9,
    flight: { speedMps: [8, 22], headingDeg: 20, holdMs: [1800, 4200], maxAccel: 2.5, maxTurnDegS: 6 },
    terrain: true,
    grades: { outstanding: 1160, good: 980, needsWork: 700 },
  },
  hard: {
    trackScoring: true,
    photoLimit: true,
    manoeuvres: [1, 2],
    decoyGapMs: [2000, 6000],
    airframeScale: 1.5,
    flight: { speedMps: [6, 30], headingDeg: 28, holdMs: [1200, 3500], maxAccel: 3.5, maxTurnDegS: 9 },
    terrain: true,
    grades: { outstanding: 1750, good: 1520, needsWork: 1100 },
  },
}

// `cbat` is the Real CBAT theme. The game key is the same either way: both
// themes post to one board, and each row records which theme it was flown on.
export function rttTuning(difficulty, cbat = false) {
  const base = RTT_TUNING[difficulty] || RTT_TUNING[DEFAULT_RTT_DIFFICULTY]
  return cbat ? { ...base, ...REAL_CBAT_RTT[base.key], realCbat: true } : base
}

export function rttGameKey(difficulty) {
  return rttTuning(difficulty).gameKey
}

export function computeGrade(score, tuning) {
  const g = tuning.grades
  if (score >= g.outstanding) return 'Outstanding'
  if (score >= g.good) return 'Good'
  if (score >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The default is 'easier', but once a user picks a difficulty that choice is
// what the instructions screen opens on next time.

const RTT_DIFFICULTY_KEY = 'sw_cbat_rtt_difficulty'

export function readStoredRttDifficulty() {
  try {
    const raw = localStorage.getItem(RTT_DIFFICULTY_KEY)
    if (raw && RTT_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_RTT_DIFFICULTY
}

export function storeRttDifficulty(difficulty) {
  try { localStorage.setItem(RTT_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}

// ── Stick sensitivity ────────────────────────────────────────────────────────
// Shared by both difficulties and remembered separately from them. The real
// test's own guidance is that adapting to the sensitivity of the stick in front
// of you matters more than any amount of prior gaming, so this is a setting the
// player is meant to fiddle with rather than something the difficulty picks.

export const MIN_SENSITIVITY = 0.4
export const MAX_SENSITIVITY = 2.0
export const DEFAULT_SENSITIVITY = 1.0

const RTT_SENSITIVITY_KEY = 'sw_cbat_rtt_sensitivity'

export function readStoredSensitivity() {
  try {
    const n = Number(localStorage.getItem(RTT_SENSITIVITY_KEY))
    if (Number.isFinite(n) && n >= MIN_SENSITIVITY && n <= MAX_SENSITIVITY) return n
  } catch { /* storage unavailable */ }
  return DEFAULT_SENSITIVITY
}

export function storeSensitivity(value) {
  try { localStorage.setItem(RTT_SENSITIVITY_KEY, String(value)) } catch { /* storage unavailable */ }
}
