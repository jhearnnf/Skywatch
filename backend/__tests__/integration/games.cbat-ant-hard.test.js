process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatAntResult     = require('../../models/GameSessionCbatAntResult');
const GameSessionCbatAntHardResult = require('../../models/GameSessionCbatAntHardResult');
const { CBAT_GAMES, cbatLabelWithDifficulty, cbatHardKeyFor, isCbatEasierKey } = require('../../constants/cbatGames');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'anthard2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// A believable Hard run: twelve rounds, most exact, a couple close, one lost to
// the clock. Out of 120, not the original board's 80.
const sample = (overrides = {}) => ({
  totalScore:   95,
  exactCount:   8,
  partialCount: 3,
  missCount:    1,
  roundsPlayed: 12,
  totalTime:    398.2,
  grade:        'Good',
  ...overrides,
});

describe('CBAT ANT (Hard)', () => {
  const RESULT_URL      = '/api/games/cbat/ant-hard/result';
  const LEADERBOARD_URL = '/api/games/cbat/ant-hard/leaderboard';
  const PB_URL          = '/api/games/cbat/ant-hard/personal-best';

  describe('POST /result', () => {
    it('saves a run and returns 201 with the submitted data', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalScore).toBe(95);
      expect(res.body.data.roundsPlayed).toBe(12);
      expect(res.body.data.grade).toBe('Good');

      expect(await GameSessionCbatAntHardResult.countDocuments()).toBe(1);
    });

    // The whole point of the split. Hard is twelve rounds out of 120 against the
    // original board's eight out of 80, and nothing converts between them — a
    // Hard run landing on the original board would sit permanently on top of it.
    it('never touches the original ANT board', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      expect(await GameSessionCbatAntResult.countDocuments()).toBe(0);
      expect(await GameSessionCbatAntHardResult.countDocuments()).toBe(1);
    });

    it('and a run on the original board never lands on Hard', async () => {
      await request(app)
        .post('/api/games/cbat/ant/result')
        .set('Cookie', cookie)
        .send(sample({ totalScore: 60, roundsPlayed: 8 }));

      expect(await GameSessionCbatAntResult.countDocuments()).toBe(1);
      expect(await GameSessionCbatAntHardResult.countDocuments()).toBe(0);
    });

    it('requires a signed-in user', async () => {
      const res = await request(app).post(RESULT_URL).send(sample());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /leaderboard', () => {
    it('ranks real runs highest score first', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 80 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 110 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);

      const real = res.body.data.leaderboard.filter(e => !e.isFake);
      expect(real[0].bestScore).toBe(110);
      expect(real.find(e => e.bestScore === 80)).toBeTruthy();
    });

    it('keeps the two ANT boards apart', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 110 }));

      const easier = await request(app).get('/api/games/cbat/ant/leaderboard').set('Cookie', cookie);
      expect(easier.body.data.leaderboard.filter(e => !e.isFake)).toHaveLength(0);
    });
  });

  describe('GET /personal-best', () => {
    it('reports the best run on this board only', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 70 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 105 }));
      await request(app)
        .post('/api/games/cbat/ant/result')
        .set('Cookie', cookie)
        .send(sample({ totalScore: 80, roundsPlayed: 8 }));

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(105);
      expect(res.body.data.attempts).toBe(2);
    });
  });
});

// ANT is the only split whose Easier half does not carry the '-easier' suffix:
// plain `ant` is the original board and kept the key its existing scores sit on.
// That is declared with `hardKey`, and everything that names a difficulty has to
// read the declaration rather than the string.
describe('ANT names both of its halves', () => {
  it('treats plain `ant` as the Easier board', () => {
    expect(isCbatEasierKey('ant')).toBe(true);
    expect(cbatHardKeyFor('ant')).toBe('ant-hard');
    expect(CBAT_GAMES['ant-hard']).toBeTruthy();
  });

  it('labels each half so a score is never ambiguous', () => {
    expect(cbatLabelWithDifficulty('ant')).toContain('(Easier)');
    expect(cbatLabelWithDifficulty('ant-hard')).toContain('(Hard)');
  });

  // Practise is a separate board, not a difficulty, so it stays bare.
  it('leaves the Practise drill out of the split', () => {
    expect(isCbatEasierKey('ant-practise')).toBe(false);
    expect(cbatLabelWithDifficulty('ant-practise')).toBe('ANT Practise');
  });
});
