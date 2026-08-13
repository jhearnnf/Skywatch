// Table Reading Test difficulty tuning.
//
// MATF is SPEEDED — you answer as many as you can inside a fixed clock — so
// there is no question count to hold constant and no shared ceiling to protect.
// The two difficulties therefore differ in the only two ways that matter here:
//
//   • how far the coordinate grid runs. ±17 on Hard, straight from the corpus:
//     the grid "runs −17 to +17 on both axes", and the one concrete piece of
//     prep advice anyone has offered is "draw out a grid running to 17 in each
//     direction and drill the lookups". ±8 on Easier — a grid you can still scan
//     without losing your place on the way across, and still signed, because
//     handling the sign is part of the task rather than part of the difficulty
//   • how much of the wind sheet part two carries: how many air-speed tables to
//     choose between, and how many rows and angle columns inside each
//   • how long each part runs
//
// Deliberately shared: the two-part structure, the symmetric grid (the "either
// way round" shortcut is the real technique and applies on both), the three-step
// lookup in part two, the five numbered options, and the scoring.
//
// No grade bands keyed to a fixed total, for the same reason — the grade comes
// from the count, and the thresholds differ because the clocks do.

export const DEFAULT_MATF_DIFFICULTY = 'easier'

export const MATF_LAUNCH_MS = 1000

export const MATF_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    gameKey: 'matf-easier',
    bars: 1,
    blurb: 'Smaller grid, longer on the clock',

    gridExtent: 8,
    tableCount: 3,
    rowCount: 5,
    angleCount: 4,
    partMs: 110000,

    grades: { outstanding: 40, good: 28, needsWork: 16 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'matf',
    bars: 3,
    blurb: 'Minus 17 to plus 17, ninety seconds a part',

    gridExtent: 17,
    tableCount: 5,
    rowCount: 7,
    angleCount: 6,
    partMs: 90000,

    grades: { outstanding: 32, good: 22, needsWork: 12 },
  },
}

export const MATF_DIFFICULTIES = [MATF_TUNING.easier, MATF_TUNING.hard]

export function matfTuning(difficulty) {
  return MATF_TUNING[difficulty] || MATF_TUNING[DEFAULT_MATF_DIFFICULTY]
}

export function matfGameKey(difficulty) {
  return matfTuning(difficulty).gameKey
}

export function computeMatfGrade(correct, tuning) {
  const g = tuning.grades
  if (correct >= g.outstanding) return 'Outstanding'
  if (correct >= g.good) return 'Good'
  if (correct >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────

const MATF_DIFFICULTY_KEY = 'sw_cbat_matf_difficulty'

export function readStoredMatfDifficulty() {
  try {
    const raw = localStorage.getItem(MATF_DIFFICULTY_KEY)
    if (raw && MATF_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_MATF_DIFFICULTY
}

export function storeMatfDifficulty(difficulty) {
  try { localStorage.setItem(MATF_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
