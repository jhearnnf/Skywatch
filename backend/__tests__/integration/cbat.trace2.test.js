process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatTrace2Result = require('../../models/GameSessionCbatTrace2Result');

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

describe('CBAT Trace 2', () => {
  const RESULT_URL      = '/api/games/cbat/trace-2/result';
  const LEADERBOARD_URL = '/api/games/cbat/trace-2/leaderboard';
  const PB_URL          = '/api/games/cbat/trace-2/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ correctCount: 6, totalQuestions: 8, totalTime: 132000, avgTimePerQuestionMs: 16500 });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.correctCount).toBe(6);
      expect(res.body.data.totalQuestions).toBe(8);
      expect(res.body.data.totalTime).toBe(132000);

      const count = await GameSessionCbatTrace2Result.countDocuments();
      expect(count).toBe(1);
    });

    it('defaults totalQuestions to 8 when omitted', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ correctCount: 3 });

      expect(res.status).toBe(201);
      expect(res.body.data.totalQuestions).toBe(8);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post(RESULT_URL).send({ correctCount: 5 });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns highest correctCount across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ correctCount: 4, totalTime: 140000 });
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ correctCount: 7, totalTime: 120000 });
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ correctCount: 5, totalTime: 130000 });

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(7);
      expect(res.body.data.attempts).toBe(3);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns 20 demo entries when no real scores exist; myBest is null', async () => {
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      const { leaderboard, myBest } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      expect(leaderboard.every(e => e.isFake)).toBe(true);
      expect(myBest).toBeNull();
    });

    it('orders real entries by correctCount DESC, interleaved with demos; myBest tracks the user', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ correctCount: 8, totalTime: 110000 });
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send({ correctCount: 4, totalTime: 130000 });

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      const board = res.body.data.leaderboard;
      expect(board).toHaveLength(20);
      const p1Idx = board.findIndex(e => e.agentNumber === '1000001');
      const p2Idx = board.findIndex(e => e.agentNumber === '1000002');
      expect(p1Idx).toBeGreaterThanOrEqual(0);
      expect(p1Idx).toBeLessThan(p2Idx);
      expect(res.body.data.myBest).toBeTruthy();
      expect(res.body.data.myBest.bestScore).toBe(8);
    });
  });
});
