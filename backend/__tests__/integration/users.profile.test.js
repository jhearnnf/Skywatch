/**
 * Users — GET /api/users/:id/profile
 *
 * The public half of the agent profile page: what any signed-in agent may read
 * about another. It must carry the name, the worn badge and the best score on
 * every test, and it must NOT carry anything the admin endpoint reserves —
 * account facts, play counts, board places.
 *
 * Covers:
 *   auth guard (401 signed out, 404 unknown/malformed id), open to non-admins
 *   identity — name, agent number, resolved worn badge, pass mark
 *   CBAT record — best in both score directions, most played first, played only
 *   leaderboard medals — the same podium places chat hangs off the avatar
 *   the fields that must stay admin only are absent
 *   Score Sharing opt-out (hideFromShowcase) empties the record and says so
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createBrief, createSettings, authCookie } = require('../helpers/factories');
const { CBAT_GAMES } = require('../../constants/cbatGames');
const Media = require('../../models/Media');
const User  = require('../../models/User');
const { resetMedalHoldersCache } = require('../../utils/cbatMedalHolders');
const { clearScoreSharingCache } = require('../../utils/cbatScoreSharing');

let viewer, cookie, user;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  resetMedalHoldersCache();
  clearScoreSharingCache();
  viewer = await createUser();
  cookie = authCookie(viewer._id);
  user   = await createUser({ agentNumber: '1000042', displayName: 'Viper' });
});
afterEach(async () => { await db.clearDatabase(); resetMedalHoldersCache(); clearScoreSharingCache(); });
afterAll(async () => db.closeDatabase());

const get = () => request(app)
  .get(`/api/users/${user._id}/profile`)
  .set('Cookie', cookie);

const seedRun = (gameKey, score) => {
  const cfg = CBAT_GAMES[gameKey];
  return cfg.Model.create({
    userId: user._id,
    [cfg.primaryField]: score,
    totalTime: 30,
    roundsPlayed: 5,
    score,
    ...(cfg.modeFilter ?? {}),
  });
};

describe('GET /api/users/:id/profile — who may read it', () => {
  it('returns 401 when signed out', async () => {
    const res = await request(app).get(`/api/users/${user._id}/profile`);
    expect(res.status).toBe(401);
  });

  it('is open to an ordinary signed-in agent', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBe('Viper');
  });

  it('returns 404 for an unknown user', async () => {
    const res = await request(app)
      .get('/api/users/507f1f77bcf86cd799439011/profile')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('returns 404 rather than 500 for a malformed id', async () => {
    const res = await request(app).get('/api/users/not-an-id/profile').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/users/:id/profile — identity', () => {
  it('returns the name, agent number and pass mark', async () => {
    await User.findByIdAndUpdate(user._id, { cbatPassed: true });
    const res = await get();
    expect(res.body.data.user).toMatchObject({
      displayName: 'Viper', agentNumber: '1000042', cbatPassed: true, isBot: false,
    });
  });

  // The Supporter mark is derived from the webhook's `donatedAt` stamp, never
  // stored as its own flag, so the route has to compute it from the sub-doc.
  it('marks a signed-in donor as a supporter, and nobody else', async () => {
    expect((await get()).body.data.user.supporter).toBe(false);
    await User.findByIdAndUpdate(user._id, { 'donationPrompt.donatedAt': new Date() });
    expect((await get()).body.data.user.supporter).toBe(true);
  });

  it('resolves the worn badge rather than returning a bare brief id', async () => {
    const media = await Media.create({
      mediaType: 'picture',
      mediaUrl: 'https://example.test/Typhoon.png',
      cutoutUrl: 'https://example.test/Typhoon-cutout.png',
    });
    const brief = await createBrief({
      title: 'Typhoon', category: 'Aircrafts', subcategory: 'Fast Jet',
      status: 'published', media: [media._id],
    });
    await User.findByIdAndUpdate(user._id, { selectedBadgeBriefId: brief._id });

    const res = await get();
    expect(res.body.data.user.selectedBadge).toMatchObject({ title: 'Typhoon' });
    expect(res.body.data.user.selectedBadge.cutoutUrl).toContain('Typhoon-cutout');
  });
});

describe('GET /api/users/:id/profile — CBAT record', () => {
  it('reports the personal best on a higher-is-better game', async () => {
    await seedRun('flag', 120);
    await seedRun('flag', 300);
    await seedRun('flag', 210);

    const res = await get();
    expect(res.body.data.cbatGames.find(g => g.gameKey === 'flag').best).toBe(300);
  });

  it('takes the lowest score as the best on a lower-is-better game', async () => {
    await seedRun('plane-turn-2d', 9);
    await seedRun('plane-turn-2d', 4);

    const res = await get();
    expect(res.body.data.cbatGames.find(g => g.gameKey === 'plane-turn-2d').best).toBe(4);
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
  });
});

describe('GET /api/users/:id/profile — Score Sharing opt-out', () => {
  it('sends no scores for a player who has opted out, and says so', async () => {
    await seedRun('flag', 500);
    await User.findByIdAndUpdate(user._id, { hideFromShowcase: true });

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.scoresHidden).toBe(true);
    expect(res.body.data.cbatGames).toEqual([]);
    // Who they are is still there: chat shows that much anyway.
    expect(res.body.data.user.displayName).toBe('Viper');
  });

  it('reports scoresHidden false for everyone else', async () => {
    const res = await get();
    expect(res.body.data.scoresHidden).toBe(false);
  });

  it('is the same switch as the homepage wall, so one objection covers both', async () => {
    await seedRun('flag', 500);
    const res1 = await request(app).patch('/api/users/me/showcase')
      .set('Cookie', authCookie(user._id)).send({ visible: false });
    expect(res1.status).toBe(200);

    const res = await get();
    expect(res.body.data.scoresHidden).toBe(true);
    expect(res.body.data.cbatGames).toEqual([]);
  });
});

describe('GET /api/users/:id/profile — leaderboard medals', () => {
  // Public because they already are: the same podium places hang off the
  // avatar in every chat channel. Ranked against the padded board a player
  // sees, so a medal here is one the leaderboard shows too.
  it('reports a top score as the gold medal', async () => {
    await seedRun('flag', 500);
    const res = await get();
    expect(res.body.data.medals).toEqual([
      { gameKey: 'flag', gameLabel: 'FLAG (Hard)', rank: 1 },
    ]);
  });

  it('counts the demo agents above them as the places they visibly occupy', async () => {
    // Angles' demo board opens 18, 17, 15. A real 16 sits third, not first.
    await seedRun('angles', 16);
    const res = await get();
    expect(res.body.data.medals).toEqual([
      { gameKey: 'angles', gameLabel: 'Angles', rank: 3 },
    ]);
  });

  it('returns no medals for a score off the podium, and none for an agent who has finished nothing', async () => {
    expect((await get()).body.data.medals).toEqual([]);
    await seedRun('flag', 50);
    resetMedalHoldersCache();
    expect((await get()).body.data.medals).toEqual([]);
  });

  it('reports no medals for a player who has opted out of Score Sharing: they are off the boards', async () => {
    await seedRun('flag', 500);
    await User.updateOne({ _id: user._id }, { hideFromShowcase: true });
    clearScoreSharingCache(); resetMedalHoldersCache();
    const res = await get();
    expect(res.body.data.scoresHidden).toBe(true);
    expect(res.body.data.cbatGames).toEqual([]);
    expect(res.body.data.medals).toEqual([]);
  });
});

describe('GET /api/users/:id/profile — what stays admin only', () => {
  it('carries no account facts', async () => {
    const res = await get();
    const u = res.body.data.user;
    for (const field of ['email', 'createdAt', 'lastSeen', 'loginStreak', 'totalAirstars',
      'cycleAirstars', 'subscriptionTier', 'difficultySetting', 'isBanned', 'isTester', 'rank']) {
      expect(u).not.toHaveProperty(field);
    }
  });

  it('carries no play counts, dates or board places', async () => {
    await seedRun('flag', 500);
    const res = await get();
    expect(res.body.data).not.toHaveProperty('stats');
    expect(res.body.data).not.toHaveProperty('badges');
    const flag = res.body.data.cbatGames.find(g => g.gameKey === 'flag');
    expect(flag).toEqual({ gameKey: 'flag', label: 'FLAG (Hard)', best: 500 });
  });
});
