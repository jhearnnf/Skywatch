// FLAG difficulty tuning.
//
// Easier is NOT a slowed-down FLAG: aircraft fly at the same speed, spawn at the
// same rate, and callsigns stay legible for exactly as long as on Hard. The
// mission is the same 60 seconds with the same maths, the same scoring and the
// same clock. What changes is how much lands on you at once:
//
//   • fewer maths questions, and never a hard sum
//   • fewer callsign questions
//   • fewer white-ringed contacts (still plenty — the shape strikes are the part
//     a new player most needs the reps on)
//
// Anything not listed here is deliberately shared, so the two difficulties stay
// the same game at different loads.

import { CBAT_FLAG_DIFFICULTY_KEY } from '../../utils/storageKeys'

export const DEFAULT_FLAG_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the game
// actually begins.
export const FLAG_LAUNCH_MS = 1000

// Which band of sums a run draws from, by game time. Hard weights toward the
// harder stages; Easier ignores the schedule entirely (see mathWeights).
const STAGE_SCHEDULE = [
  { start: 0,  end: 12, diff: 'easy'   },
  { start: 12, end: 24, diff: 'medium' },
  { start: 24, end: 36, diff: 'hard'   },
  { start: 36, end: 48, diff: 'medium' },
  { start: 48, end: 60, diff: 'easy'   },
]

export const FLAG_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'flag-easier',
    bars: 1,
    blurb: 'Fewer questions and contacts',
    // Maths questions across the 60s — same timeout as Hard, there are simply
    // fewer of them.
    mathCount: 6,
    // Fixed mix instead of the stage schedule: an easier run never serves a
    // hard sum.
    mathWeights: { easy: 7, medium: 3, hard: 0 },
    // Per-tick odds of a callsign question once the cooldown clears: roughly
    // half as many prompts as Hard.
    acSpawnChance: 0.008,
    // Share of contacts carrying a white ring. Below Hard's 50/50, but high
    // enough that shapes keep arming steadily.
    circleChance: 0.35,
    // Fewer questions and fewer armed shapes mean a lower achievable total, so
    // the grade bands come down with them.
    grades: { outstanding: 300, good: 180, needsWork: 70 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'flag',
    bars: 3,
    blurb: 'Harder than the real thing',
    mathCount: 10,
    mathWeights: null,          // null = weight by the stage schedule
    acSpawnChance: 0.015,
    circleChance: 0.5,
    grades: { outstanding: 400, good: 250, needsWork: 100 },
  },
}

// Ordered for the intro screen: easier sits left of the title, hard sits right.
export const FLAG_DIFFICULTIES = [FLAG_TUNING.easier, FLAG_TUNING.hard]

export function flagTuning(difficulty) {
  return FLAG_TUNING[difficulty] || FLAG_TUNING[DEFAULT_FLAG_DIFFICULTY]
}

export function flagGameKey(difficulty) {
  return flagTuning(difficulty).gameKey
}

function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0)
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let roll = Math.random() * total
  for (const [key, w] of entries) {
    roll -= w
    if (roll <= 0) return key
  }
  return entries[entries.length - 1][0]
}

export function pickMathDifficulty(gameTime, tuning) {
  if (tuning.mathWeights) return weightedPick(tuning.mathWeights)

  // Weight toward harder stages
  const stage = STAGE_SCHEDULE.find(s => gameTime >= s.start && gameTime < s.end)
    || STAGE_SCHEDULE[STAGE_SCHEDULE.length - 1]
  const roll = Math.random()
  if (stage.diff === 'hard') {
    if (roll < 0.55) return 'hard'
    if (roll < 0.8)  return 'medium'
    return 'easy'
  }
  if (stage.diff === 'medium') {
    if (roll < 0.5) return 'medium'
    if (roll < 0.75) return 'easy'
    return 'hard'
  }
  if (roll < 0.5) return 'easy'
  if (roll < 0.8) return 'medium'
  return 'hard'
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

export function readStoredFlagDifficulty() {
  try {
    const raw = localStorage.getItem(CBAT_FLAG_DIFFICULTY_KEY)
    if (raw && FLAG_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_FLAG_DIFFICULTY
}

export function storeFlagDifficulty(difficulty) {
  try { localStorage.setItem(CBAT_FLAG_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
