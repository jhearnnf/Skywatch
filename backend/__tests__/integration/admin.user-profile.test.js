/**
 * Admin — GET /api/admin/users/:id/profile
 *
 * Backs the read-only agent profile page, opened from the user card in
 * Community. One read that answers "who is this account": identity and
 * standing, the aircraft badges they have collected, and their CBAT record.
 *
 * Covers:
 *   auth guards (401 unauthenticated, 403 non-admin, 404 unknown/malformed id)
 *   identity + standing fields, including the resolved worn badge
 *   badge split — earned vs locked vs pending (read, but no cutout yet)
 *   badges ignore the viewer's slim mode (unlike /api/users/me/badge-options)
 *   CBAT record — attempts, personal best in both score directions, ordering
 *   modeFilter isolation for registry entries sharing one collection
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createBrief, createSettings, authCookie } = require('../helpers/factories');
const { CBAT_GAMES } = require('../../constants/cbatGames');
const Media = require('../../models/Media');
const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');

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

const get = () => request(app)
  .get(`/api/admin/users/${user._id}/profile`)
  .set('Cookie', cookie);

// Superset of the fields the various CBAT result schemas mark required; strict
// mode drops the ones a given schema does not declare, so one shape fits all.
const seedRun = (gameKey, score, createdAt) => {
  const cfg = CBAT_GAMES[gameKey];
  return cfg.Model.create({
    userId: user._id,
    [cfg.primaryField]: score,
    totalTime: 30,
    roundsPlayed: 5,
    score,
    ...(cfg.modeFilter ?? {}),
    ...(createdAt ? { createdAt } : {}),
  });
};

// An Aircraft brief that can be collected: published, in the Aircrafts
// category, and carrying a Media with a cutout to draw.
const aircraftBrief = async (title, { cutout = true } = {}) => {
  const media = await Media.create({
    mediaType: 'picture',
    mediaUrl: `https://example.test/${title}.png`,
    ...(cutout ? { cutoutUrl: `https://example.test/${title}-cutout.png` } : {}),
  });
  return createBrief({
    title,
    category: 'Aircrafts',
    subcategory: 'Fast Jet',
    status: 'published',
    media: [media._id],
  });
};

const markRead = (brief) => IntelligenceBriefRead.create({
  userId: user._id, intelBriefId: brief._id, completed: true,
});

describe('GET /api/admin/users/:id/profile — auth guards', () => {
  it('returns 401 for an unauthenticated request', async () => {
    const res = await request(app).get(`/api/admin/users/${user._id}/profile`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user, including for their own account', async () => {
    const plain = await createUser();
    const res = await request(app)
      .get(`/api/admin/users/${plain._id}/profile`)
      .set('Cookie', authCookie(plain._id));
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await request(app)
      .get('/api/admin/users/507f1f77bcf86cd799439011/profile')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('returns 404 rather than 500 for a malformed id', async () => {
    const res = await request(app)
      .get('/api/admin/users/not-an-id/profile')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/users/:id/profile — identity and standing', () => {
  it('returns the fields the profile header renders', async () => {
    await User_update({ displayName: 'Viper', loginStreak: 4, totalAirstars: 900, cycleAirstars: 250, cbatPassed: true });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      displayName:   'Viper',
      agentNumber:   '1000042',
      loginStreak:   4,
      totalAirstars: 900,
      cycleAirstars: 250,
      cbatPassed:    true,
      isAdmin:       false,
      isBanned:      false,
    });
    expect(res.body.data.user.email).toBeTruthy();
  });

  it('resolves the worn badge rather than returning a bare brief id', async () => {
    const brief = await aircraftBrief('Typhoon');
    await markRead(brief);
    await User_update({ selectedBadgeBriefId: brief._id });

    const res = await get();
    expect(res.body.data.user.selectedBadge).toMatchObject({ title: 'Typhoon' });
    expect(res.body.data.user.selectedBadge.cutoutUrl).toContain('Typhoon-cutout');
  });
});

describe('GET /api/admin/users/:id/profile — badge collection', () => {
  it('splits collectable aircraft into earned and locked', async () => {
    const read   = await aircraftBrief('Typhoon');
    await aircraftBrief('Hawk T2');
    await markRead(read);

    const res = await get();
    expect(res.body.data.badges.earned.map(b => b.title)).toEqual(['Typhoon']);
    expect(res.body.data.badges.locked.map(b => b.title)).toEqual(['Hawk T2']);
  });

  it('counts a read brief with no cutout as pending, in neither list', async () => {
    const noCutout = await aircraftBrief('Chinook', { cutout: false });
    await markRead(noCutout);

    const res = await get();
    expect(res.body.data.badges.earned).toHaveLength(0);
    expect(res.body.data.badges.locked).toHaveLength(0);
    expect(res.body.data.badges.pendingCount).toBe(1);
  });

  it('ignores the viewing admin\'s slim mode — this reports what the agent earned', async () => {
    await aircraftBrief('Typhoon');
    const res = await request(app)
      .get(`/api/admin/users/${user._id}/profile`)
      .set('Cookie', cookie)
      .set('X-Slim-App', '1');
    // Slim mode unlocks every cutout on the agent's OWN badge picker. Here it
    // must not, or the admin's client would be read as the agent's collection.
    expect(res.body.data.badges.earned).toHaveLength(0);
    expect(res.body.data.badges.locked.map(b => b.title)).toEqual(['Typhoon']);
  });
});

describe('GET /api/admin/users/:id/profile — CBAT record', () => {
  it('reports attempts and the personal best on a higher-is-better game', async () => {
    await seedRun('flag', 120);
    await seedRun('flag', 300);
    await seedRun('flag', 210);

    const res = await get();
    const flag = res.body.data.cbatGames.find(g => g.gameKey === 'flag');
    expect(flag).toMatchObject({ attempts: 3, best: 300 });
    expect(res.body.data.stats.cbatFinished).toBe(3);
  });

  it('takes the lowest score as the best on a lower-is-better game', async () => {
    await seedRun('plane-turn-2d', 9);
    await seedRun('plane-turn-2d', 4);

    const res = await get();
    const trace = res.body.data.cbatGames.find(g => g.gameKey === 'plane-turn-2d');
    expect(trace.best).toBe(4);
  });

  it('keeps two registry entries sharing one collection apart', async () => {
    await seedRun('plane-turn-2d', 5);
    await seedRun('plane-turn-3d', 8);

    const res = await get();
    const keys = res.body.data.cbatGames.map(g => g.gameKey).sort();
    expect(keys).toEqual(['plane-turn-2d', 'plane-turn-3d']);
    expect(res.body.data.cbatGames.find(g => g.gameKey === 'plane-turn-2d').attempts).toBe(1);
  });

  it('lists games most played first and omits games never finished', async () => {
    await seedRun('flag', 100);
    await seedRun('angles', 10);
    await seedRun('angles', 12);

    const res = await get();
    expect(res.body.data.cbatGames.map(g => g.gameKey)).toEqual(['angles', 'flag']);
  });

  it('returns an empty record for an agent who has never finished a test', async () => {
    const res = await get();
    expect(res.body.data.cbatGames).toEqual([]);
    expect(res.body.data.stats.cbatFinished).toBe(0);
  });
});

describe('GET /api/admin/users/:id/profile — leaderboard standing', () => {
  // Every board a player sees is padded with demo agents, and those rows occupy
  // real places on screen. Both numbers here are ranked against that padded
  // board, so the page can never claim a place the leaderboard does not show.
  it('reports a top score as first place, with the gold medal to match', async () => {
    await seedRun('flag', 500);

    const res = await get();
    const flag = res.body.data.cbatGames.find(g => g.gameKey === 'flag');
    expect(flag.boardRank).toBe(1);
    expect(res.body.data.medals).toEqual([
      { gameKey: 'flag', gameLabel: 'FLAG (Hard)', rank: 1 },
    ]);
  });

  it('counts the demo agents above them as the places they visibly occupy', async () => {
    // Angles' demo board opens 18, 17, 15. A real 16 sits third, not first.
    await seedRun('angles', 16);

    const res = await get();
    const angles = res.body.data.cbatGames.find(g => g.gameKey === 'angles');
    expect(angles.boardRank).toBe(3);
    expect(res.body.data.medals).toEqual([
      { gameKey: 'angles', gameLabel: 'Angles', rank: 3 },
    ]);
  });

  it('reports no position at all for a score off the bottom of the board', async () => {
    // FLAG always draws its full demo sequence, whose lowest row is 75.
    await seedRun('flag', 50);

    const res = await get();
    const flag = res.body.data.cbatGames.find(g => g.gameKey === 'flag');
    expect(flag.boardRank).toBeNull();
    expect(res.body.data.medals).toEqual([]);
  });

  it('lists several medals best first', async () => {
    await seedRun('angles', 16);   // bronze
    await seedRun('flag', 500);    // gold

    const res = await get();
    expect(res.body.data.medals.map(m => m.rank)).toEqual([1, 3]);
    expect(res.body.data.medals[0].gameKey).toBe('flag');
  });

  it('returns no medals for an agent who has finished nothing', async () => {
    const res = await get();
    expect(res.body.data.medals).toEqual([]);
  });
});

// Small helper kept at the bottom: several tests need to set a field on the
// target user after creation, and the factory only builds one.
async function User_update(fields) {
  const User = require('../../models/User');
  await User.findByIdAndUpdate(user._id, fields);
}
