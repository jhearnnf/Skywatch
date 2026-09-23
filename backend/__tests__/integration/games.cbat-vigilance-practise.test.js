process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatVigilanceResult      = require('../../models/GameSessionCbatVigilanceResult');
const GameSessionCbatVigilanceHardResult  = require('../../models/GameSessionCbatVigilanceHardResult');
const GameSessionCbatVigilancePractiseResult = require('../../models/GameSessionCbatVigilancePractiseResult');
const { cbatLabelWithDifficulty, isCbatEasierKey } = require('../../constants/cbatGames');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'vigdrill2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// A believable drill: one minute, about two stars a second, no priorities.
const sample = (overrides = {}) => ({
  totalScore:        1050,
  starsCleared:      108,
  prioritiesCleared: 0,
  misKeyed:          1,
  totalTime:         60,
  ...overrides,
});

describe('CBAT Vigilance Practise drill', () => {
  const RESULT_URL      = '/api/games/cbat/vigilance-practise/result';
  const LEADERBOARD_URL = '/api/games/cbat/vigilance-practise/leaderboard';
  const PB_URL          = '/api/games/cbat/vigilance-practise/personal-best';

  it('saves a run to its own collection and nowhere else', async () => {
    const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());
    expect(res.status).toBe(201);
    expect(res.body.data.totalScore).toBe(1050);

    expect(await GameSessionCbatVigilancePractiseResult.countDocuments()).toBe(1);
    expect(await GameSessionCbatVigilanceResult.countDocuments()).toBe(0);
    expect(await GameSessionCbatVigilanceHardResult.countDocuments()).toBe(0);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).post(RESULT_URL).send(sample());
    expect(res.status).toBe(401);
  });

  it('ranks real runs highest first, apart from the two Vigilance boards', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 220 }));
    await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 410 }));

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const real = res.body.data.leaderboard.filter(e => !e.isFake);
    expect(real[0].bestScore).toBe(410);

    const easier = await request(app).get('/api/games/cbat/vigilance/leaderboard').set('Cookie', cookie);
    expect(easier.body.data.leaderboard.filter(e => !e.isFake)).toHaveLength(0);
  });

  it('reports the best drill run only', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 180 }));
    await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 300 }));
    await request(app)
      .post('/api/games/cbat/vigilance/result')
      .set('Cookie', cookie)
      .send(sample({ totalScore: 900, totalTime: 60 }));

    const res = await request(app).get(PB_URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.bestScore).toBe(300);
    expect(res.body.data.attempts).toBe(2);
  });

  // A drill, not a difficulty: it must never be read as a half of the pair.
  it('is not a difficulty half and carries its own name', () => {
    expect(isCbatEasierKey('vigilance-practise')).toBe(false);
    expect(cbatLabelWithDifficulty('vigilance-practise')).toBe('Vigilance Practise');
  });
});
