/**
 * Medals hanging off a chat avatar.
 *
 * The property that matters: the medal shown must match the board the player
 * actually sees, which is best-per-user AND padded with demo rows.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const { CBAT_GAMES }   = require('../../constants/cbatGames');
const {
  getMedalHolders, medalsForUsers, resetMedalHoldersCache,
} = require('../../utils/cbatMedalHolders');

const GAME_KEY = 'target';

beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); resetMedalHoldersCache(); });
afterEach(async () => { await db.clearDatabase(); resetMedalHoldersCache(); });
afterAll(async () => { await db.closeDatabase(); });

const cfg = () => CBAT_GAMES[GAME_KEY];

// A completed run for `user` on the target game.
const score = (user, value, totalTime = 60) => cfg().Model.create({
  userId: user._id,
  ...(cfg().modeFilter ?? {}),
  [cfg().primaryField]: value,
  totalTime,
});

describe('getMedalHolders', () => {
  it('gives the top scorer a gold medal', async () => {
    const best = await createUser({ displayName: 'Falcon' });
    await score(best, 999999);

    const holders = await getMedalHolders({ force: true });
    const mine = holders.get(String(best._id));

    expect(mine).toBeTruthy();
    expect(mine[0].rank).toBe(1);
    expect(mine[0].gameKey).toBe(GAME_KEY);
    expect(mine[0].gameLabel).toBe(cfg().label);
  });

  it('counts a player once, not once per run', async () => {
    // The board is best-per-user; ten strong sessions occupy one row. Counting
    // documents would let one player take the whole podium.
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    await score(a, 999999);
    await score(a, 999998);
    await score(a, 999997);
    await score(b, 999996);

    const holders = await getMedalHolders({ force: true });
    expect(holders.get(String(a._id))).toHaveLength(1);
    expect(holders.get(String(a._id))[0].rank).toBe(1);
    expect(holders.get(String(b._id))[0].rank).toBe(2);
  });

  it('gives nobody a medal below the podium', async () => {
    const users = [];
    for (let i = 0; i < 4; i += 1) {
      const u = await createUser({ displayName: `Agent${i}` });
      users.push(u);
      await score(u, 999999 - i);
    }

    const holders = await getMedalHolders({ force: true });
    expect(holders.get(String(users[2]._id))[0].rank).toBe(3);
    expect(holders.get(String(users[3]._id))).toBeUndefined();
  });

  it('caches, and force bypasses it', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    await score(a, 999999);
    await getMedalHolders({ force: true });

    const b = await createUser({ displayName: 'Viper' });
    await score(b, 1000000);

    // Cached: the new leader is not visible yet.
    expect((await getMedalHolders()).get(String(b._id))).toBeUndefined();
    // Forced: it is.
    expect((await getMedalHolders({ force: true })).get(String(b._id))[0].rank).toBe(1);
  });

  it('returns nothing for a game nobody has played', async () => {
    const holders = await getMedalHolders({ force: true });
    expect(holders.size).toBe(0);
  });
});

describe('medalsForUsers', () => {
  it('keys by user id and omits users with no medals', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    await score(a, 999999);

    const out = await medalsForUsers([a._id, b._id]);
    expect(Object.keys(out)).toEqual([String(a._id)]);
    expect(out[String(a._id)][0].rank).toBe(1);
  });

  it('does no work for an empty list', async () => {
    expect(await medalsForUsers([])).toEqual({});
  });
});

describe('through the chat API', () => {
  it('attaches medals to the sender profile', async () => {
    const admin = await createUser({ isAdmin: true });
    const a = await createUser({ displayName: 'Falcon' });
    await score(a, 999999);
    resetMedalHoldersCache();

    const made = await request(app).post('/api/chat/admin/channels')
      .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
    const id = made.body.data.channel._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'hello' });

    const res = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id));

    const sender = res.body.data.senders[String(a._id)];
    expect(sender.medals).toHaveLength(1);
    expect(sender.medals[0]).toMatchObject({ rank: 1, gameKey: GAME_KEY });
  });

  it('sends an empty list for a sender with no medals', async () => {
    const admin = await createUser({ isAdmin: true });
    const a = await createUser({ displayName: 'Falcon' });

    const made = await request(app).post('/api/chat/admin/channels')
      .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
    const id = made.body.data.channel._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'hello' });

    const res = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id));
    expect(res.body.data.senders[String(a._id)].medals).toEqual([]);
  });
});
