process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

let admin, adminCookie, player, playerCookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  admin = await createAdminUser({ email: 'boss@skywatch.test', agentNumber: '9000001' });
  adminCookie = authCookie(admin._id);
  player = await createUser({ email: 'pilot@example.com', agentNumber: '9000002' });
  playerCookie = authCookie(player._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CBAT leaderboard — admin email exposure', () => {
  const RESULT_URL = '/api/games/cbat/symbols/result';
  const LEADERBOARD_URL = '/api/games/cbat/symbols/leaderboard';

  beforeEach(async () => {
    await request(app).post(RESULT_URL).set('Cookie', playerCookie)
      .send({ correctCount: 12, totalTime: 30 });
    await request(app).post(RESULT_URL).set('Cookie', adminCookie)
      .send({ correctCount: 8, totalTime: 25 });
  });

  it('includes email for every row when requester is an admin', async () => {
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', adminCookie);
    expect(res.status).toBe(200);

    const { leaderboard } = res.body.data;
    expect(leaderboard).toHaveLength(20);
    const real = leaderboard.filter(e => !e.isFake);
    expect(real).toHaveLength(2);
    const emails = real.map(e => e.email).sort();
    expect(emails).toEqual(['boss@skywatch.test', 'pilot@example.com']);
    // Fakes carry email="demo" so admins can tell them apart from real users
    const fakes = leaderboard.filter(e => e.isFake);
    expect(fakes.every(e => e.email === 'demo')).toBe(true);
  });

  it('includes achievedAt on real rows for admins, and omits it on fakes', async () => {
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', adminCookie);
    expect(res.status).toBe(200);

    const { leaderboard } = res.body.data;
    const real = leaderboard.filter(e => !e.isFake);
    expect(real).toHaveLength(2);
    real.forEach(entry => {
      expect(entry.achievedAt).toBeDefined();
      // ISO date string parses to a real timestamp
      expect(Number.isNaN(new Date(entry.achievedAt).getTime())).toBe(false);
    });
    const fakes = leaderboard.filter(e => e.isFake);
    expect(fakes.every(e => e.achievedAt === undefined)).toBe(true);
  });

  it('does NOT include email for any row when requester is a regular user', async () => {
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', playerCookie);
    expect(res.status).toBe(200);

    const { leaderboard } = res.body.data;
    expect(leaderboard).toHaveLength(20);
    leaderboard.forEach(entry => {
      expect(entry.email).toBeUndefined();
      expect(entry.achievedAt).toBeUndefined();
      expect(entry.agentNumber).toBeDefined();
    });
  });

  it('includes email and achievedAt on myBest when admin lands outside the top 20', async () => {
    // Fill 20 higher-scoring rows from 20 distinct users so admin falls to #21
    for (let i = 0; i < 20; i++) {
      const u = await createUser({ email: `filler${i}@test.com`, agentNumber: `800000${i}` });
      await request(app).post(RESULT_URL).set('Cookie', authCookie(u._id))
        .send({ correctCount: 15, totalTime: 20 + i });
    }

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', adminCookie);
    expect(res.status).toBe(200);

    const { leaderboard, myBest } = res.body.data;
    expect(leaderboard).toHaveLength(20);
    // Admin's run (correctCount 8) isn't in the top 20
    expect(myBest).toBeTruthy();
    expect(myBest.userId.toString()).toBe(admin._id.toString());
    expect(myBest.email).toBe('boss@skywatch.test');
    expect(myBest.achievedAt).toBeDefined();
    expect(Number.isNaN(new Date(myBest.achievedAt).getTime())).toBe(false);
  });

  // The CBAT hub's admin-view toggle sends ?adminView=0 so an admin can read the
  // boards exactly as a player does.
  it('drops email and achievedAt for an admin who asks for the agent view', async () => {
    const res = await request(app).get(`${LEADERBOARD_URL}?adminView=0`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);

    const { leaderboard, myBest } = res.body.data;
    expect(leaderboard).toHaveLength(20);
    leaderboard.forEach(entry => {
      expect(entry.email).toBeUndefined();
      expect(entry.achievedAt).toBeUndefined();
      expect(entry.agentNumber).toBeDefined();
    });
    expect(myBest.email).toBeUndefined();
    expect(myBest.achievedAt).toBeUndefined();
  });

  it('keeps the admin view on any other value of adminView', async () => {
    const res = await request(app).get(`${LEADERBOARD_URL}?adminView=1`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const real = res.body.data.leaderboard.filter(e => !e.isFake);
    expect(real.map(e => e.email).sort()).toEqual(['boss@skywatch.test', 'pilot@example.com']);
  });

  it('drops email from the weekly board for an admin who asks for the agent view', async () => {
    const admin$ = await request(app).get(`${LEADERBOARD_URL}?period=weekly`).set('Cookie', adminCookie);
    expect(admin$.body.data.leaderboard.some(e => e.email)).toBe(true);

    const res = await request(app).get(`${LEADERBOARD_URL}?period=weekly&adminView=0`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    res.body.data.leaderboard.forEach(entry => expect(entry.email).toBeUndefined());
    expect(res.body.data.myBest?.email).toBeUndefined();
  });

  it('composes reveal neighbour names from agent numbers in the agent view', async () => {
    const url = '/api/games/cbat/symbols/weekly/me';
    const asAdmin = await request(app).get(url).set('Cookie', adminCookie);
    expect(asAdmin.body.data.neighbors.some(n => n.name.includes('@'))).toBe(true);

    const res = await request(app).get(`${url}?adminView=0`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    res.body.data.neighbors.forEach(n => {
      expect(n.name).not.toContain('@');
      expect(n.name).toMatch(/^Agent /);
    });
  });

  it('drops email from the recent-scores feed for an admin who asks for the agent view', async () => {
    const asAdmin = await request(app).get('/api/games/cbat/recent').set('Cookie', adminCookie);
    expect(asAdmin.body.data.recent.some(r => r.email)).toBe(true);

    const res = await request(app).get('/api/games/cbat/recent?adminView=0').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.recent.length).toBeGreaterThan(0);
    res.body.data.recent.forEach(r => {
      expect(r.email).toBeUndefined();
      expect(r.agentNumber).toBeDefined();
    });
  });

  it('does NOT include email or achievedAt on myBest for a regular user outside the top 20', async () => {
    for (let i = 0; i < 20; i++) {
      const u = await createUser({ email: `filler${i}@test.com`, agentNumber: `800000${i}` });
      await request(app).post(RESULT_URL).set('Cookie', authCookie(u._id))
        .send({ correctCount: 15, totalTime: 20 + i });
    }

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', playerCookie);
    expect(res.status).toBe(200);

    const { myBest } = res.body.data;
    expect(myBest).toBeTruthy();
    expect(myBest.userId.toString()).toBe(player._id.toString());
    expect(myBest.email).toBeUndefined();
    expect(myBest.achievedAt).toBeUndefined();
  });
});
