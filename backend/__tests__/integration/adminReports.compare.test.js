process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatSatResult = require('../../models/GameSessionCbatSatResult');
const User = require('../../models/User');

const DAY = 24 * 60 * 60 * 1000;

let admin, cookie, u1, u2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  admin  = await createAdminUser({ agentNumber: '1000099' });
  cookie = authCookie(admin._id);
  u1 = await createUser({ agentNumber: '1000001' });
  u2 = await createUser({ agentNumber: '1000002' });
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Helper: an SAT session at a specific time. SAT is the newest CBAT game and is
// exercised here precisely to prove a registry-only addition flows through the
// comparison code with no special-casing.
function satAt(userId, when) {
  return GameSessionCbatSatResult.create({
    userId, correctCount: 10, totalQuestions: 12, totalTime: 120, createdAt: when,
  });
}

describe('GET /api/admin/reports/cbat — prior-period comparison', () => {
  beforeEach(async () => {
    const now = Date.now();
    // Current 7d window: 3 SAT sessions across 2 players.
    await satAt(u1._id, new Date(now - 1 * DAY));
    await satAt(u1._id, new Date(now - 2 * DAY));
    await satAt(u2._id, new Date(now - 1 * DAY));
    // Prior 7d window (8–14d ago): 1 SAT session by a single player.
    await satAt(u1._id, new Date(now - 9 * DAY));
  });

  it('returns comparison deltas and per-game prevSessions (incl. SAT) with compare=1', async () => {
    const res = await request(app)
      .get('/api/admin/reports/cbat?window=7d&compare=1')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;

    // Headline comparison block present and correct.
    expect(data.comparison).toBeTruthy();
    expect(data.comparison.totalSessions).toEqual({ prev: 1, delta: 2 });       // (3-1)/1
    expect(data.comparison.uniquePlayers).toEqual({ prev: 1, delta: 1 });       // (2-1)/1

    // SAT — a registry-only addition — appears with prior-period figures.
    const sat = data.perGame.find(g => g.key === 'sat');
    expect(sat).toBeTruthy();
    expect(sat.label).toBe('Situational Awareness Test');
    expect(sat.sessions).toBe(3);
    expect(sat.prevSessions).toBe(1);
    expect(sat.sessionsDelta).toBe(2);

    // Prior daily totals are overlaid on the current buckets (aligned by offset).
    const prevSum = data.dailySessions.reduce((s, r) => s + (r._prevTotal ?? 0), 0);
    expect(prevSum).toBe(1);
  });

  it('omits comparison data when compare is not requested', async () => {
    const res = await request(app)
      .get('/api/admin/reports/cbat?window=7d')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.comparison).toBeNull();
    const sat = data.perGame.find(g => g.key === 'sat');
    expect(sat.prevSessions).toBeUndefined();
    expect(sat.sessionsDelta).toBeUndefined();
    expect(data.dailySessions.every(r => r._prevTotal === undefined)).toBe(true);
  });

  it('returns null comparison for all-time even with compare=1 (no prior period)', async () => {
    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all&compare=1')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.comparison).toBeNull();
  });
});

describe('GET /api/admin/reports/window — prior-period comparison', () => {
  beforeEach(async () => {
    const now = Date.now();
    // Backdate signups via the native driver — createdAt is immutable under
    // Mongoose timestamps, so updateOne would be silently ignored.
    const backdate = (id, when) => User.collection.updateOne({ _id: id }, { $set: { createdAt: new Date(when) } });
    await backdate(u1._id, now - 1 * DAY);   // current window
    await backdate(u2._id, now - 2 * DAY);   // current window
    const prior = await createUser({ agentNumber: '1000003' });
    await backdate(prior._id, now - 9 * DAY); // prior window
  });

  it('returns a comparison block with signup deltas and aligned daily prev', async () => {
    const res = await request(app)
      .get('/api/admin/reports/window?window=7d&compare=1')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.comparison).toBeTruthy();
    expect(data.comparison.signups.prev).toBe(1);
    // Current window = admin (now) + u1 + u2 = 3; prior = 1 → (3-1)/1 = 2.
    expect(data.comparison.signups.delta).toBeCloseTo(2);
    // Daily signups carry an aligned prior series.
    expect(data.dailySignups.some(r => typeof r.prev === 'number')).toBe(true);
    expect(data.dailySignups.reduce((s, r) => s + (r.prev ?? 0), 0)).toBe(1);
  });

  it('omits comparison when compare is not requested', async () => {
    const res = await request(app)
      .get('/api/admin/reports/window?window=7d')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.comparison).toBeNull();
    expect(res.body.data.dailySignups.every(r => r.prev === undefined)).toBe(true);
  });
});
