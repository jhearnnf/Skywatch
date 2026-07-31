process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, authCookie } = require('../helpers/factories');
const { CBAT_GAMES } = require('../../constants/cbatGames');
const { clearShowcaseCache, MIN_ATTEMPTS } = require('../../utils/cbatShowcase');

// Writes `scores` as one user's history on one game, oldest first — one run per
// day so the series has a real spread of dates. Target and FLAG share a result
// shape (totalScore + totalTime), which is why one writer covers both.
async function play(gameKey, userId, scores) {
  const Model = CBAT_GAMES[gameKey].Model;
  const start = Date.now() - scores.length * 86400000;
  for (let i = 0; i < scores.length; i++) {
    await Model.create({
      userId,
      totalScore: scores[i],
      totalTime: 120,
      grade: 'Good',
      createdAt: new Date(start + i * 86400000),
    });
  }
}

const playTarget = (userId, scores) => play('target', userId, scores);
const playFlag   = (userId, scores) => play('flag',   userId, scores);

// A history that starts at 100 and finishes around 200 — comfortably past the
// improvement floor, with the two trend windows disjoint.
const IMPROVING = [100, 100, 100, 100, 100, 150, 160, 180, 200, 200, 200, 200, 200];
const FLAT      = Array.from({ length: MIN_ATTEMPTS + 2 }, () => 100);

const get = () => request(app).get('/api/games/cbat/showcase');

beforeAll(async () => { await db.connect(); });
beforeEach(() => clearShowcaseCache());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('GET /api/games/cbat/showcase', () => {
  it('is public — a logged-out visitor gets the wall', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    await playTarget(user._id, IMPROVING);

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.panels.find(p => p.gameKey === 'target')).toBeTruthy();
  });

  it('reports the improvement between the first five and last five runs', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    await playTarget(user._id, IMPROVING);

    const { improvementPct, firstAvg, lastAvg, attempts, series } = (await get()).body.data.panels[0];
    expect(firstAvg).toBe(100);
    expect(lastAvg).toBe(200);
    expect(improvementPct).toBe(100);
    expect(attempts).toBe(IMPROVING.length);
    expect(series).toHaveLength(IMPROVING.length);
    expect(series[0].score).toBe(100);
  });

  // ── What a logged-out stranger must not be able to read ──────────────────
  // This endpoint is the only public view of CBAT scores; every leaderboard
  // route is behind `protect`. These four are the minimisation contract.

  it('names players by agent number, never by display name', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    await playTarget(user._id, IMPROVING);

    const res = await get();
    expect(res.body.data.panels[0].name).toMatch(/^Agent \d+$/);
    expect(JSON.stringify(res.body)).not.toContain('Falcon');
  });

  it('never dates a single run', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    await playTarget(user._id, IMPROVING);

    const { series } = (await get()).body.data.panels[0];
    for (const point of series) expect(Object.keys(point)).toEqual(['score']);
  });

  it('states elapsed time only as a whole number of days', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    await playTarget(user._id, IMPROVING);   // one run per day

    // 13 runs a day apart — 12 days between the first and the last.
    expect((await get()).body.data.panels[0].spanDays).toBe(IMPROVING.length - 1);
  });

  it('never exposes an email address', async () => {
    const user = await createUser({ email: 'pilot@example.com', displayName: 'Falcon' });
    await playTarget(user._id, IMPROVING);

    expect(JSON.stringify(await get())).not.toContain('pilot@example.com');
  });

  it('never shows the excluded dev account', async () => {
    const dev = await createUser({ displayName: 'SkyWatch_Dev' });
    await playTarget(dev._id, IMPROVING);

    expect((await get()).body.data.panels).toHaveLength(0);
  });

  it('never shows an admin account', async () => {
    const admin = await createAdminUser({ displayName: 'Overseer' });
    await playTarget(admin._id, IMPROVING);

    expect((await get()).body.data.panels).toHaveLength(0);
  });

  it('never shows a player who has opted out', async () => {
    const user = await createUser({ displayName: 'Private', hideFromShowcase: true });
    await playTarget(user._id, IMPROVING);

    expect((await get()).body.data.panels).toHaveLength(0);
  });

  it('honours an opt-out immediately, not after the cache expires', async () => {
    const user = await createUser({ displayName: 'Private' });
    const cookie = authCookie(user._id);
    await playTarget(user._id, IMPROVING);

    // Warm the pool cache by rendering the wall once with them on it.
    expect((await get()).body.data.panels).toHaveLength(1);

    const res = await request(app)
      .patch('/api/users/me/showcase')
      .set('Cookie', cookie)
      .send({ visible: false });
    expect(res.status).toBe(200);

    // No waiting out the five-minute pool cache.
    expect((await get()).body.data.panels).toHaveLength(0);
  });

  it('lets a player opt back in', async () => {
    const user = await createUser({ displayName: 'Private', hideFromShowcase: true });
    await playTarget(user._id, IMPROVING);
    expect((await get()).body.data.panels).toHaveLength(0);

    await request(app)
      .patch('/api/users/me/showcase')
      .set('Cookie', authCookie(user._id))
      .send({ visible: true });

    expect((await get()).body.data.panels).toHaveLength(1);
  });

  it('rejects a non-boolean opt-out', async () => {
    const user = await createUser({});
    const res = await request(app)
      .patch('/api/users/me/showcase')
      .set('Cookie', authCookie(user._id))
      .send({ visible: 'no' });

    expect(res.status).toBe(400);
  });

  it('skips a player who has not improved', async () => {
    const user = await createUser({ displayName: 'Plateau' });
    await playTarget(user._id, FLAT);

    expect((await get()).body.data.panels).toHaveLength(0);
  });

  it('skips a player with too few runs to compare two windows', async () => {
    const user = await createUser({ displayName: 'Rookie' });
    await playTarget(user._id, [100, 100, 100, 200, 200, 200]); // improved, but < MIN_ATTEMPTS

    expect((await get()).body.data.panels).toHaveLength(0);
  });

  it('omits a game nobody qualifies for rather than inventing a panel', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    await playTarget(user._id, IMPROVING);

    // Only Target has been played, so DPT and FLAG are simply absent.
    const keys = (await get()).body.data.panels.map(p => p.gameKey);
    expect(keys).toEqual(['target']);
  });

  it('prefers a different player on each panel', async () => {
    // Two players, both qualified on both games. The wall should name both
    // rather than putting the same person on two cards.
    const a = await createUser({ displayName: 'Alpha' });
    const b = await createUser({ displayName: 'Bravo' });
    for (const id of [a._id, b._id]) {
      await playTarget(id, IMPROVING);
      await playFlag(id, IMPROVING);
    }

    const names = (await get()).body.data.panels.map(p => p.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);   // two different agent numbers
  });

  it('reuses a player rather than dropping a panel when nobody else qualifies', async () => {
    const solo = await createUser({ displayName: 'Solo' });
    await playTarget(solo._id, IMPROVING);
    await playFlag(solo._id, IMPROVING);

    const names = (await get()).body.data.panels.map(p => p.name);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(names[1]);   // the same agent on both panels, rather than one panel
  });

  it('never exposes account ids', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    await playTarget(user._id, IMPROVING);

    expect((await get()).body.data.panels[0].userId).toBeUndefined();
  });

  it('varies which top-ten player it picks across page loads', async () => {
    for (let i = 0; i < 4; i++) {
      const user = await createUser({ displayName: `Pilot${i}` });
      // Same shape of history for each, offset so they hold different board
      // positions — every one of them is a valid pick.
      await playTarget(user._id, IMPROVING.map(s => s + i));
    }

    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      seen.add((await get()).body.data.panels[0].name);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
