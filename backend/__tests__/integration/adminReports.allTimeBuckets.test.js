process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatSatResult = require('../../models/GameSessionCbatSatResult');

const DAY = 24 * 60 * 60 * 1000;

let admin, cookie, u1;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  admin  = await createAdminUser({ agentNumber: '1000099' });
  cookie = authCookie(admin._id);
  u1 = await createUser({ agentNumber: '1000001' });
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

function satAt(userId, when) {
  return GameSessionCbatSatResult.create({
    userId, correctCount: 10, totalQuestions: 12, totalTime: 120, createdAt: when,
  });
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

describe('GET /api/admin/reports/cbat?window=all — daily bucket span', () => {
  it('starts the daily buckets at the first day with activity, not the epoch', async () => {
    const now = Date.now();
    const oldest = new Date(now - 400 * DAY); // well before any window; ~1970 if unclamped
    await satAt(u1._id, oldest);
    await satAt(u1._id, new Date(now - 1 * DAY));

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const rows = res.body.data.dailySessions;

    // First bucket is the oldest session's UTC day — NOT 1970-01-01.
    expect(rows[0].date).toBe(ymd(oldest));
    // ~401 days of buckets, nowhere near the ~20,000 an epoch start would produce.
    expect(rows.length).toBeLessThan(500);
    // Both sessions are represented (bars are actually present).
    const total = rows.reduce((s, r) => s + (r.sat ?? 0), 0);
    expect(total).toBe(2);
  });

  it('falls back to a single day (no crash) when there is no activity at all', async () => {
    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const rows = res.body.data.dailySessions;
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe(ymd(Date.now()));
  });
});
