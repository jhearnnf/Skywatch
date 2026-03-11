process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createBrief, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── GET /api/users/stats ───────────────────────────────────────────────────
describe('GET /api/users/stats', () => {
  it('returns user stats when authenticated', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/users/stats')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const { data } = res.body;
    expect(data.agentNumber).toBeDefined();
    expect(data.brifsRead).toBe(0);
    expect(data.gamesPlayed).toBe(0);
    expect(data.winPercent).toBe(0);
    expect(data.totalAircoins).toBe(0);
  });

  it('returns 401 if not authenticated', async () => {
    const res = await request(app).get('/api/users/stats');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/users/me/difficulty ────────────────────────────────────────
describe('PATCH /api/users/me/difficulty', () => {
  it('updates difficulty to medium', async () => {
    const user   = await createUser({ difficultySetting: 'easy' });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/difficulty')
      .set('Cookie', cookie)
      .send({ difficulty: 'medium' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.difficultySetting).toBe('medium');
  });

  it('returns 400 for invalid difficulty value', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/difficulty')
      .set('Cookie', cookie)
      .send({ difficulty: 'insane' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/easy or medium/i);
  });

  it('returns 401 if not authenticated', async () => {
    const res = await request(app)
      .patch('/api/users/me/difficulty')
      .send({ difficulty: 'easy' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/users/leaderboard ────────────────────────────────────────────
describe('GET /api/users/leaderboard', () => {
  it('returns a list of users ordered by totalAircoins', async () => {
    await createUser({ email: 'rich@test.com',  totalAircoins: 500 });
    await createUser({ email: 'broke@test.com', totalAircoins: 10 });

    const res = await request(app).get('/api/users/leaderboard');

    expect(res.status).toBe(200);
    const agents = res.body.data?.agents ?? [];
    expect(agents.length).toBeGreaterThan(0);
    // Should be sorted descending by coins
    if (agents.length >= 2) {
      expect(agents[0].totalAircoins).toBeGreaterThanOrEqual(agents[1].totalAircoins);
    }
  });

  it('is a public endpoint — no cookie required', async () => {
    const res = await request(app).get('/api/users/leaderboard');
    expect(res.status).toBe(200);
  });

  it('does not expose passwords or sensitive fields', async () => {
    await createUser({ email: 'secret@test.com', password: 'Password123' });

    const res = await request(app).get('/api/users/leaderboard');

    expect(res.status).toBe(200);
    const agents = res.body.data?.agents ?? [];
    agents.forEach(u => {
      expect(u.password).toBeUndefined();
      expect(u.googleId).toBeUndefined();
    });
  });
});
