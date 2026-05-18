process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatTrace1Result = require('../../models/GameSessionCbatTrace1Result');

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

describe('CBAT Trace 1', () => {
  const RESULT_URL      = '/api/games/cbat/trace-1/result';
  const LEADERBOARD_URL = '/api/games/cbat/trace-1/leaderboard';
  const PB_URL          = '/api/games/cbat/trace-1/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ score: 28, correctTurns: 34, totalTurns: 40, roundsCompleted: 5, accuracy: 85, aircraftUsed: 'Hawk T2', totalTime: 23500 });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.score).toBe(28);
      expect(res.body.data.correctTurns).toBe(34);
      expect(res.body.data.totalTurns).toBe(40);
      expect(res.body.data.accuracy).toBe(85);
      expect(res.body.data.aircraftUsed).toBe('Hawk T2');
      expect(res.body.data.totalTime).toBe(23500);

      const count = await GameSessionCbatTrace1Result.countDocuments();
      expect(count).toBe(1);
    });

    it('accepts a negative score', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ score: -12, correctTurns: 14, totalTurns: 40 });

      expect(res.status).toBe(201);
      expect(res.body.data.score).toBe(-12);
    });

    it('rejects missing score with 400', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ correctTurns: 20, totalTurns: 40 });

      expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send({ score: 10 });

      expect(res.status).toBe(401);
    });

    it('defaults aircraftUsed to Hawk T2 when omitted', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ score: 15 });

      expect(res.status).toBe(201);
      expect(res.body.data.aircraftUsed).toBe('Hawk T2');
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

    it('returns highest score across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ score: 12, totalTime: 25000 });
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ score: 28, totalTime: 23000 });
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ score: 18, totalTime: 24000 });

      const res = await request(app).get(PB_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(28);
      expect(res.body.data.attempts).toBe(3);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns 20 padded entries when no real scores exist', async () => {
      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.leaderboard.length).toBe(20);
      // Top of the trace-1 fake sequence is 38; the worst is 0.
      const scores = res.body.data.leaderboard.map(e => e.bestScore);
      expect(scores[0]).toBe(38);
      expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
    });

    it('places a high real score above fake entries', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ score: 40, totalTime: 22000 });

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      const top = res.body.data.leaderboard[0];
      expect(top.bestScore).toBe(40);
      expect(top.isFake).toBeFalsy();
      expect(res.body.data.myBest).toBeTruthy();
      expect(res.body.data.myBest.bestScore).toBe(40);
    });

    it('returns a myBest entry when the user is below the top 20', async () => {
      // Insert a very low real score — below all fake entries.
      await request(app).post(RESULT_URL).set('Cookie', cookie).send({ score: -20, totalTime: 28000 });

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.myBest).toBeTruthy();
      expect(res.body.data.myBest.bestScore).toBe(-20);
    });
  });
});
