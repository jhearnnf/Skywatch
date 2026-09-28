// A made-up finished Mock Assessment for the admin tools' "Simulated pass / fail page" buttons, so an
// admin can see exactly what a player lands on at the end without sitting one.
//
// Random region, random role in it, random scores — but every score is a real game score fed
// through the real sheet (buildMockSheet), so the page shows what that scorer would say. Scores are
// drawn stanine-first and turned back into game scores with scoreForStanine, then re-drawn until the
// sheet gives the verdict asked for. Nothing is saved.

const { BATTERIES, REGIONS } = require('../constants/cbatBatteries');
const { buildMockPlan } = require('./cbatMockPlan');
const { buildMockSheet, serialiseMock } = require('./cbatMock');
const { scoreForStanine } = require('./cbatStanine');

const MAX_TRIES = 300;

const pickOne = (list, rng) => list[Math.floor(rng() * list.length)];
const between = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));

// A game score that reads back as `stanine`. scoreForStanine has nothing to aim at for 1, so a 1 is
// a 2's score less a clear margin.
function scoreFor(gameKey, stanine) {
  if (stanine > 1) return scoreForStanine(gameKey, stanine);
  const two = scoreForStanine(gameKey, 2);
  const three = scoreForStanine(gameKey, 3);
  return two == null || three == null ? null : two - (three - two);
}

// Stanines for each game. A pass leans high. A fail is either a low sitting overall or a good one
// with one weak game, which is how the minimum-stanine fail (the confusing one) usually shows up.
function drawStanines(gameKeys, want, rng) {
  if (want === 'pass') return gameKeys.map(() => between(4, 9, rng));
  if (rng() < 0.5) return gameKeys.map(() => between(1, 6, rng));
  const weak = Math.floor(rng() * gameKeys.length);
  return gameKeys.map((_, i) => (i === weak ? between(1, 2, rng) : between(5, 9, rng)));
}

function simulateMock({ want = 'pass', userId, rng = Math.random, now = new Date() } = {}) {
  const regions = Object.keys(REGIONS).filter(r => BATTERIES.some(b => b.region === r));

  for (let i = 0; i < MAX_TRIES; i++) {
    const region = pickOne(regions, rng);
    const battery = pickOne(BATTERIES.filter(b => b.region === region), rng);
    const plan = buildMockPlan({ batteryKey: battery.key, rng });
    if (!plan) continue;

    const gameKeys = plan.steps.flatMap(s => s.gameKeys);
    const stanines = drawStanines(gameKeys, want, rng);
    const scores = new Map(gameKeys.map((g, j) => [g, scoreFor(g, stanines[j])]));

    const minutesIn = plan.totalMinutes;
    const startedAt = new Date(now.getTime() - minutesIn * 60 * 1000);
    const mock = {
      _id: 'simulated',
      userId,
      region: plan.region,
      scope: 'role',
      batteryKey: battery.key,
      steps: plan.steps.map(s => ({
        ...s,
        done: true,
        results: s.gameKeys.map(g => ({ gameKey: g, resultId: null, score: scores.get(g), playedAt: now })),
      })),
      breakAfter: plan.breakAfter,
      currentStep: plan.steps.length,
      breakStartedAt: null,
      status: 'completed',
      startedAt,
      lastActivityAt: now,
      endedAt: now,
    };

    const status = buildMockSheet(mock).batteries[0]?.status;
    if (status === want) return serialiseMock(mock, { withSheet: true });
  }
  return null;
}

module.exports = { simulateMock };
