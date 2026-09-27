// Which tests a Mock Assessment sits, in what order, and where the breaks fall.
//
// Pure: no database, and the shuffle takes an injected rng so a test can pin it. The route calls
// buildMockPlan once when a mock starts and stores the result, so the order and the break points
// never move under a player who refreshes halfway through.

const { TESTS, BATTERIES, BATTERY_BY_KEY, REGIONS, normaliseRegion } = require('../constants/cbatBatteries');
const MOCK = require('../constants/cbatMockAssessment.json');

// The batteries a mock is scored against: the one role, or every role in the region.
function mockBatteries({ batteryKey = null, region = null } = {}) {
  if (batteryKey) {
    const b = BATTERY_BY_KEY[batteryKey];
    return b ? [b] : null;
  }
  const r = normaliseRegion(region);
  return BATTERIES.filter(b => b.region === r);
}

// The steps, unshuffled, in first-seen order through the batteries (so the preview lists them in
// the order the sheet does). One step per distinct set of games: a code with no game is dropped,
// two codes on the same game share a step, and a code with two games is one step played back to
// back.
function mockSteps(batteries) {
  const byGames = new Map();
  for (const b of batteries) {
    for (const d of b.domains) {
      for (const t of d.tests) {
        const games = TESTS[t.code]?.games ?? [];
        if (!games.length) continue;
        const id = games.join('+');
        if (!byGames.has(id)) {
          byGames.set(id, {
            codes: [],
            gameKeys: [...games],
            minutes: games.reduce((a, g) => a + (MOCK.minutes[g] ?? 0), 0),
          });
        }
        const step = byGames.get(id);
        if (!step.codes.includes(t.code)) step.codes.push(t.code);
      }
    }
  }
  return [...byGames.values()];
}

// Codes a battery lists that no SkyWatch game can sit. Shown on the start page so a player knows
// the sheet will leave them out.
function unsatCodes(batteries) {
  const out = new Set();
  for (const b of batteries) for (const d of b.domains) for (const t of d.tests) {
    if (!(TESTS[t.code]?.games ?? []).length) out.add(t.code);
  }
  return [...out];
}

// Break points: a break follows the first step that takes the running total since the last break
// to breakAfterMinutes or more, and never follows the last step (there is nothing after it to
// rest for).
function breakPoints(steps, breakAfterMinutes = MOCK.breakAfterMinutes) {
  const out = [];
  let since = 0;
  steps.forEach((s, i) => {
    since += s.minutes;
    if (since >= breakAfterMinutes && i < steps.length - 1) {
      out.push(i);
      since = 0;
    }
  });
  return out;
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Test minutes plus a full break for every break point.
function totalMinutes(steps, breakAfter) {
  return steps.reduce((a, s) => a + s.minutes, 0) + breakAfter.length * MOCK.breakMinutes;
}

// Everything needed to start a mock, or null for an unknown role. `rng` defaults to Math.random.
function buildMockPlan({ batteryKey = null, region = null, rng = Math.random } = {}) {
  const batteries = mockBatteries({ batteryKey, region });
  if (!batteries || !batteries.length) return null;
  const steps = shuffle(mockSteps(batteries), rng);
  const breakAfter = breakPoints(steps);
  return {
    scope: batteryKey ? 'role' : 'all',
    batteryKey: batteryKey ?? null,
    region: batteryKey ? batteries[0].region : normaliseRegion(region),
    steps,
    breakAfter,
    totalMinutes: totalMinutes(steps, breakAfter),
    unsat: unsatCodes(batteries),
  };
}

module.exports = {
  MOCK,
  REGIONS,
  mockBatteries,
  mockSteps,
  unsatCodes,
  breakPoints,
  totalMinutes,
  buildMockPlan,
};
