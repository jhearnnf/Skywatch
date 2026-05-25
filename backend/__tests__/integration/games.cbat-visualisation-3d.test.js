process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatVisualisation3DResult = require('../../models/GameSessionCbatVisualisation3DResult');

let user, cookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CBAT Visualisation 3D', () => {
  const RESULT_URL      = '/api/games/cbat/visualisation-3d/result';
  const LEADERBOARD_URL = '/api/games/cbat/visualisation-3d/leaderboard';
  const PB_URL          = '/api/games/cbat/visualisation-3d/personal-best';

  const sample = (overrides = {}) => ({
    correctCount: 6,
    tier1Correct: 4,
    tier2Correct: 2,
    totalTime:    72.4,
    grade:        'Good',
    ...overrides,
  });

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send(sample());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.correctCount).toBe(6);
      expect(res.body.data.tier1Correct).toBe(4);
      expect(res.body.data.tier2Correct).toBe(2);
      expect(res.body.data.totalTime).toBe(72.4);
      expect(res.body.data.grade).toBe('Good');

      const count = await GameSessionCbatVisualisation3DResult.countDocuments();
      expect(count).toBe(1);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post(RESULT_URL).send(sample());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns the best score for the user', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ correctCount: 5, totalTime: 80 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ correctCount: 7, totalTime: 65 }));

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(7);
      expect(res.body.data.bestTime).toBe(65);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns the user among the leaderboard rows after a result is saved', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.leaderboard)).toBe(true);
      expect(res.body.data.leaderboard.length).toBeGreaterThan(0);
    });
  });
});
