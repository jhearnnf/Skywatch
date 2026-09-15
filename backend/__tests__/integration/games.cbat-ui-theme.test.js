// Which site theme a Symbols run was played under (constants/cbatUiThemes.js
// and CBAT_GAMES[key].uiTheme). The Real CBAT variant of Symbols is a
// different screen — numbered tiles answered by typing, a different glyph
// pool — so the board says which one a score came from. Covers the result
// route, both leaderboards surfacing it only for flagged games, and the demo
// padding that keeps the board looking real.

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

describe('CBAT ui theme — unflagged games are unaffected', () => {
  const ANGLES_URL = '/api/games/cbat/angles/result';
  const sample = { correctCount: 15, totalTime: 60, grade: 'Good' };

  it('carries no uiTheme key on the all-time board', async () => {
    await request(app).post(ANGLES_URL).set('Cookie', cookie).send({ ...sample, uiTheme: 'cbat' });
    const res = await request(app).get('/api/games/cbat/angles/leaderboard').set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001');
    expect(row).not.toHaveProperty('uiTheme');
    expect(res.body.data.myBest).not.toHaveProperty('uiTheme');
  });

  it('carries no uiThemes key on the weekly board', async () => {
    await request(app).post(ANGLES_URL).set('Cookie', cookie).send({ ...sample, uiTheme: 'cbat', playedAt: inWeek });
    const res = await request(app).get('/api/games/cbat/angles/leaderboard?period=weekly').set('Cookie', cookie);
    const row = res.body.data.leaderboard.find(e => e.agentNumber === '1000001') || res.body.data.myBest;
    expect(row).not.toHaveProperty('uiThemes');
  });
});
