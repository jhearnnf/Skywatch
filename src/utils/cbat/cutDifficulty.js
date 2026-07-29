// CUT difficulty tuning.
//
// Hard is the original test — every value here is what CUT shipped with. Easier
// runs the same 180 seconds, the same six displays, the same tolerances and the
// same scoring; what changes is how fast the systems wander away from you and
// how often the Message feed asks for something:
//
//   • fuel drains slower, so the tank spread takes longer to break
//   • hydraulic pressure rises and falls slower, so the band lasts longer
//   • airspeed bleeds off slower (the wind pushing you off the required speed)
//   • tasks — and therefore messages — arrive further apart
//
// Everything else is deliberately shared, so the two difficulties stay the same
// test at different loads.
//
// This file imports nothing from cutSim.js: cutSim imports the tuning for its
// defaults, and a cycle between them would leave one side undefined at module
// init. The numbers live here, and cutSim reads them off the sim.

export const DEFAULT_CUT_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the game
// actually begins. Matches FLAG's — the sequence should feel the same wherever
// it appears.
export const CUT_LAUNCH_MS = 1000

export const CUT_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'cut-easier',
    bars: 1,
    blurb: 'Slower drift, fewer messages',

    // Drift rates — how fast a system leaves tolerance while you're looking at
    // one of the other five.
    fuelDrainPerSec: 2.5,
    speedDriftPerSec: 0.28,
    pressRisePerSec: 0.4,
    pressDropPerSec: 0.3,

    // Task cadence. Every one of these announces itself in Message, so
    // stretching them is what "fewer messages" means.
    speedChangeMs: [52_000, 68_000],
    cameraFirstMs: [62_000, 80_000],
    cameraNextMs: [65_000, 95_000],
    loadGapMs: [30_000, 42_000],
    firstLoadMs: 30_000,
    firstCodeMs: 16_000,
    codeGapMs: [14_000, 24_000],

    // Fewer tasks in the same 180s means a lower achievable total, so the grade
    // bands come down with them.
    grades: { outstanding: 800, good: 500, needsWork: 250 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'cut',
    bars: 3,
    blurb: 'Harder than the real thing',

    fuelDrainPerSec: 4.5,
    speedDriftPerSec: 0.5,
    pressRisePerSec: 0.7,
    pressDropPerSec: 0.5,

    speedChangeMs: [32_000, 42_000],
    cameraFirstMs: [40_000, 55_000],
    cameraNextMs: [40_000, 60_000],
    loadGapMs: [18_000, 26_000],
    firstLoadMs: 22_000,
    firstCodeMs: 10_000,
    codeGapMs: [8_000, 14_000],

    grades: { outstanding: 1100, good: 700, needsWork: 350 },
  },
}

// Ordered for the intro screen: easier sits left of the title, hard sits right.
export const CUT_DIFFICULTIES = [CUT_TUNING.easier, CUT_TUNING.hard]

export function cutTuning(difficulty) {
  return CUT_TUNING[difficulty] || CUT_TUNING[DEFAULT_CUT_DIFFICULTY]
}

export function cutGameKey(difficulty) {
  return cutTuning(difficulty).gameKey
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The default is 'easier', but once a user picks a difficulty that choice is
// what the instructions screen opens on next time.

const CUT_DIFFICULTY_KEY = 'sw_cbat_cut_difficulty'

export function readStoredCutDifficulty() {
  try {
    const raw = localStorage.getItem(CUT_DIFFICULTY_KEY)
    if (raw && CUT_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_CUT_DIFFICULTY
}

export function storeCutDifficulty(difficulty) {
  try { localStorage.setItem(CUT_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
