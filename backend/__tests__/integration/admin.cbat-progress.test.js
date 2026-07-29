/**
 * Admin — GET /api/admin/users/:id/cbat-progress
 *
 * Backs the graph icon on the Users panel: one user's score-over-time series for a single
 * CBAT game, plus the list of games they've actually finished a run of.
 *
 * Covers:
 *   auth guards (401 unauthenticated, 403 non-admin, 404 unknown user)
 *   games list — played games only, ordered by first play
 *   default game = the first one they ever played
 *   explicit ?gameKey selection, including an unplayed one
 *   400 on an unknown gameKey
 *   chronological series + lifetime attempts + best (both score directions)
 *   modeFilter isolation for registry entries sharing one collection
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const { CBAT_GAMES } = require('../../constants/cbatGames');

let admin, cookie, user;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  admin  = await createAdminUser();
  cookie = authCookie(admin._id);
  user   = await createUser({ agentNumber: '1000042' });
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Superset of the fields the various result schemas mark required; mongoose strict mode drops
// the ones a given schema doesn't declare, so one shape covers every game.
const makeDoc = (cfg, userId, score, createdAt, time = 30) => ({
  userId,
  [cfg.primaryField]: score,
  totalTime: time,
  roundsPlayed: 5,
  score,
  ...(cfg.modeFilter ?? {}),
  ...(createdAt ? { createdAt } : {}),
});

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const seed = (gameKey, ...args) => CBAT_GAMES[gameKey].Model.create(makeDoc(CBAT_GAMES[gameKey], ...args));

const get = (qs = '') => request(app)
  .get(`/api/admin/users/${user._id}/cbat-progress${qs}`)
  .set('Cookie', cookie);

describe('GET /api/admin/users/:id/cbat-progress — auth guards', () => {
  it('returns 401 for an unauthenticated request', async () => {
    const res = await request(app).get(`/api/admin/users/${user._id}/cbat-progress`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const plain = await createUser();
    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-progress`)
      .set('Cookie', authCookie(plain._id));
    expect(res.status).toBe(403);
  });

  it('returns 404 when the target user does not exist', async () => {
    const res = await request(app)
      .get('/api/admin/users/507f1f77bcf86cd799439011/cbat-progress')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('returns 400 for an unknown gameKey', async () => {
    const res = await get('?gameKey=not-a-game');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/users/:id/cbat-progress — empty state', () => {
  it('returns no games and an empty series for a user who has never finished a run', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.games).toEqual([]);
    expect(res.body.data.gameKey).toBeNull();
    expect(res.body.data.series).toEqual([]);
    expect(res.body.data.attempts).toBe(0);
    expect(res.body.data.best).toBeNull();
    expect(res.body.data.user.agentNumber).toBe('1000042');
  });

  it('still serves an explicitly requested game the user has never played', async () => {
    const res = await get('?gameKey=angles');
    expect(res.status).toBe(200);
    expect(res.body.data.gameKey).toBe('angles');
    expect(res.body.data.series).toEqual([]);
    expect(res.body.data.attempts).toBe(0);
  });
});

describe('GET /api/admin/users/:id/cbat-progress — games list', () => {
  it('lists only games with a finished run, most played first', async () => {
    await seed('target', user._id, 100, daysAgo(3));
    await seed('angles', user._id, 4,   daysAgo(20));
    await seed('angles', user._id, 9,   daysAgo(1));
    await seed('angles', user._id, 6,   daysAgo(2));
    await seed('symbols', user._id, 7,  daysAgo(10));
    await seed('symbols', user._id, 9,  daysAgo(9));

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.games.map(g => g.gameKey)).toEqual(['angles', 'symbols', 'target']);
    expect(res.body.data.games.map(g => g.attempts)).toEqual([3, 2, 1]);
  });

  // Two games played the same number of times keep a stable, explainable order rather than
  // whatever the registry happened to iterate first.
  it('breaks a tie on run count with whichever game they picked up first', async () => {
    await seed('target',  user._id, 100, daysAgo(3));
    await seed('symbols', user._id, 7,   daysAgo(30));

    const res = await get();
    expect(res.body.data.games.map(g => g.gameKey)).toEqual(['symbols', 'target']);
  });

  // The picker disables a game the agent can't be charted on, so the flag has to come from here.
  it('flags which games have enough runs to chart', async () => {
    await seed('angles', user._id, 4, daysAgo(20));
    await seed('angles', user._id, 9, daysAgo(1));
    for (let i = 0; i < 3; i++) await seed('symbols', user._id, i, daysAgo(10 - i));

    const res = await get();
    const byKey = Object.fromEntries(res.body.data.games.map(g => [g.gameKey, g.chartable]));
    expect(byKey).toEqual({ angles: false, symbols: true });   // 2 runs vs 3
  });

  it('excludes other users runs from the list and the series', async () => {
    const other = await createUser({ agentNumber: '1000043' });
    await seed('angles', other._id, 12, daysAgo(2));
    await seed('angles', user._id,  3,  daysAgo(1));

    const res = await get();
    expect(res.body.data.games).toHaveLength(1);
    expect(res.body.data.games[0].attempts).toBe(1);
    expect(res.body.data.series.map(p => p.score)).toEqual([3]);
  });
});

describe('GET /api/admin/users/:id/cbat-progress — series', () => {
  // Their most-played game leads the picker, so it is also what opens — the selected pill is
  // never buried down the list.
  it('defaults to the game the user has played most', async () => {
    for (let i = 0; i < 3; i++) await seed('target', user._id, 100, daysAgo(30 - i));
    for (let i = 0; i < 5; i++) await seed('symbols', user._id, 8,  daysAgo(10 - i));

    const res = await get();
    expect(res.body.data.gameKey).toBe('symbols');
    expect(res.body.data.label).toBe(CBAT_GAMES['symbols'].label);
  });

  // Opening on a one-run game would show a dead panel the admin then has to click out of.
  it('skips past games with too few runs when picking the default', async () => {
    for (let i = 0; i < 2; i++) await seed('symbols', user._id, 8, daysAgo(30 - i));
    for (let i = 0; i < 3; i++) await seed('target', user._id, 100, daysAgo(10 - i));

    const res = await get();
    expect(res.body.data.gameKey).toBe('target');
  });

  it('falls back to the most played game when none is chartable yet', async () => {
    await seed('symbols', user._id, 8,   daysAgo(30));
    for (let i = 0; i < 2; i++) await seed('target', user._id, 100, daysAgo(10 - i));

    const res = await get();
    expect(res.body.data.gameKey).toBe('target');
    expect(res.body.data.series).toHaveLength(2);
  });

  it('honours an explicit gameKey over the default', async () => {
    await seed('symbols', user._id, 8,   daysAgo(30));
    await seed('target',  user._id, 100, daysAgo(2));

    const res = await get('?gameKey=target');
    expect(res.body.data.gameKey).toBe('target');
    expect(res.body.data.series.map(p => p.score)).toEqual([100]);
  });

  it('returns the series oldest → newest with lifetime attempts and the best score', async () => {
    await seed('angles', user._id, 3, daysAgo(1));
    await seed('angles', user._id, 1, daysAgo(9));
    await seed('angles', user._id, 7, daysAgo(5));

    const res = await get('?gameKey=angles');
    expect(res.body.data.series.map(p => p.score)).toEqual([1, 7, 3]);
    expect(res.body.data.attempts).toBe(3);
    expect(res.body.data.best).toBe(7);           // higher is better
    expect(res.body.data.lowerIsBetter).toBe(false);
  });

  it('reports the lowest score as best on a lower-is-better game', async () => {
    await seed('plane-turn-2d', user._id, 80, daysAgo(4));
    await seed('plane-turn-2d', user._id, 50, daysAgo(1));

    const res = await get('?gameKey=plane-turn-2d');
    expect(res.body.data.best).toBe(50);
    expect(res.body.data.lowerIsBetter).toBe(true);
  });

  it('keeps registry entries that share a collection separate via modeFilter', async () => {
    await seed('plane-turn-2d', user._id, 50, daysAgo(4));
    await seed('plane-turn-3d', user._id, 200, daysAgo(2));

    const res = await get('?gameKey=plane-turn-3d');
    expect(res.body.data.attempts).toBe(1);
    expect(res.body.data.series.map(p => p.score)).toEqual([200]);
    expect(res.body.data.games.map(g => g.gameKey)).toEqual(['plane-turn-2d', 'plane-turn-3d']);
  });

  it('caps the series at ?limit keeping the most recent runs, but reports lifetime attempts', async () => {
    for (let i = 0; i < 8; i++) await seed('angles', user._id, i, daysAgo(20 - i));

    const res = await get('?gameKey=angles&limit=3');
    expect(res.body.data.attempts).toBe(8);
    expect(res.body.data.series.map(p => p.score)).toEqual([5, 6, 7]);
  });

  it('omits the trend averages below six runs and supplies them at six', async () => {
    for (let i = 0; i < 5; i++) await seed('angles', user._id, i, daysAgo(20 - i));
    const short = await get('?gameKey=angles');
    expect(short.body.data.firstAvg).toBeNull();
    expect(short.body.data.lastAvg).toBeNull();

    await seed('angles', user._id, 5, daysAgo(15));
    const long = await get('?gameKey=angles');
    expect(long.body.data.firstAvg).not.toBeNull();
    expect(long.body.data.lastAvg).not.toBeNull();
  });

  // The endpoint resolves its config from CBAT_GAMES at call time, so a newly added game works
  // with no extra wiring. Locks that in — a registry entry whose model can't serve the query
  // fails here rather than 500ing in the admin panel.
  it('responds for every game in the CBAT_GAMES registry', async () => {
    for (const [gameKey, cfg] of Object.entries(CBAT_GAMES)) {
      await cfg.Model.create(makeDoc(cfg, user._id, 5));
      const res = await get(`?gameKey=${gameKey}`);
      expect([gameKey, res.status]).toEqual([gameKey, 200]);
      expect([gameKey, res.body.data.series.length]).toEqual([gameKey, 1]);
      expect([gameKey, res.body.data.series[0].score]).toEqual([gameKey, 5]);
    }
  });
});
