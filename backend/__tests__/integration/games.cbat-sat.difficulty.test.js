process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatSatResult       = require('../../models/GameSessionCbatSatResult');
const GameSessionCbatSatEasierResult = require('../../models/GameSessionCbatSatEasierResult');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'sat2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// SAT's Easier difficulty is a separate registry entry backed by its own
// collection, so its board must be completely independent of the Hard board.
// Easier asks 10 questions where Hard asks 18, so a leak is doubly wrong: a hard
// run doesn't just outrank the easier field, it can post a score above the
// easier board's own ceiling.
describe('CBAT SAT (Easier)', () => {
  const EASIER_RESULT_URL = '/api/games/cbat/sat-easier/result';
  const EASIER_PB_URL     = '/api/games/cbat/sat-easier/personal-best';
  const EASIER_LB_URL     = '/api/games/cbat/sat-easier/leaderboard';
  const HARD_RESULT_URL   = '/api/games/cbat/sat/result';
  const HARD_PB_URL       = '/api/games/cbat/sat/personal-best';

  const easierRun = (overrides = {}) => ({
    correctCount: 8, totalQuestions: 10, totalTime: 118.4, avgTimePerQuestionMs: 11840,
    ...overrides,
  });
  const hardRun = (overrides = {}) => ({
    correctCount: 14, totalQuestions: 18, totalTime: 206.2, avgTimePerQuestionMs: 11455,
    ...overrides,
  });

  it('saves an easier result to its own collection, not the hard one', async () => {
    const res = await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(easierRun());

    expect(res.status).toBe(201);
    expect(res.body.data.correctCount).toBe(8);
    expect(res.body.data.totalQuestions).toBe(10);
    expect(await GameSessionCbatSatEasierResult.countDocuments()).toBe(1);
    expect(await GameSessionCbatSatResult.countDocuments()).toBe(0);
  });

  it('saves a hard result to the original collection, untouched', async () => {
    const res = await request(app).post(HARD_RESULT_URL).set('Cookie', cookie).send(hardRun());

    expect(res.status).toBe(201);
    expect(res.body.data.totalQuestions).toBe(18);
    expect(await GameSessionCbatSatResult.countDocuments()).toBe(1);
    expect(await GameSessionCbatSatEasierResult.countDocuments()).toBe(0);
  });

  it('keeps personal bests separate per difficulty', async () => {
    await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(easierRun({ correctCount: 9 }));
    await request(app).post(HARD_RESULT_URL).set('Cookie', cookie).send(hardRun({ correctCount: 12 }));

    const easier = await request(app).get(EASIER_PB_URL).set('Cookie', cookie);
    const hard   = await request(app).get(HARD_PB_URL).set('Cookie', cookie);

    expect(easier.body.data.bestScore).toBe(9);
    expect(easier.body.data.attempts).toBe(1);
    expect(hard.body.data.bestScore).toBe(12);
    expect(hard.body.data.attempts).toBe(1);
  });

  it('leaderboard only ranks easier runs', async () => {
    // A hard run scoring 16 would top the easier board outright — and 16 is above
    // what the 10-question easier run can even reach — if the collections leaked.
    await request(app).post(HARD_RESULT_URL).set('Cookie', cookie2).send(hardRun({ correctCount: 16 }));
    await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(easierRun({ correctCount: 10 }));

    const res = await request(app).get(EASIER_LB_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;

    expect(res.status).toBe(200);
    expect(leaderboard).toHaveLength(20);
    expect(leaderboard.find(e => e.agentNumber === '1000002')).toBeUndefined();
    // A perfect 10 beats every demo row (ceiling 9), so the real run leads.
    expect(leaderboard[0].agentNumber).toBe('1000001');
  });

  it('pads with its own demo band, scaled to 10 questions not 18', async () => {
    const res = await request(app).get(EASIER_LB_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;

    expect(leaderboard).toHaveLength(20);
    expect(leaderboard.every(e => e.isFake)).toBe(true);
    leaderboard.forEach(e => {
      expect(e.bestScore).toBeGreaterThanOrEqual(3);
      expect(e.bestScore).toBeLessThan(10);
    });
  });
});
