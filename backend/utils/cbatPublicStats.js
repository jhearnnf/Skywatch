// Anonymous practice totals for the public CBAT test pages (/cbat-tests/<slug>).
//
// Two numbers per test, and nothing else, by design:
//   runs         - how many results have been saved across the test's boards
//   improvedPct  - of players with 10+ runs on a board, the share whose runs
//                  8-10 beat their first three
//
// The improvement figure is a SHARE of players, never a score. Publishing
// scores would tell anyone how our scoring is spread, which is the kind of
// detail a competitor could copy; a share says only "practice helps".
//
// Privacy (memory: public data minimisation): no ids, names, timestamps or
// per-user values leave this module. Small numbers are suppressed rather than
// rounded, because a cohort of three is close to identifying people. Admin and
// bot accounts are left out so testing and seeded play do not count.
//
// Read once per build (scripts/build-cbat-test-pages.mjs), so a 6-hour cache
// is plenty and keeps a hammered public endpoint from re-aggregating.
const User = require('../models/User');
const { CBAT_GAMES } = require('../constants/cbatGames');
const registry = require('../constants/cbatTestPages.json');

const IMPROVE_MIN_RUNS = 10;   // runs on one board before a player counts
const EARLY_RUNS = 3;          // runs 1-3
const LATE_FROM = 7;           // runs 8-10 (0-based slice start)
const LATE_RUNS = 3;
const MIN_RUNS_SHOWN = 200;    // fewer than this and `runs` is withheld
const MIN_COHORT = 20;         // fewer qualifying players and `improvedPct` is withheld
const CACHE_MS = 6 * 60 * 60 * 1000;

let cache = null;

async function excludedUserIds() {
  const rows = await User.find({ $or: [{ isAdmin: true }, { isBot: true }] }, { _id: 1 }).lean();
  return rows.map(r => r._id);
}

/** Per board: total runs, and how many qualifying players improved. */
async function boardStats(cfg, excluded) {
  const match = { ...(cfg.modeFilter ?? {}), userId: { $nin: excluded } };
  const runs = await cfg.Model.countDocuments(match);

  const rows = await cfg.Model.aggregate([
    { $match: match },
    // Oldest first, so the pushed array is each player's runs in order.
    { $sort: { userId: 1, createdAt: 1 } },
    { $group: { _id: '$userId', scores: { $push: `$${cfg.primaryField}` } } },
    { $match: { [`scores.${IMPROVE_MIN_RUNS - 1}`]: { $exists: true } } },
    { $project: {
      _id: 0,
      early: { $avg: { $slice: ['$scores', EARLY_RUNS] } },
      late:  { $avg: { $slice: ['$scores', LATE_FROM, LATE_RUNS] } },
    } },
  ]);

  // sortDir 1 means lower is better (Trace counts rotations), as everywhere else.
  const better = cfg.sortDir === 1 ? (r => r.late < r.early) : (r => r.late > r.early);
  const valid = rows.filter(r => Number.isFinite(r.early) && Number.isFinite(r.late));
  return { runs, cohort: valid.length, improved: valid.filter(better).length };
}

/** Pools a test's boards and applies the suppression floors. Exported for tests. */
function summarise(boards) {
  const runs = boards.reduce((a, b) => a + b.runs, 0);
  const cohort = boards.reduce((a, b) => a + b.cohort, 0);
  const improved = boards.reduce((a, b) => a + b.improved, 0);
  return {
    runs: runs >= MIN_RUNS_SHOWN ? runs : null,
    improvedPct: cohort >= MIN_COHORT ? Math.round((improved / cohort) * 100) : null,
    cohort: cohort >= MIN_COHORT ? cohort : null,
  };
}

async function buildCbatPublicStats() {
  const excluded = await excludedUserIds();
  const tests = {};
  for (const entry of registry.tests) {
    const boards = [];
    for (const key of entry.gameKeys) {
      const cfg = CBAT_GAMES[key];
      if (cfg) boards.push(await boardStats(cfg, excluded));
    }
    tests[entry.guideId] = summarise(boards);
  }
  return { tests };
}

async function getCbatPublicStats({ now = Date.now() } = {}) {
  if (cache && now - cache.at < CACHE_MS) return cache.data;
  const data = await buildCbatPublicStats();
  cache = { at: now, data };
  return data;
}

function resetCbatPublicStatsCache() { cache = null; }

module.exports = {
  getCbatPublicStats, buildCbatPublicStats, summarise, resetCbatPublicStatsCache,
  MIN_RUNS_SHOWN, MIN_COHORT, IMPROVE_MIN_RUNS,
};
