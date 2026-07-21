process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatStart = require('../../models/GameSessionCbatStart');

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

describe('GET /api/admin/reports/cbat — activity heatmap', () => {
  it('buckets game starts into a 7×24 day/hour grid (index 0 = Monday)', async () => {
    // Winter dates → Europe/London == UTC, so the buckets are unambiguous.
    // 2026-01-05 is a Monday, 2026-01-06 a Tuesday.
    await GameSessionCbatStart.create([
      { userId: u1._id, gameKey: 'target', startedAt: new Date('2026-01-06T14:00:00Z') }, // Tue 14:00
      { userId: u2._id, gameKey: 'target', startedAt: new Date('2026-01-06T14:30:00Z') }, // Tue 14:00 bucket
      { userId: u1._id, gameKey: 'target', startedAt: new Date('2026-01-05T09:15:00Z') }, // Mon 09:00
    ]);

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const hm = res.body.data.activityHeatmap;
    expect(hm.timezone).toBe('Europe/London');
    expect(hm.grid).toHaveLength(7);
    expect(hm.grid.every(row => row.length === 24)).toBe(true);

    expect(hm.grid[1][14]).toBe(2); // Tuesday 14:00 → row index 1
    expect(hm.grid[0][9]).toBe(1);  // Monday 09:00 → row index 0
    expect(hm.max).toBe(2);
    expect(hm.total).toBe(3);
  });

  it('bucketises in Europe/London, not UTC (BST shifts a 23:30 UTC start to 00:00)', async () => {
    // Summer (BST = UTC+1): 23:30 UTC → 00:30 London the *next* day.
    await GameSessionCbatStart.create({
      userId: u1._id, gameKey: 'target', startedAt: new Date('2026-06-30T23:30:00Z'),
    });

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { grid } = res.body.data.activityHeatmap;

    // Exactly one non-zero cell — assert it landed on hour 0, not UTC's hour 23.
    let found = null;
    grid.forEach((row, d) => row.forEach((count, h) => { if (count) found = { d, h, count }; }));
    expect(found).toBeTruthy();
    expect(found.h).toBe(0);
    expect(found.count).toBe(1);
  });

  it('returns an all-zero grid when there are no starts', async () => {
    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const hm = res.body.data.activityHeatmap;
    expect(hm.max).toBe(0);
    expect(hm.total).toBe(0);
    expect(hm.grid.flat().every(c => c === 0)).toBe(true);
  });
});
