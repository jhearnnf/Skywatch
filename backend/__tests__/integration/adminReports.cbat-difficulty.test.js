process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatStart = require('../../models/GameSessionCbatStart');
const { CBAT_GAMES, cbatLabelWithDifficulty } = require('../../constants/cbatGames');

let admin, cookie, u1, u2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  admin  = await createAdminUser({ agentNumber: '1000099' });
  cookie = authCookie(admin._id);
  u1 = await createUser({ agentNumber: '1000001' });
  u2 = await createUser({ agentNumber: '1000002' });
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// FLAG's and CUT's difficulties are separate CBAT_GAMES entries backed by
// separate collections, and the CBAT report is registry-driven — so they should
// already report independently, with no per-difficulty code in adminReports.js.
// This pins that: a difficulty that stopped showing up (or that folded its
// numbers into the other one) would be silent data loss on the Reports page.
describe('GET /api/admin/reports/cbat — FLAG difficulties report separately', () => {
  const result = (score) => ({
    totalScore: score, mathCorrect: 3, mathWrong: 0, mathTimeout: 0,
    aircraftCorrect: 2, aircraftWrong: 0, aircraftMissed: 0,
    targetHits: 4, targetMisses: 0, aircraftsSeen: 3,
    totalTime: 60, grade: 'Good',
  });

  it('gives each difficulty its own labelled series and per-game row', async () => {
    const hard = authCookie(u1._id);
    const easy = authCookie(u2._id);
    await request(app).post('/api/games/cbat/flag/result').set('Cookie', hard).send(result(300));
    await request(app).post('/api/games/cbat/flag-easier/result').set('Cookie', easy).send(result(150));
    await request(app).post('/api/games/cbat/flag-easier/result').set('Cookie', hard).send(result(120));

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;

    expect(data.gameKeys).toEqual(expect.arrayContaining(['flag', 'flag-easier']));
    // Both halves name their difficulty. The two sit in the same table and the
    // same stacked chart, where a bare "FLAG" reads as "all FLAG", not as Hard.
    expect(data.gameLabels['flag']).toBe('FLAG (Hard)');
    expect(data.gameLabels['flag-easier']).toBe('FLAG (Easier)');

    const hardRow = data.perGame.find(g => g.key === 'flag');
    const easyRow = data.perGame.find(g => g.key === 'flag-easier');
    expect(hardRow.label).toBe('FLAG (Hard)');
    expect(easyRow.label).toBe('FLAG (Easier)');
    expect(hardRow.sessions).toBe(1);
    expect(hardRow.players).toBe(1);
    expect(easyRow.sessions).toBe(2);
    expect(easyRow.players).toBe(2);
  });

  it('scopes abandon % to the difficulty that was started', async () => {
    // Two Easier starts, one of which produced a result; one Hard start that
    // didn't. The starts are keyed by gameKey, so they must not cross over.
    await GameSessionCbatStart.create([
      { userId: u1._id, gameKey: 'flag-easier', clientStartId: 'e1' },
      { userId: u2._id, gameKey: 'flag-easier', clientStartId: 'e2' },
      { userId: u1._id, gameKey: 'flag',        clientStartId: 'h1' },
    ]);
    await request(app).post('/api/games/cbat/flag-easier/result')
      .set('Cookie', authCookie(u1._id)).send(result(150));

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    const easyRow = res.body.data.perGame.find(g => g.key === 'flag-easier');
    const hardRow = res.body.data.perGame.find(g => g.key === 'flag');
    // abandonPct is a 0–1 fraction, not a percentage.
    expect(easyRow.abandonPct).toBe(0.5);  // 2 starts, 1 result
    expect(hardRow.abandonPct).toBe(1);    // 1 start, no result
  });
});

// The two cases above pin FLAG and CUT by name because those are the ones an
// admin reads most. This one covers the rest by walking the registry, so adding
// a `-easier` entry without teaching the report to say "(Hard)" fails here
// rather than shipping a chart legend nobody can read.
describe('GET /api/admin/reports/cbat — every split game names both difficulties', () => {
  it('labels each half of each split game, and leaves unsplit games bare', async () => {
    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    const { gameLabels } = res.body.data;
    const easierKeys = Object.keys(CBAT_GAMES).filter(k => k.endsWith('-easier'));
    expect(easierKeys.length).toBeGreaterThan(0);

    for (const easierKey of easierKeys) {
      const hardKey = easierKey.replace(/-easier$/, '');
      expect(gameLabels[easierKey]).toContain('(Easier)');
      expect(gameLabels[hardKey]).toBe(`${CBAT_GAMES[hardKey].label} (Hard)`);
    }

    for (const [key, cfg] of Object.entries(CBAT_GAMES)) {
      if (key.endsWith('-easier') || CBAT_GAMES[`${key}-easier`]) continue;
      expect(gameLabels[key]).toBe(cfg.label);
    }

    // And the table rows agree with the chart legend.
    for (const row of res.body.data.perGame) {
      if (row.isTutorial) continue;
      expect(row.label).toBe(cbatLabelWithDifficulty(row.key));
    }
  });
});

describe('GET /api/admin/reports/cbat — CUT difficulties report separately', () => {
  const result = (score) => ({
    totalScore: score, totalTime: 180, tasksCompleted: 6, tasksMissed: 1, warningSeconds: 20,
  });

  it('gives each difficulty its own labelled series and per-game row', async () => {
    await request(app).post('/api/games/cbat/cut/result')
      .set('Cookie', authCookie(u1._id)).send(result(900));
    await request(app).post('/api/games/cbat/cut-easier/result')
      .set('Cookie', authCookie(u2._id)).send(result(400));

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    const { data } = res.body;
    expect(data.gameKeys).toEqual(expect.arrayContaining(['cut', 'cut-easier']));
    expect(data.gameLabels['cut']).toBe('Cognitive Updating Test (Hard)');
    expect(data.gameLabels['cut-easier']).toBe('Cognitive Updating Test (Easier)');
    expect(data.perGame.find(g => g.key === 'cut').sessions).toBe(1);
    expect(data.perGame.find(g => g.key === 'cut-easier').sessions).toBe(1);
  });
});
