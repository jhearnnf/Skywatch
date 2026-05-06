process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatPlaneTurnResult      = require('../../models/GameSessionCbatPlaneTurnResult');
const GameSessionCbatAnglesResult         = require('../../models/GameSessionCbatAnglesResult');
const GameSessionCbatCodeDuplicatesResult = require('../../models/GameSessionCbatCodeDuplicatesResult');
const GameSessionCbatSymbolsResult        = require('../../models/GameSessionCbatSymbolsResult');
const GameSessionCbatTargetResult         = require('../../models/GameSessionCbatTargetResult');
const GameSessionCbatInstrumentsResult    = require('../../models/GameSessionCbatInstrumentsResult');
const GameSessionCbatAntResult            = require('../../models/GameSessionCbatAntResult');
const GameSessionCbatDptResult            = require('../../models/GameSessionCbatDptResult');

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

      expect(leaderboard).toHaveLength(20);
      const real = leaderboard.filter(e => !e.isFake);
      expect(real).toHaveLength(3);
      // All three real runs are present — both of pilot1's sessions
      expect(real.map(r => r.bestScore).sort((a, b) => a - b)).toEqual([20, 30, 50]);
      // Global sort: lower rotations first, time breaks ties
      for (let i = 1; i < leaderboard.length; i++) {
        expect(leaderboard[i].bestScore).toBeGreaterThanOrEqual(leaderboard[i - 1].bestScore);
      }
      // myBest is pilot1's best real run (30 rotations); rank reflects merged position
      expect(myBest.bestScore).toBe(30);
      expect(myBest.userId.toString()).toBe(user._id.toString());
    });

    it('returns a fully-padded fake leaderboard when no results exist', async () => {
      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.leaderboard).toHaveLength(20);
      expect(res.body.data.leaderboard.every(e => e.isFake)).toBe(true);
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

      expect(res.body.data.leaderboard).toHaveLength(20);
      const real = res.body.data.leaderboard.filter(e => !e.isFake);
      expect(real).toHaveLength(2);
      // Both of this user's sessions show up (40 and 100 rotations)
      expect(real.map(r => r.bestScore).sort((a, b) => a - b)).toEqual([40, 100]);
      expect(real[0].userId).toBe(real[1].userId);
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
      expect(leaderboard).toHaveLength(20);
      const real = leaderboard.filter(e => !e.isFake);
      expect(real).toHaveLength(2);
      // Same correctCount — pilot2 (faster time) sits above pilot1
      const p2Idx = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeLessThan(p1Idx);
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
      expect(leaderboard).toHaveLength(20);
      const real = leaderboard.filter(e => !e.isFake);
      expect(real).toHaveLength(2);
      // Both real entries present with their scores
      const scores = real.map(r => r.bestScore).sort((a, b) => b - a);
      expect(scores).toEqual([14, 10]);
      // pilot2 (14) ranks above pilot1 (10) in the merged list
      const p2Idx = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeLessThan(p1Idx);

      expect(myBest.bestScore).toBe(10);
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

    it('returns the time from the best-score session, not the fastest overall time', async () => {
      // Fast but low-score run
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 10, tier1Correct: 5, tier2Correct: 3, tier3Correct: 2, totalTime: 20, grade: 'Needs Work' });
      // Slower but top-score run — this is the true personal best
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 15, tier1Correct: 5, tier2Correct: 5, tier3Correct: 5, totalTime: 40, grade: 'Outstanding' });

      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.body.data.bestScore).toBe(15);
      expect(res.body.data.bestTime).toBe(40);
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
      expect(leaderboard).toHaveLength(20);
      const real = leaderboard.filter(e => !e.isFake);
      expect(real).toHaveLength(2);
      // Same correctCount — pilot2 (faster time) sits above pilot1
      const p2Idx = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeLessThan(p1Idx);
    });

    it('returns a fully-padded fake leaderboard when no results exist', async () => {
      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.body.data.leaderboard).toHaveLength(20);
      expect(res.body.data.leaderboard.every(e => e.isFake)).toBe(true);
      expect(res.body.data.myBest).toBeNull();
    });
  });
});

// ── Target ───────────────────────────────────────────────────────────────────
describe('CBAT Target', () => {
  const RESULT_URL = '/api/games/cbat/target/result';
  const LEADERBOARD_URL = '/api/games/cbat/target/leaderboard';
  const PB_URL = '/api/games/cbat/target/personal-best';

  const sample = (overrides = {}) => ({
    totalScore: 320,
    sceneScore: 180, lightScore: 60, scanScore: 50, systemScore: 30,
    sceneHits: 18, sceneMisses: 2,
    lightMatches: 3, lightMisclicks: 0,
    scanMatches: 2, scanMisclicks: 0,
    systemMatches: 2, systemMisclicks: 0,
    totalTime: 120, grade: 'Good',
    ...overrides,
  });

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalScore).toBe(320);
      expect(res.body.data.sceneHits).toBe(18);
      expect(res.body.data.grade).toBe('Good');
      const count = await GameSessionCbatTargetResult.countDocuments();
      expect(count).toBe(1);
    });

    it('accepts negative scores', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ totalScore: -25, sceneScore: -25, grade: 'Failed' }));
      expect(res.status).toBe(201);
      expect(res.body.data.totalScore).toBe(-25);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post(RESULT_URL).send(sample());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data).toBeNull();
    });

    it('returns highest totalScore across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 150, totalTime: 120 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 420, totalTime: 120 }));

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data.bestScore).toBe(420);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns leaderboard sorted by highest totalScore, then fastest time', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 300, totalTime: 120 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 300, totalTime: 100 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      const real = leaderboard.filter(e => !e.isFake);
      expect(real).toHaveLength(2);
      // Same totalScore — user2 (faster time) sits above user1
      const p2Idx = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeLessThan(p1Idx);
    });

    it('returns a fully-padded fake leaderboard when no results exist', async () => {
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.body.data.leaderboard).toHaveLength(20);
      expect(res.body.data.leaderboard.every(e => e.isFake)).toBe(true);
      expect(res.body.data.myBest).toBeNull();
    });
  });
});

// ── Instruments ──────────────────────────────────────────────────────────────
describe('CBAT Instruments', () => {
  const RESULT_URL = '/api/games/cbat/instruments/result';
  const LEADERBOARD_URL = '/api/games/cbat/instruments/leaderboard';
  const PB_URL = '/api/games/cbat/instruments/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ correctCount: 14, roundsPlayed: 18, totalTime: 90, grade: 'Good' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.correctCount).toBe(14);
      expect(res.body.data.roundsPlayed).toBe(18);
      expect(res.body.data.grade).toBe('Good');

      const count = await GameSessionCbatInstrumentsResult.countDocuments();
      expect(count).toBe(1);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send({ correctCount: 10, roundsPlayed: 15, totalTime: 90 });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data).toBeNull();
    });

    it('returns best score (most correct) across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 8, roundsPlayed: 12, totalTime: 90, grade: 'Needs Work' });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 17, roundsPlayed: 20, totalTime: 90, grade: 'Outstanding' });

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data.bestScore).toBe(17);
      expect(res.body.data.bestTime).toBe(90);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns leaderboard sorted by most correct, then fastest time', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ correctCount: 12, roundsPlayed: 16, totalTime: 88, grade: 'Good' });
      await request(app).post(RESULT_URL).set('Cookie', cookie2)
        .send({ correctCount: 12, roundsPlayed: 14, totalTime: 75, grade: 'Good' });

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      const real = leaderboard.filter(e => !e.isFake);
      expect(real).toHaveLength(2);
      // Same correctCount — user2 (faster time) sits above user1
      const p2Idx = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeLessThan(p1Idx);
    });

    it('returns a fully-padded fake leaderboard when no results exist', async () => {
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.body.data.leaderboard).toHaveLength(20);
      expect(res.body.data.leaderboard.every(e => e.isFake)).toBe(true);
      expect(res.body.data.myBest).toBeNull();
    });
  });
});

// ── Airborne Numerical Test ─────────────────────────────────────────────────
describe('CBAT Airborne Numerical Test', () => {
  const RESULT_URL = '/api/games/cbat/ant/result';
  const LEADERBOARD_URL = '/api/games/cbat/ant/leaderboard';
  const PB_URL = '/api/games/cbat/ant/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({
          totalScore: 55,
          exactCount: 4,
          partialCount: 3,
          missCount: 1,
          roundsPlayed: 8,
          totalTime: 240,
          grade: 'Good',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalScore).toBe(55);
      expect(res.body.data.exactCount).toBe(4);
      expect(res.body.data.partialCount).toBe(3);
      expect(res.body.data.missCount).toBe(1);
      expect(res.body.data.grade).toBe('Good');

      const count = await GameSessionCbatAntResult.countDocuments();
      expect(count).toBe(1);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send({ totalScore: 30, roundsPlayed: 8, totalTime: 120 });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data).toBeNull();
    });

    it('returns best score (highest total) across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalScore: 35, exactCount: 2, partialCount: 3, missCount: 3, roundsPlayed: 8, totalTime: 220, grade: 'Needs Work' });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalScore: 70, exactCount: 6, partialCount: 2, missCount: 0, roundsPlayed: 8, totalTime: 190, grade: 'Outstanding' });

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data.bestScore).toBe(70);
      expect(res.body.data.bestTime).toBe(190);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns leaderboard sorted by highest score, then fastest time', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalScore: 60, exactCount: 4, partialCount: 4, missCount: 0, roundsPlayed: 8, totalTime: 200, grade: 'Good' });
      await request(app).post(RESULT_URL).set('Cookie', cookie2)
        .send({ totalScore: 60, exactCount: 5, partialCount: 2, missCount: 1, roundsPlayed: 8, totalTime: 175, grade: 'Good' });

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      const real = leaderboard.filter(e => !e.isFake);
      expect(real).toHaveLength(2);
      // Same totalScore — user2 (faster time) sits above user1
      const p2Idx = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeLessThan(p1Idx);
    });

    it('returns a fully-padded fake leaderboard when no results exist', async () => {
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.body.data.leaderboard).toHaveLength(20);
      expect(res.body.data.leaderboard.every(e => e.isFake)).toBe(true);
      expect(res.body.data.myBest).toBeNull();
    });
  });
});

// ── DPT (Dynamic Projection Test) ────────────────────────────────────────────
describe('CBAT DPT', () => {
  const RESULT_URL = '/api/games/cbat/dpt/result';
  const PB_URL     = '/api/games/cbat/dpt/personal-best';

  describe('POST /result', () => {
    it('saves a result with all gameplay fields', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({
          totalScore: 1250,
          totalTime: 312.4,
          finalRound: 8,
          gatesHit: 18,
          interceptions: 3,
          dangerZoneViolations: 2,
          separationViolations: 1,
          aircraftUsed: 'F-35B Lightning II',
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalScore).toBe(1250);
      expect(res.body.data.finalRound).toBe(8);
      expect(res.body.data.interceptions).toBe(3);
      expect(res.body.data.aircraftUsed).toBe('F-35B Lightning II');
      expect(await GameSessionCbatDptResult.countDocuments()).toBe(1);
    });

    it('coerces missing numeric fields to 0 and clamps negative score to 0', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send({ totalScore: -50, totalTime: 60, finalRound: 1 });
      expect(res.status).toBe(201);
      expect(res.body.data.totalScore).toBe(0);
      expect(res.body.data.gatesHit).toBe(0);
      expect(res.body.data.interceptions).toBe(0);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post(RESULT_URL).send({ totalScore: 100, totalTime: 30 });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns highest totalScore as best (higher is better)', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalScore: 500,  totalTime: 100, finalRound: 4 });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalScore: 1200, totalTime: 200, finalRound: 8 });
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send({ totalScore: 800,  totalTime: 150, finalRound: 6 });

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data.bestScore).toBe(1200);
      expect(res.body.data.bestTime).toBe(200);
      expect(res.body.data.attempts).toBe(3);
    });
  });
});
