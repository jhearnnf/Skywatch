process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createBrief, createSettings, authCookie, createPassedQuizAttempt, createWonBooResult, createBooBriefs } = require('../helpers/factories');
const AircoinLog = require('../../models/AircoinLog');
const GameSessionQuizAttempt             = require('../../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult     = require('../../models/GameSessionOrderOfBattleResult');
const GameSessionWhereAircraftResult     = require('../../models/GameSessionWhereAircraftResult');
const GameOrderOfBattle                  = require('../../models/GameOrderOfBattle');
const mongoose                           = require('mongoose');

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
    expect(data.abandonedGames).toBe(0);
    expect(data.winPercent).toBe(0);
    expect(data.totalAircoins).toBe(0);
  });

  it('returns 401 if not authenticated', async () => {
    const res = await request(app).get('/api/users/stats');
    expect(res.status).toBe(401);
  });

  it('gamesPlayed excludes abandoned games and abandonedGames counts them', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);
    const brief  = await createBrief();

    // 2 completed quiz attempts
    await createPassedQuizAttempt(user._id, brief._id);
    await createPassedQuizAttempt(user._id, brief._id);

    // 1 abandoned quiz attempt
    await GameSessionQuizAttempt.create({
      userId:        user._id,
      intelBriefId:  brief._id,
      gameSessionId: `abandoned-quiz-${Date.now()}`,
      difficulty:    'easy',
      status:        'abandoned',
    });

    // 1 abandoned BOO result
    const booGame = await GameOrderOfBattle.create({
      anchorBriefId: brief._id,
      category:      'Aircrafts',
      difficulty:    'easy',
      orderType:     'speed',
      choices:       [],
    });
    await GameSessionOrderOfBattleResult.create({
      userId:    user._id,
      gameId:    booGame._id,
      abandoned: true,
      userChoices: [],
    });

    // 1 abandoned WTA result
    await GameSessionWhereAircraftResult.create({
      userId:          user._id,
      aircraftBriefId: brief._id,
      gameSessionId:   `abandoned-wta-${Date.now()}`,
      status:          'abandoned',
    });

    const res = await request(app)
      .get('/api/users/stats')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.gamesPlayed).toBe(2);    // only completed quiz attempts
    expect(data.abandonedGames).toBe(3); // 1 quiz + 1 BOO + 1 WTA
  });
});

// ── PATCH /api/users/me/difficulty ────────────────────────────────────────
describe('PATCH /api/users/me/difficulty', () => {
  it('updates difficulty to medium', async () => {
    const user   = await createUser({ difficultySetting: 'easy', subscriptionTier: 'silver' });
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

// ── GET /api/users/aircoins/history ───────────────────────────────────────
describe('GET /api/users/aircoins/history', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/users/aircoins/history');
    expect(res.status).toBe(401);
  });

  it('returns logs and total for authenticated user', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await AircoinLog.create({ userId: user._id, amount: 10, reason: 'brief_read',  label: 'Intel Brief Read' });
    await AircoinLog.create({ userId: user._id, amount: 5,  reason: 'daily_brief', label: 'Daily Brief'      });

    const res = await request(app)
      .get('/api/users/aircoins/history')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const { logs, total } = res.body.data;
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBe(2);
    expect(total).toBe(2);
  });

  it('returns most recent entries first', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await AircoinLog.create({ userId: user._id, amount: 5,  reason: 'daily_brief', label: 'First'  });
    await AircoinLog.create({ userId: user._id, amount: 20, reason: 'quiz',         label: 'Second' });

    const res = await request(app)
      .get('/api/users/aircoins/history')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { logs } = res.body.data;
    // Most recent first — "Second" was created last
    expect(logs[0].label).toBe('Second');
    expect(logs[1].label).toBe('First');
  });

  it('only returns logs belonging to the authenticated user', async () => {
    const userA  = await createUser({ email: 'a@test.com' });
    const userB  = await createUser({ email: 'b@test.com' });
    const cookie = authCookie(userA._id);

    await AircoinLog.create({ userId: userA._id, amount: 10, reason: 'brief_read', label: 'A log' });
    await AircoinLog.create({ userId: userB._id, amount: 99, reason: 'brief_read', label: 'B log' });

    const res = await request(app)
      .get('/api/users/aircoins/history')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { logs } = res.body.data;
    expect(logs.every(l => l.userId?.toString() === userA._id.toString() || !l.userId)).toBe(true);
    expect(logs.some(l => l.label === 'B log')).toBe(false);
  });

  it('respects the ?limit query param', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    for (let i = 0; i < 5; i++) {
      await AircoinLog.create({ userId: user._id, amount: i + 1, reason: 'brief_read', label: `Entry ${i}` });
    }

    const res = await request(app)
      .get('/api/users/aircoins/history?limit=3')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.logs.length).toBe(3);
    expect(res.body.data.total).toBe(5); // total is unaffected by limit
  });

  it('returns an empty log array when user has no history', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/users/aircoins/history')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.logs).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it('each log entry contains amount, reason, and label', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await AircoinLog.create({ userId: user._id, amount: 7, reason: 'daily_brief', label: 'Daily Brief' });

    const res = await request(app)
      .get('/api/users/aircoins/history')
      .set('Cookie', cookie);

    const entry = res.body.data.logs[0];
    expect(entry.amount).toBe(7);
    expect(entry.reason).toBe('daily_brief');
    expect(entry.label).toBe('Daily Brief');
  });
});
