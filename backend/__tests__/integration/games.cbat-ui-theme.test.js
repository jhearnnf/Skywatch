// Which site theme a run was played under (constants/cbatUiThemes.js). Every
// result row carries it (utils/cbatResult.js stamps it from the body) and
// every board shows it per row, so a SkyWatch score and a Real CBAT score can
// be told apart at a glance. Symbols is the worked example (its Real CBAT
// variant is a different screen — numbered tiles answered by typing); Angles
// stands in for the games whose route never mentions the field. Covers the
// result route, both leaderboards surfacing it, and the demo padding that
// keeps the board looking real.

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const { startOfWeekUTC } = require('../../utils/weekWindow');
const { UI_THEMES } = require('../../constants/cbatUiThemes');

let user, cookie;

const weekStart = startOfWeekUTC();
const inWeek = new Date(weekStart.getTime() + 24 * 60 * 60 * 1000).toISOString(); // Tue-ish

const RESULT_URL      = '/api/games/cbat/symbols/result';
const LEADERBOARD_URL = '/api/games/cbat/symbols/leaderboard';
const WEEKLY_URL      = '/api/games/cbat/symbols/leaderboard?period=weekly';

// A minimal-but-valid Symbols body. Deliberately omits uiTheme — each test adds it.
const body = { correctCount: 12, tier1Correct: 5, tier2Correct: 4, tier3Correct: 3, totalTime: 40.5, grade: 'Good' };

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CBAT ui theme — submission', () => {
  it.each(UI_THEMES)('stores uiTheme "%s" and returns it in the 201 body', async (theme) => {
    const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, uiTheme: theme });
    expect(res.status).toBe(201);
    expect(res.body.data.uiTheme).toBe(theme);
  });

  it('normalises an unrecognised uiTheme to null, still 201', async () => {
    const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, uiTheme: 'neon' });
    expect(res.status).toBe(201);
    expect(res.body.data.uiTheme).toBeNull();
  });

  it('defaults a missing uiTheme to null, still 201', async () => {
    const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.uiTheme).toBeNull();
  });
});

describe('CBAT ui theme — all-time leaderboard (symbols)', () => {
  it("shows the BEST run's uiTheme, not the first or last submitted", async () => {
    // Weaker run under SkyWatch, then a stronger run under Real CBAT — the
    // board must report cbat because that is the run it ranks on.
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, correctCount: 8, uiTheme: 'skywatch' });
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, correctCount: 14, uiTheme: 'cbat' });

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001');
    expect(row.bestScore).toBe(14);
    expect(row.uiTheme).toBe('cbat');
    expect(res.body.data.myBest.uiTheme).toBe('cbat');
  });

  it('pads demo rows with a uiTheme drawn from the allowed list', async () => {
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;
    expect(leaderboard.length).toBe(20);
    expect(leaderboard.every(e => e.isFake)).toBe(true);
    leaderboard.forEach(e => {
      expect(UI_THEMES).toContain(e.uiTheme);
    });
    // Mostly SkyWatch, with some Real CBAT rows — never all one theme.
    expect(new Set(leaderboard.map(e => e.uiTheme)).size).toBe(2);
  });
});

describe('CBAT ui theme — weekly leaderboard (symbols)', () => {
  it('lists the distinct non-null themes played under across the week', async () => {
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, uiTheme: 'skywatch', playedAt: inWeek });
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, uiTheme: 'cbat', playedAt: inWeek });
    // A run with an invalid/missing theme contributes nothing to the set.
    await request(app).post(RESULT_URL).set('Cookie', cookie).send({ ...body, uiTheme: 'neon', playedAt: inWeek });

    const res = await request(app).get(WEEKLY_URL).set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001') || res.body.data.myBest;
    expect(new Set(row.uiThemes)).toEqual(new Set(['skywatch', 'cbat']));
    expect(row.uiThemes).not.toContain(null);
    expect(row.uiThemes.length).toBe(2);
  });

  it('pads a quiet week with demo rows carrying a one-element uiThemes array', async () => {
    const res = await request(app).get(WEEKLY_URL).set('Cookie', cookie);
    const { leaderboard } = res.body.data;
    expect(leaderboard.length).toBeGreaterThan(0);
    leaderboard.forEach(e => {
      expect(Array.isArray(e.uiThemes)).toBe(true);
      expect(e.uiThemes.length).toBe(1);
      expect(UI_THEMES).toContain(e.uiThemes[0]);
    });
  });
});

// Angles' result route never reads uiTheme itself — the shared save helper
// stamps it — so it proves the field reaches every game, not just the ones
// whose Real CBAT variant is a different task.
describe('CBAT ui theme — every game carries it (angles)', () => {
  const ANGLES_URL = '/api/games/cbat/angles/result';
  const sample = { correctCount: 15, totalTime: 60, grade: 'Good' };

  it.each(UI_THEMES)('stores uiTheme "%s" on a result', async (theme) => {
    const res = await request(app).post(ANGLES_URL).set('Cookie', cookie).send({ ...sample, uiTheme: theme });
    expect(res.status).toBe(201);
    expect(res.body.data.uiTheme).toBe(theme);
  });

  it('normalises a missing or unknown uiTheme to null', async () => {
    const a = await request(app).post(ANGLES_URL).set('Cookie', cookie).send(sample);
    expect(a.body.data.uiTheme).toBeNull();
    const b = await request(app).post(ANGLES_URL).set('Cookie', cookie).send({ ...sample, uiTheme: 'neon' });
    expect(b.body.data.uiTheme).toBeNull();
  });

  it("shows the BEST run's uiTheme on the all-time board, for me and in the list", async () => {
    await request(app).post(ANGLES_URL).set('Cookie', cookie).send({ ...sample, correctCount: 10, uiTheme: 'skywatch' });
    await request(app).post(ANGLES_URL).set('Cookie', cookie).send({ ...sample, correctCount: 18, uiTheme: 'cbat' });
    const res = await request(app).get('/api/games/cbat/angles/leaderboard').set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001');
    expect(row.uiTheme).toBe('cbat');
    expect(res.body.data.myBest.uiTheme).toBe('cbat');
  });

  it('lists the distinct themes on the weekly board and pads demo rows with one', async () => {
    await request(app).post(ANGLES_URL).set('Cookie', cookie).send({ ...sample, uiTheme: 'cbat', playedAt: inWeek });
    await request(app).post(ANGLES_URL).set('Cookie', cookie).send({ ...sample, uiTheme: 'skywatch', playedAt: inWeek });
    const res = await request(app).get('/api/games/cbat/angles/leaderboard?period=weekly').set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001') || res.body.data.myBest;
    expect([...row.uiThemes].sort()).toEqual(['cbat', 'skywatch']);
    res.body.data.leaderboard.filter(e => e.isFake).forEach(e => {
      expect(e.uiThemes.length).toBe(1);
      expect(UI_THEMES).toContain(e.uiThemes[0]);
    });
  });

  it('pads the all-time board with demo rows that carry a theme', async () => {
    const res = await request(app).get('/api/games/cbat/angles/leaderboard').set('Cookie', cookie);
    const { leaderboard } = res.body.data;
    expect(leaderboard.length).toBe(20);
    leaderboard.forEach(e => expect(UI_THEMES).toContain(e.uiTheme));
  });
});

// Code Duplicates too: under the Real CBAT theme the count is picked from five
// numbered options over a 5-to-15 digit ramp rather than typed, so a score
// says which task it came from.
describe('CBAT ui theme — code-duplicates', () => {
  const url = '/api/games/cbat/code-duplicates/result';
  const sample = { correctCount: 9, easyCorrect: 4, mediumCorrect: 3, hardCorrect: 2, totalTime: 120, grade: 'Good' };

  it.each(UI_THEMES)('stores uiTheme "%s" on a result', async (theme) => {
    const res = await request(app).post(url).set('Cookie', cookie).send({ ...sample, uiTheme: theme });
    expect(res.status).toBe(201);
    expect(res.body.data.uiTheme).toBe(theme);
  });

  it('normalises a missing or unknown uiTheme to null', async () => {
    const a = await request(app).post(url).set('Cookie', cookie).send(sample);
    expect(a.body.data.uiTheme).toBeNull();
    const b = await request(app).post(url).set('Cookie', cookie).send({ ...sample, uiTheme: 'neon' });
    expect(b.body.data.uiTheme).toBeNull();
  });

  it("shows the BEST run's uiTheme on the all-time board and the set on the weekly one", async () => {
    await request(app).post(url).set('Cookie', cookie).send({ ...sample, correctCount: 7, uiTheme: 'skywatch', playedAt: inWeek });
    await request(app).post(url).set('Cookie', cookie).send({ ...sample, correctCount: 13, uiTheme: 'cbat', playedAt: inWeek });
    const all = await request(app).get('/api/games/cbat/code-duplicates/leaderboard').set('Cookie', cookie);
    const row = all.body.data.leaderboard.find(e => e.agentNumber === '1000001');
    expect(row.uiTheme).toBe('cbat');
    expect(all.body.data.myBest.uiTheme).toBe('cbat');
    const weekly = await request(app).get('/api/games/cbat/code-duplicates/leaderboard?period=weekly').set('Cookie', cookie);
    const mine = weekly.body.data.leaderboard.find(e => e.agentNumber === '1000001') || weekly.body.data.myBest;
    expect([...mine.uiThemes].sort()).toEqual(['cbat', 'skywatch']);
  });
});

// CUT: under the Real CBAT theme its Mission display is the real one (field
// entry + dispenser) rather than the station drop, so both its boards say
// which variant a score came from. Both difficulties, since each has its own
// collection.
describe.each(['cut', 'cut-easier'])('CBAT ui theme — %s', (key) => {
  const url = `/api/games/cbat/${key}/result`;
  const sample = { totalScore: 640, totalTime: 180, tasksCompleted: 12, tasksMissed: 2, warningSeconds: 9 };

  it.each(UI_THEMES)('stores uiTheme "%s" on a result', async (theme) => {
    const res = await request(app).post(url).set('Cookie', cookie).send({ ...sample, uiTheme: theme });
    expect(res.status).toBe(201);
    expect(res.body.data.uiTheme).toBe(theme);
  });

  it('normalises a missing or unknown uiTheme to null', async () => {
    const a = await request(app).post(url).set('Cookie', cookie).send(sample);
    expect(a.body.data.uiTheme).toBeNull();
    const b = await request(app).post(url).set('Cookie', cookie).send({ ...sample, uiTheme: 'neon' });
    expect(b.body.data.uiTheme).toBeNull();
  });

  it("shows the BEST run's uiTheme on the all-time board and the set on the weekly one", async () => {
    await request(app).post(url).set('Cookie', cookie).send({ ...sample, totalScore: 500, uiTheme: 'skywatch', playedAt: inWeek });
    await request(app).post(url).set('Cookie', cookie).send({ ...sample, totalScore: 900, uiTheme: 'cbat', playedAt: inWeek });
    const all = await request(app).get(`/api/games/cbat/${key}/leaderboard`).set('Cookie', cookie);
    const row = all.body.data.leaderboard.find(e => e.agentNumber === '1000001');
    expect(row.uiTheme).toBe('cbat');
    expect(all.body.data.myBest.uiTheme).toBe('cbat');
    const weekly = await request(app).get(`/api/games/cbat/${key}/leaderboard?period=weekly`).set('Cookie', cookie);
    const mine = weekly.body.data.leaderboard.find(e => e.agentNumber === '1000001') || weekly.body.data.myBest;
    expect([...mine.uiThemes].sort()).toEqual(['cbat', 'skywatch']);
  });
});
