/**
 * Chat — the Community count badge.
 *
 * The dot and the number answer different questions. The dot says "Community
 * has moved on"; the number says "N messages are waiting for YOU". These tests
 * pin the difference down, because getting it wrong in either direction breaks
 * the badge: count everything and it is permanently large and ignored, count
 * nothing and a real @mention goes unnoticed.
 *
 * What counts: @mentions of you, replies to your messages, and every message in
 * a DM or your support thread. What does not: ordinary channel traffic, your
 * own messages, system lines, deleted messages and silenced channels.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');
const User             = require('../../models/User');

beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

async function seedChannel() {
  const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
  const falcon = await createUser({ displayName: 'Falcon' });
  const viper  = await createUser({ displayName: 'Viper' });

  const made = await request(app).post('/api/chat/admin/channels')
    .set('Cookie', authCookie(admin._id)).send({ name: 'General' });

  return { admin, falcon, viper, channelId: made.body.data.channel._id };
}

const send = (userId, convoId, body, replyToId) =>
  request(app).post(`/api/chat/conversations/${convoId}/messages`)
    .set('Cookie', authCookie(userId)).send({ body, ...(replyToId ? { replyToId } : {}) });

const markRead = (userId, convoId) =>
  request(app).post(`/api/chat/conversations/${convoId}/read`)
    .set('Cookie', authCookie(userId));

const unread = (userId) =>
  request(app).get('/api/chat/unread/me').set('Cookie', authCookie(userId));

const overview = (userId) =>
  request(app).get('/api/chat/overview').set('Cookie', authCookie(userId));

describe('GET /api/chat/unread/me — personalUnread', () => {
  it('leaves channel chatter to the dot and out of the number', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    await markRead(falcon._id, channelId);

    await send(viper._id, channelId, 'anyone flown the ACT today');
    await send(viper._id, channelId, 'the callsigns are brutal');

    const res = await unread(falcon._id);
    expect(res.body.data.hasUnread).toBe(true);
    expect(res.body.data.personalUnread).toBe(0);
  });

  it('counts an @mention of you', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    await markRead(falcon._id, channelId);

    await send(viper._id, channelId, 'noise');
    await send(viper._id, channelId, '@Falcon what did you score');

    expect((await unread(falcon._id)).body.data.personalUnread).toBe(1);
  });

  it('counts a reply to something you said', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    const mine = await send(falcon._id, channelId, 'I got 62 on Trace');
    await markRead(falcon._id, channelId);

    await send(viper._id, channelId, 'nice one', mine.body.data.message._id);

    expect((await unread(falcon._id)).body.data.personalUnread).toBe(1);
  });

  it('counts every message in a DM, addressed to you by definition', async () => {
    const { falcon, viper } = await seedChannel();
    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(falcon._id)).send({ userId: viper._id });
    const dmId = dm.body.data.conversation._id;

    await send(viper._id, dmId, 'hello');
    await send(viper._id, dmId, 'are you around');

    expect((await unread(falcon._id)).body.data.personalUnread).toBe(2);
  });

  it('does not count your own messages', async () => {
    const { falcon, channelId } = await seedChannel();
    await send(falcon._id, channelId, 'talking to myself @Falcon');

    expect((await unread(falcon._id)).body.data.personalUnread).toBe(0);
  });

  it('clears once you open the conversation', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    await send(viper._id, channelId, '@Falcon over here');
    expect((await unread(falcon._id)).body.data.personalUnread).toBe(1);

    await markRead(falcon._id, channelId);
    expect((await unread(falcon._id)).body.data.personalUnread).toBe(0);
  });

  it('ignores a mention in a channel the admin has silenced', async () => {
    const { admin, falcon, viper, channelId } = await seedChannel();
    await request(app).patch(`/api/chat/admin/channels/${channelId}`)
      .set('Cookie', authCookie(admin._id)).send({ notifyMembers: false });

    await send(viper._id, channelId, '@Falcon look at this');

    const res = await unread(falcon._id);
    expect(res.body.data.hasUnread).toBe(false);
    expect(res.body.data.personalUnread).toBe(0);
  });

  it('drops a mention a moderator has removed', async () => {
    const { admin, falcon, viper, channelId } = await seedChannel();
    await markRead(falcon._id, channelId);
    const bad = await send(viper._id, channelId, '@Falcon you muppet');

    await request(app).delete(`/api/chat/admin/messages/${bad.body.data.message._id}`)
      .set('Cookie', authCookie(admin._id));

    expect((await unread(falcon._id)).body.data.personalUnread).toBe(0);
  });

  it('stays at zero for a user who has muted Community', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    await User.findByIdAndUpdate(falcon._id, { communityNotificationsEnabled: false });

    await send(viper._id, channelId, '@Falcon still here');

    const res = await unread(falcon._id);
    expect(res.body.data.personalUnread).toBe(0);
    expect(res.body.data.hasUnread).toBe(false);
  });
});

describe('GET /api/chat/overview — where the number came from', () => {
  it('breaks the count down per conversation so the rail explains the badge', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    await markRead(falcon._id, channelId);

    await send(viper._id, channelId, 'unrelated chatter');
    await send(viper._id, channelId, '@Falcon one');
    await send(viper._id, channelId, '@Falcon two');

    const res = await overview(falcon._id);
    const channel = res.body.data.channels.find(c => String(c._id) === String(channelId));
    expect(channel.unread).toBe(true);
    expect(channel.personalUnread).toBe(2);
  });

  it('reports a busy channel as unread but not personal', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    await markRead(falcon._id, channelId);
    await send(viper._id, channelId, 'chatter');

    const res = await overview(falcon._id);
    const channel = res.body.data.channels.find(c => String(c._id) === String(channelId));
    expect(channel.unread).toBe(true);
    expect(channel.personalUnread).toBe(0);
  });
});

describe('replyTo.userId', () => {
  it('is snapshotted at send time, so the count needs no join', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    const parent = await send(falcon._id, channelId, 'first');
    const reply  = await send(viper._id, channelId, 'second', parent.body.data.message._id);

    const stored = await ChatMessage.findById(reply.body.data.message._id).lean();
    expect(String(stored.replyTo.userId)).toBe(String(falcon._id));
  });
});

// Replies written before replyTo.userId existed would never count, which would
// make the badge quietly wrong for every conversation older than the feature.
describe('migrations/backfillReplyToUserId', () => {
  const backfill = require('../../migrations/backfillReplyToUserId');
  const silent = { log: () => {} };

  it('fills in the parent author on legacy replies', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    const parent = await send(falcon._id, channelId, 'first');
    const reply  = await send(viper._id, channelId, 'second', parent.body.data.message._id);
    const replyId = reply.body.data.message._id;

    // Back to how the collection looked before the field existed.
    await ChatMessage.collection.updateOne(
      { _id: (await ChatMessage.findById(replyId).lean())._id },
      { $unset: { 'replyTo.userId': '' } },
    );

    const result = await backfill({ ChatMessage, logger: silent });
    expect(result).toEqual({ scanned: 1, filled: 1 });

    const fixed = await ChatMessage.findById(replyId).lean();
    expect(String(fixed.replyTo.userId)).toBe(String(falcon._id));
  });

  it('is a no-op the second time', async () => {
    const { falcon, viper, channelId } = await seedChannel();
    const parent = await send(falcon._id, channelId, 'first');
    await send(viper._id, channelId, 'second', parent.body.data.message._id);

    expect(await backfill({ ChatMessage, logger: silent })).toEqual({ scanned: 0, filled: 0 });
  });
});
