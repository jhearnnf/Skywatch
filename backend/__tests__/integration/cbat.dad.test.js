process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatDADResult = require('../../models/GameSessionCbatDADResult');

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

describe('CBAT Directions and Distances (DAD)', () => {
  const RESULT_URL      = '/api/games/cbat/dad/result';
  const LEADERBOARD_URL = '/api/games/cbat/dad/leaderboard';
  const PB_URL          = '/api/games/cbat/dad/personal-best';

  const sample = (overrides = {}) => ({
    correctCount: 12,
    totalQuestions: 15,
    totalTime: 188.2,
    avgTimePerQuestionMs: 12546,
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
      expect(res.body.data.correctCount).toBe(12);
      expect(res.body.data.totalQuestions).toBe(15);
      expect(res.body.data.totalTime).toBe(188.2);

      const count = await GameSessionCbatDADResult.countDocuments();
      expect(count).toBe(1);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post(RESULT_URL).send(sample());
      expect(res.status).toBe(401);
    });

    it('is idempotent on a repeated clientResultId (offline-sync retry)', async () => {
      const body = sample({ clientResultId: 'dad-abc-123' });
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(body);
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(body);

      const count = await GameSessionCbatDADResult.countDocuments();
      expect(count).toBe(1);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when user has no results', async () => {
      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns highest correctCount across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 8, totalTime: 200 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 14, totalTime: 180 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 11, totalTime: 170 }));

      const res = await request(app).get(PB_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(14);
      expect(res.body.data.attempts).toBe(3);
    });
  });

  // DAD uses padLeaderboard with demo tuning (scores 4–14): up to 20 demo
  // entries render when the board is sparse, interleaved with real entries by
  // correctCount then totalTime. The best demo is 14, so a real 15 tops it.
  describe('GET /leaderboard', () => {
    it('returns 20 demo entries when no real results exist; myBest is null', async () => {
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      const { leaderboard, myBest } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      expect(leaderboard.every(e => e.isFake)).toBe(true);
      expect(myBest).toBeNull();
    });

    it('orders real entries by correctCount DESC, interleaved with demos; myBest tracks the user', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 10, totalTime: 100 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ correctCount: 13, totalTime: 200 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      const board = res.body.data.leaderboard;
      expect(board).toHaveLength(20);
      // The higher real score (13, user2) ranks above the lower one (10, user1).
      const p2Idx = board.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = board.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeGreaterThanOrEqual(0);
      expect(p2Idx).toBeLessThan(p1Idx);
      expect(res.body.data.myBest.bestScore).toBe(10);
    });

    it('breaks ties on identical correctCount by lower totalTime', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 12, totalTime: 150 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ correctCount: 12, totalTime: 120 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      const board = res.body.data.leaderboard;
      expect(board).toHaveLength(20);
      // Same score (12) — the faster real run (120s, user2) ranks above the slower (150s, user1).
      const p2Idx = board.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = board.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeGreaterThanOrEqual(0);
      expect(p2Idx).toBeLessThan(p1Idx);
    });
  });
});

describe('CBAT DAD split: plain dad = Easier (old scores kept), dad-hard = fresh Hard', () => {
  const GameSessionCbatDADHardResult = require('../../models/GameSessionCbatDADHardResult');
  const { loadForm } = require('../../utils/cbatAptitudeReport');
  const sample = { correctCount: 9, totalQuestions: 15, totalTime: 171.4, avgTimePerQuestionMs: 11426 };

  it('saves a Hard run to its own collection and never touches the Easier board', async () => {
    const res = await request(app).post('/api/games/cbat/dad-hard/result').set('Cookie', cookie).send(sample);
    expect(res.status).toBe(201);
    expect(await GameSessionCbatDADHardResult.countDocuments()).toBe(1);
    expect(await GameSessionCbatDADResult.countDocuments()).toBe(0);

    const pb = await request(app).get('/api/games/cbat/dad-hard/personal-best').set('Cookie', cookie);
    expect(pb.body.data.bestScore).toBe(9);
    const easierPb = await request(app).get('/api/games/cbat/dad/personal-best').set('Cookie', cookie);
    expect(easierPb.body.data).toBeNull();
  });

  it('serves its own leaderboard', async () => {
    await request(app).post('/api/games/cbat/dad-hard/result').set('Cookie', cookie).send(sample);
    const res = await request(app).get('/api/games/cbat/dad-hard/leaderboard').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.leaderboard.some(e => e.agentNumber === '1000001')).toBe(true);
    const easier = await request(app).get('/api/games/cbat/dad/leaderboard').set('Cookie', cookie);
    expect(easier.body.data.leaderboard.some(e => e.agentNumber === '1000001')).toBe(false);
  });

  it('stamps an Easier run on the plain board, and only when the body says so', async () => {
    await request(app).post(`/api/games/cbat/dad/result`).set('Cookie', cookie).send({ ...sample, difficulty: 'easier' });
    await request(app).post(`/api/games/cbat/dad/result`).set('Cookie', cookie).send(sample); // a pre-split build
    await request(app).post(`/api/games/cbat/dad-hard/result`).set('Cookie', cookie).send({ ...sample, difficulty: 'easier' });
    const plain = await GameSessionCbatDADResult.find().lean();
    expect(plain.map(r => r.difficulty ?? null).sort()).toEqual(['easier', null]);
    const hard = await GameSessionCbatDADHardResult.findOne().lean();
    expect(hard.difficulty).toBeUndefined();
  });

  describe('Aptitude Report form', () => {
    const at = (min) => new Date(Date.UTC(2026, 10, 19, 12, min));
    const old = (n, min) => GameSessionCbatDADResult.create({ userId: user._id, correctCount: n, totalTime: 100, createdAt: at(min) });

    it('keeps the pre-split reading when no Hard runs exist yet', async () => {
      await old(15, 1); await old(13, 2); await old(14, 3);
      const form = await loadForm(user._id, ['dad-hard']);
      expect(form['dad-hard'].runs).toBe(3);
      expect(form['dad-hard'].form).toBe(14);
    });

    it('ignores Easier runs', async () => {
      await old(14, 1);
      await GameSessionCbatDADResult.create({ userId: user._id, correctCount: 15, totalTime: 60, difficulty: 'easier', createdAt: at(5) });
      const form = await loadForm(user._id, ['dad-hard']);
      expect(form['dad-hard'].runs).toBe(1);
      expect(form['dad-hard'].form).toBe(14);
    });

    it('lets new Hard runs push the old ones out, newest first', async () => {
      await old(15, 1); await old(15, 2); await old(15, 3);
      await GameSessionCbatDADHardResult.create({ userId: user._id, correctCount: 6, totalTime: 200, createdAt: at(10) });
      await GameSessionCbatDADHardResult.create({ userId: user._id, correctCount: 9, totalTime: 200, createdAt: at(11) });
      const form = await loadForm(user._id, ['dad-hard']);
      // window of 3: 9, 6 (Hard) and the newest old 15
      expect(form['dad-hard'].form).toBe(10);
    });

    it('reads the same from the many-users loader', async () => {
      const { loadFormForUsers } = require('../../utils/cbatAptitudeReport');
      await old(15, 1); await old(15, 2);
      await GameSessionCbatDADResult.create({ userId: user._id, correctCount: 1, totalTime: 60, difficulty: 'easier', createdAt: at(4) });
      await GameSessionCbatDADHardResult.create({ userId: user._id, correctCount: 6, totalTime: 200, createdAt: at(10) });
      const byUser = await loadFormForUsers([user._id], ['dad-hard']);
      expect(byUser[String(user._id)]['dad-hard'].form).toBe(12);
    });
  });
});
