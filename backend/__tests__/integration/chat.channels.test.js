/**
 * Chat — channels
 *
 * Covers:
 *   POST   /api/chat/admin/channels             — create, slug collision, non-admin 403
 *   PATCH  /api/chat/admin/channels/:id         — rename
 *   POST   /api/chat/admin/channels/:id/archive — hides from users, keeps messages
 *   DELETE /api/chat/admin/channels/:id         — purge, refused while live
 *   GET    /api/chat/overview                   — channels visible to any user
 *   posting rules — display name required, archived channels closed
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');

// Mongoose builds indexes in the background, so a fresh in-memory database can
// race the first write. server.js awaits the same syncIndexes() via
// migrations/chatChannelsUpgrade before it listens; do it explicitly here so
// the unique-slug behaviour is actually exercised rather than skipped.
beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const createChannel = (cookie, body = {}) =>
  request(app).post('/api/chat/admin/channels').set('Cookie', cookie)
    .send({ name: 'General', ...body });

describe('POST /api/chat/admin/channels', () => {
  it('creates a channel with a slug derived from the name', async () => {
    const admin = await createUser({ isAdmin: true });
    const res = await createChannel(authCookie(admin._id), { name: 'Flight Deck', emoji: '🛩️' });

    expect(res.status).toBe(200);
    expect(res.body.data.channel.type).toBe('channel');
    expect(res.body.data.channel.channel.slug).toBe('flight-deck');
    expect(res.body.data.channel.isArchived).toBe(false);
  });

  it('rejects a duplicate name among live channels with 409', async () => {
    const admin = await createUser({ isAdmin: true });
    const c = authCookie(admin._id);
    await createChannel(c, { name: 'General' });
    const res = await createChannel(c, { name: 'General' });
    expect(res.status).toBe(409);
  });

  it('frees the slug once the channel is archived', async () => {
    const admin = await createUser({ isAdmin: true });
    const c = authCookie(admin._id);
    const first = await createChannel(c, { name: 'General' });
    await request(app).post(`/api/chat/admin/channels/${first.body.data.channel._id}/archive`).set('Cookie', c);

    const res = await createChannel(c, { name: 'General' });
    expect(res.status).toBe(200);
  });

  it('rejects non-admins with 403', async () => {
    const user = await createUser();
    const res = await createChannel(authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

describe('archiving', () => {
  it('hides the channel from users but keeps its messages for admins', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const user  = await createUser({ displayName: 'Falcon' });
    const ca = authCookie(admin._id);
    const cu = authCookie(user._id);

    const made = await createChannel(ca, { name: 'General' });
    const id   = made.body.data.channel._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', cu).send({ body: 'hello' });

    await request(app).post(`/api/chat/admin/channels/${id}/archive`).set('Cookie', ca);

    // Gone from the user's list…
    const overview = await request(app).get('/api/chat/overview').set('Cookie', cu);
    expect(overview.body.data.channels).toHaveLength(0);

    // …but the transcript survives and the admin can still read it.
    expect(await ChatMessage.countDocuments({ conversationId: id })).toBe(1);
    const thread = await request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', ca);
    expect(thread.status).toBe(200);
    expect(thread.body.data.messages).toHaveLength(1);
  });

  it('closes an archived channel to new posts', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const user  = await createUser({ displayName: 'Falcon' });
    const ca = authCookie(admin._id);

    const made = await createChannel(ca, { name: 'General' });
    const id   = made.body.data.channel._id;
    await request(app).post(`/api/chat/admin/channels/${id}/archive`).set('Cookie', ca);

    // An archived channel is invisible to users, so they are refused at the
    // read gate — 403, the same answer as for a channel that never existed.
    const asUser = await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(user._id)).send({ body: 'hello' });
    expect(asUser.status).toBe(403);

    // Admins can still read it, so they get the specific reason instead.
    const asAdmin = await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', ca).send({ body: 'hello' });
    expect(asAdmin.status).toBe(400);
    expect(asAdmin.body.message).toMatch(/archived/i);
  });
});

describe('DELETE /api/chat/admin/channels/:id', () => {
  it('refuses to purge a live channel', async () => {
    const admin = await createUser({ isAdmin: true });
    const c = authCookie(admin._id);
    const made = await createChannel(c, { name: 'General' });

    const res = await request(app).delete(`/api/chat/admin/channels/${made.body.data.channel._id}`)
      .set('Cookie', c);
    expect(res.status).toBe(400);
    expect(await ChatConversation.countDocuments({ type: 'channel' })).toBe(1);
  });

  it('purges an archived channel and its messages', async () => {
    const admin = await createUser({ isAdmin: true });
    const user  = await createUser({ displayName: 'Falcon' });
    const c = authCookie(admin._id);

    const made = await createChannel(c, { name: 'General' });
    const id   = made.body.data.channel._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(user._id)).send({ body: 'hello' });
    await request(app).post(`/api/chat/admin/channels/${id}/archive`).set('Cookie', c);

    const res = await request(app).delete(`/api/chat/admin/channels/${id}`).set('Cookie', c);
    expect(res.status).toBe(200);
    expect(res.body.data.deletedMessages).toBe(1);
    expect(await ChatConversation.countDocuments({ type: 'channel' })).toBe(0);
    expect(await ChatMessage.countDocuments({ conversationId: id })).toBe(0);
  });
});

describe('posting in a channel', () => {
  it('requires a display name', async () => {
    const admin = await createUser({ isAdmin: true });
    const user  = await createUser(); // no displayName
    const made  = await createChannel(authCookie(admin._id), { name: 'General' });

    const res = await request(app).post(`/api/chat/conversations/${made.body.data.channel._id}/messages`)
      .set('Cookie', authCookie(user._id)).send({ body: 'hello' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DISPLAY_NAME_REQUIRED');
  });

  it('snapshots the display name onto the message', async () => {
    const admin = await createUser({ isAdmin: true });
    const user  = await createUser({ displayName: 'Falcon' });
    const made  = await createChannel(authCookie(admin._id), { name: 'General' });

    const res = await request(app).post(`/api/chat/conversations/${made.body.data.channel._id}/messages`)
      .set('Cookie', authCookie(user._id)).send({ body: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body.data.message.senderDisplayName).toBe('Falcon');
  });

  it('is readable by any signed-in user', async () => {
    const admin = await createUser({ isAdmin: true });
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const made = await createChannel(authCookie(admin._id), { name: 'General' });
    const id   = made.body.data.channel._id;

    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'hello' });

    const res = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(b._id));
    expect(res.status).toBe(200);
    expect(res.body.data.messages[0].body).toBe('hello');
  });
});

describe('sender profiles (chat avatars)', () => {
  it('returns one entry per distinct sender, not one per message', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const made = await createChannel(authCookie(admin._id), { name: 'General' });
    const id = made.body.data.channel._id;

    for (const body of ['one', 'two', 'three']) {
      await request(app).post(`/api/chat/conversations/${id}/messages`)
        .set('Cookie', authCookie(a._id)).send({ body });
    }
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(b._id)).send({ body: 'hi' });

    const res = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(b._id));

    expect(res.body.data.messages).toHaveLength(4);
    expect(Object.keys(res.body.data.senders).sort())
      .toEqual([String(a._id), String(b._id)].sort());
    expect(res.body.data.senders[String(a._id)].displayName).toBe('Falcon');
    // Shape the frontend's <ProfileBadge> expects.
    expect(res.body.data.senders[String(a._id)]).toHaveProperty('selectedBadge');
    expect(res.body.data.senders[String(a._id)]).toHaveProperty('rank');
  });

  it('omits admins from a support thread, so no staff badge leaks', async () => {
    // The user sees one "Skywatch Support" identity; whose badge replied is not
    // theirs to know.
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const user  = await createUser({ displayName: 'Falcon' });
    const cu = authCookie(user._id);

    const start = await request(app).post('/api/chat/conversations').set('Cookie', cu);
    const id = start.body.data.conversation._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', cu).send({ body: 'help please' });
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'on it' });

    const asUser = await request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', cu);
    expect(Object.keys(asUser.body.data.senders)).toEqual([String(user._id)]);

    // An admin viewing the same thread does see who replied.
    const asAdmin = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id));
    expect(Object.keys(asAdmin.body.data.senders).sort())
      .toEqual([String(user._id), String(admin._id)].sort());
  });

  it('has no entry for system messages', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const cu = authCookie(user._id);
    const start = await request(app).post('/api/chat/conversations').set('Cookie', cu);
    const id = start.body.data.conversation._id;
    await request(app).post(`/api/chat/conversations/${id}/close`).set('Cookie', cu);

    const res = await request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', cu);
    const system = res.body.data.messages.find(m => m.senderRole === 'system');
    expect(system).toBeTruthy();
    // The close system message carries the user's id, but a system row must not
    // put anyone in the sender map on its own.
    expect(res.body.data.senders).toEqual({});
  });
});

describe('announcements channels (adminOnly)', () => {
  const makeAnnouncements = (cookie) =>
    request(app).post('/api/chat/admin/channels').set('Cookie', cookie)
      .send({ name: 'Announcements', emoji: '📢', order: -1, adminOnly: true });

  it('lets admins post and refuses everyone else', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const user  = await createUser({ displayName: 'Falcon' });

    const made = await makeAnnouncements(authCookie(admin._id));
    expect(made.body.data.channel.channel.adminOnly).toBe(true);
    const id = made.body.data.channel._id;

    const byAdmin = await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'Trace 2 is live.' });
    expect(byAdmin.status).toBe(200);

    const byUser = await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(user._id)).send({ body: 'nice one' });
    expect(byUser.status).toBe(403);
    expect(byUser.body.code).toBe('CHANNEL_READ_ONLY');
  });

  it('is still readable by everyone', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const user  = await createUser({ displayName: 'Falcon' });

    const made = await makeAnnouncements(authCookie(admin._id));
    const id = made.body.data.channel._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'Trace 2 is live.' });

    const res = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.messages[0].body).toBe('Trace 2 is live.');
    expect(res.body.data.conversation.adminOnly).toBe(true);
  });

  it('surfaces adminOnly on the overview so the UI can hide the composer', async () => {
    const admin = await createUser({ isAdmin: true });
    const user  = await createUser({ displayName: 'Falcon' });
    await makeAnnouncements(authCookie(admin._id));

    const res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));
    expect(res.body.data.channels[0].adminOnly).toBe(true);
  });

  it('records the commits an announcement covered', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const c = authCookie(admin._id);
    const made = await makeAnnouncements(c);
    const id = made.body.data.channel._id;

    const res = await request(app).post(`/api/chat/admin/channels/${id}/announce`)
      .set('Cookie', c).send({ body: 'Trace 2 is live.', shas: ['aaa1111'] });
    expect(res.status).toBe(200);

    const stored = await ChatMessage.findOne({ conversationId: id });
    expect(stored.announcedCommitShas).toEqual(['aaa1111']);
    expect(stored.body).toBe('Trace 2 is live.');
  });

  it('refuses the announce endpoint to non-admins', async () => {
    const admin = await createUser({ isAdmin: true });
    const user  = await createUser({ displayName: 'Falcon' });
    const made  = await makeAnnouncements(authCookie(admin._id));

    const res = await request(app).post(`/api/chat/admin/channels/${made.body.data.channel._id}/announce`)
      .set('Cookie', authCookie(user._id)).send({ body: 'sneaky' });
    expect(res.status).toBe(403);
  });

  it('503s the drafter when GitHub is not configured', async () => {
    const prevRepo = process.env.GITHUB_REPO;
    const prevToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_TOKEN;
    try {
      const admin = await createUser({ isAdmin: true });
      const made = await makeAnnouncements(authCookie(admin._id));
      const res = await request(app).post(`/api/chat/admin/channels/${made.body.data.channel._id}/draft-updates`)
        .set('Cookie', authCookie(admin._id));
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/GitHub/i);
    } finally {
      if (prevRepo)  process.env.GITHUB_REPO  = prevRepo;
      if (prevToken) process.env.GITHUB_TOKEN = prevToken;
    }
  });
});

describe('GET /api/chat/overview', () => {
  it('marks a channel unread for a user who has never opened it', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const user  = await createUser({ displayName: 'Falcon' });
    const cu = authCookie(user._id);

    const made = await createChannel(authCookie(admin._id), { name: 'General' });
    const id   = made.body.data.channel._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'first' });

    // The dot is for everyone, not just people already in the channel.
    let res = await request(app).get('/api/chat/overview').set('Cookie', cu);
    expect(res.body.data.channels[0].unread).toBe(true);

    await request(app).post(`/api/chat/conversations/${id}/read`).set('Cookie', cu);
    res = await request(app).get('/api/chat/overview').set('Cookie', cu);
    expect(res.body.data.channels[0].unread).toBe(false);

    // …and comes back on the next message.
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'second' });
    res = await request(app).get('/api/chat/overview').set('Cookie', cu);
    expect(res.body.data.channels[0].unread).toBe(true);
  });

  it('does not mark a channel unread from the sender\'s own message', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const user  = await createUser({ displayName: 'Falcon' });
    const cu = authCookie(user._id);

    const made = await createChannel(authCookie(admin._id), { name: 'General' });
    const id   = made.body.data.channel._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', cu).send({ body: 'hello all' });

    const res = await request(app).get('/api/chat/overview').set('Cookie', cu);
    expect(res.body.data.channels[0].unread).toBe(false);
  });

  it('does not mark an empty channel unread', async () => {
    const admin = await createUser({ isAdmin: true });
    const user  = await createUser({ displayName: 'Falcon' });
    await createChannel(authCookie(admin._id), { name: 'General' });

    const res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));
    expect(res.body.data.channels[0].unread).toBe(false);
  });

  it('reports whether the viewer still needs a display name', async () => {
    const named   = await createUser({ displayName: 'Falcon' });
    const unnamed = await createUser();

    const a = await request(app).get('/api/chat/overview').set('Cookie', authCookie(named._id));
    const b = await request(app).get('/api/chat/overview').set('Cookie', authCookie(unnamed._id));

    expect(a.body.data.viewer.displayNameRequired).toBe(false);
    expect(b.body.data.viewer.displayNameRequired).toBe(true);
  });
});
