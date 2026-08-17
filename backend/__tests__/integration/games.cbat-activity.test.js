process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatStart = require('../../models/GameSessionCbatStart');
const {
  clearActivityStatsCache, startOfDayInTz, QUIET_BELOW_PLAYS,
} = require('../../utils/cbatActivityStats');

const ROUTE = '/api/games/cbat/activity';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

// Seed `count` starts for one user at a fixed instant.
const seedStarts = (userId, at, count, gameKey = 'angles') =>
  GameSessionCbatStart.insertMany(
    Array.from({ length: count }, () => ({ userId, gameKey, startedAt: at }))
  );

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); clearActivityStatsCache(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('GET /api/games/cbat/activity', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).get(ROUTE);
    expect(res.status).toBe(401);
  });

  it('counts every start in the last 7 days, not just finished runs', async () => {
    const user = await createUser({ agentNumber: '4000001' });
    // Comfortably inside the window, and above the quiet threshold.
    await seedStarts(user._id, new Date(Date.now() - 2 * DAY_MS), QUIET_BELOW_PLAYS + 5);

    const res = await request(app).get(ROUTE).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.plays7d).toBe(QUIET_BELOW_PLAYS + 5);
  });

  it('excludes starts older than 7 days', async () => {
    const user = await createUser({ agentNumber: '4000002' });
    await seedStarts(user._id, new Date(Date.now() - 2 * DAY_MS), QUIET_BELOW_PLAYS);
    await seedStarts(user._id, new Date(Date.now() - 8 * DAY_MS), 50);

    const res = await request(app).get(ROUTE).set('Cookie', authCookie(user._id));
    expect(res.body.data.plays7d).toBe(QUIET_BELOW_PLAYS);
  });

  it('counts each agent once per day however many games they start', async () => {
    const a = await createUser({ agentNumber: '4000003' });
    const b = await createUser({ agentNumber: '4000004' });
    // Just after local midnight, so the rows land in today's bucket whatever
    // time the suite runs.
    const today = new Date(startOfDayInTz().getTime() + HOUR_MS);
    await seedStarts(a._id, today, 6);
    await seedStarts(b._id, today, 4);

    const res = await request(app).get(ROUTE).set('Cookie', authCookie(a._id));
    expect(res.body.data.plays7d).toBe(10);
    expect(res.body.data.agentsToday).toBe(2);
  });

  it('does not count yesterday\'s players as active today', async () => {
    const user = await createUser({ agentNumber: '4000005' });
    const yesterday = new Date(startOfDayInTz().getTime() - HOUR_MS);
    await seedStarts(user._id, yesterday, QUIET_BELOW_PLAYS);

    const res = await request(app).get(ROUTE).set('Cookie', authCookie(user._id));
    expect(res.body.data.plays7d).toBe(QUIET_BELOW_PLAYS);
    expect(res.body.data.agentsToday).toBe(0);
  });

  // The counters are never padded, so the honest answer on a quiet site is a
  // small number — the flag lets the client draw nothing rather than shout it.
  it('flags a quiet week instead of inflating it', async () => {
    const user = await createUser({ agentNumber: '4000006' });
    await seedStarts(user._id, new Date(Date.now() - HOUR_MS), QUIET_BELOW_PLAYS - 1);

    const res = await request(app).get(ROUTE).set('Cookie', authCookie(user._id));
    expect(res.body.data.quiet).toBe(true);
    expect(res.body.data.plays7d).toBe(QUIET_BELOW_PLAYS - 1);
  });

  it('reports an empty site as zero rather than a floor', async () => {
    const user = await createUser({ agentNumber: '4000007' });

    const res = await request(app).get(ROUTE).set('Cookie', authCookie(user._id));
    expect(res.body.data).toEqual({ plays7d: 0, agentsToday: 0, quiet: true });
  });
});
