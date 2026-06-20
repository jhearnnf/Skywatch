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
  'plane-turn-2d':   0,
  'plane-turn-3d':   1,
  'angles':          4,
  'code-duplicates': 8,
  'symbols':        12,
  'target':         16,
  'instruments':    20,
  'ant':             2,
  'flag':            6,
  'visualisation-2d': 10,
  'visualisation-3d': 11,
  'dpt':             14,
  'trace-1':         13,
  'numerical-ops':   15,
  'act':             18,
  'dad':             22,
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
//
// Both seedTime and timeStep are kept non-integer so the rounded 1-decimal
// display (`bestTime.toFixed(1)`) varies row-to-row (e.g. 80.4 / 83.7 / 87.0…)
// instead of every demo row showing a .0 second tie. Exception: `flag` is a
// fixed-60s game where every real run also displays 60.0, so its fakes match.
const FAKE_TUNING = {
  'plane-turn-2d': {
    floor: 42, ceiling: 107, seedTime: 80.4, timeStep: 3.3,
    scoreSequence: [42, 45, 48, 52, 55, 58, 62, 65, 68, 72, 75, 78, 82, 85, 88, 92, 95, 98, 102, 107],
  },
  'plane-turn-3d': {
    // 3D adds vertical navigation, climbs/dives, and quaternion rotations —
    // real best runs land closer to ~180 rotations, not the ~65 the early
    // tuning assumed. Top demo of 180 keeps the board feeling competitive
    // without giving users a trivially-beatable target.
    floor: 180, ceiling: 265, seedTime: 220.7, timeStep: 4.7,
    scoreSequence: [180, 185, 190, 195, 200, 205, 210, 215, 220, 225, 230, 235, 240, 244, 248, 252, 256, 260, 263, 265],
  },
  'angles':          { floor: 1,  ceiling: 19,  seedScore: 18,  seedTime: 38.4, scoreStep: 1,  timeStep: 2.5 },
  'code-duplicates': {
    floor: 7, ceiling: 14, seedTime: 88.7, timeStep: 3.4,
    // 20 values, monotonically non-increasing, max 13, min 7 (out of 15).
    // Times run ~88s → ~165s — bracketing realistic user runs (15 rounds ×
    // 5s display + answer time ≈ 85s fast / 160s slow).
    scoreSequence: [13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8, 8, 7, 7, 7],
  },
  'symbols':         { floor: 1,  ceiling: 14,  seedScore: 13,  seedTime: 30.6, scoreStep: 1,  timeStep: 2.3 },
  'target': {
    floor: 15, ceiling: 580, seedTime: 95.4, timeStep: 6.3,
    // Top fakes sit in the 300–600 "decent to impressive" band (Outstanding
    // threshold is 400); the rest trail off through Good / Needs Work / Failed.
    scoreSequence: [580, 520, 470, 420, 380, 340, 300, 260, 220, 180, 140, 110, 85, 65, 50, 40, 32, 25, 20, 15],
  },
  'instruments': {
    // Always runs to the 90s time limit, so fake times barely vary.
    floor: 1, ceiling: 10, seedTime: 87.4, timeStep: 0.1,
    // Top fake sits at the low end of "Good" (≥10); most of the roster is
    // "Needs Work" (5–9) or "Failed" (<5). Grade bands: 15+ / 10+ / 5+.
    scoreSequence: [10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1],
  },
  'ant': {
    floor: 15, ceiling: 75, seedTime: 210.6, timeStep: 9.3,
    // 20 multiples-of-5 values, monotonically non-increasing, max 70, min 15.
    // Every ANT total is a multiple of 5 (10 exact / 5 partial / 0 miss × 8 rounds).
    scoreSequence: [70, 65, 60, 55, 50, 50, 45, 45, 40, 40, 35, 35, 30, 30, 25, 25, 20, 20, 15, 15],
  },
  'visualisation-2d': { floor: 1, ceiling: 7, seedScore: 7, seedTime: 70.5, scoreStep: 1, timeStep: 4.3 },
  'visualisation-3d': {
    // 8 rounds of 3D shape-matching, one correct answer per round (max 8).
    // 3D is harder than 2D so the top demo sits at 7, not 8, and runs a touch
    // longer (30s/round timer × 8 = ~240s baseline + feedback → ~250–320s).
    // Explicit sequence (not the stepped generator) so the narrow 2–7 band
    // still spans 6 distinct values.
    floor: 2, ceiling: 8, seedTime: 248.5, timeStep: 2.8,
    scoreSequence: [7, 7, 7, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2],
  },
  'flag': {
    floor: 55, ceiling: 104, seedTime: 60, timeStep: 0,
    // 20 values, monotonically non-increasing, max 104, min 55. Higher is
    // better. FLAG is a fixed-60s game so all real totalTimes equal 60 too —
    // fakes match (timeStep: 0, integer seedTime) so tie-breaker order stays
    // stable AND fake rows display the same 60.0 every real row does. This is
    // the one tuning intentionally exempt from the "non-integer" rule above.
    // Floor of 55 keeps the visible top-20 above 55 even when sub-floor real
    // entries exist (paired with FULL_SEQUENCE_GAMES below).
    scoreSequence: [104, 100, 97, 94, 91, 88, 85, 82, 79, 76, 73, 70, 67, 64, 62, 60, 58, 57, 56, 55],
  },
  'act': {
    // 5 rounds × ~45s = ~225s totalTime. Score is a sum of correct rings (+20),
    // wrong rings/missed instructions (-15/-10), wall scrape (-5/sec), and
    // graded bleep hits/misses (+25/+20/+10/-10). A capable run lands in the
    // 250–420 band; the top fake at 460 is competitive but not unbeatable.
    floor: 60, ceiling: 460, seedTime: 226.4, timeStep: 4.3,
    scoreSequence: [460, 420, 380, 350, 320, 295, 270, 245, 220, 195, 175, 155, 135, 120, 105, 95, 85, 75, 68, 60],
  },
  'dpt': {
    // totalScore accumulates across 8 rounds: +100/gate, +250/intercept,
    // +50×round completion bonus, minus danger-zone (-10/s) and bad-hit (-150)
    // penalties — a perfect no-penalty run tops out near ~5,750. Top demo of
    // 4,820 is a strong-but-beatable run; the rest trail toward ~1,100. Scores
    // land on multiples of 10 (the danger-zone penalty is per-second), so the
    // sequence keeps that granularity. Runs are long (~900–1,200s / 15–20 min).
    floor: 1100, ceiling: 5750, seedTime: 915.4, timeStep: 11.3,
    scoreSequence: [4820, 4560, 4300, 4050, 3800, 3540, 3290, 3030, 2780, 2530, 2280, 2030, 1860, 1700, 1560, 1440, 1340, 1250, 1170, 1100],
  },
  'trace-1': {
    // correctTurns out of 40 (5 rounds × 8 turns), higher is better. Top demo
    // of 37 stays just under the 40 ceiling; the roster trails to 12. Rounds
    // speed up each pass (turn intervals 1.87s → 0.93s), so a full run is
    // short — ~60–120s.
    floor: 12, ceiling: 40, seedTime: 64.7, timeStep: 2.1,
    scoreSequence: [37, 36, 35, 34, 33, 31, 30, 29, 27, 26, 24, 23, 21, 20, 18, 17, 16, 15, 14, 12],
  },
  'numerical-ops': {
    // correctPercentage = round(correctCount / 20 × 100), so every real value
    // is a multiple of 5. Top demo of 95% stays under a perfect 100%; the
    // roster trails to 35%. 20 questions × 20s timer + feedback → ~300–420s.
    floor: 35, ceiling: 100, seedTime: 312.4, timeStep: 4.3,
    scoreSequence: [95, 90, 90, 85, 85, 80, 75, 75, 70, 65, 65, 60, 55, 55, 50, 50, 45, 40, 40, 35],
  },
  'dad': {
    // correctCount out of 15 (Directions and Distances), higher is better. Top
    // demo of 14 stays under a perfect 15; the roster trails to 4. No hard
    // timer — 15 reading-comprehension questions run ~120–300s.
    floor: 4, ceiling: 15, seedTime: 128.6, timeStep: 6.3,
    scoreSequence: [14, 13, 13, 12, 12, 11, 11, 11, 10, 10, 9, 9, 9, 8, 8, 7, 7, 6, 5, 4],
  },
  'sat': {
    // correctCount out of 18 (Situational Awareness Test), higher is better. Top
    // demo of 17 stays under a perfect 18; the roster trails to 5. Three
    // observe+recall situations (~18s observe + 6 questions each) → ~180–260s.
    floor: 5, ceiling: 18, seedTime: 204.6, timeStep: 5.4,
    scoreSequence: [17, 16, 16, 15, 15, 14, 14, 13, 12, 12, 11, 11, 10, 9, 9, 8, 8, 7, 6, 5],
  },
};

// Fixed delta tables — natural-looking variance without randomness.
const SCORE_STEPS = [1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1];
const TIME_STEPS  = [1, 1, 2, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1];

function generateFakes(gameKey, count, { lowerBetter, tuning, isAdmin }) {
  const offset = GAME_OFFSET[gameKey] ?? 0;
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
      _id: `fake-${gameKey}-${i}`,
      userId: `fake-user-${gameKey}-${i}`,
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

function padLeaderboard(real, gameKey, { limit = 20, isAdmin = false } = {}) {
  const cfg = CBAT_GAMES[gameKey];
  const tuning = FAKE_TUNING[gameKey];

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
  const fakes = generateFakes(gameKey, needed, { lowerBetter, tuning, isAdmin });

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

// ── Weekly leaderboard demo padding ──────────────────────────────────────────
// The weekly board sums points earned since Monday, so demo rows must look like
// a few real players who've each played only a couple of games this week —
// modest weekTotals built from a low play count, NOT single big all-time scores.
//
// WEEKLY_PER_PLAY is a typical "decent single run" value per game, in the same
// space as that game's weekly total: primaryField points for higher-is-better
// games, and derived weeklyExpr points for the lower-is-better trace games.
// EVERY leaderboard game has an entry so no weekly board is ever left with just
// 0–1 real players — sparse weeks always get a few demo rows (unlike the
// all-time board, which leaves some games real-only). Values sit a little below
// the real median single run (queried from production) so engaged real players
// can still outrank the demos.
const WEEKLY_PER_PLAY = {
  'plane-turn-2d':   150,  // derived points space (≈ real median run, see cfg.weeklyExpr)
  'plane-turn-3d':   165,
  'angles':           14,  // real med 16
  'code-duplicates':  11,  // real med 12
  'symbols':          13,  // real med 15
  'target':          520,  // real med 602
  'instruments':       4,  // real med 3
  'ant':              45,  // real med 50
  'visualisation-2d':  4,  // real med 3
  'visualisation-3d':  4,  // real med 4
  'flag':            220,  // real med 246
  'dpt':            3400,  // real med 3850
  'act':            1300,  // real med 1482
  'trace-1':          26,  // real med 29 (correctTurns /40)
  'numerical-ops':    80,  // real med 90 (correctPercentage)
  'dad':               9,  // correctCount /15 — a little below a decent single run
  'sat':              11,  // correctCount /18 — a little below a decent single run
};

// Six deterministic demo players: a couple of active ones, the rest light.
// plays + factor are paired by index; factor varies the per-play average so
// totals aren't exact multiples and the ordering looks organic.
const WEEKLY_PLAYS   = [3, 2, 2, 1, 3, 1];
const WEEKLY_FACTORS = [1.18, 1.05, 0.96, 0.88, 0.78, 0.70];

// Below this many real weekly entries the board counts as "sparse" and gets
// topped up with demo rows; at or above it the week is busy enough to stand on
// its own (and we don't risk demo rows displacing real players).
const WEEKLY_SPARSE_THRESHOLD = 8;

function generateWeeklyFakes(gameKey, perPlay, isAdmin) {
  const offset = GAME_OFFSET[gameKey] ?? 0;
  const fakes = [];
  for (let i = 0; i < WEEKLY_PLAYS.length; i++) {
    const plays = WEEKLY_PLAYS[i];
    const entry = {
      _id: `fake-weekly-${gameKey}-${i}`,
      userId: `fake-weekly-user-${gameKey}-${i}`,
      agentNumber: FAKE_AGENTS[(offset + i) % FAKE_AGENTS.length],
      weekTotal: Math.round(perPlay * plays * WEEKLY_FACTORS[i]),
      plays,
      isFake: true,
    };
    if (isAdmin) entry.email = 'demo';
    fakes.push(entry);
  }
  return fakes;
}

// Pad a weekly leaderboard (already sorted weekTotal-desc) with demo rows when
// the week is sparse, then resort and assign ranks. Demo rows can interleave
// with — or, for very low-activity real entries, outrank — real ones, exactly
// like the all-time padder.
function padWeeklyLeaderboard(real, gameKey, { limit = 20, isAdmin = false } = {}) {
  const perPlay = WEEKLY_PER_PLAY[gameKey];

  // No demo tuning, board already full, or week busy enough → real only.
  if (perPlay == null || real.length >= limit || real.length >= WEEKLY_SPARSE_THRESHOLD) {
    real.forEach((e, i) => { e.rank = i + 1; });
    return real;
  }

  const fakes = generateWeeklyFakes(gameKey, perPlay, isAdmin);
  const merged = [...real, ...fakes].sort((a, b) => {
    if (a.weekTotal !== b.weekTotal) return b.weekTotal - a.weekTotal;
    return (b.plays || 0) - (a.plays || 0);
  });
  const trimmed = merged.slice(0, limit);
  trimmed.forEach((e, i) => { e.rank = i + 1; });
  return trimmed;
}

module.exports = { padLeaderboard, padWeeklyLeaderboard, FAKE_AGENTS, FAKE_TUNING, WEEKLY_PER_PLAY };
