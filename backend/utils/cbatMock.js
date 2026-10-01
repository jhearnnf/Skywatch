// Mock Assessment runtime: the idle limit, claiming a finished run for the current step, and the
// score sheet.
//
// A mock never owns a score. Each test is an ordinary Hard run saved through saveCbatResult into
// its own game collection, exactly as if it had been played from the hub. A run carrying a
// `mockId` is then CLAIMED here: if it is the game the mock is waiting on, the step records it
// and the mock moves on. A run that does not fit (wrong game, mock over, not yours) is still
// saved and still counts everywhere; it just does not move the mock.

const mongoose = require('mongoose');
const CbatMockAssessment = require('../models/CbatMockAssessment');
const { CBAT_GAMES } = require('../constants/cbatGames');
const { MAX_SCORE, MAX_STANINE, TESTS, BATTERY_BY_KEY } = require('../constants/cbatBatteries');
const { buildBatteryReport, minRunsFor } = require('./cbatAptitudeReport');
const { MOCK, mockBatteries } = require('./cbatMockPlan');

const IDLE_LIMIT_MS = MOCK.idleLimitMinutes * 60 * 1000;

// Close an active mock that has sat idle past the limit. Returns true when it did. The mock is
// dated as having ended at the moment the limit ran out, not when somebody next looked, so the
// notice can say "closed at 16:10" truthfully.
async function expireIfIdle(mock, now = new Date()) {
  if (!mock || mock.status !== 'active') return false;
  const deadline = new Date(new Date(mock.lastActivityAt).getTime() + IDLE_LIMIT_MS);
  if (now <= deadline) return false;
  mock.status = 'expired';
  mock.endedAt = deadline;
  mock.breakStartedAt = null;
  await mock.save();
  return true;
}

// The user's active mock after the idle check, or null.
async function findActiveMock(userId, now = new Date()) {
  const mock = await CbatMockAssessment.findOne({ userId, status: 'active' }).sort({ startedAt: -1 });
  if (!mock) return null;
  if (await expireIfIdle(mock, now)) return null;
  return mock;
}

// The gameKey a result route is saving, read off the request path (`/cbat/flag/result`). Every
// CBAT result route has that shape, which is why the claim can live in saveCbatResult rather than
// in thirty route handlers.
function gameKeyFromRequest(req) {
  const m = /\/cbat\/([^/]+)\/result$/.exec(req?.path ?? '');
  return m && CBAT_GAMES[m[1]] ? m[1] : null;
}

// Record a saved run against the mock it names, if it is the run the mock is waiting on.
// Idempotent: a retried submission that resolves to the same result row is a no-op. Never throws
// into the caller — a problem here must not fail a score submission.
async function claimMockResult({ userId, mockId, gameKey, result, now = new Date() }) {
  try {
    if (!mockId || !gameKey || !result || !mongoose.isValidObjectId(mockId)) return null;
    const mock = await CbatMockAssessment.findOne({ _id: mockId, userId });
    if (!mock || mock.status !== 'active') return null;
    if (await expireIfIdle(mock, now)) return null;

    const step = mock.steps[mock.currentStep];
    if (!step || !step.gameKeys.includes(gameKey)) return null;
    if (step.results.some(r => r.gameKey === gameKey)) return mock;

    const primary = CBAT_GAMES[gameKey]?.primaryField;
    const score = Number(result[primary]);
    step.results.push({
      gameKey,
      resultId: result._id,
      score: Number.isFinite(score) ? score : null,
      playedAt: result.createdAt ?? now,
    });
    mock.lastActivityAt = now;

    if (step.gameKeys.every(g => step.results.some(r => r.gameKey === g))) {
      step.done = true;
      const finished = mock.currentStep;
      mock.currentStep += 1;
      if (mock.currentStep >= mock.steps.length) {
        mock.status = 'completed';
        mock.endedAt = now;
        mock.breakStartedAt = null;
      } else if (mock.breakAfter.includes(finished)) {
        mock.breakStartedAt = now;
      }
    }
    mock.markModified('steps');
    await mock.save();
    return mock;
  } catch (err) {
    console.error('[cbatMock] claim failed:', err.message);
    return null;
  }
}

// ── Score sheet ──────────────────────────────────────────────────────────────────────────────
// The Aptitude Report's own scorer, fed this sitting alone. Each game sat is handed over as a
// FULL window of runs at the score it came back with, so nothing is shrunk toward the middle and
// the sheet reads as one sitting on one morning — which is what the real sheet is. A test not sat
// (the mock was left early, or there is no game for it) is simply unmeasured, and the report's
// coverage rules decide whether the battery can still be judged.
function mockForm(mock) {
  const form = {};
  for (const step of mock.steps) {
    for (const r of step.results) {
      if (!Number.isFinite(r.score)) continue;
      form[r.gameKey] = { runs: minRunsFor(r.gameKey), form: r.score, easierOnly: false, lastPlayedAt: r.playedAt };
    }
  }
  return form;
}

function sheetBattery(battery, form) {
  const report = buildBatteryReport(battery, form);
  return {
    key: report.key,
    label: report.label,
    group: report.group,
    region: report.region,
    basedOn: report.basedOn,
    cutoff: report.cutoff,
    score: report.score,
    status: report.status,
    coverage: report.coverage,
    failedMinimums: report.failedMinimums,
    domains: report.domains.map(d => ({
      key: d.key,
      label: d.label,
      weight: d.weight,
      minStanine: d.minStanine,
      stanine: d.stanine,
      belowMinimum: d.belowMinimum,
      tests: d.tests.map(t => ({ code: t.code, mult: t.mult, label: t.label, sat: t.state === 'scored' })),
    })),
  };
}

function buildMockSheet(mock) {
  const batteries = mock.scope === 'role'
    ? [BATTERY_BY_KEY[mock.batteryKey]].filter(Boolean)
    : mockBatteries({ region: mock.region });
  const form = mockForm(mock);
  return {
    maxScore: MAX_SCORE,
    maxStanine: MAX_STANINE,
    batteries: batteries.map(b => sheetBattery(b, form)),
  };
}

// What the client is sent. `testsDone` / `testsTotal` count steps; the sheet is attached for any
// mock that has ended.
function serialiseMock(mock, { withSheet = false } = {}) {
  const m = mock.toObject ? mock.toObject() : mock;
  const out = {
    id: String(m._id),
    // Whose mock it is. The browser keeps a copy so a new tab can lock on its first frame, and
    // checks it against whoever is signed in before trusting it.
    userId: String(m.userId),
    region: m.region,
    scope: m.scope,
    batteryKey: m.batteryKey,
    batteryLabel: m.batteryKey ? (BATTERY_BY_KEY[m.batteryKey]?.label ?? m.batteryKey) : null,
    steps: m.steps.map(s => ({
      codes: s.codes,
      labels: s.codes.map(c => TESTS[c]?.label ?? c),
      gameKeys: s.gameKeys,
      // Where each board is played, from the server's config rather than the client's, so a tab
      // running an older build still opens the right board (see `paths` in the mock config).
      paths: Object.fromEntries(s.gameKeys.map(g => [g, MOCK.paths[g] ?? null])),
      minutes: s.minutes,
      done: s.done,
      played: s.results.map(r => r.gameKey),
    })),
    breakAfter: m.breakAfter,
    currentStep: m.currentStep,
    breakStartedAt: m.breakStartedAt,
    status: m.status,
    startedAt: m.startedAt,
    lastActivityAt: m.lastActivityAt,
    endedAt: m.endedAt,
    deadline: m.status === 'active' ? new Date(new Date(m.lastActivityAt).getTime() + IDLE_LIMIT_MS) : null,
    testsDone: m.steps.filter(s => s.done).length,
    testsTotal: m.steps.length,
  };
  if (withSheet) out.sheet = buildMockSheet(m);
  return out;
}

module.exports = {
  IDLE_LIMIT_MS,
  expireIfIdle,
  findActiveMock,
  gameKeyFromRequest,
  claimMockResult,
  mockForm,
  buildMockSheet,
  serialiseMock,
};
