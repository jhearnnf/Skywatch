// CUT difficulty tuning. Hard uses the former Easier pacing; Easier gives
// players more time between tasks and longer code and mission entry windows.
// Both difficulties last three minutes. Tolerances and rewards are shared.
// Kept independent of cutSim.js to avoid a circular import.

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
    blurb: 'Slowest drift, fewer tasks',
    gameMs: 180_000,

    // Drift rates — how fast a system leaves tolerance while you're looking at
    // one of the other five.
    fuelDrainPerSec: 0.75,
    speedDriftPerSec: 0.085,
    pressRisePerSec: 0.12,
    pressDropPerSec: 0.09,

    // Tasks start early, with long repeat gaps to keep the workload gentle.
    // Task cadence. Every one of these announces itself in Message, so
    // stretching them is what "fewer messages" means.
    speedChangeMs: [100_000, 120_000],
    cameraFirstMs: [20_000, 24_000],
    cameraNextMs: [120_000, 150_000],
    firstCodeMs: 2_000,
    codeGapMs: [60_000, 75_000],

    codeWindowMs: 50_000,
    codeSubmitWindowMs: 40_000,
    fieldWindowMs: 50_000,

    // Mission display (cutSim's "Mission display" block). A load drop is
    // ordered this far ahead of its time, its three values this far apart,
    // and the next drop follows this long after; video values are ordered on
    // their own cadence.
    // Two complete drop windows fit even if the first is missed.
    firstDropMs: 1_000,
    dropLeadMs: [55_000, 55_000],
    dropOrderGapMs: [5_000, 7_000],
    dropGapMs: [20_000, 30_000],
    fieldFirstMs: 8_000,
    fieldGapMs: [60_000, 75_000],
    // Real CBAT theme only: camera orders carry a time this far ahead.
    cameraLeadMs: [28_000, 30_000],

    // Fewer tasks mean a lower achievable total, so the grade
    // bands come down with them.
    grades: { outstanding: 600, good: 400, needsWork: 200 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'cut',
    bars: 3,
    blurb: 'Gentle drift, three-minute run',
    gameMs: 180_000,

    // Drift rates — how fast a system leaves tolerance while you're looking at
    // one of the other five.
    fuelDrainPerSec: 1.5,
    speedDriftPerSec: 0.17,
    pressRisePerSec: 0.24,
    pressDropPerSec: 0.18,

    // Task cadence. Every one of these announces itself in Message, so
    // stretching them is what "fewer messages" means.
    speedChangeMs: [70_000, 90_000],
    cameraFirstMs: [80_000, 100_000],
    cameraNextMs: [85_000, 115_000],
    firstCodeMs: 20_000,
    codeGapMs: [20_000, 32_000],

    codeWindowMs: 45_000,
    codeSubmitWindowMs: 25_000,
    fieldWindowMs: 45_000,

    // Mission display (cutSim's "Mission display" block). A load drop is
    // ordered this far ahead of its time, its three values this far apart,
    // and the next drop follows this long after; video values are ordered on
    // their own cadence.
    // Three complete drop windows fit at the slowest cadence, including misses.
    firstDropMs: 8_000,
    dropLeadMs: [32_000, 38_000],
    dropOrderGapMs: [5_000, 7_000],
    dropGapMs: [8_000, 10_000],
    fieldFirstMs: 26_000,
    fieldGapMs: [32_000, 44_000],
    // Real CBAT theme only: camera orders carry a time this far ahead.
    cameraLeadMs: [18_000, 28_000],

    // Fewer tasks mean a lower achievable total, so the grade
    // bands come down with them.
    grades: { outstanding: 650, good: 400, needsWork: 200 },
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
