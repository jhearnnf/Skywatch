process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const CbatMatfPrint = require('../../models/CbatMatfPrint');

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

describe('POST /api/games/cbat/matf/print', () => {
  it('records one print per call against the board it was built for', async () => {
    const res = await request(app).post('/api/games/cbat/matf/print')
      .set('Cookie', authCookie(u1._id)).send({ gameKey: 'matf-easier', seed: 12345 });
    expect(res.status).toBe(201);
    const rows = await CbatMatfPrint.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0].gameKey).toBe('matf-easier');
    expect(rows[0].seed).toBe(12345);
    expect(String(rows[0].userId)).toBe(String(u1._id));
  });

  it('rejects a board that is not MATF', async () => {
    const res = await request(app).post('/api/games/cbat/matf/print')
      .set('Cookie', authCookie(u1._id)).send({ gameKey: 'flag', seed: 1 });
    expect(res.status).toBe(400);
    expect(await CbatMatfPrint.countDocuments()).toBe(0);
  });

  it('requires a signed-in player', async () => {
    const res = await request(app).post('/api/games/cbat/matf/print').send({ gameKey: 'matf', seed: 1 });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/reports/cbat — MATF prints', () => {
  const print = (user, gameKey) => request(app).post('/api/games/cbat/matf/print')
    .set('Cookie', authCookie(user._id)).send({ gameKey, seed: 7 });

  it('counts prints, players and the split by board', async () => {
    await print(u1, 'matf');
    await print(u1, 'matf');
    await print(u2, 'matf-easier');

    const res = await request(app).get('/api/admin/reports/cbat?window=all').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.gameStats.matfPrints).toEqual({ prints: 3, hard: 2, easier: 1, players: 2 });
  });

  it('only counts prints inside the window, and compares against the prior one', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await CbatMatfPrint.create({ userId: u1._id, gameKey: 'matf', printedAt: tenDaysAgo });
    await print(u2, 'matf');
    await print(u2, 'matf');

    const res = await request(app).get('/api/admin/reports/cbat?window=7d&compare=1').set('Cookie', cookie);
    const m = res.body.data.gameStats.matfPrints;
    expect(m.prints).toBe(2);
    expect(m.players).toBe(1);
    expect(m.prev).toBe(1);
    expect(m.delta).toBeCloseTo(1);
  });
});
