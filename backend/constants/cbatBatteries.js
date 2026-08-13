// Single source of truth lives in cbatBatteries.json — shared with the frontend, which imports
// the JSON directly (same arrangement as categories.js / categories.json).
//
// This wrapper adds the lookups the backend reaches for repeatedly, so no route has to re-derive
// them from the arrays.

const data = require('./cbatBatteries.json');

const { maxScore: MAX_SCORE, maxStanine: MAX_STANINE, minCoverageForVerdict: MIN_COVERAGE_FOR_VERDICT,
        domains: DOMAINS, tests: TESTS, stanineAnchors: STANINE_ANCHORS, batteries: BATTERIES } = data;

const BATTERY_BY_KEY = Object.fromEntries(BATTERIES.map(b => [b.key, b]));

// Every SkyWatch game key any battery can draw on. Used to bound the "load this user's form"
// query to the games that can actually affect a report, rather than all 25 registry entries.
const SCORED_GAME_KEYS = [...new Set(Object.values(TESTS).flatMap(t => t.games))];

module.exports = {
  MAX_SCORE,
  MAX_STANINE,
  MIN_COVERAGE_FOR_VERDICT,
  DOMAINS,
  TESTS,
  STANINE_ANCHORS,
  BATTERIES,
  BATTERY_BY_KEY,
  SCORED_GAME_KEYS,
};
