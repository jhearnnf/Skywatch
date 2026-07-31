// Numerical Operations difficulty tuning.
//
// Hard is the original test — every value here is what the game shipped with.
// Easier runs the same 20 questions in the same four rounds on the same 20s
// per-question clock; what changes is the arithmetic itself:
//
//   • smaller numbers each round (round 4 tops out at 50, not 99)
//   • × and ÷ keep their second operand inside the 10 times table, so the
//     multiplier/divisor never becomes the whole difficulty
//   • more + and −, fewer × and ÷ in the op mix
//
// Everything else is deliberately shared — question count, round structure, the
// clock, the keypad and the scoring — so the two difficulties stay the same test
// at different loads (the same rule FLAG and CUT follow).

export const DEFAULT_NUMERICAL_OPS_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the game
// actually begins. Matches FLAG's and CUT's — the sequence should feel the same
// wherever it appears.
export const NUMERICAL_OPS_LAUNCH_MS = 1000

// Weighted op pools. Division is harder to satisfy (it needs a clean integer
// result) and tends to dominate when picked uniformly, so it's the rarest entry
// in both pools.
const OPS_HARD   = ['+', '+', '-', '-', '*', '*', '/']              // + − × 2/7 each, ÷ 1/7
const OPS_EASIER = ['+', '+', '+', '-', '-', '-', '*', '/']         // + − 3/8 each, × ÷ 1/8

export const NUMERICAL_OPS_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'numerical-ops-easier',
    bars: 1,
    blurb: 'Smaller numbers, gentler operations',

    // Upper bound on the displayed operands, per round. Still escalates — it
    // just stops short of the two-digit-by-two-digit multiplications that make
    // Hard's round 4 a different exercise from its round 1.
    roundMax: [10, 20, 30, 50],
    ops: OPS_EASIER,
    // Cap on the SECOND operand of × and ÷ (the multiplier / divisor). Capping
    // one side rather than both keeps × and ÷ growing with the rounds while the
    // mental step stays a times-table fact. null = no cap.
    factorMax: 10,

    // Score is a percentage of a fixed 20 questions, so both difficulties share
    // the same 100% ceiling — unlike FLAG and CUT, where Easier lowers the
    // achievable total. The bands therefore move the other way: an easier run
    // has to be more accurate to earn the same grade.
    grades: { outstanding: 95, good: 80, needsWork: 60 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'numerical-ops',
    bars: 3,
    blurb: 'Harder than the real thing',

    roundMax: [10, 25, 50, 99],
    ops: OPS_HARD,
    factorMax: null,

    grades: { outstanding: 90, good: 70, needsWork: 50 },
  },
}

// Ordered for the intro screen: easier sits left of the title, hard sits right.
export const NUMERICAL_OPS_DIFFICULTIES = [NUMERICAL_OPS_TUNING.easier, NUMERICAL_OPS_TUNING.hard]

export function numericalOpsTuning(difficulty) {
  return NUMERICAL_OPS_TUNING[difficulty] || NUMERICAL_OPS_TUNING[DEFAULT_NUMERICAL_OPS_DIFFICULTY]
}

export function numericalOpsGameKey(difficulty) {
  return numericalOpsTuning(difficulty).gameKey
}

export function computeGrade(pct, tuning) {
  const g = tuning.grades
  if (pct >= g.outstanding) return 'Outstanding'
  if (pct >= g.good) return 'Good'
  if (pct >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The default is 'easier', but once a user picks a difficulty that choice is
// what the instructions screen opens on next time.

const NUMERICAL_OPS_DIFFICULTY_KEY = 'sw_cbat_numerical_ops_difficulty'

export function readStoredNumericalOpsDifficulty() {
  try {
    const raw = localStorage.getItem(NUMERICAL_OPS_DIFFICULTY_KEY)
    if (raw && NUMERICAL_OPS_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_NUMERICAL_OPS_DIFFICULTY
}

export function storeNumericalOpsDifficulty(difficulty) {
  try { localStorage.setItem(NUMERICAL_OPS_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
