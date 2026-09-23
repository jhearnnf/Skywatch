// Vigilance Test difficulty tuning.
//
// Vigilance shipped as one board on purpose: the test measures holding
// attention on a dull task over a fixed stretch, so the usual Easier — shorter,
// lighter — would remove what is being measured. That reasoning still stands,
// and it is why BOTH difficulties here run the same 180 seconds on the same
// 9×9 grid with the same keying. What it did not anticipate is the other
// failure: the board was too forgiving to discriminate at the top. Real runs
// sat within a few percent of the ceiling (median 1035 against a strong 1242),
// and a player reported it as too easy. A test everyone maxes is not
// measuring anything either.
//
// So the split runs the other way from most of the roster. Plain `vigilance`
// is the Easier half — the original key, so every score ever set on it still
// ranks — and Hard is a new board, `vigilance-hard`, from zero. The same
// arrangement as ANT's, for the same reason: the existing key had to keep its
// scores.
//
// Neither board is the original game any more. Each keeps a different half of
// it (2026-09-15):
//
//   • HARD keeps the clock and the points: the full 180 seconds at 10 a star,
//     with stars appearing far more often — routine stars on a 1.5s → 0.75s
//     cadence instead of 2.6s → 1.3s, priority tasks from 15s and every 15s
//     instead of from 24s and every 28s. The board cap goes up with the spawn
//     rate so it never gates the cadence.
//   • EASIER keeps the pace: the original cadence exactly (its minute is the
//     FIRST minute of the original ramp, not a compressed copy of it — see
//     spawnRampMs), but the run is 60 seconds and every clear pays TRIPLE:
//     30 a star, and a priority task 90 plus up to 90 for breaking off at once.
//     A short run at triple points lands in the same region as a full old run
//     (a clean minute is roughly 1,100 against the old strong 1,242), which is
//     why the scores already on the `vigilance` board still rank alongside it.
//
// What is identical on both, deliberately: a star stays where it is until its
// coordinate is keyed correctly (nothing times out or moves), the 8-second
// priority bonus window, and the mis-key penalty.
//
// The two boards do not share a ceiling, so neither carries a maxScore and the
// label on each says which board it is.
//
// Grade bands are a first cut. Hard's are set from the spawn budget (roughly
// 160 routine stars and 11 priority tasks over the run) against a strong
// keying rate of about one star a second; Easier's from a clean minute at
// triple points. Retune them with the demo boards in cbatFakeLeaderboard.js
// once there are real runs.

import {
  VIGILANCE_BASE_LOAD, STAR_POINTS, PRIORITY_BASE_POINTS, PRIORITY_BONUS_POINTS,
} from './vigilanceSim'

// Easier pays this many times the original per clear.
export const EASIER_POINTS_MULTIPLIER = 3

export const DEFAULT_VIGILANCE_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the game
// begins. Matches the other split games' — the sequence should feel the same
// wherever it appears.
export const VIGILANCE_LAUNCH_MS = 1000

export const VIGILANCE_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // The original key, so every existing score still sits on this board.
    gameKey: 'vigilance',
    bars: 1,
    blurb: 'One minute at the original pace, triple points',

    load: {
      ...VIGILANCE_BASE_LOAD,
      durationMs: 60000,
      starPoints: STAR_POINTS * EASIER_POINTS_MULTIPLIER,
      priorityBasePoints: PRIORITY_BASE_POINTS * EASIER_POINTS_MULTIPLIER,
      priorityBonusPoints: PRIORITY_BONUS_POINTS * EASIER_POINTS_MULTIPLIER,
    },

    // A clean minute is ~27 routine stars (810) plus two priority tasks.
    grades: { outstanding: 750, good: 500, needsWork: 250 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'vigilance-hard',
    bars: 3,
    blurb: 'Three minutes, stars appear much more often',

    load: {
      ...VIGILANCE_BASE_LOAD,
      spawnStartMs: 1500,
      spawnEndMs: 750,
      maxStars: 24,
      priorityFirstMs: 15000,
      priorityIntervalMs: 15000,
    },

    grades: { outstanding: 1300, good: 900, needsWork: 500 },
  },
}

// ── Practise drill ─────────────────────────────────────────────────────────────
// Not a difficulty — a separate exercise on its own board, the way ANT's
// Practise is, so it carries a badge and never bars. The corpus is blunt that
// "the bottleneck is the keying, not the finding", and this is the keying on
// its own: one minute on a grid that is already mostly full and refills
// almost as fast as it is cleared, so there is never a star to hunt for. No
// priority tasks — breaking off is a different skill from keying fast.
//
// The mis-key penalty is raised here, and it has to be. With ~70% of cells
// starred, the standard 5 makes a random coordinate worth +6 on average, so
// hammering the pad would out-score reading the board. At 50 a random guess
// loses points (0.69 × 10 − 0.31 × 50 ≈ −8.6), so the fastest way up the
// board is still keying what you see.
export const VIGILANCE_PRACTISE_STARS = 56
export const VIGILANCE_PRACTISE_MISKEY_PENALTY = 50

export const VIGILANCE_PRACTISE = {
  key: 'practise',
  label: 'Practise',
  badge: 'Drill',
  gameKey: 'vigilance-practise',
  blurb: 'One minute on a flooded grid, just keying',

  load: {
    ...VIGILANCE_BASE_LOAD,
    durationMs: 60000,
    initialStars: VIGILANCE_PRACTISE_STARS,
    maxStars: VIGILANCE_PRACTISE_STARS,
    spawnStartMs: 250,
    spawnEndMs: 250,
    priorityFirstMs: Infinity,
    miskeyPenalty: VIGILANCE_PRACTISE_MISKEY_PENALTY,
  },

  // A good player scores around 400 in the minute.
  grades: { outstanding: 400, good: 280, needsWork: 150 },
}

VIGILANCE_TUNING.practise = VIGILANCE_PRACTISE

// Ordered for the mode row: Easier left, Hard right.
export const VIGILANCE_DIFFICULTIES = [VIGILANCE_TUNING.easier, VIGILANCE_TUNING.hard]

// Everything the row offers: the pair, then the drill. The drill has its own
// admin toggle (it is its own board), so a disabled drill drops out of the row.
export const VIGILANCE_MODES = [...VIGILANCE_DIFFICULTIES, VIGILANCE_PRACTISE]

export function vigilanceModes(drillEnabled = true) {
  return drillEnabled ? VIGILANCE_MODES : VIGILANCE_DIFFICULTIES
}

export function vigilanceTuning(difficulty) {
  return VIGILANCE_TUNING[difficulty] || VIGILANCE_TUNING[DEFAULT_VIGILANCE_DIFFICULTY]
}

export function vigilanceGameKey(difficulty) {
  return vigilanceTuning(difficulty).gameKey
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

const VIGILANCE_DIFFICULTY_KEY = 'sw_cbat_vigilance_difficulty'

export function readStoredVigilanceDifficulty() {
  try {
    const raw = localStorage.getItem(VIGILANCE_DIFFICULTY_KEY)
    if (raw && VIGILANCE_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_VIGILANCE_DIFFICULTY
}

export function storeVigilanceDifficulty(difficulty) {
  try { localStorage.setItem(VIGILANCE_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
