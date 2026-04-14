process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatPlaneTurnResult      = require('../../models/GameSessionCbatPlaneTurnResult');
const GameSessionCbatAnglesResult         = require('../../models/GameSessionCbatAnglesResult');
const GameSessionCbatCodeDuplicatesResult = require('../../models/GameSessionCbatCodeDuplicatesResult');
const GameSessionCbatSymbolsResult        = require('../../models/GameSessionCbatSymbolsResult');

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

// ── Plane Turn ───────────────────────────────────────────────────────────────
describe('CBAT Plane Turn', () => {
  const RESULT_URL = '/api/games/cbat/plane-turn/result';
  const LEADERBOARD_URL = '/api/games/cbat/plane-turn/leaderboard';
  const PB_URL = '/api/games/cbat/plane-turn/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ totalRotations: 42, totalTime: 30.5, levelsCompleted: 5, aircraftUsed: 'F-35' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalRotations).toBe(42);
      expect(res.body.data.totalTime).toBe(30.5);
      expect(res.body.data.aircraftUsed).toBe('F-35');

      const count = await GameSessionCbatPlaneTurnResult.countDocuments();
      expect(count).toBe(1);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send({ totalRotations: 42, totalTime: 30.5 });

      expect(res.status).toBe(401);
    });

    it('saves multiple results for the same user', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 50, totalTime: 40 });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 30, totalTime: 25 });

      const count = await GameSessionCbatPlaneTurnResult.countDocuments({ userId: user._id });
      expect(count).toBe(2);
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

    it('returns best score (fewest rotations) across multiple attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 50, totalTime: 40 });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 30, totalTime: 25 });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 45, totalTime: 35 });

      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(30);
      expect(res.body.data.bestTime).toBe(25);
      expect(res.body.data.attempts).toBe(3);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns leaderboard sorted by fewest rotations, one row per session', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 50, totalTime: 40 });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 30, totalTime: 25 });
      await request(app).post(RESULT_URL).set('Cookie', cookie2)
        .send({ totalRotations: 20, totalTime: 20 });

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      const { leaderboard, myBest } = res.body.data;

      expect(leaderboard).toHaveLength(3);
      // pilot2 #1 — fewest rotations
      expect(leaderboard[0].agentNumber).toBe('1000002');
      expect(leaderboard[0].bestScore).toBe(20);
      expect(leaderboard[0].rank).toBe(1);
      // pilot1's 30-rotation run is #2
      expect(leaderboard[1].agentNumber).toBe('1000001');
      expect(leaderboard[1].bestScore).toBe(30);
      expect(leaderboard[1].rank).toBe(2);
      // pilot1's 50-rotation run is #3 — both sessions appear
      expect(leaderboard[2].agentNumber).toBe('1000001');
      expect(leaderboard[2].bestScore).toBe(50);
      expect(leaderboard[2].rank).toBe(3);

      // myBest is pilot1's best (first) entry in the board
      expect(myBest.rank).toBe(2);
      expect(myBest.bestScore).toBe(30);
    });

    it('returns empty leaderboard when no results exist', async () => {
      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.leaderboard).toHaveLength(0);
      expect(res.body.data.myBest).toBeNull();
    });

    it('includes every qualifying session from the same user', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 100, totalTime: 60 });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalRotations: 40, totalTime: 30 });

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.body.data.leaderboard).toHaveLength(2);
      expect(res.body.data.leaderboard[0].bestScore).toBe(40);
      expect(res.body.data.leaderboard[1].bestScore).toBe(100);
      expect(res.body.data.leaderboard[0].userId).toBe(res.body.data.leaderboard[1].userId);
    });
  });
});

// ── Angles ───────────────────────────────────────────────────────────────────
describe('CBAT Angles', () => {
  const RESULT_URL = '/api/games/cbat/angles/result';
  const LEADERBOARD_URL = '/api/games/cbat/angles/leaderboard';
  const PB_URL = '/api/games/cbat/angles/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ correctCount: 16, round1Correct: 9, round2Correct: 7, totalTime: 45.2, grade: 'Good' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.correctCount).toBe(16);
      expect(res.body.data.grade).toBe('Good');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send({ correctCount: 16, totalTime: 45 });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns best score (most correct) across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 12, round1Correct: 7, round2Correct: 5, totalTime: 50, grade: 'Needs Work' });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 18, round1Correct: 10, round2Correct: 8, totalTime: 40, grade: 'Outstanding' });

      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.body.data.bestScore).toBe(18);
      expect(res.body.data.bestTime).toBe(40);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns leaderboard sorted by most correct, then fastest time', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 16, round1Correct: 9, round2Correct: 7, totalTime: 45, grade: 'Good' });
      await request(app).post(RESULT_URL).set('Cookie', cookie2)
        .send({ correctCount: 16, round1Correct: 8, round2Correct: 8, totalTime: 38, grade: 'Good' });

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(2);
      // Same correctCount — pilot2 wins on time
      expect(leaderboard[0].agentNumber).toBe('1000002');
      expect(leaderboard[1].agentNumber).toBe('1000001');
    });
  });
});

// ── Code Duplicates ──────────────────────────────────────────────────────────
describe('CBAT Code Duplicates', () => {
  const RESULT_URL = '/api/games/cbat/code-duplicates/result';
  const LEADERBOARD_URL = '/api/games/cbat/code-duplicates/leaderboard';
  const PB_URL = '/api/games/cbat/code-duplicates/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ correctCount: 12, easyCorrect: 5, mediumCorrect: 4, hardCorrect: 3, totalTime: 90, grade: 'Good' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.correctCount).toBe(12);
      expect(res.body.data.easyCorrect).toBe(5);
      expect(res.body.data.hardCorrect).toBe(3);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send({ correctCount: 12, totalTime: 90 });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.body.data).toBeNull();
    });

    it('returns best score (most correct) across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 8, easyCorrect: 4, mediumCorrect: 3, hardCorrect: 1, totalTime: 100, grade: 'Needs Work' });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 13, easyCorrect: 5, mediumCorrect: 5, hardCorrect: 3, totalTime: 85, grade: 'Outstanding' });

      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.body.data.bestScore).toBe(13);
      expect(res.body.data.bestTime).toBe(85);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns leaderboard sorted by most correct', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 10, easyCorrect: 5, mediumCorrect: 3, hardCorrect: 2, totalTime: 90, grade: 'Good' });
      await request(app).post(RESULT_URL).set('Cookie', cookie2)
        .send({ correctCount: 14, easyCorrect: 5, mediumCorrect: 5, hardCorrect: 4, totalTime: 80, grade: 'Outstanding' });

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      const { leaderboard, myBest } = res.body.data;
      expect(leaderboard).toHaveLength(2);
      expect(leaderboard[0].agentNumber).toBe('1000002');
      expect(leaderboard[0].bestScore).toBe(14);
      expect(leaderboard[1].agentNumber).toBe('1000001');
      expect(leaderboard[1].bestScore).toBe(10);

      expect(myBest.rank).toBe(2);
    });

    it('returns myBest with rank when user is outside top 20', async () => {
      // Create 21 users with better scores
      for (let i = 0; i < 21; i++) {
        const u = await createUser({ agentNumber: `200000${i}`, email: `top${i}@test.com` });
        const c = authCookie(u._id);
        await request(app).post(RESULT_URL).set('Cookie', c)
          .send({ correctCount: 15, easyCorrect: 5, mediumCorrect: 5, hardCorrect: 5, totalTime: 60 + i, grade: 'Outstanding' });
      }

      // Our user with a worse score
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 5, easyCorrect: 3, mediumCorrect: 2, hardCorrect: 0, totalTime: 120, grade: 'Failed' });

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      const { leaderboard, myBest } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      // User should not be in the top 20
      expect(leaderboard.find(e => e.agentNumber === '1000001')).toBeUndefined();
      // But myBest should exist with correct rank
      expect(myBest).not.toBeNull();
      expect(myBest.bestScore).toBe(5);
      expect(myBest.rank).toBe(22);
    });
  });
});

// ── Symbols ──────────────────────────────────────────────────────────────────
describe('CBAT Symbols', () => {
  const RESULT_URL = '/api/games/cbat/symbols/result';
  const LEADERBOARD_URL = '/api/games/cbat/symbols/leaderboard';
  const PB_URL = '/api/games/cbat/symbols/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ correctCount: 13, tier1Correct: 5, tier2Correct: 5, tier3Correct: 3, totalTime: 32.4, grade: 'Outstanding' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.correctCount).toBe(13);
      expect(res.body.data.tier1Correct).toBe(5);
      expect(res.body.data.tier3Correct).toBe(3);
      expect(res.body.data.grade).toBe('Outstanding');

      const count = await GameSessionCbatSymbolsResult.countDocuments();
      expect(count).toBe(1);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send({ correctCount: 10, totalTime: 40 });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.body.data).toBeNull();
    });

    it('returns best score (most correct) across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 9, tier1Correct: 5, tier2Correct: 3, tier3Correct: 1, totalTime: 50, grade: 'Needs Work' });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 14, tier1Correct: 5, tier2Correct: 5, tier3Correct: 4, totalTime: 38, grade: 'Outstanding' });

      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.body.data.bestScore).toBe(14);
      expect(res.body.data.bestTime).toBe(38);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns leaderboard sorted by most correct, then fastest time', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 12, tier1Correct: 5, tier2Correct: 4, tier3Correct: 3, totalTime: 45, grade: 'Good' });
      await request(app).post(RESULT_URL).set('Cookie', cookie2)
        .send({ correctCount: 12, tier1Correct: 5, tier2Correct: 4, tier3Correct: 3, totalTime: 36, grade: 'Good' });

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(2);
      // Same correctCount — pilot2 wins on time
      expect(leaderboard[0].agentNumber).toBe('1000002');
      expect(leaderboard[1].agentNumber).toBe('1000001');
    });

    it('returns empty leaderboard when no results exist', async () => {
      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.body.data.leaderboard).toHaveLength(0);
      expect(res.body.data.myBest).toBeNull();
    });
  });
});
