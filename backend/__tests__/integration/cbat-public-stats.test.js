/**
 * GET /api/games/cbat/public-stats
 *
 * Anonymous practice totals baked into the public CBAT test pages at build time.
 *
 * Covers:
 *   public (no auth), and the payload carries no ids, names or per-user values
 *   runs total + the improvement share for a test with enough data
 *   small numbers are withheld, not rounded
 *   admin and bot accounts are left out
 *   summarise() pools boards and applies both floors
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings } = require('../helpers/factories');
const { CBAT_GAMES } = require('../../constants/cbatGames');
const {
  summarise, resetCbatPublicStatsCache, MIN_RUNS_SHOWN, MIN_COHORT, IMPROVE_MIN_RUNS,
} = require('../../utils/cbatPublicStats');

const cfg = CBAT_GAMES.dad; // one board, higher is better

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); resetCbatPublicStatsCache(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const t0 = Date.now() - 1000 * 60 * 60 * 24 * 30;
const docs = (userId, scores) => scores.map((score, i) => ({
  userId,
  [cfg.primaryField]: score,
  totalTime: 30,
  roundsPlayed: 5,
  score,
  createdAt: new Date(t0 + i * 60000),
}));

// `improvers` players go 2,2,2 ... 8,8,8; the rest go 8,8,8 ... 2,2,2.
async function seedPlayers(count, improvers, makeUser = (i) => createUser({ agentNumber: String(2000000 + i) })) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const u = await makeUser(i);
    const up = i < improvers;
    const scores = Array.from({ length: IMPROVE_MIN_RUNS }, (_, r) => (r < 3 ? (up ? 2 : 8) : r >= 7 ? (up ? 8 : 2) : 5));
    rows.push(...docs(u._id, scores));
  }
  await cfg.Model.insertMany(rows);
}

const get = () => request(app).get('/api/games/cbat/public-stats');

describe('GET /api/games/cbat/public-stats', () => {
  it('is public and returns every registry test', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.tests.dad).toEqual({ runs: null, improvedPct: null, cohort: null });
    expect(Object.keys(res.body.data.tests)).toContain('flag');
  });

  it('publishes the run total and the improvement share once there is enough data', async () => {
    await seedPlayers(MIN_COHORT, 15);
    const { dad } = (await get()).body.data.tests;
    expect(dad.runs).toBe(MIN_COHORT * IMPROVE_MIN_RUNS);
    expect(dad.cohort).toBe(MIN_COHORT);
    expect(dad.improvedPct).toBe(75);
  });

  it('withholds small numbers instead of rounding them', async () => {
    await seedPlayers(MIN_COHORT - 1, 10);
    const { dad } = (await get()).body.data.tests;
    expect(dad.runs).toBeNull();
    expect(dad.improvedPct).toBeNull();
  });

  it('leaves admin and bot accounts out', async () => {
    await seedPlayers(MIN_COHORT - 1, 10);
    await seedPlayers(2, 2, (i) => (i === 0
      ? createAdminUser({ agentNumber: '3000001' })
      : createUser({ agentNumber: '3000002', isBot: true })));
    const { dad } = (await get()).body.data.tests;
    expect(dad.cohort).toBeNull();
  });

  it('never carries ids, names or per-user values', async () => {
    await seedPlayers(MIN_COHORT, 10);
    const text = JSON.stringify((await get()).body);
    expect(text).not.toMatch(/[0-9a-f]{24}/);
    expect(text).not.toMatch(/userId|agentNumber|displayName|email|createdAt/);
  });
});

describe('summarise()', () => {
  it('pools boards before applying the floors', () => {
    const half = { runs: MIN_RUNS_SHOWN / 2, cohort: MIN_COHORT / 2, improved: 5 };
    expect(summarise([half])).toEqual({ runs: null, improvedPct: null, cohort: null });
    expect(summarise([half, half])).toEqual({ runs: MIN_RUNS_SHOWN, improvedPct: 50, cohort: MIN_COHORT });
  });
});
