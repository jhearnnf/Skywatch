/**
 * Chat — admin "message anyone" search
 *
 * Covers:
 *   GET /api/chat/admin/users/search  — admin-only, substring match, exclusions
 *   GET /api/chat/conversations/:id/messages
 *                                    — an empty DM still names the other party
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');

beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const search = (cookie, q) =>
  request(app).get(`/api/chat/admin/users/search?q=${encodeURIComponent(q)}`).set('Cookie', cookie);

const names = (res) => res.body.data.users.map(u => u.displayName);

describe('GET /api/chat/admin/users/search', () => {
  it('is admin-only', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const res = await search(authCookie(user._id), 'Falcon');
    expect(res.status).toBe(403);
  });

  it('returns nothing for an empty query rather than the whole directory', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    await createUser({ displayName: 'Falcon' });

    const res = await request(app).get('/api/chat/admin/users/search?q=%20%20')
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.users).toEqual([]);
  });

  it('matches a substring of the display name, not just a prefix', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    await createUser({ displayName: 'Nightfalcon' });

    expect(names(await search(authCookie(admin._id), 'falco'))).toEqual(['Nightfalcon']);
  });

  it('matches on agent number and email, so a half-remembered id finds someone', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    await createUser({ displayName: 'Viper', agentNumber: '333111666', email: 'viper@test.com' });

    expect(names(await search(authCookie(admin._id), '111'))).toEqual(['Viper']);
    expect(names(await search(authCookie(admin._id), 'viper@'))).toEqual(['Viper']);
  });

  it('finds an agent who has never chosen a display name', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    await createUser({ agentNumber: '900900900' });

    const res = await search(authCookie(admin._id), '900900');
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.users[0].displayName).toBeNull();
    expect(res.body.data.users[0].agentNumber).toBe('900900900');
  });

  it('excludes the admin themselves, bots and banned accounts', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control agent' });
    await createUser({ displayName: 'Control bot', isBot: true, botKey: 'guide' });
    await createUser({ displayName: 'Control banned', isBanned: true });
    await createUser({ displayName: 'Control normal' });

    expect(names(await search(authCookie(admin._id), 'Control'))).toEqual(['Control normal']);
  });

  it('keeps chat-banned users, and flags them', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    await createUser({ displayName: 'Rowdy', chatBannedAt: new Date() });

    const res = await search(authCookie(admin._id), 'Rowdy');
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.users[0].chatBanned).toBe(true);
  });

  it('treats regex punctuation in the query as literal text', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    await createUser({ displayName: 'Falcon' });

    const res = await search(authCookie(admin._id), '(');
    expect(res.status).toBe(200);
    expect(res.body.data.users).toEqual([]);
  });

  it('leaks no contact details — only what the rail renders', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    await createUser({ displayName: 'Viper', email: 'viper@test.com' });

    const [hit] = (await search(authCookie(admin._id), 'Viper')).body.data.users;
    expect(Object.keys(hit).sort())
      .toEqual(['_id', 'agentNumber', 'chatBanned', 'displayName', 'isAdmin']);
  });
});

describe('opening a DM from the search', () => {
  it('names the other party even before the thread has any messages', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const target = await createUser({ displayName: 'Viper' });

    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(admin._id)).send({ userId: target._id });
    expect(dm.status).toBe(200);

    // The overview deliberately hides empty DMs, so the thread header has
    // nothing to fall back on but this.
    const res = await request(app)
      .get(`/api/chat/conversations/${dm.body.data.conversation._id}/messages`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.title).toBe('Viper');
  });

  it('falls back to the agent number when they have no display name', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const target = await createUser({ agentNumber: '900900900' });

    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(admin._id)).send({ userId: target._id });

    const res = await request(app)
      .get(`/api/chat/conversations/${dm.body.data.conversation._id}/messages`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.conversation.title).toBe('Agent #900900900');
  });
});
