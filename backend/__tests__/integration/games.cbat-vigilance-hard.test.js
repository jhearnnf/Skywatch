process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatVigilanceResult     = require('../../models/GameSessionCbatVigilanceResult');
const GameSessionCbatVigilanceHardResult = require('../../models/GameSessionCbatVigilanceHardResult');
const { CBAT_GAMES, cbatLabelWithDifficulty, cbatHardKeyFor, isCbatEasierKey } = require('../../constants/cbatGames');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'vighard2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// A believable Hard run: the same three minutes, more stars cleared than an
// Easier run could offer.
const sample = (overrides = {}) => ({
  totalScore:        910,
  starsCleared:      118,
  prioritiesCleared: 9,
  misKeyed:          4,
  totalTime:         180,
  ...overrides,
});

describe('CBAT Vigilance (Hard)', () => {
  const RESULT_URL      = '/api/games/cbat/vigilance-hard/result';
  const LEADERBOARD_URL = '/api/games/cbat/vigilance-hard/leaderboard';
  const PB_URL          = '/api/games/cbat/vigilance-hard/personal-best';

  describe('POST /result', () => {
    it('saves a run and returns 201 with the submitted data', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalScore).toBe(910);
      expect(res.body.data.starsCleared).toBe(118);

      expect(await GameSessionCbatVigilanceHardResult.countDocuments()).toBe(1);
    });

    // The whole point of the split. Hard offers ~1.7x the stars, so nothing
    // converts between the boards — a Hard run landing on the original board
    // would sit permanently on top of it.
    it('never touches the original Vigilance board', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      expect(await GameSessionCbatVigilanceResult.countDocuments()).toBe(0);
      expect(await GameSessionCbatVigilanceHardResult.countDocuments()).toBe(1);
    });

    it('and a run on the original board never lands on Hard', async () => {
      await request(app)
        .post('/api/games/cbat/vigilance/result')
        .set('Cookie', cookie)
        .send(sample({ totalScore: 620 }));

      expect(await GameSessionCbatVigilanceResult.countDocuments()).toBe(1);
      expect(await GameSessionCbatVigilanceHardResult.countDocuments()).toBe(0);
    });

    it('requires a signed-in user', async () => {
      const res = await request(app).post(RESULT_URL).send(sample());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /leaderboard', () => {
    it('ranks real runs highest score first', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 700 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 1100 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);

      const real = res.body.data.leaderboard.filter(e => !e.isFake);
      expect(real[0].bestScore).toBe(1100);
      expect(real.find(e => e.bestScore === 700)).toBeTruthy();
    });

    it('keeps the two Vigilance boards apart', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 1100 }));

      const easier = await request(app).get('/api/games/cbat/vigilance/leaderboard').set('Cookie', cookie);
      expect(easier.body.data.leaderboard.filter(e => !e.isFake)).toHaveLength(0);
    });
  });

  describe('GET /personal-best', () => {
    it('reports the best run on this board only', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 640 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 980 }));
      await request(app)
        .post('/api/games/cbat/vigilance/result')
        .set('Cookie', cookie)
        .send(sample({ totalScore: 1200 }));

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(980);
      expect(res.body.data.attempts).toBe(2);
    });
  });
});

// Like ANT, the Easier half does not carry the '-easier' suffix: plain
// `vigilance` is the original board and kept the key its existing scores sit
// on. That is declared with `hardKey`, and everything that names a difficulty
// has to read the declaration rather than the string.
describe('Vigilance names both of its halves', () => {
  it('treats plain `vigilance` as the Easier board', () => {
    expect(isCbatEasierKey('vigilance')).toBe(true);
    expect(cbatHardKeyFor('vigilance')).toBe('vigilance-hard');
    expect(CBAT_GAMES['vigilance-hard']).toBeTruthy();
  });

  it('labels each half so a score is never ambiguous', () => {
    expect(cbatLabelWithDifficulty('vigilance')).toBe('Vigilance Test (Easier)');
    expect(cbatLabelWithDifficulty('vigilance-hard')).toBe('Vigilance Test (Hard)');
  });
});
