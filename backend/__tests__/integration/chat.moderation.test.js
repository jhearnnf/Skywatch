/**
 * Chat — moderation
 *
 * Covers:
 *   DELETE /api/chat/admin/messages/:id       — soft delete; body hidden from
 *                                               users, retained for admins
 *   POST/DELETE /admin/users/:id/chat-ban     — blocks channels and DMs, but
 *                                               NOT the support thread
 *   POST /api/chat/messages/:id/report        — lands in the ProblemReport queue
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');
const ProblemReport    = require('../../models/ProblemReport');
const User             = require('../../models/User');

beforeAll(async () => {
  await db.connect();
  await ChatConversation.syncIndexes();
  await ProblemReport.syncIndexes();
});
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

// A channel with one message in it, plus the cast.
async function seedChannelWithMessage() {
  const admin = await createUser({ isAdmin: true, displayName: 'Control' });
  const author = await createUser({ displayName: 'Falcon' });
  const reader = await createUser({ displayName: 'Viper' });

  const made = await request(app).post('/api/chat/admin/channels')
    .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
  const channelId = made.body.data.channel._id;

  const sent = await request(app).post(`/api/chat/conversations/${channelId}/messages`)
    .set('Cookie', authCookie(author._id)).send({ body: 'something rude' });

  return { admin, author, reader, channelId, messageId: sent.body.data.message._id };
}

describe('DELETE /api/chat/admin/messages/:id', () => {
  it('removes the message from the user view entirely, leaving no tombstone', async () => {
    const { admin, reader, channelId, messageId } = await seedChannelWithMessage();

    const res = await request(app).delete(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);

    // No placeholder, no "removed by a moderator" — as far as a user is
    // concerned the message was never there.
    const asUser = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(reader._id));
    expect(asUser.body.data.messages).toHaveLength(0);

    // The record survives — a moderation trail that erases the evidence is
    // useless.
    const asAdmin = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(admin._id));
    expect(asAdmin.body.data.messages).toHaveLength(1);
    expect(asAdmin.body.data.messages[0].deleted).toBe(true);
    expect(asAdmin.body.data.messages[0].body).toBe('something rude');
    expect(await ChatMessage.countDocuments({ _id: messageId })).toBe(1);
  });

  it('keeps the surrounding messages intact for the user', async () => {
    const { admin, author, reader, channelId, messageId } = await seedChannelWithMessage();
    const ca = authCookie(admin._id);

    await request(app).post(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(author._id)).send({ body: 'and another thing' });
    await request(app).delete(`/api/chat/admin/messages/${messageId}`).set('Cookie', ca);

    const asUser = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(reader._id));
    expect(asUser.body.data.messages.map(m => m.body)).toEqual(['and another thing']);
  });

  it('drops a removed message from the channel preview', async () => {
    const { admin, reader, channelId, messageId } = await seedChannelWithMessage();
    await request(app).delete(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', authCookie(admin._id));

    const overview = await request(app).get('/api/chat/overview')
      .set('Cookie', authCookie(reader._id));
    const channel = overview.body.data.channels.find(c => String(c._id) === String(channelId));
    expect(channel.preview).toBeNull();
  });

  it('rejects non-admins', async () => {
    const { reader, messageId } = await seedChannelWithMessage();
    const res = await request(app).delete(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', authCookie(reader._id));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/chat/admin/messages/:id', () => {
  it('rewrites the body and marks the message edited for everyone', async () => {
    const { admin, reader, channelId, messageId } = await seedChannelWithMessage();

    const res = await request(app).patch(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'something civil' });
    expect(res.status).toBe(200);
    expect(res.body.data.message.body).toBe('something civil');
    expect(res.body.data.message.edited).toBe(true);

    // The marker is not an admin-only detail — a moderator quietly rewriting
    // what someone said and leaving no trace would be worse than leaving it.
    const asUser = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(reader._id));
    expect(asUser.body.data.messages[0].body).toBe('something civil');
    expect(asUser.body.data.messages[0].edited).toBe(true);
  });

  it('keeps the original body as the moderation record, admin-only', async () => {
    const { admin, reader, channelId, messageId } = await seedChannelWithMessage();
    const ca = authCookie(admin._id);

    await request(app).patch(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', ca).send({ body: 'first correction' });
    // A second pass must not launder the original away.
    await request(app).patch(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', ca).send({ body: 'second correction' });

    expect((await ChatMessage.findById(messageId)).originalBody).toBe('something rude');

    const asAdmin = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', ca);
    expect(asAdmin.body.data.messages[0].originalBody).toBe('something rude');

    const asUser = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(reader._id));
    expect(asUser.body.data.messages[0].originalBody).toBeUndefined();
  });

  it('leaves an unedited message unmarked', async () => {
    const { reader, channelId } = await seedChannelWithMessage();
    const res = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(reader._id));
    expect(res.body.data.messages[0].edited).toBe(false);
  });

  it('refuses to edit a removed message', async () => {
    const { admin, messageId } = await seedChannelWithMessage();
    const ca = authCookie(admin._id);
    await request(app).delete(`/api/chat/admin/messages/${messageId}`).set('Cookie', ca);

    const res = await request(app).patch(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', ca).send({ body: 'resurrected' });
    expect(res.status).toBe(400);
  });

  it('requires a non-empty body', async () => {
    const { admin, messageId } = await seedChannelWithMessage();
    const res = await request(app).patch(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', authCookie(admin._id)).send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects non-admins — including the message author', async () => {
    const { author, reader, messageId } = await seedChannelWithMessage();

    for (const u of [author, reader]) {
      const res = await request(app).patch(`/api/chat/admin/messages/${messageId}`)
        .set('Cookie', authCookie(u._id)).send({ body: 'mine now' });
      expect(res.status).toBe(403);
    }
    expect((await ChatMessage.findById(messageId)).body).toBe('something rude');
  });
});

describe('chat ban', () => {
  it('blocks channel posts but leaves support reachable', async () => {
    const { admin, author, channelId } = await seedChannelWithMessage();
    const ca = authCookie(admin._id);
    const cu = authCookie(author._id);

    const ban = await request(app).post(`/api/chat/admin/users/${author._id}/chat-ban`)
      .set('Cookie', ca).send({ reason: 'Abusive language' });
    expect(ban.status).toBe(200);
    expect((await User.findById(author._id)).chatBannedAt).toBeTruthy();

    const post = await request(app).post(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', cu).send({ body: 'again' });
    expect(post.status).toBe(403);
    expect(post.body.code).toBe('CHAT_BANNED');
    expect(post.body.message).toMatch(/Abusive language/);

    // Reading still works — a ban mutes, it does not blind.
    const read = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', cu);
    expect(read.status).toBe(200);

    // And support stays open, or the ban would sever the only route to appeal it.
    const start = await request(app).post('/api/chat/conversations').set('Cookie', cu);
    const supportPost = await request(app)
      .post(`/api/chat/conversations/${start.body.data.conversation._id}/messages`)
      .set('Cookie', cu).send({ body: 'why was I banned?' });
    expect(supportPost.status).toBe(200);
  });

  it('lifts cleanly', async () => {
    const { admin, author, channelId } = await seedChannelWithMessage();
    const ca = authCookie(admin._id);

    await request(app).post(`/api/chat/admin/users/${author._id}/chat-ban`)
      .set('Cookie', ca).send({ reason: 'Mistake' });
    await request(app).delete(`/api/chat/admin/users/${author._id}/chat-ban`).set('Cookie', ca);

    const post = await request(app).post(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(author._id)).send({ body: 'back' });
    expect(post.status).toBe(200);
  });

  it('refuses to ban an admin', async () => {
    const { admin } = await seedChannelWithMessage();
    const other = await createUser({ isAdmin: true });
    const res = await request(app).post(`/api/chat/admin/users/${other._id}/chat-ban`)
      .set('Cookie', authCookie(admin._id)).send({ reason: 'no' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/chat/messages/:id/report', () => {
  it('files a chat_message report carrying the offending body', async () => {
    const { reader, author, channelId, messageId } = await seedChannelWithMessage();

    const res = await request(app).post(`/api/chat/messages/${messageId}/report`)
      .set('Cookie', authCookie(reader._id)).send({ reason: 'Abusive' });
    expect(res.status).toBe(200);

    const report = await ProblemReport.findOne({ chatMessageId: messageId });
    expect(report.kind).toBe('chat_message');
    expect(String(report.userId)).toBe(String(reader._id));
    expect(String(report.reportedUserId)).toBe(String(author._id));
    expect(String(report.chatConversationId)).toBe(String(channelId));
    expect(report.description).toMatch(/Abusive/);
    // The body is copied in so the record survives the message being deleted.
    expect(report.description).toMatch(/something rude/);
  });

  it('is idempotent — re-reporting does not spam the queue', async () => {
    const { reader, messageId } = await seedChannelWithMessage();
    const c = authCookie(reader._id);

    await request(app).post(`/api/chat/messages/${messageId}/report`).set('Cookie', c).send({ reason: 'a' });
    const second = await request(app).post(`/api/chat/messages/${messageId}/report`).set('Cookie', c).send({ reason: 'b' });

    expect(second.status).toBe(200);
    expect(await ProblemReport.countDocuments({ chatMessageId: messageId })).toBe(1);
  });

  it('refuses self-reports', async () => {
    const { author, messageId } = await seedChannelWithMessage();
    const res = await request(app).post(`/api/chat/messages/${messageId}/report`)
      .set('Cookie', authCookie(author._id)).send({ reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('refuses a report from someone who cannot see the message', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const outsider = await createUser({ displayName: 'Nomad' });

    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(a._id)).send({ userId: b._id });
    const sent = await request(app).post(`/api/chat/conversations/${dm.body.data.conversation._id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'private' });

    const res = await request(app).post(`/api/chat/messages/${sent.body.data.message._id}/report`)
      .set('Cookie', authCookie(outsider._id)).send({ reason: 'x' });
    expect(res.status).toBe(403);
  });
});
