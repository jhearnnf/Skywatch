/**
 * Chat — @mentions, the unread divider and the mention jump.
 *
 * The case that shapes all of this is that a display name may contain SPACES,
 * so "@Guide Bot" cannot be resolved by splitting on whitespace.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const seedChatBot      = require('../../seeds/seedChatBot');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');

beforeAll(async () => {
  await db.connect();
  await ChatConversation.syncIndexes();
});
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

async function seedGeneral() {
  const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
  const falcon = await createUser({ displayName: 'Falcon' });
  const viper  = await createUser({ displayName: 'Viper' });

  const made = await request(app).post('/api/chat/admin/channels')
    .set('Cookie', authCookie(admin._id)).send({ name: 'General' });

  return { admin, falcon, viper, channelId: made.body.data.channel._id };
}

const send = (userId, channelId, body) =>
  request(app).post(`/api/chat/conversations/${channelId}/messages`)
    .set('Cookie', authCookie(userId)).send({ body });

const load = (userId, channelId) =>
  request(app).get(`/api/chat/conversations/${channelId}/messages`)
    .set('Cookie', authCookie(userId));

const markRead = (userId, channelId) =>
  request(app).post(`/api/chat/conversations/${channelId}/read`)
    .set('Cookie', authCookie(userId));

describe('@mentions', () => {
  it('records who a message mentioned', async () => {
    const { falcon, viper, channelId } = await seedGeneral();

    const res = await send(falcon._id, channelId, 'nice one @Viper');
    expect(res.status).toBe(200);
    expect(res.body.data.message.mentions).toEqual([String(viper._id)]);
  });

  it('resolves a name typed by hand exactly as the picker would', async () => {
    // One code path: there is no client-supplied id list to disagree with.
    const { falcon, viper, channelId } = await seedGeneral();
    const res = await send(falcon._id, channelId, 'oi @viper look at this');
    expect(res.body.data.message.mentions).toEqual([String(viper._id)]);
  });

  it('does not mention anyone for an email address', async () => {
    const { falcon, channelId } = await seedGeneral();
    await createUser({ displayName: 'example' });
    const res = await send(falcon._id, channelId, 'mail me at falcon@example.com');
    expect(res.body.data.message.mentions).toEqual([]);
  });

  it('includes a mentioned user in the sender profiles, so the name can be highlighted', async () => {
    // Viper has never posted here, so without this the client would have no
    // display name to match against and the highlight would silently not happen.
    const { falcon, viper, channelId } = await seedGeneral();
    await send(falcon._id, channelId, 'hello @Viper');

    const res = await load(falcon._id, channelId);
    expect(res.body.data.senders[String(viper._id)].displayName).toBe('Viper');
  });

  it('does not resolve mentions in a support thread', async () => {
    const { falcon, viper } = await seedGeneral();
    const start = await request(app).post('/api/chat/conversations')
      .set('Cookie', authCookie(falcon._id));
    const res = await send(falcon._id, start.body.data.conversation._id, 'help @Viper');
    expect(res.body.data.message.mentions).toEqual([]);
  });
});

describe('coming back to a channel', () => {
  it('reports where you got up to and what mentioned you', async () => {
    const { falcon, viper, channelId } = await seedGeneral();

    await send(viper._id, channelId, 'first');
    await markRead(falcon._id, channelId);
    const mention = await send(viper._id, channelId, 'over here @Falcon');
    await send(viper._id, channelId, 'and another');

    const res = await load(falcon._id, channelId);
    expect(res.body.data.lastReadAt).toBeTruthy();
    expect(res.body.data.unreadMentionCount).toBe(1);
    expect(String(res.body.data.firstUnreadMention._id))
      .toBe(String(mention.body.data.message._id));
  });

  it('reports no read marker at all on a first visit', async () => {
    // A first visit is not a pile of unread messages, so the client draws no
    // "new" line.
    const { falcon, viper, channelId } = await seedGeneral();
    await send(viper._id, channelId, 'hello');

    const res = await load(falcon._id, channelId);
    expect(res.body.data.lastReadAt).toBeNull();
  });

  it('ignores a mention you have already seen', async () => {
    const { falcon, viper, channelId } = await seedGeneral();
    await send(viper._id, channelId, 'hi @Falcon');
    await markRead(falcon._id, channelId);

    const res = await load(falcon._id, channelId);
    expect(res.body.data.unreadMentionCount).toBe(0);
    expect(res.body.data.firstUnreadMention).toBeNull();
  });

  it('points at the OLDEST unread mention, not the newest', async () => {
    // The point of the jump is to find the one you have not read yet.
    const { falcon, viper, channelId } = await seedGeneral();
    await markRead(falcon._id, channelId);

    const first = await send(viper._id, channelId, 'first ping @Falcon');
    await send(viper._id, channelId, 'second ping @Falcon');

    const res = await load(falcon._id, channelId);
    expect(res.body.data.unreadMentionCount).toBe(2);
    expect(String(res.body.data.firstUnreadMention._id))
      .toBe(String(first.body.data.message._id));
  });

  it('does not count a mention in a message a moderator removed', async () => {
    const { admin, falcon, viper, channelId } = await seedGeneral();
    await markRead(falcon._id, channelId);
    const ping = await send(viper._id, channelId, 'hi @Falcon');
    await request(app).delete(`/api/chat/admin/messages/${ping.body.data.message._id}`)
      .set('Cookie', authCookie(admin._id));

    const res = await load(falcon._id, channelId);
    expect(res.body.data.unreadMentionCount).toBe(0);
  });
});

describe('mention suggestions', () => {
  const suggest = (userId, channelId, q = '') =>
    request(app).get(`/api/chat/conversations/${channelId}/mention-suggestions?q=${q}`)
      .set('Cookie', authCookie(userId));

  it('offers the guide bot and nobody else on a bare @', async () => {
    const { falcon, channelId } = await seedGeneral();
    await seedChatBot();

    const res = await suggest(falcon._id, channelId);
    expect(res.body.data.suggestions.map(s => s.displayName)).toEqual(['Guide Bot']);
  });

  it('searches agents once you start typing', async () => {
    const { falcon, channelId } = await seedGeneral();
    const res = await suggest(falcon._id, channelId, 'vip');
    expect(res.body.data.suggestions.map(s => s.displayName)).toContain('Viper');
  });

  it('never offers an account with no display name', async () => {
    // "Agent #1234567" is an account identifier, not a name someone chose —
    // listing those would make the picker a directory of every signup.
    const { falcon, channelId } = await seedGeneral();
    const nameless = await createUser({ displayName: null });

    const res = await suggest(falcon._id, channelId, 'a');
    const ids = res.body.data.suggestions.map(s => String(s._id));
    expect(ids).not.toContain(String(nameless._id));
    expect(JSON.stringify(res.body.data.suggestions)).not.toMatch(/agentNumber/i);
  });

  it('does not offer you yourself', async () => {
    const { falcon, channelId } = await seedGeneral();
    const res = await suggest(falcon._id, channelId, 'fal');
    expect(res.body.data.suggestions.map(s => String(s._id))).not.toContain(String(falcon._id));
  });

  it('does not crash or scan the world on regex metacharacters', async () => {
    const { falcon, channelId } = await seedGeneral();
    const res = await suggest(falcon._id, channelId, encodeURIComponent('.*('));
    expect(res.status).toBe(200);
    expect(res.body.data.suggestions).toEqual([]);
  });

  it('refuses someone who cannot read the conversation', async () => {
    const a = await createUser({ displayName: 'Alpha' });
    const b = await createUser({ displayName: 'Bravo' });
    const outsider = await createUser({ displayName: 'Nomad' });
    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(a._id)).send({ userId: b._id });

    const res = await suggest(outsider._id, dm.body.data.conversation._id, 'a');
    expect(res.status).toBe(403);
  });
});
