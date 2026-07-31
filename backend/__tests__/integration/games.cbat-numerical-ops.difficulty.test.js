process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatNumericalOpsResult       = require('../../models/GameSessionCbatNumericalOpsResult');
const GameSessionCbatNumericalOpsEasierResult = require('../../models/GameSessionCbatNumericalOpsEasierResult');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'numops2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Numerical Operations' Easier difficulty is a separate registry entry backed by
// its own collection, so its board must be completely independent of the Hard
// board — scores must never leak either way. Both score a percentage of the same
// 20 questions, which makes a leak especially easy to miss: the numbers look
// plausible on either board.
describe('CBAT Numerical Operations (Easier)', () => {
  const EASIER_RESULT_URL = '/api/games/cbat/numerical-ops-easier/result';
  const EASIER_PB_URL     = '/api/games/cbat/numerical-ops-easier/personal-best';
  const EASIER_LB_URL     = '/api/games/cbat/numerical-ops-easier/leaderboard';
  const HARD_RESULT_URL   = '/api/games/cbat/numerical-ops/result';
  const HARD_PB_URL       = '/api/games/cbat/numerical-ops/personal-best';

  const sample = (overrides = {}) => ({
    correctCount: 16, correctPercentage: 80,
    round1Correct: 5, round2Correct: 4, round3Correct: 4, round4Correct: 3,
    totalTime: 280, avgTimePerQuestionMs: 14000,
    ...overrides,
  });

  it('saves an easier result to its own collection, not the hard one', async () => {
    const res = await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(sample());

    expect(res.status).toBe(201);
    expect(res.body.data.correctPercentage).toBe(80);
    expect(res.body.data.round4Correct).toBe(3);
    expect(await GameSessionCbatNumericalOpsEasierResult.countDocuments()).toBe(1);
    expect(await GameSessionCbatNumericalOpsResult.countDocuments()).toBe(0);
  });

  it('keeps personal bests separate per difficulty', async () => {
    await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 19, correctPercentage: 95 }));
    await request(app).post(HARD_RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 11, correctPercentage: 55 }));

    const easier = await request(app).get(EASIER_PB_URL).set('Cookie', cookie);
    const hard   = await request(app).get(HARD_PB_URL).set('Cookie', cookie);

    expect(easier.body.data.bestScore).toBe(95);
    expect(easier.body.data.attempts).toBe(1);
    expect(hard.body.data.bestScore).toBe(55);
    expect(hard.body.data.attempts).toBe(1);
  });

  it('leaderboard only ranks easier runs', async () => {
    // A hard run that would top the easier board if the collections leaked.
    await request(app).post(HARD_RESULT_URL).set('Cookie', cookie2).send(sample({ correctPercentage: 100 }));
    await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(sample({ correctPercentage: 100 }));

    const res = await request(app).get(EASIER_LB_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;

    expect(res.status).toBe(200);
    expect(leaderboard).toHaveLength(20);
    expect(leaderboard.find(e => e.agentNumber === '1000002')).toBeUndefined();
    // 100% beats every demo row (ceiling 95), so the real easier run leads.
    expect(leaderboard[0].agentNumber).toBe('1000001');
  });

  it('pads with its own demo band, above the hard one', async () => {
    const res = await request(app).get(EASIER_LB_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;
    expect(leaderboard).toHaveLength(20);
    expect(leaderboard.every(e => e.isFake)).toBe(true);
    leaderboard.forEach(e => {
      expect(e.bestScore).toBeGreaterThanOrEqual(45);
      expect(e.bestScore).toBeLessThan(100);
      // A percentage of 20 questions is always a multiple of 5; a demo row that
      // isn't reads as fabricated.
      expect(e.bestScore % 5).toBe(0);
    });
  });
});
