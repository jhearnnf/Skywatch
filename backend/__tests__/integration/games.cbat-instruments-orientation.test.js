process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatInstrumentsResult            = require('../../models/GameSessionCbatInstrumentsResult');
const GameSessionCbatInstrumentsOrientationResult = require('../../models/GameSessionCbatInstrumentsOrientationResult');
const { CBAT_GAMES, isCbatEasierKey, cbatLabelWithDifficulty } = require('../../constants/cbatGames');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'orient2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// A believable run: ten questions, most of them right, well inside the clock.
const sample = (overrides = {}) => ({
  correctCount: 7,
  roundsPlayed: 10,
  totalTime:    84.2,
  grade:        'Good',
  ...overrides,
});

describe('CBAT Instruments Orientation', () => {
  const RESULT_URL      = '/api/games/cbat/instruments-orientation/result';
  const LEADERBOARD_URL = '/api/games/cbat/instruments-orientation/leaderboard';
  const PB_URL          = '/api/games/cbat/instruments-orientation/personal-best';

  describe('POST /result', () => {
    it('saves a run and returns 201 with the submitted data', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.correctCount).toBe(7);
      expect(res.body.data.roundsPlayed).toBe(10);
      expect(res.body.data.grade).toBe('Good');

      expect(await GameSessionCbatInstrumentsOrientationResult.countDocuments()).toBe(1);
    });

    // Reading counts rounds against a 90s clock and Orientation is out of a
    // fixed ten, so nothing converts between them. A run on the wrong board
    // would sit on it for good.
    it('never touches the Reading board', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());
      expect(await GameSessionCbatInstrumentsResult.countDocuments()).toBe(0);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post(RESULT_URL).send(sample());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when the user has no runs', async () => {
      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data).toBeNull();
    });

    it('returns the most correct across attempts, ignoring Reading runs', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 5, grade: 'Needs Work' }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 9, totalTime: 70.5, grade: 'Outstanding' }));
      await request(app).post('/api/games/cbat/instruments/result').set('Cookie', cookie)
        .send({ correctCount: 17, roundsPlayed: 20, totalTime: 90, grade: 'Outstanding' });

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data.bestScore).toBe(9);
      expect(res.body.data.bestTime).toBe(70.5);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('ranks by most correct, then fastest time', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ correctCount: 8, totalTime: 95 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ correctCount: 8, totalTime: 61 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      expect(leaderboard.filter(e => !e.isFake)).toHaveLength(2);
      const p2Idx = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const p1Idx = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(p2Idx).toBeLessThan(p1Idx);
    });

    it('pads with demo rows out of ten when nobody has played', async () => {
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      const { leaderboard } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      expect(leaderboard.every(e => e.isFake)).toBe(true);
      expect(leaderboard.every(e => e.bestScore >= 1 && e.bestScore <= 10)).toBe(true);
    });
  });

  describe('registry', () => {
    it('is a second board behind the tile, not a difficulty of Reading', () => {
      expect(CBAT_GAMES['instruments-orientation']).toBeDefined();
      expect(isCbatEasierKey('instruments')).toBe(false);
      expect(isCbatEasierKey('instruments-orientation')).toBe(false);
      // Each board names itself, so neither label needs a difficulty suffix.
      expect(cbatLabelWithDifficulty('instruments')).toBe('Instruments Reading');
      expect(cbatLabelWithDifficulty('instruments-orientation')).toBe('Instruments Orientation');
    });
  });
});
