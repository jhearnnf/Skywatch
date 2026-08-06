process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatRttResult       = require('../../models/GameSessionCbatRttResult');
const GameSessionCbatRttEasierResult = require('../../models/GameSessionCbatRttEasierResult');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'rtt2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// A believable Hard run: 12 passes, most frames captured, a couple of targets
// lost behind cover.
const sample = (overrides = {}) => ({
  totalScore:          820,
  totalTime:           115.4,
  framesTaken:         38,
  framesOnTarget:      31,
  targetsCompleted:    9,
  avgCentringErrorDeg: 0.74,
  ...overrides,
});

describe('CBAT RTT', () => {
  const RESULT_URL      = '/api/games/cbat/rtt/result';
  const LEADERBOARD_URL = '/api/games/cbat/rtt/leaderboard';
  const PB_URL          = '/api/games/cbat/rtt/personal-best';

  describe('POST /result', () => {
    it('saves a result and returns 201 with the submitted data', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalScore).toBe(820);
      expect(res.body.data.totalTime).toBe(115.4);
      expect(res.body.data.framesTaken).toBe(38);
      expect(res.body.data.framesOnTarget).toBe(31);
      expect(res.body.data.targetsCompleted).toBe(9);
      expect(res.body.data.avgCentringErrorDeg).toBe(0.74);

      expect(await GameSessionCbatRttResult.countDocuments()).toBe(1);
    });

    // Score accumulates and can genuinely go negative — a run where nothing is
    // captured is all penalty. That must store, not be coerced to 0.
    it('stores a negative total for a run that captured nothing', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ totalScore: -360, framesTaken: 0, framesOnTarget: 0, targetsCompleted: 0, avgCentringErrorDeg: 0 }));

      expect(res.status).toBe(201);
      expect(res.body.data.totalScore).toBe(-360);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post(RESULT_URL).send(sample());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /personal-best', () => {
    it('returns null when the user has no results', async () => {
      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns the highest totalScore across attempts', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 400 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 950 }));

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.body.data.bestScore).toBe(950);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  describe('GET /leaderboard', () => {
    it('returns 20 demo entries inside the tuned band when no real results exist', async () => {
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

      expect(res.status).toBe(200);
      const { leaderboard, myBest } = res.body.data;
      expect(leaderboard).toHaveLength(20);
      expect(leaderboard.every(e => e.isFake)).toBe(true);
      leaderboard.forEach(e => {
        expect(e.bestScore).toBeGreaterThanOrEqual(230);
        expect(e.bestScore).toBeLessThanOrEqual(960);
      });
      // RTT totals are arbitrary integers — a frame pays 20 plus a centring
      // bonus of round(20 × howCentred) — so unlike FLAG's and ANT's boards
      // these must NOT all be round numbers. A board where every score ends in
      // 0 or 5 is the giveaway that it was generated.
      expect(leaderboard.every(e => e.bestScore % 5 === 0)).toBe(false);
      expect(leaderboard.filter(e => e.bestScore % 10 === 0).length).toBeLessThan(3);
      expect(myBest).toBeNull();
    });

    it('places a strong real run at rank 1 above the demos', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 1300 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      const { leaderboard, myBest } = res.body.data;

      expect(leaderboard).toHaveLength(20);
      expect(leaderboard[0].bestScore).toBe(1300);
      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[0].isFake).toBeFalsy();
      expect(myBest.bestScore).toBe(1300);
    });

    it('sorts by highest totalScore, breaking ties on the faster run', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 1200, totalTime: 118 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 1200, totalTime: 112 }));

      const { leaderboard } = (await request(app).get(LEADERBOARD_URL).set('Cookie', cookie)).body.data;
      const second = leaderboard.findIndex(e => e.agentNumber === '1000002');
      const first  = leaderboard.findIndex(e => e.agentNumber === '1000001');
      expect(second).toBeLessThan(first);
      expect(first).toBeLessThan(2);
    });
  });
});

// The Easier difficulty is a separate registry entry backed by its own
// collection, so its board must be completely independent — scores must never
// leak either way.
describe('CBAT RTT (Easier)', () => {
  const EASIER_RESULT_URL = '/api/games/cbat/rtt-easier/result';
  const EASIER_PB_URL     = '/api/games/cbat/rtt-easier/personal-best';
  const EASIER_LB_URL     = '/api/games/cbat/rtt-easier/leaderboard';
  const HARD_RESULT_URL   = '/api/games/cbat/rtt/result';
  const HARD_PB_URL       = '/api/games/cbat/rtt/personal-best';

  it('saves an easier result to its own collection, not the hard one', async () => {
    const res = await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie)
      .send(sample({ totalScore: 540, totalTime: 80.2, targetsCompleted: 6 }));

    expect(res.status).toBe(201);
    expect(res.body.data.totalScore).toBe(540);
    expect(await GameSessionCbatRttEasierResult.countDocuments()).toBe(1);
    expect(await GameSessionCbatRttResult.countDocuments()).toBe(0);
  });

  it('keeps personal bests separate per difficulty', async () => {
    await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 500 }));
    await request(app).post(HARD_RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 900 }));

    const easier = await request(app).get(EASIER_PB_URL).set('Cookie', cookie);
    const hard   = await request(app).get(HARD_PB_URL).set('Cookie', cookie);

    expect(easier.body.data.bestScore).toBe(500);
    expect(easier.body.data.attempts).toBe(1);
    expect(hard.body.data.bestScore).toBe(900);
    expect(hard.body.data.attempts).toBe(1);
  });

  it('leaderboard only ranks easier runs', async () => {
    // A hard run that would top the easier board if the collections leaked.
    await request(app).post(HARD_RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 1500 }));
    await request(app).post(EASIER_RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 900, totalTime: 80 }));

    const res = await request(app).get(EASIER_LB_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;

    expect(leaderboard).toHaveLength(20);
    expect(leaderboard.find(e => e.agentNumber === '1000002')).toBeUndefined();
    // 900 beats every demo row (ceiling 675), so the real easier run leads.
    expect(leaderboard[0].agentNumber).toBe('1000001');
  });

  it('pads with the easier band, which sits below the hard one', async () => {
    const res = await request(app).get(EASIER_LB_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;

    expect(leaderboard).toHaveLength(20);
    expect(leaderboard.every(e => e.isFake)).toBe(true);
    leaderboard.forEach(e => {
      expect(e.bestScore).toBeGreaterThanOrEqual(175);
      expect(e.bestScore).toBeLessThanOrEqual(675);
    });
    expect(leaderboard.every(e => e.bestScore % 5 === 0)).toBe(false);
  });
});
