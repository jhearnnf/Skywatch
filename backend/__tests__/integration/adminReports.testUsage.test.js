process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatTargetResult = require('../../models/GameSessionCbatTargetResult');
const GameSessionCbatAnglesResult = require('../../models/GameSessionCbatAnglesResult');
const GameSessionCbatStart        = require('../../models/GameSessionCbatStart');

const DAY_MS = 24 * 60 * 60 * 1000;
// Buckets are keyed by Europe/London calendar day, so tests must key the same way.
function ymd(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(d));
}

let admin, cookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  admin  = await createAdminUser({ agentNumber: '1000099' });
  cookie = authCookie(admin._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

async function playTarget(userId, when) {
  return GameSessionCbatTargetResult.create({ userId, totalScore: 100, totalTime: 60, createdAt: when });
}

describe('GET /api/admin/reports/snapshot — test usage', () => {
  it('counts distinct tester accounts who played CBAT per day, last 7 days', async () => {
    const now = new Date();
    const today = new Date(now.getTime() - 2 * 60 * 60 * 1000);   // a couple hours ago (safely today)
    const yesterday = new Date(now.getTime() - DAY_MS - 2 * 60 * 60 * 1000);

    const tester1 = await createUser({ agentNumber: '1000001', isTester: true });
    const tester2 = await createUser({ agentNumber: '1000002', isTester: true });
    const normal  = await createUser({ agentNumber: '1000003' }); // not a tester

    // Tester1 played two CBAT games today → still counts as ONE distinct tester.
    await playTarget(tester1._id, today);
    await GameSessionCbatAnglesResult.create({ userId: tester1._id, correctCount: 5, totalTime: 30, createdAt: today });
    // Tester2 also played today.
    await playTarget(tester2._id, today);
    // Tester1 played yesterday too.
    await playTarget(tester1._id, yesterday);
    // A non-tester played today — must NOT be counted.
    await playTarget(normal._id, today);

    const res = await request(app)
      .get('/api/admin/reports/snapshot')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const testUsage = res.body.data.testUsage;
    expect(Array.isArray(testUsage)).toBe(true);
    expect(testUsage).toHaveLength(7);

    const byDate = Object.fromEntries(testUsage.map(r => [r.date, r.count]));
    expect(byDate[ymd(today)]).toBe(2);      // two distinct testers today (not 3 plays)
    expect(byDate[ymd(yesterday)]).toBe(1);  // one tester yesterday
  });

  it('counts a tester who only started a game (no finish) as active', async () => {
    const started = new Date(Date.now() - 2 * 60 * 60 * 1000); // a couple hours ago
    const tester = await createUser({ agentNumber: '1000010', isTester: true });
    // A start with no matching result — an abandoned/in-progress session.
    await GameSessionCbatStart.create({ userId: tester._id, gameKey: 'target', startedAt: started });

    const res = await request(app)
      .get('/api/admin/reports/snapshot')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const byDate = Object.fromEntries(res.body.data.testUsage.map(r => [r.date, r.count]));
    expect(byDate[ymd(started)]).toBe(1);
  });

  it('does not double-count a tester who both started and finished today', async () => {
    const when = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const tester = await createUser({ agentNumber: '1000011', isTester: true });
    await GameSessionCbatStart.create({ userId: tester._id, gameKey: 'target', startedAt: when });
    await playTarget(tester._id, when);

    const res = await request(app)
      .get('/api/admin/reports/snapshot')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const byDate = Object.fromEntries(res.body.data.testUsage.map(r => [r.date, r.count]));
    expect(byDate[ymd(when)]).toBe(1); // one distinct tester, not two
  });

  it('returns a zero-filled 7-day series when no testers have played', async () => {
    await createUser({ agentNumber: '1000004', isTester: true }); // tester, but no plays
    await playTarget((await createUser({ agentNumber: '1000005' }))._id, new Date());

    const res = await request(app)
      .get('/api/admin/reports/snapshot')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const testUsage = res.body.data.testUsage;
    expect(testUsage).toHaveLength(7);
    expect(testUsage.every(r => r.count === 0)).toBe(true);
  });
});
