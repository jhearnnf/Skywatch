// Mock Assessment — /api/cbat-mock
//
// One sitting of every test a role (or every role in a region) is scored on, with breaks, an idle
// limit, and a score sheet at the end. The runs themselves are ordinary Hard runs posted to the
// usual game routes with a `mockId`; see utils/cbatMock.js for how they are claimed.
//
// Mounted at its own prefix rather than under /api/games/cbat/, where `/cbat/:gameKey/start`
// would read "mock" as a game key.

const router = require('express').Router();
const { protect } = require('../middleware/auth');
const AppSettings = require('../models/AppSettings');
const CbatMockAssessment = require('../models/CbatMockAssessment');
const { BATTERY_BY_KEY, detectRegion, normaliseRegion } = require('../constants/cbatBatteries');
const { buildMockPlan, mockBatteries, mockSteps, breakPoints, totalMinutes, unsatCodes, MOCK } = require('../utils/cbatMockPlan');
const { findActiveMock, expireIfIdle, serialiseMock } = require('../utils/cbatMock');
const { loadForm } = require('../utils/cbatAptitudeReport');
const { canAccessCbat } = require('../utils/cbatAccess');

const HISTORY_LIMIT = 50;

// The admin switch. Admins can always reach it, so it can be tried before it is switched on.
async function mockAvailable(user) {
  const settings = await AppSettings.getSettings();
  if (!canAccessCbat(user, settings)) return { ok: false, status: 403, message: 'Your subscription does not include CBAT access.' };
  if (!user.isAdmin && settings.cbatMockAssessmentEnabled === false) {
    return { ok: false, status: 403, message: 'The Mock Assessment is switched off at the moment.' };
  }
  return { ok: true, settings };
}

// A game an admin has switched off cannot be sat, so it drops out of a new mock (and out of the
// sheet's coverage) rather than leaving the player stuck on a test they cannot open.
function gameDisabled(settings, gameKey, user) {
  if (user.isAdmin) return false;
  const map = settings?.cbatGameEnabled;
  const stored = map && typeof map.get === 'function' ? map.get(gameKey) : map?.[gameKey];
  return stored === false;
}

// Which mock the request is about: a role, or every role in a region.
function scopeFrom(input, user) {
  const batteryKey = input.battery && input.battery !== 'all' ? String(input.battery) : null;
  if (batteryKey) return BATTERY_BY_KEY[batteryKey] ? { batteryKey } : null;
  return { region: normaliseRegion(input.region || detectRegion(user)) };
}

// GET /preview?battery=pilot | ?battery=all&region=GB
// What a mock would contain, before starting it: the tests, the time, and which of them the
// player has never played on Hard (the start page's readiness hint).
router.get('/preview', protect, async (req, res) => {
  try {
    const scope = scopeFrom(req.query, req.user);
    if (!scope) return res.status(404).json({ message: 'Unknown role' });
    const batteries = mockBatteries(scope);
    const steps = mockSteps(batteries);
    const breakAfter = breakPoints(steps);
    const form = await loadForm(req.user._id, [...new Set(steps.flatMap(s => s.gameKeys))]);
    res.json({ status: 'success', data: {
      scope: scope.batteryKey ? 'role' : 'all',
      batteryKey: scope.batteryKey ?? null,
      region: scope.batteryKey ? BATTERY_BY_KEY[scope.batteryKey].region : scope.region,
      batteries: batteries.map(b => ({ key: b.key, label: b.label })),
      steps: steps.map(s => ({
        codes: s.codes,
        gameKeys: s.gameKeys,
        minutes: s.minutes,
        played: s.gameKeys.every(g => (form[g]?.runs ?? 0) > 0),
      })),
      breaks: breakAfter.length,
      totalMinutes: totalMinutes(steps, breakAfter),
      unsat: unsatCodes(batteries),
      breakMinutes: MOCK.breakMinutes,
      idleLimitMinutes: MOCK.idleLimitMinutes,
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /current — the active mock (after the idle check), and an unseen notice for a mock that
// closed itself, so the player learns why rather than finding it gone.
router.get('/current', protect, async (req, res) => {
  try {
    const mock = await findActiveMock(req.user._id);
    let closed = null;
    if (!mock) {
      const last = await CbatMockAssessment.findOne({ userId: req.user._id, status: 'expired', noticeSeenAt: null })
        .sort({ startedAt: -1 });
      if (last) closed = serialiseMock(last);
    }
    // The start page's defaults: the player's chosen role, else the region we think they are in.
    res.json({ status: 'success', data: {
      mock: mock ? serialiseMock(mock) : null,
      closed,
      targetBattery: req.user.cbatTargetBattery ?? null,
      detectedRegion: detectRegion(req.user),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /history — every finished or closed mock, newest first, with its headline results.
router.get('/history', protect, async (req, res) => {
  try {
    const mocks = await CbatMockAssessment.find({ userId: req.user._id, status: { $ne: 'active' } })
      .sort({ startedAt: -1 }).limit(HISTORY_LIMIT);
    const data = mocks.map((m) => {
      const s = serialiseMock(m, { withSheet: true });
      return {
        id: s.id, scope: s.scope, batteryKey: s.batteryKey, batteryLabel: s.batteryLabel, region: s.region,
        status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, testsDone: s.testsDone, testsTotal: s.testsTotal,
        results: s.sheet.batteries.map(b => ({ key: b.key, label: b.label, score: b.score, cutoff: b.cutoff, status: b.status })),
      };
    });
    res.json({ status: 'success', data: { mocks: data } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /start { battery: 'pilot' | 'all', region? }
router.post('/start', protect, async (req, res) => {
  try {
    const gate = await mockAvailable(req.user);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const existing = await findActiveMock(req.user._id);
    if (existing) {
      return res.status(409).json({ message: 'You already have an assessment in progress.', data: { mock: serialiseMock(existing) } });
    }

    const scope = scopeFrom(req.body || {}, req.user);
    if (!scope) return res.status(404).json({ message: 'Unknown role' });
    const plan = buildMockPlan(scope);
    if (!plan) return res.status(404).json({ message: 'Unknown role' });

    // Drop anything switched off, then place the breaks on what is left.
    const steps = plan.steps.filter(s => !s.gameKeys.some(g => gameDisabled(gate.settings, g, req.user)));
    if (!steps.length) return res.status(400).json({ message: 'None of these tests are available right now.' });

    const now = new Date();
    const mock = await CbatMockAssessment.create({
      userId: req.user._id,
      region: plan.region,
      scope: plan.scope,
      batteryKey: plan.batteryKey,
      steps,
      breakAfter: breakPoints(steps),
      startedAt: now,
      lastActivityAt: now,
    });
    res.status(201).json({ status: 'success', data: { mock: serialiseMock(mock) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Load one of the caller's own mocks by id, after the idle check.
async function ownMock(req) {
  const mock = await CbatMockAssessment.findOne({ _id: req.params.id, userId: req.user._id }).catch(() => null);
  if (mock) await expireIfIdle(mock);
  return mock;
}

// POST /:id/begin — the player has pressed Continue and is heading into the current test. Ends a
// break and restarts the idle clock.
router.post('/:id/begin', protect, async (req, res) => {
  try {
    const mock = await ownMock(req);
    if (!mock) return res.status(404).json({ message: 'Assessment not found' });
    if (mock.status !== 'active') {
      return res.status(409).json({ message: 'This assessment has ended.', data: { mock: serialiseMock(mock) } });
    }
    mock.lastActivityAt = new Date();
    mock.breakStartedAt = null;
    await mock.save();
    res.json({ status: 'success', data: { mock: serialiseMock(mock) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /:id/abandon — the player chose to leave. Scores already posted stay where they are.
router.post('/:id/abandon', protect, async (req, res) => {
  try {
    const mock = await ownMock(req);
    if (!mock) return res.status(404).json({ message: 'Assessment not found' });
    if (mock.status === 'active') {
      const clip = v => (typeof v === 'string' ? v.slice(0, 200) : null);
      mock.status = 'abandoned';
      mock.endedAt = new Date();
      mock.breakStartedAt = null;
      mock.abandonInfo = {
        source: clip(req.body?.source),
        from: clip(req.body?.from),
        to: clip(req.body?.to),
        userAgent: clip(req.get('user-agent')),
      };
      await mock.save();
    }
    res.json({ status: 'success', data: { mock: serialiseMock(mock) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /:id/notice-seen — the "your assessment closed" notice has been shown.
router.post('/:id/notice-seen', protect, async (req, res) => {
  try {
    const mock = await ownMock(req);
    if (!mock) return res.status(404).json({ message: 'Assessment not found' });
    if (!mock.noticeSeenAt) { mock.noticeSeenAt = new Date(); await mock.save(); }
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /:id — one mock in full, with its score sheet once it has ended.
router.get('/:id', protect, async (req, res) => {
  try {
    const mock = await ownMock(req);
    if (!mock) return res.status(404).json({ message: 'Assessment not found' });
    res.json({ status: 'success', data: { mock: serialiseMock(mock, { withSheet: mock.status !== 'active' }) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
