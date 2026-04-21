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
    expect(leaderboard).toHaveLength(2);
    const emails = leaderboard.map(e => e.email).sort();
    expect(emails).toEqual(['boss@skywatch.test', 'pilot@example.com']);
  });

  it('does NOT include email for any row when requester is a regular user', async () => {
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', playerCookie);
    expect(res.status).toBe(200);

    const { leaderboard } = res.body.data;
    expect(leaderboard).toHaveLength(2);
    leaderboard.forEach(entry => {
      expect(entry.email).toBeUndefined();
      expect(entry.agentNumber).toBeDefined();
    });
  });

  it('includes email on myBest when admin lands outside the top 20', async () => {
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
  });

  it('does NOT include email on myBest for a regular user outside the top 20', async () => {
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
  });
});
