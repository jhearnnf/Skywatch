// FLAG difficulty tuning.
//
// 'hard' is the original assessment-pace game — every value here matches what
// FLAG shipped with. 'easier' is the SAME 60-second mission run slowly: maths
// questions arrive less often and stay up far longer, callsigns are readable
// for twice as long, aircraft fly slower, and the field carries fewer contacts
// at once. Per-event scoring is identical; the two difficulties keep entirely
// separate leaderboards, so their totals never have to be comparable.
//
// Everything difficulty-dependent lives in this one table so the game page, the
// play field and the results screen can't drift apart.

import { CBAT_FLAG_DIFFICULTY_KEY } from '../../utils/storageKeys'

export const DEFAULT_FLAG_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the game
// actually begins.
export const FLAG_LAUNCH_MS = 1000

// Spawn pressure across the run, in 12s windows: easy → medium → hard → medium
// → easy. `max` is the soft cap on simultaneous on-screen aircraft, `spawn` the
// average gap between spawn attempts. Scaled per difficulty by the tuning below.
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
    blurb: 'Slower maths, longer callsign reads',
    // Maths: 6 questions instead of 10, roughly twice the time to answer, and
    // twice the breather between them.
    mathCount: 6,
    mathTimeout: 15,
    mathGap: 6,
    // Fixed mix instead of the stage schedule — an easier run never serves a
    // hard sum.
    mathWeights: { easy: 7, medium: 3, hard: 0 },
    // Callsign questions: rarer, and far longer on screen to answer.
    acCooldown: 6,
    acDuration: 9,
    acFirst: 6,
    acSpawnChance: 0.012,
    // Play field: slower traffic, callsigns legible for twice as long, half the
    // contacts, and longer gaps between spawns.
    aircraftSpeed: 12,
    symbolFlashSeconds: 10,
    maxScale: 0.5,
    spawnScale: 1.8,
    // Fewer scoring opportunities in the same 60s, so the grade bands scale
    // down with them.
    grades: { outstanding: 300, good: 180, needsWork: 70 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'flag',
    bars: 3,
    blurb: 'Harder than the real thing',
    mathCount: 10,
    mathTimeout: 8,
    mathGap: 3,
    mathWeights: null,          // null = weight by the stage schedule
    acCooldown: 3,
    acDuration: 4,
    acFirst: 5,
    acSpawnChance: 0.015,
    aircraftSpeed: 20,
    symbolFlashSeconds: 5,
    maxScale: 1,
    spawnScale: 1,
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

// ── Difficulty-aware helpers ─────────────────────────────────────────────────

function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0)
  const total = entries.reduce((s, [, w]) => s + w, 0)
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

// Per-stage spawn pressure, scaled by difficulty. Shared by the play field.
export function stageConfig(gameTime, tuning) {
  let base
  if (gameTime < 12)      base = { max: 4,  spawn: 2.2 }
  else if (gameTime < 24) base = { max: 8,  spawn: 1.3 }
  else if (gameTime < 36) base = { max: 14, spawn: 0.55 }
  else if (gameTime < 48) base = { max: 8,  spawn: 1.3 }
  else                    base = { max: 4,  spawn: 2.2 }
  return {
    max: Math.max(2, Math.round(base.max * tuning.maxScale)),
    spawn: base.spawn * tuning.spawnScale,
  }
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
