process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatInstrumentsResult            = require('../../models/GameSessionCbatInstrumentsResult');
const GameSessionCbatInstrumentsOrientationResult = require('../../models/GameSessionCbatInstrumentsOrientationResult');
const GameSessionCbatInstrumentsPractiseResult    = require('../../models/GameSessionCbatInstrumentsPractiseResult');
const { cbatLabelWithDifficulty, isCbatEasierKey } = require('../../constants/cbatGames');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'instdrill2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// A believable drill: one minute, six dials matched, a handful of rings.
const sample = (overrides = {}) => ({
  totalScore:   55,
  dialsMatched: 5,
  dialsSet:     6,
  ringsHit:     7,
  avgMatchTime: 5.2,
  totalTime:    60,
  ...overrides,
});

describe('CBAT Instruments Practise drill', () => {
  const RESULT_URL      = '/api/games/cbat/instruments-practise/result';
  const LEADERBOARD_URL = '/api/games/cbat/instruments-practise/leaderboard';
  const PB_URL          = '/api/games/cbat/instruments-practise/personal-best';

  it('saves a run to its own collection and nowhere else', async () => {
    const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());
    expect(res.status).toBe(201);
    expect(res.body.data.totalScore).toBe(55);
    expect(res.body.data.dialsMatched).toBe(5);

    expect(await GameSessionCbatInstrumentsPractiseResult.countDocuments()).toBe(1);
    expect(await GameSessionCbatInstrumentsResult.countDocuments()).toBe(0);
    expect(await GameSessionCbatInstrumentsOrientationResult.countDocuments()).toBe(0);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).post(RESULT_URL).send(sample());
    expect(res.status).toBe(401);
  });

  it('ranks real runs highest first, apart from the two Instruments boards', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 22 }));
    await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 61 }));

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const real = res.body.data.leaderboard.filter(e => !e.isFake);
    expect(real[0].bestScore).toBe(61);
    expect(real[1].bestScore).toBe(22);

    const reading = await request(app).get('/api/games/cbat/instruments/leaderboard').set('Cookie', cookie);
    expect(reading.body.data.leaderboard.filter(e => !e.isFake)).toHaveLength(0);
  });

  it('reports the best drill run only', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 18 }));
    await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 40 }));
    await request(app)
      .post('/api/games/cbat/instruments/result')
      .set('Cookie', cookie)
      .send({ correctCount: 12, roundsPlayed: 14, totalTime: 90, grade: 'Good' });

    const res = await request(app).get(PB_URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.bestScore).toBe(40);
    expect(res.body.data.attempts).toBe(2);
  });

  // A drill, not a difficulty: it must never be read as a half of a pair.
  it('is not a difficulty half and carries its own name', () => {
    expect(isCbatEasierKey('instruments-practise')).toBe(false);
    expect(cbatLabelWithDifficulty('instruments-practise')).toBe('Instruments Practise');
  });
});
