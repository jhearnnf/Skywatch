process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatFlagResult = require('../../models/GameSessionCbatFlagResult');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'flag2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── FLAG ──────────────────────────────────────────────────────────────────────
describe('CBAT FLAG', () => {
  const RESULT_URL      = '/api/games/cbat/flag/result';
  const LEADERBOARD_URL = '/api/games/cbat/flag/leaderboard';
  const PB_URL          = '/api/games/cbat/flag/personal-best';

  // Realistic payload — ~10 events across math, aircraft-id, and target sub-tasks.
  const sample = (overrides = {}) => ({
    totalScore:       185,
    mathCorrect:      4,
    mathWrong:        1,
    mathTimeout:      1,
    aircraftCorrect:  3,
    aircraftWrong:    1,
    aircraftMissed:   0,
    targetHits:       8,
    targetMisses:     2,
    aircraftsSeen:    4,
    aircraftBriefId:  'brief_abc123',
    totalTime:        95.5,
    grade:            'Good',
    ...overrides,
  });

  // ── POST /result ────────────────────────────────────────────────────────────
  describe('POST /result', () => {
    it('saves a result and returns 201 with the submitted data', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .set('Cookie', cookie)
        .send(sample());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalScore).toBe(185);
      expect(res.body.data.mathCorrect).toBe(4);
      expect(res.body.data.mathWrong).toBe(1);
      expect(res.body.data.mathTimeout).toBe(1);
      expect(res.body.data.aircraftCorrect).toBe(3);
      expect(res.body.data.aircraftWrong).toBe(1);
      expect(res.body.data.aircraftMissed).toBe(0);
      expect(res.body.data.targetHits).toBe(8);
      expect(res.body.data.targetMisses).toBe(2);
      expect(res.body.data.aircraftsSeen).toBe(4);
      expect(res.body.data.aircraftBriefId).toBe('brief_abc123');
      expect(res.body.data.totalTime).toBe(95.5);
      expect(res.body.data.grade).toBe('Good');

      const count = await GameSessionCbatFlagResult.countDocuments();
      expect(count).toBe(1);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(RESULT_URL)
        .send(sample());

      expect(res.status).toBe(401);
    });
  });

  // ── GET /personal-best ──────────────────────────────────────────────────────
  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns a result after one POST', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toBeNull();
      expect(res.body.data.bestScore).toBe(185);
      expect(res.body.data.attempts).toBe(1);
    });

    it('returns the highest totalScore across multiple attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ totalScore: 100, totalTime: 120 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ totalScore: 200, totalTime: 100 }));

      const res = await request(app)
        .get(PB_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(200);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  // ── GET /leaderboard ────────────────────────────────────────────────────────
  // FLAG uses padLeaderboard with FULL_SEQUENCE tuning: 20 demo entries (scores
  // 55–104) always render, and any real entry below score 55 is displaced.
  describe('GET /leaderboard', () => {
    it('returns 20 demo entries when no real results exist; myBest is null', async () => {
      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      const { leaderboard, myBest } = res.body.data;
      expect(Array.isArray(leaderboard)).toBe(true);
      expect(leaderboard).toHaveLength(20);
      expect(leaderboard.every(e => e.isFake)).toBe(true);
      // Floor enforced — no fake below 55.
      leaderboard.forEach(e => expect(e.bestScore).toBeGreaterThanOrEqual(55));
      expect(myBest).toBeNull();
    });

    it('places a high real score at rank 1 above demos; myBest reflects the real score', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ totalScore: 300, totalTime: 90 }));

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      const { leaderboard, myBest } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      expect(leaderboard[0].bestScore).toBe(300);
      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[0].isFake).toBeFalsy();

      expect(myBest).not.toBeNull();
      expect(myBest.bestScore).toBe(300);
      expect(myBest.userId.toString()).toBe(user._id.toString());
    });

    it('hides real entries that score below the 55-point floor', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ totalScore: 40, totalTime: 60 }));

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      const { leaderboard, myBest } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      // Real entry (40) is below the 55 floor — not surfaced in the top 20.
      expect(leaderboard.every(e => e.userId.toString() !== user._id.toString())).toBe(true);
      // myBest still tracks the real user's actual best, even when off-board.
      expect(myBest.bestScore).toBe(40);
    });

    it('still shows demos when 20+ sub-floor real sessions exist (regression: full-sequence must not short-circuit on real.length >= limit)', async () => {
      // Simulate a heavy player who has ground 25 sessions at scores in the
      // negative / sub-floor band. Aggregate will pull the top 20 of those
      // (still all sub-floor). Without full-sequence override, padLeaderboard
      // would early-return all 20 reals and never generate fakes.
      const subFloorScores = [-12, -9, -7, -7, -7, -5, -3, -3, 0, 2, 5, 8, 10, 14, 18, 22, 28, 33, 40, 45, 48, 50, 52, 53, 54];
      for (const s of subFloorScores) {
        await request(app).post(RESULT_URL).set('Cookie', cookie)
          .send(sample({ totalScore: s, totalTime: 60 }));
      }

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      // Every visible row is a fake; no sub-floor real sessions surface.
      expect(leaderboard.every(e => e.isFake)).toBe(true);
      leaderboard.forEach(e => expect(e.bestScore).toBeGreaterThanOrEqual(55));
    });

    it('sorts by highest totalScore; ties broken by fastest totalTime', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ totalScore: 250, totalTime: 110 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2)
        .send(sample({ totalScore: 250, totalTime: 90 }));

      const res = await request(app)
        .get(LEADERBOARD_URL)
        .set('Cookie', cookie);

      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(20);

      // user2 (same score, faster time) should rank above user1
      const p2Idx = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeLessThan(p1Idx);
      // Both real entries (250) outrank every fake (max 104).
      expect(p1Idx).toBeLessThan(2);
    });
  });
});
