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
const { PRESENCE_WINDOW_MS, PRESENCE_LIST_LIMIT } = require('../../constants/presence');

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
        .toEqual(['_id', 'agentNumber', 'displayName', 'isAdmin', 'isSelf', 'lastSeen', 'location']);
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
