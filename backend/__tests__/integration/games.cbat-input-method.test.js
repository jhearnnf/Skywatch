// Which physical control a steered CBAT run (ACT, RTT, SMA — see
// constants/cbatInputMethods.js and CBAT_GAMES[key].inputMethod) was flown on.
// Covers the five result routes that accept it, both leaderboards surfacing it
// only for steered games, and the demo padding that keeps those boards looking
// real.

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const { startOfWeekUTC } = require('../../utils/weekWindow');
const { CBAT_INPUT_METHODS } = require('../../constants/cbatInputMethods');

let user, cookie;

const weekStart = startOfWeekUTC();
const inWeek = new Date(weekStart.getTime() + 24 * 60 * 60 * 1000).toISOString(); // Tue-ish

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// One entry per steered route: the URL, and a minimal-but-valid body for it.
// Bodies deliberately omit inputMethod — each test adds it.
const ROUTES = [
  { gameKey: 'act',        url: '/api/games/cbat/act/result',        body: { totalScore: 300, totalTime: 220, finalRound: 5 } },
  { gameKey: 'rtt',        url: '/api/games/cbat/rtt/result',        body: { totalScore: 800, totalTime: 115 } },
  { gameKey: 'rtt-easier', url: '/api/games/cbat/rtt-easier/result', body: { totalScore: 500, totalTime: 80 } },
  { gameKey: 'sma',        url: '/api/games/cbat/sma/result',        body: { totalScore: 340, totalTime: 62.5 } },
  { gameKey: 'sma-easier', url: '/api/games/cbat/sma-easier/result', body: { totalScore: 180, totalTime: 32.5 } },
];

describe('CBAT input method — submission', () => {
  it.each(ROUTES)('stores a valid inputMethod on $gameKey and returns it in the 201 body', async ({ url, body }) => {
    const res = await request(app).post(url).set('Cookie', cookie).send({ ...body, inputMethod: 'joystick' });
    expect(res.status).toBe(201);
    expect(res.body.data.inputMethod).toBe('joystick');
  });

  it.each(ROUTES)('normalises an unrecognised inputMethod on $gameKey to null, still 201', async ({ url, body }) => {
    const res = await request(app).post(url).set('Cookie', cookie).send({ ...body, inputMethod: 'gamepad' });
    expect(res.status).toBe(201);
    expect(res.body.data.inputMethod).toBeNull();
  });

  it.each(ROUTES)('defaults a missing inputMethod on $gameKey to null, still 201', async ({ url, body }) => {
    const res = await request(app).post(url).set('Cookie', cookie).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.inputMethod).toBeNull();
  });
});

describe('CBAT input method — all-time leaderboard (rtt)', () => {
  const RESULT_URL      = '/api/games/cbat/rtt/result';
  const LEADERBOARD_URL = '/api/games/cbat/rtt/leaderboard';

  it("shows the BEST run's inputMethod, not the first or last submitted", async () => {
    // Weaker run on touch, then a stronger run on joystick — the board must
    // report joystick because that is the run it ranks on.
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ totalScore: 400, totalTime: 120, inputMethod: 'touch' });
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ totalScore: 900, totalTime: 110, inputMethod: 'joystick' });

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001');
    expect(row.bestScore).toBe(900);
    expect(row.inputMethod).toBe('joystick');
    expect(res.body.data.myBest.inputMethod).toBe('joystick');
  });

  it('pads demo rows with an inputMethod drawn from the allowed list', async () => {
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;
    expect(leaderboard.length).toBe(20);
    expect(leaderboard.every(e => e.isFake)).toBe(true);
    leaderboard.forEach(e => {
      expect(CBAT_INPUT_METHODS).toContain(e.inputMethod);
    });
  });
});

describe('CBAT input method — weekly leaderboard (rtt)', () => {
  const RESULT_URL = '/api/games/cbat/rtt/result';
  const WEEKLY_URL = '/api/games/cbat/rtt/leaderboard?period=weekly';

  it('lists the distinct non-null controls used across the week, not the null ones', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie)
      .send({ totalScore: 400, totalTime: 120, inputMethod: 'joystick', playedAt: inWeek });
    await request(app).post(RESULT_URL).set('Cookie', cookie)
      .send({ totalScore: 300, totalTime: 100, inputMethod: 'touch', playedAt: inWeek });
    // A run with an invalid/missing method contributes nothing to the set.
    await request(app).post(RESULT_URL).set('Cookie', cookie)
      .send({ totalScore: 100, totalTime: 90, inputMethod: 'gamepad', playedAt: inWeek });

    const res = await request(app).get(WEEKLY_URL).set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001') || res.body.data.myBest;
    expect(new Set(row.inputMethods)).toEqual(new Set(['joystick', 'touch']));
    expect(row.inputMethods).not.toContain(null);
    expect(row.inputMethods.length).toBe(2);
  });

  it('pads a quiet week with demo rows carrying a one-element inputMethods array', async () => {
    const res = await request(app).get(WEEKLY_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;
    expect(leaderboard.length).toBeGreaterThan(0);
    leaderboard.forEach(e => {
      expect(Array.isArray(e.inputMethods)).toBe(true);
      expect(e.inputMethods.length).toBe(1);
      expect(CBAT_INPUT_METHODS).toContain(e.inputMethods[0]);
    });
  });
});

// myBest/row shape when the user's best sits outside the top 20 is covered by
// the same fallback code path exercised above when the user IS in view (the
// $first/$addToSet projections are identical either way); building a genuine
// 20-real-user board here to force the fallback branch adds a lot of setup for
// no new assertion, so that specific branch is not separately exercised.

describe('CBAT input method — non-steered games are unaffected', () => {
  const RESULT_URL = '/api/games/cbat/target/result';
  const sample = {
    totalScore: 320,
    sceneScore: 180, lightScore: 60, scanScore: 50, systemScore: 30,
    sceneHits: 18, sceneMisses: 2,
    lightMatches: 3, lightMisclicks: 0,
    scanMatches: 2, scanMisclicks: 0,
    systemMatches: 2, systemMisclicks: 0,
    totalTime: 120, grade: 'Good',
  };

  it('carries no inputMethod key on the all-time board', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample);
    const res = await request(app).get('/api/games/cbat/target/leaderboard').set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001');
    expect(row).not.toHaveProperty('inputMethod');
    expect(res.body.data.myBest).not.toHaveProperty('inputMethod');
  });

  it('carries no inputMethods key on the weekly board', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...sample, playedAt: inWeek });
    const res = await request(app).get('/api/games/cbat/target/leaderboard?period=weekly').set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001') || res.body.data.myBest;
    expect(row).not.toHaveProperty('inputMethods');
  });
});

// Pedals ride beside the method rather than replacing it (see
// constants/cbatInputMethods.js): SMA is the one test flown on them, so only
// its two routes accept the field and only its boards carry it.
describe('CBAT pedals — SMA', () => {
  const RESULT_URL = '/api/games/cbat/sma/result';
  const ALLTIME_URL = '/api/games/cbat/sma/leaderboard';
  const WEEKLY_URL  = '/api/games/cbat/sma/leaderboard?period=weekly';
  const body = { totalScore: 340, totalTime: 62.5, inputMethod: 'joystick' };

  it.each([
    ['sma',        '/api/games/cbat/sma/result'],
    ['sma-easier', '/api/games/cbat/sma-easier/result'],
  ])('stores a real boolean on %s and treats anything else as unsaid', async (_key, url) => {
    for (const [sent, stored] of [[true, true], [false, false], ['true', null], [1, null], [undefined, null]]) {
      const res = await request(app).post(url).set('Cookie', cookie).send({ ...body, pedals: sent });
      expect(res.status).toBe(201);
      expect([sent, res.body.data.pedals]).toEqual([sent, stored]);
    }
  });

  it("shows the BEST run's pedals on the all-time board, beside its method", async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, totalScore: 200, inputMethod: 'keyboard-mouse', pedals: false });
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, totalScore: 900, pedals: true });
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, totalScore: 300, pedals: false });

    const res = await request(app).get(ALLTIME_URL).set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001');
    expect(row.bestScore).toBe(900);
    expect(row.inputMethod).toBe('joystick');
    expect(row.pedals).toBe(true);
    expect(res.body.data.myBest.pedals).toBe(true);
  });

  it('marks a weekly row as pedals if any run that week used them', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, pedals: false, playedAt: inWeek });
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, pedals: true, playedAt: inWeek });
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, playedAt: inWeek });

    const res = await request(app).get(WEEKLY_URL).set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001') || res.body.data.myBest;
    expect(row.pedals).toBe(true);
  });

  it('leaves a weekly row null when no run that week said either way', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, playedAt: inWeek });
    const res = await request(app).get(WEEKLY_URL).set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001') || res.body.data.myBest;
    expect(row.pedals).toBeNull();
  });

  it('pads both SMA boards with demo rows that carry a boolean pedals, some of them true', async () => {
    for (const url of [ALLTIME_URL, WEEKLY_URL]) {
      const res = await request(app).get(url).set('Cookie', cookie);
      const { leaderboard } = res.body.data;
      expect(leaderboard.length).toBeGreaterThan(0);
      leaderboard.forEach(e => expect(typeof e.pedals).toBe('boolean'));
      expect(leaderboard.some(e => e.pedals)).toBe(true);
      expect(leaderboard.some(e => !e.pedals)).toBe(true);
      // Never a phone with pedals.
      leaderboard.filter(e => e.pedals).forEach(e => {
        expect(e.inputMethod ?? e.inputMethods[0]).not.toBe('touch');
      });
    }
  });

  it('is ignored by the other steered games: RTT rows carry no pedals key', async () => {
    const res1 = await request(app).post('/api/games/cbat/rtt/result').set('Cookie', cookie)
      .send({ totalScore: 800, totalTime: 115, inputMethod: 'joystick', pedals: true, playedAt: inWeek });
    expect(res1.status).toBe(201);
    expect(res1.body.data).not.toHaveProperty('pedals');
    const all = await request(app).get('/api/games/cbat/rtt/leaderboard').set('Cookie', cookie);
    expect(all.body.data.leaderboard.find(e => e.agentNumber === '1000001')).not.toHaveProperty('pedals');
    const week = await request(app).get('/api/games/cbat/rtt/leaderboard?period=weekly').set('Cookie', cookie);
    const row = week.body.data.leaderboard.find(e => e.agentNumber === '1000001') || week.body.data.myBest;
    expect(row).not.toHaveProperty('pedals');
  });
});
