const { CBAT_GAMES } = require('../constants/cbatGames');

// Deterministic, believable filler for CBAT leaderboards so new users never
// see a sparse or empty board. Fakes can outrank real entries — after padding,
// the merged list is resorted by score-priority-then-time, so each row's
// position reflects its actual score.

// Pool of 7-digit agent numbers matching the shape of real ones (see User model).
// Each game picks a different offset so the roster varies per board.
const FAKE_AGENTS = [
  '2847193', '5102338', '4061729', '3384501', '6728014',
  '1904872', '7532091', '2360458', '4917263', '5845120',
  '3079614', '6451802', '2183947', '5692035', '4738621',
  '3917205', '2504816', '6183470', '4260917', '5371829',
  '3648102', '2971305', '5814026', '4503718', '6247193',
];

const GAME_OFFSET = {
  'plane-turn:2d':   0,
  'plane-turn:3d':   1,
  'angles':          4,
  'code-duplicates': 8,
  'symbols':        12,
  'target':         16,
  'instruments':    20,
  'ant':             2,
  'flag':            6,
  'visualisation-2d': 10,
};

// Per-game score/time tuning. Every fake score stays inside [floor, ceiling]:
//   - floor > 0 (no demo shows a zero)
//   - ceiling < game max (no demo hits the perfect score)
// seedScore is the best-ranked fake when the pool is empty; the generator
// walks from there toward the worse end using SCORE_STEPS / TIME_STEPS.
// scoreSequence (optional) overrides the step generator when a game's real
// scores can only take specific values (e.g. ANT awards 0/5/10 per round,
// so totals are always multiples of 5).
// seedTime is the fastest fake's totalTime; timeStep scales the between-row
// deltas. Both reflect what a real completion actually looks like for each
// game (e.g. code-duplicates is 15 rounds × ~5s display + answer ≈ 100–200s,
// instruments is capped at a 90-second timer, ANT runs 8×60s rounds ≈ 180–450s).
const FAKE_TUNING = {
  'plane-turn:2d': {
    floor: 42, ceiling: 107, seedTime: 80, timeStep: 3,
    scoreSequence: [42, 45, 48, 52, 55, 58, 62, 65, 68, 72, 75, 78, 82, 85, 88, 92, 95, 98, 102, 107],
  },
  'plane-turn:3d': {
    floor: 65, ceiling: 140, seedTime: 110, timeStep: 4,
    scoreSequence: [65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 124, 128, 132, 135, 138, 140, 140, 140],
  },
  'angles':          { floor: 1,  ceiling: 19,  seedScore: 18,  seedTime: 38, scoreStep: 1,  timeStep: 2.5 },
  'code-duplicates': {
    floor: 7, ceiling: 14, seedTime: 88, timeStep: 3,
    // 20 values, monotonically non-increasing, max 13, min 7 (out of 15).
    // Times run 88s → 163s — bracketing realistic user runs (15 rounds ×
    // 5s display + answer time ≈ 85s fast / 160s slow).
    scoreSequence: [13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8, 8, 7, 7, 7],
  },
  'symbols':         { floor: 1,  ceiling: 14,  seedScore: 13,  seedTime: 30, scoreStep: 1,  timeStep: 2   },
  'target': {
    floor: 15, ceiling: 580, seedTime: 95, timeStep: 6,
    // Top fakes sit in the 300–600 "decent to impressive" band (Outstanding
    // threshold is 400); the rest trail off through Good / Needs Work / Failed.
    scoreSequence: [580, 520, 470, 420, 380, 340, 300, 260, 220, 180, 140, 110, 85, 65, 50, 40, 32, 25, 20, 15],
  },
  'instruments': {
    // Always runs to the 90s time limit, so fake times barely vary.
    floor: 1, ceiling: 10, seedTime: 87, timeStep: 0.1,
    // Top fake sits at the low end of "Good" (≥10); most of the roster is
    // "Needs Work" (5–9) or "Failed" (<5). Grade bands: 15+ / 10+ / 5+.
    scoreSequence: [10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1],
  },
  'ant': {
    floor: 15, ceiling: 75, seedTime: 210, timeStep: 9,
    // 20 multiples-of-5 values, monotonically non-increasing, max 70, min 15.
    // Every ANT total is a multiple of 5 (10 exact / 5 partial / 0 miss × 8 rounds).
    scoreSequence: [70, 65, 60, 55, 50, 50, 45, 45, 40, 40, 35, 35, 30, 30, 25, 25, 20, 20, 15, 15],
  },
  'visualisation-2d': { floor: 1, ceiling: 7, seedScore: 7, seedTime: 70, scoreStep: 1, timeStep: 4 },
  'flag': {
    floor: 55, ceiling: 104, seedTime: 60, timeStep: 0,
    // 20 values, monotonically non-increasing, max 104, min 55. Higher is
    // better. FLAG is a fixed-60s game so all real totalTimes equal 60 too —
    // fakes match (timeStep: 0) so tie-breaker order stays stable.
    // Floor of 55 keeps the visible top-20 above 55 even when sub-floor real
    // entries exist (paired with FULL_SEQUENCE_GAMES below).
    scoreSequence: [104, 100, 97, 94, 91, 88, 85, 82, 79, 76, 73, 70, 67, 64, 62, 60, 58, 57, 56, 55],
  },
};

// Fixed delta tables — natural-looking variance without randomness.
const SCORE_STEPS = [1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1];
const TIME_STEPS  = [1, 1, 2, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1];

function generateFakes(gameKey, count, { lowerBetter, tuning, isAdmin, tuningKey }) {
  const offset = GAME_OFFSET[tuningKey ?? gameKey] ?? GAME_OFFSET[gameKey] ?? 0;
  const fakes = [];
  let runScore = tuning.seedScore;
  let runTime = tuning.seedTime;
  for (let i = 0; i < count; i++) {
    // If the game defines an explicit score sequence (e.g. ANT's multiples
    // of 5), use it directly. Otherwise walk from seedScore with deltas.
    if (tuning.scoreSequence) {
      runScore = tuning.scoreSequence[i % tuning.scoreSequence.length];
    } else if (i > 0) {
      const scoreDelta = SCORE_STEPS[i % SCORE_STEPS.length] * tuning.scoreStep;
      runScore = lowerBetter
        ? Math.min(runScore + scoreDelta, tuning.ceiling)
        : Math.max(runScore - scoreDelta, tuning.floor);
    }
    if (i > 0) {
      const timeDelta = TIME_STEPS[i % TIME_STEPS.length] * tuning.timeStep;
      runTime += timeDelta;
    }
    const entry = {
      _id: `fake-${tuningKey ?? gameKey}-${i}`,
      userId: `fake-user-${tuningKey ?? gameKey}-${i}`,
      agentNumber: FAKE_AGENTS[(offset + i) % FAKE_AGENTS.length],
      bestScore: runScore,
      bestTime: Number(runTime.toFixed(1)),
      isFake: true,
    };
    if (isAdmin) entry.email = 'demo';
    fakes.push(entry);
  }
  return fakes;
}

// ANT, code-duplicates, and flag: always generate the full demo sequence so
// the visible top 20 keeps a per-game min-score floor (15 for ANT, 7 for
// code-duplicates, 55 for flag) even when real entries with sub-floor
// scores exist — including when the real pool is already at/above the
// 20-row limit. Other games keep gap-fill padding (limit - real.length)
// and short-circuit when real already fills the board.
const FULL_SEQUENCE_GAMES = new Set(['ant', 'code-duplicates', 'flag']);

function padLeaderboard(real, gameKey, { limit = 20, isAdmin = false, mode = null } = {}) {
  const cfg = CBAT_GAMES[gameKey];
  const tuningKey = mode ? (`${gameKey}:${mode}` in FAKE_TUNING ? `${gameKey}:${mode}` : gameKey) : gameKey;
  const tuning = FAKE_TUNING[tuningKey];

  // No tuning for this game → just rank real entries as-is.
  if (!cfg || !tuning) {
    real.forEach((e, i) => { e.rank = i + 1; });
    return real;
  }

  const isFullSequence = FULL_SEQUENCE_GAMES.has(gameKey);

  // Non-full-sequence games short-circuit when real already fills the board.
  // Full-sequence games always run the merge so the floor displaces sub-floor
  // real entries even when there are 20+ of them.
  if (!isFullSequence && real.length >= limit) {
    real.forEach((e, i) => { e.rank = i + 1; });
    return real;
  }

  const lowerBetter = cfg.sortDir === 1;
  const needed = isFullSequence ? tuning.scoreSequence.length : (limit - real.length);
  const fakes = generateFakes(gameKey, needed, { lowerBetter, tuning, isAdmin, tuningKey });

  // Merge real + fakes, then sort by points-priority, time-on-ties.
  const merged = [...real, ...fakes].sort((a, b) => {
    if (a.bestScore !== b.bestScore) {
      return lowerBetter ? a.bestScore - b.bestScore : b.bestScore - a.bestScore;
    }
    return a.bestTime - b.bestTime;
  });

  const trimmed = merged.slice(0, limit);
  trimmed.forEach((e, i) => { e.rank = i + 1; });
  return trimmed;
}

module.exports = { padLeaderboard, FAKE_AGENTS, FAKE_TUNING };
