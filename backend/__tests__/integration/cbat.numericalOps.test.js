process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatNumericalOpsResult = require('../../models/GameSessionCbatNumericalOpsResult');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'p2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CBAT Numerical Operations', () => {
  const RESULT_URL      = '/api/games/cbat/numerical-ops/result';
  const LEADERBOARD_URL = '/api/games/cbat/numerical-ops/leaderboard';
  const PB_URL          = '/api/games/cbat/numerical-ops/personal-best';

  const sample = (overrides = {}) => ({
    correctCount: 17,
    correctPercentage: 85,
    round1Correct: 5,
    round2Correct: 5,
    round3Correct: 4,
    round4Correct: 3,
    totalTime: 142.4,
    avgTimePerQuestionMs: 7120,
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
      expect(res.body.data.correctCount).toBe(17);
      expect(res.body.data.correctPercentage).toBe(85);
      expect(res.body.data.round1Correct).toBe(5);
      expect(res.body.data.round4Correct).toBe(3);
      expect(res.body.data.totalTime).toBe(142.4);

      const count = await GameSessionCbatNumericalOpsResult.countDocuments();
      expect(count).toBe(1);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send(sample());

      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns highest correctPercentage across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctPercentage: 60, totalTime: 160 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctPercentage: 90, totalTime: 130 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctPercentage: 75, totalTime: 150 }));

      const res = await request(app).get(PB_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(90);
      expect(res.body.data.attempts).toBe(3);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns an empty leaderboard when no real scores exist (no demo padding)', async () => {
      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.leaderboard).toEqual([]);
      expect(res.body.data.myBest).toBeNull();
    });

    it('orders by correctPercentage DESC and uses totalTime as tiebreaker', async () => {
      // user2 has a higher percentage but slower time — still ranks above user1.
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctPercentage: 80, totalTime: 100 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ correctPercentage: 95, totalTime: 200 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      const board = res.body.data.leaderboard;
      expect(board).toHaveLength(2);
      expect(board.every(e => !e.isFake)).toBe(true);
      expect(board[0].bestScore).toBe(95);
      expect(board[1].bestScore).toBe(80);

      expect(res.body.data.myBest).toBeTruthy();
      expect(res.body.data.myBest.bestScore).toBe(80);
    });

    it('breaks ties on identical percentage by lower totalTime', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctPercentage: 90, totalTime: 150 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ correctPercentage: 90, totalTime: 120 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      const board = res.body.data.leaderboard;
      expect(board).toHaveLength(2);
      expect(board[0].bestTime).toBe(120);
      expect(board[1].bestTime).toBe(150);
    });
  });
});
