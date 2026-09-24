// Single source of truth lives in cbatBatteries.json — shared with the frontend, which imports
// the JSON directly (same arrangement as categories.js / categories.json).
//
// This wrapper adds the lookups the backend reaches for repeatedly, so no route has to re-derive
// them from the arrays.

const data = require('./cbatBatteries.json');

const { maxScore: MAX_SCORE, maxStanine: MAX_STANINE, minCoverageForVerdict: MIN_COVERAGE_FOR_VERDICT,
        domains: DOMAINS, tests: TESTS, stanineAnchors: STANINE_ANCHORS, cohortShift: COHORT_SHIFT,
        regions: REGIONS, derivedBatteries: DERIVED_SPECS } = data;

// The UK roles are transcribed from real sheets; every one of them is region GB.
const UK_BATTERIES = data.batteries.map(b => ({ ...b, region: 'GB' }));
const UK_BY_KEY = Object.fromEntries(UK_BATTERIES.map(b => [b.key, b]));

// A Canadian or Australian role, built from the UK role it borrows (see `_regionsComment` in the
// JSON). Test codes are swapped, then dropped; a domain with nothing left in it would silently
// shift weight onto the others, so that is a data error and throws at load rather than scoring.
function deriveBattery(spec) {
  const base = UK_BY_KEY[spec.basedOn];
  if (!base) throw new Error(`cbatBatteries: ${spec.key} is based on unknown role ${spec.basedOn}`);
  const swap = spec.swap ?? {};
  const drop = new Set(spec.drop ?? []);
  const domains = base.domains.map((d) => {
    const tests = d.tests
      .map(t => ({ ...t, code: swap[t.code] ?? t.code }))
      .filter(t => !drop.has(t.code));
    if (!tests.length) throw new Error(`cbatBatteries: ${spec.key} drops every test in ${d.key}`);
    return { ...d, tests };
  });
  const { swap: _s, drop: _d, ...meta } = spec;
  return { ...meta, cutoff: base.cutoff, note: spec.note ?? null, domains };
}

const BATTERIES = [...UK_BATTERIES, ...DERIVED_SPECS.map(deriveBattery)];
const BATTERY_BY_KEY = Object.fromEntries(BATTERIES.map(b => [b.key, b]));

// GB, CA or AU. Anything else (a country we have no roles for, or no country at all) reads as
// the UK, whose roles are the ones every SkyWatch game was built against.
function normaliseRegion(code) {
  const c = String(code ?? '').toUpperCase();
  return REGIONS[c] ? c : 'GB';
}

// Where the player is, for the report's region box: the region they gave for their test date
// first (they typed it), then where we first saw them. Never stored as its own field; once a role
// is chosen, the role's own region is the answer.
function detectRegion(user) {
  return normaliseRegion(user?.upcomingCbatRegion || user?.firstSeenCountry || user?.geo?.country);
}

// The region a player's report is for: their chosen role's, else the detected one.
function reportRegionFor(user) {
  return BATTERY_BY_KEY[user?.cbatTargetBattery]?.region ?? detectRegion(user);
}

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
  COHORT_SHIFT,
  BATTERIES,
  BATTERY_BY_KEY,
  REGIONS,
  normaliseRegion,
  detectRegion,
  reportRegionFor,
  SCORED_GAME_KEYS,
};
