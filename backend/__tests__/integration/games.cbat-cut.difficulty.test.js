process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatCutResult       = require('../../models/GameSessionCbatCutResult');
const GameSessionCbatCutEasierResult = require('../../models/GameSessionCbatCutEasierResult');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'cut2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// CUT's Easier difficulty is a separate registry entry backed by its own
// collection, so its board must be completely independent of the Hard board —
// scores must never leak either way.
describe('CBAT CUT (Easier)', () => {
  const EASIER_RESULT_URL = '/api/games/cbat/cut-easier/result';
  const EASIER_PB_URL     = '/api/games/cbat/cut-easier/personal-best';
  const EASIER_LB_URL     = '/api/games/cbat/cut-easier/leaderboard';
  const HARD_RESULT_URL   = '/api/games/cbat/cut/result';
  const HARD_PB_URL       = '/api/games/cbat/cut/personal-best';

  const sample = (overrides = {}) => ({
    totalScore: 400, totalTime: 180,
    tasksCompleted: 8, tasksMissed: 2, warningSeconds: 25,
    ...overrides,
  });

  it('saves an easier result to its own collection, not the hard one', async () => {
    const res = await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(sample());

    expect(res.status).toBe(201);
    expect(res.body.data.totalScore).toBe(400);
    expect(await GameSessionCbatCutEasierResult.countDocuments()).toBe(1);
    expect(await GameSessionCbatCutResult.countDocuments()).toBe(0);
  });

  it('keeps personal bests separate per difficulty', async () => {
    await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 300 }));
    await request(app).post(HARD_RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 1200 }));

    const easier = await request(app).get(EASIER_PB_URL).set('Cookie', cookie);
    const hard   = await request(app).get(HARD_PB_URL).set('Cookie', cookie);

    expect(easier.body.data.bestScore).toBe(300);
    expect(easier.body.data.attempts).toBe(1);
    expect(hard.body.data.bestScore).toBe(1200);
    expect(hard.body.data.attempts).toBe(1);
  });

  it('leaderboard only ranks easier runs', async () => {
    // A hard run that would top the easier board if the collections leaked.
    await request(app).post(HARD_RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 2000 }));
    await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 800 }));

    const res = await request(app).get(EASIER_LB_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;

    expect(res.status).toBe(200);
    expect(leaderboard).toHaveLength(20);
    expect(leaderboard.find(e => e.agentNumber === '1000002')).toBeUndefined();
    // 800 beats every demo row (ceiling 420), so the real easier run leads.
    expect(leaderboard[0].agentNumber).toBe('1000001');
  });

  it('pads with its own demo band, below the hard one', async () => {
    const res = await request(app).get(EASIER_LB_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;
    expect(leaderboard).toHaveLength(20);
    expect(leaderboard.every(e => e.isFake)).toBe(true);
    leaderboard.forEach(e => {
      expect(e.bestScore).toBeGreaterThanOrEqual(110);
      expect(e.bestScore).toBeLessThanOrEqual(420);
    });
  });
});
