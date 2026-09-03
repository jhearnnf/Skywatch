/**
 * Chat — who is online
 *
 * Covers:
 *   GET /api/chat/presence  — admin-only, the lastSeen window, exclusions,
 *                             and the true count behind a capped list
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const { PRESENCE_WINDOW_MS, PRESENCE_LIST_LIMIT, PRESENCE_HERE_WINDOW_MS } = require('../../constants/presence');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const presence = (cookie) =>
  request(app).get('/api/chat/presence').set('Cookie', cookie);

const agoMs = (ms) => new Date(Date.now() - ms);
const names = (res) => res.body.data.online.map(u => u.displayName);

describe('GET /api/chat/presence', () => {
  it('is admin-only — members do not get to see who is around', async () => {
    const user = await createUser({ displayName: 'Falcon', lastSeen: new Date() });
    const res = await presence(authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('lists accounts seen inside the window and drops the ones outside it', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({ displayName: 'Recent', lastSeen: agoMs(60_000) });
    await createUser({ displayName: 'Stale',  lastSeen: agoMs(PRESENCE_WINDOW_MS + 60_000) });
    await createUser({ displayName: 'Never',  lastSeen: null });

    const res = await presence(authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(names(res).sort()).toEqual(['Control', 'Recent']);
    expect(res.body.data.count).toBe(2);
  });

  it('counts the admin themselves — "am I showing up" is a fair question', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });

    expect(names(await presence(authCookie(admin._id)))).toEqual(['Control']);
  });

  it('excludes bots and banned accounts', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({ displayName: 'Bot',    isBot: true, botKey: 'guide', lastSeen: new Date() });
    await createUser({ displayName: 'Banned', isBanned: true, lastSeen: new Date() });

    expect(names(await presence(authCookie(admin._id)))).toEqual(['Control']);
  });

  it('sorts most recently seen first', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: agoMs(300_000) });
    await createUser({ displayName: 'Middle', lastSeen: agoMs(120_000) });
    await createUser({ displayName: 'Newest', lastSeen: agoMs(1_000) });

    expect(names(await presence(authCookie(admin._id)))).toEqual(['Newest', 'Middle', 'Control']);
  });

  it('caps the list but still reports the true total', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    const extra = 3;
    for (let i = 0; i < PRESENCE_LIST_LIMIT + extra - 1; i++) {
      await createUser({ displayName: `Agent ${i}`, lastSeen: agoMs(i * 1_000) });
    }

    const res = await presence(authCookie(admin._id));
    expect(res.body.data.online).toHaveLength(PRESENCE_LIST_LIMIT);
    expect(res.body.data.count).toBe(PRESENCE_LIST_LIMIT + extra);
  });

  it('leaks no contact details — only what the strip renders', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({ displayName: 'Viper', email: 'viper@test.com', lastSeen: new Date() });

    const { online } = (await presence(authCookie(admin._id))).body.data;
    for (const u of online) {
      expect(Object.keys(u).sort())
        .toEqual(['_id', 'agentNumber', 'cbatCard', 'displayName', 'isAdmin', 'isSelf', 'lastSeen', 'location']);
    }
  });

  it('reports the window it used, so the client can say what "online" means', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });

    expect((await presence(authCookie(admin._id))).body.data.windowMs).toBe(PRESENCE_WINDOW_MS);
  });
});

describe('where everyone is', () => {
  const find = (res, name) => res.body.data.online.find(u => u.displayName === name);

  it('reports each agent\'s page, from the label the heartbeat stored', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({ displayName: 'Viper',  lastSeen: new Date(), lastLocation: 'CBAT · ACT' });
    await createUser({ displayName: 'Falcon', lastSeen: new Date(), lastLocation: 'Reading a brief' });

    const res = await presence(authCookie(admin._id));
    expect(find(res, 'Viper').location).toBe('CBAT · ACT');
    expect(find(res, 'Falcon').location).toBe('Reading a brief');
  });

  it('withholds the location of the admin reading the strip', async () => {
    // They are in Community, reading this — the one row that says nothing.
    const admin = await createUser({
      isAdmin: true, displayName: 'Control', lastSeen: new Date(), lastLocation: 'Community',
    });

    const me = find(await presence(authCookie(admin._id)), 'Control');
    expect(me.isSelf).toBe(true);
    expect(me.location).toBeNull();
  });

  it('marks everyone else as not-self, so only one row can be "You"', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({ displayName: 'Viper', lastSeen: new Date(), lastLocation: 'Profile' });

    const res = await presence(authCookie(admin._id));
    expect(res.body.data.online.filter(u => u.isSelf)).toHaveLength(1);
    expect(find(res, 'Viper').isSelf).toBe(false);
  });

  it('reports null for someone whose client has not said where they are', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    // An older client that sends no path, or one on an unlabelled route.
    await createUser({ displayName: 'Viper', lastSeen: new Date(), lastLocation: null });

    expect(find(await presence(authCookie(admin._id)), 'Viper').location).toBeNull();
  });
});

describe('which CBAT tile everyone is on', () => {
  const find = (res, name) => res.body.data.online.find(u => u.displayName === name);

  it('reports the tile the heartbeat resolved, for the dots on the hub', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({ displayName: 'Viper',  lastSeen: new Date(), lastCbatCard: 'target' });
    await createUser({ displayName: 'Falcon', lastSeen: new Date(), lastCbatCard: 'plane-turn' });

    const res = await presence(authCookie(admin._id));
    expect(find(res, 'Viper').cbatCard).toBe('target');
    expect(find(res, 'Falcon').cbatCard).toBe('plane-turn');
  });

  it('falls back to the label for a row written before the tile was recorded', async () => {
    // Every deployed backend has stored the label since August, and an older one
    // still handling heartbeats stores nothing else. The hub knows perfectly
    // well where these people are, so it marks the tile.
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({ displayName: 'Viper',  lastSeen: new Date(), lastLocation: 'CBAT · Angles' });
    await createUser({ displayName: 'Falcon', lastSeen: new Date(), lastLocation: 'CBAT · Trace 1/2' });

    const res = await presence(authCookie(admin._id));
    expect(find(res, 'Viper').cbatCard).toBe('angles');
    expect(find(res, 'Falcon').cbatCard).toBe('plane-turn');
  });

  it('prefers the recorded tile over the label, which cannot name a leaderboard', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({
      displayName:  'Viper',
      lastSeen:     new Date(),
      lastLocation: 'CBAT · Leaderboard',
      lastCbatCard: 'target',
    });

    expect(find(await presence(authCookie(admin._id)), 'Viper').cbatCard).toBe('target');
  });

  it('reports null for someone who is online but not in a game', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({ displayName: 'Viper', lastSeen: new Date(), lastCbatCard: null, lastLocation: 'Community' });

    expect(find(await presence(authCookie(admin._id)), 'Viper').cbatCard).toBeNull();
  });

  it('drops the tile once the beat is older than the dot window', async () => {
    // The strip is forgiving about "around recently"; a dot on a game tile is a
    // claim that someone is playing it right now, so it goes out much sooner.
    // The row itself stays — they are still online.
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({
      displayName:  'Viper',
      lastSeen:     agoMs(PRESENCE_HERE_WINDOW_MS + 30_000),
      lastCbatCard: 'target',
    });

    const viper = find(await presence(authCookie(admin._id)), 'Viper');
    expect(viper.cbatCard).toBeNull();
    expect(viper.location).toBeDefined();
  });

  it('keeps the tile for a beat inside the dot window', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });
    await createUser({
      displayName:  'Viper',
      lastSeen:     agoMs(PRESENCE_HERE_WINDOW_MS - 30_000),
      lastCbatCard: 'act',
    });

    expect(find(await presence(authCookie(admin._id)), 'Viper').cbatCard).toBe('act');
  });

  it('keeps the viewer own tile, unlike their location', async () => {
    // An admin reading the hub is on /cbat, which is no tile at all — so the
    // only time this is not null is a second tab or device of theirs sitting in
    // a game, which is exactly when they would want to see it.
    const admin = await createUser({
      isAdmin: true, displayName: 'Control', lastSeen: new Date(),
      lastLocation: 'CBAT · ACT', lastCbatCard: 'act',
    });

    const me = find(await presence(authCookie(admin._id)), 'Control');
    expect(me.location).toBeNull();
    expect(me.cbatCard).toBe('act');
  });

  it('says what window the dots are drawn from', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control', lastSeen: new Date() });

    expect((await presence(authCookie(admin._id))).body.data.hereWindowMs)
      .toBe(PRESENCE_HERE_WINDOW_MS);
  });
});

describe('POST /api/users/heartbeat — reporting where you are', () => {
  const beat = (user, body) =>
    request(app).post('/api/users/heartbeat').set('Cookie', authCookie(user._id)).send(body);

  const reload = async (user) => {
    const User = require('../../models/User');
    return User.findById(user._id).lean();
  };

  it('stores the label for the path, not the path', async () => {
    const user = await createUser({ displayName: 'Viper' });
    expect((await beat(user, { path: '/cbat/act' })).status).toBe(200);

    expect((await reload(user)).lastLocation).toBe('CBAT · ACT');
  });

  it('stores no id from a path that carries one', async () => {
    const user = await createUser({ displayName: 'Viper' });
    await beat(user, { path: '/brief/68f1a2b3c4d5e6f708192a3b' });

    const stored = (await reload(user)).lastLocation;
    expect(stored).toBe('Reading a brief');
    expect(stored).not.toContain('68f1a2b3');
  });

  it('clears the location when they move somewhere unlabelled', async () => {
    const user = await createUser({ displayName: 'Viper' });
    await beat(user, { path: '/cbat/act' });
    expect((await reload(user)).lastLocation).toBe('CBAT · ACT');

    // Otherwise the strip keeps showing a game they left ten minutes ago as
    // though they were still in it.
    await beat(user, { path: '/nowhere/we/label' });
    expect((await reload(user)).lastLocation).toBeNull();
  });

  it('stores the hub tile alongside the label', async () => {
    const user = await createUser({ displayName: 'Viper' });
    await beat(user, { path: '/cbat/trace' });

    const stored = await reload(user);
    // The label names the page; the card names the tile it belongs to, which
    // the label cannot answer for a combined tile or a leaderboard.
    expect(stored.lastLocation).toBe('CBAT · Trace 1/2');
    expect(stored.lastCbatCard).toBe('plane-turn');
  });

  it('keeps someone on a game tile while they read its leaderboard', async () => {
    const user = await createUser({ displayName: 'Viper' });
    await beat(user, { path: '/cbat/target/leaderboard' });

    const stored = await reload(user);
    expect(stored.lastLocation).toBe('CBAT · Leaderboard');
    expect(stored.lastCbatCard).toBe('target');
  });

  it('clears the tile the moment they leave the game', async () => {
    const user = await createUser({ displayName: 'Viper' });
    await beat(user, { path: '/cbat/act' });
    expect((await reload(user)).lastCbatCard).toBe('act');

    // Back on the hub. A dot left on ACT would be claiming they are still in
    // it while they are looking at the tile.
    await beat(user, { path: '/cbat' });
    expect((await reload(user)).lastCbatCard).toBeNull();
  });

  it('still records presence when the path is missing or junk', async () => {
    const user = await createUser({ displayName: 'Viper' });

    for (const body of [{}, { path: 42 }, { path: 'not-a-path' }]) {
      const res = await beat(user, body);
      expect(res.status).toBe(200);
      const stored = await reload(user);
      // Presence is what the online count depends on; a bad path must never be
      // able to take it down with it.
      expect(stored.lastSeen).toBeTruthy();
      expect(stored.lastLocation).toBeNull();
      expect(stored.lastCbatCard).toBeNull();
    }
  });

  it('records presence and location together, as one write', async () => {
    const user = await createUser({ displayName: 'Viper' });
    const before = new Date();
    await beat(user, { path: '/profile' });

    const stored = await reload(user);
    expect(stored.lastLocation).toBe('Profile');
    expect(new Date(stored.lastSeen).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});
