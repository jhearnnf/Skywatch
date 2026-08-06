/**
 * Chat — direct messages
 *
 * Covers:
 *   POST /api/chat/dm                — create, coalesce, self/unknown rejection
 *   thread isolation                 — a third user cannot read a DM
 *   admin access                     — can READ any DM, cannot POST into one
 *   GET  /api/chat/overview          — DMs listed with the other party's name
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

const openDm = (cookie, userId) =>
  request(app).post('/api/chat/dm').set('Cookie', cookie).send({ userId });

describe('POST /api/chat/dm', () => {
  it('opens a DM between two users', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const res = await openDm(authCookie(a._id), b._id);
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.type).toBe('dm');
    expect(res.body.data.conversation.participantIds).toHaveLength(2);
  });

  it('coalesces — either party opening it lands on the same thread', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const first  = await openDm(authCookie(a._id), b._id);
    const second = await openDm(authCookie(b._id), a._id);

    expect(second.body.data.conversation._id).toBe(first.body.data.conversation._id);
    expect(await ChatConversation.countDocuments({ type: 'dm' })).toBe(1);
  });

  it('refuses a DM with yourself', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const res = await openDm(authCookie(a._id), a._id);
    expect(res.status).toBe(400);
  });

  it('refuses a DM with an unknown user', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const res = await openDm(authCookie(a._id), '507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
  });
});

describe('DM access', () => {
  it('keeps a third user out', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const c = await createUser({ displayName: 'Nomad' });

    const dm = await openDm(authCookie(a._id), b._id);
    const id = dm.body.data.conversation._id;

    const read = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(c._id));
    expect(read.status).toBe(403);

    const post = await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(c._id)).send({ body: 'butting in' });
    expect(post.status).toBe(403);
  });

  it('lets an admin read a DM but not post into it', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });

    const dm = await openDm(authCookie(a._id), b._id);
    const id = dm.body.data.conversation._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'private thing' });

    // Reading is the whole point of the transcript power.
    const read = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id));
    expect(read.status).toBe(200);
    expect(read.body.data.messages[0].body).toBe('private thing');

    // Posting is not — a message from an admin would be indistinguishable from
    // one of the two participants having sent it.
    const post = await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'injected' });
    expect(post.status).toBe(403);
  });

  it('requires a display name to post', async () => {
    const a = await createUser(); // no displayName
    const b = await createUser({ displayName: 'Viper' });

    const dm = await openDm(authCookie(a._id), b._id);
    const res = await request(app).post(`/api/chat/conversations/${dm.body.data.conversation._id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'hello' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DISPLAY_NAME_REQUIRED');
  });
});

describe('account deletion', () => {
  it('removes the DM but de-identifies channel posts', async () => {
    const { deleteUserAndData } = require('../../services/deleteUserData');
    const ChatMessage = require('../../models/ChatMessage');

    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const channel = await request(app).post('/api/chat/admin/channels')
      .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
    const channelId = channel.body.data.channel._id;
    await request(app).post(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'public post' });

    const dm = await openDm(authCookie(a._id), b._id);
    const dmId = dm.body.data.conversation._id;
    await request(app).post(`/api/chat/conversations/${dmId}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'private post' });

    await deleteUserAndData(a._id);

    // The DM goes with the account — a private 1:1 thread has no owner left.
    expect(await ChatConversation.countDocuments({ _id: dmId })).toBe(0);
    expect(await ChatMessage.countDocuments({ conversationId: dmId })).toBe(0);

    // The channel post stays so the shared conversation isn't full of holes,
    // but both identifying fields are cleared.
    const kept = await ChatMessage.findOne({ conversationId: channelId });
    expect(kept.body).toBe('public post');
    expect(kept.senderUserId).toBeNull();
    expect(kept.senderDisplayName).toBeNull();
  });
});

describe('GET /api/chat/overview', () => {
  it('lists a DM under the other party\'s display name once it has messages', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const dm = await openDm(authCookie(a._id), b._id);
    const id = dm.body.data.conversation._id;

    // An empty DM is an artefact of opening the composer and walking away.
    let res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(a._id));
    expect(res.body.data.dms).toHaveLength(0);

    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'hello' });

    res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(a._id));
    expect(res.body.data.dms).toHaveLength(1);
    expect(res.body.data.dms[0].title).toBe('Viper');
    // The sender's own message never marks their own thread unread.
    expect(res.body.data.dms[0].unread).toBe(false);

    const other = await request(app).get('/api/chat/overview').set('Cookie', authCookie(b._id));
    expect(other.body.data.dms[0].title).toBe('Falcon');
    expect(other.body.data.dms[0].unread).toBe(true);
  });
});
