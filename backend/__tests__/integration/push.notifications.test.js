/**
 * Push notifications: device sign-up, the per-account switches, and who is
 * notified about what. Delivery is swapped for a recorder at the transport
 * boundary, so these cover the decisions, not Google's or Mozilla's servers.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const PushSubscription = require('../../models/PushSubscription');
const User             = require('../../models/User');
const pushNotify       = require('../../utils/pushNotify');

let sent;

beforeAll(async () => {
  await db.connect();
  await ChatConversation.syncIndexes();
  await PushSubscription.syncIndexes();
});
beforeEach(async () => {
  await createSettings();
  sent = [];
  pushNotify._setConfig({ web: { publicKey: 'pub', privateKey: 'priv', subject: 'https://example.test' } });
  pushNotify._setTransports({
    web: async (sub, payload) => { sent.push({ userId: String(sub.userId), ...payload }); return 'ok'; },
    fcm: async (sub, payload) => { sent.push({ userId: String(sub.userId), ...payload }); return 'ok'; },
  });
});
afterEach(async () => {
  pushNotify._reset();
  await db.clearDatabase();
});
afterAll(async () => { await db.closeDatabase(); });

// Delivery is scheduled off the request, so wait for it.
const settle = () => new Promise(r => setTimeout(r, 80));

let nameNo = 0;
const nextName = () => `Agent${++nameNo}`;

let deviceNo = 0;
const subscribe = (userId) => request(app).post('/api/push/subscribe')
  .set('Cookie', authCookie(userId))
  .send({
    kind: 'web',
    subscription: {
      endpoint: `https://push.example.test/device-${++deviceNo}`,
      keys: { p256dh: 'p256', auth: 'auth' },
    },
  });

const setPrefs = (userId, prefs) => request(app).patch('/api/users/me/push-prefs')
  .set('Cookie', authCookie(userId)).send(prefs);

const send = (userId, convoId, body, extra = {}) =>
  request(app).post(`/api/chat/conversations/${convoId}/messages`)
    .set('Cookie', authCookie(userId)).send({ body, ...extra });

async function makeChannel(name) {
  const admin = await createUser({ isAdmin: true, displayName: 'Control' });
  const made = await request(app).post('/api/chat/admin/channels')
    .set('Cookie', authCookie(admin._id)).send({ name });
  return { admin, channelId: made.body.data.channel._id };
}

describe('device sign-up', () => {
  it('reports what the server can deliver', async () => {
    const u = await createUser({ displayName: nextName() });
    const res = await request(app).get('/api/push/config').set('Cookie', authCookie(u._id));
    expect(res.body.data).toEqual({ webPublicKey: 'pub', fcm: false });
  });

  it('stores one row per device and moves it to whoever signs up last', async () => {
    const a = await createUser({ displayName: nextName() });
    const b = await createUser({ displayName: nextName() });
    const body = { kind: 'fcm', token: 'phone-token' };
    await request(app).post('/api/push/subscribe').set('Cookie', authCookie(a._id)).send(body).expect(200);
    await request(app).post('/api/push/subscribe').set('Cookie', authCookie(b._id)).send(body).expect(200);
    const rows = await PushSubscription.find().lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].userId)).toBe(String(b._id));
  });

  it('refuses a web endpoint that is not https', async () => {
    const u = await createUser({ displayName: nextName() });
    await request(app).post('/api/push/subscribe').set('Cookie', authCookie(u._id))
      .send({ kind: 'web', subscription: { endpoint: 'http://127.0.0.1/x', keys: { p256dh: 'a', auth: 'b' } } })
      .expect(400);
  });

  it('only removes your own device', async () => {
    const a = await createUser({ displayName: nextName() });
    const b = await createUser({ displayName: nextName() });
    await request(app).post('/api/push/subscribe').set('Cookie', authCookie(a._id)).send({ kind: 'fcm', token: 't1' });
    await request(app).post('/api/push/unsubscribe').set('Cookie', authCookie(b._id)).send({ endpoint: 't1' });
    expect(await PushSubscription.countDocuments()).toBe(1);
    await request(app).post('/api/push/unsubscribe').set('Cookie', authCookie(a._id)).send({ endpoint: 't1' });
    expect(await PushSubscription.countDocuments()).toBe(0);
  });
});

describe('push-prefs', () => {
  it('defaults personal switches on and rooms off', async () => {
    const u = await createUser({ displayName: nextName() });
    const res = await setPrefs(u._id, { general: true }).expect(200);
    expect(res.body.data.user.pushPrefs).toEqual({
      dms: true, replies: true, mentions: true, reactions: true,
      lounge: false, general: true, updates: false,
    });
  });

  it('rejects unknown keys and non-booleans', async () => {
    const u = await createUser({ displayName: nextName() });
    await setPrefs(u._id, { everything: true }).expect(400);
    await setPrefs(u._id, { dms: 'yes' }).expect(400);
  });
});

describe('who is notified', () => {
  it('notifies the other side of a DM, not the sender', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    await subscribe(a._id);
    await subscribe(b._id);
    const dm = await request(app).post('/api/chat/dm').set('Cookie', authCookie(a._id)).send({ userId: b._id });
    const id = dm.body.data.conversation._id;

    await send(a._id, id, 'Fancy a round of SDT?').expect(200);
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      userId: String(b._id), title: 'Falcon', body: 'Fancy a round of SDT?',
      url: `/chat/${id}`, kind: 'dms',
    });
  });

  it('stays quiet when DMs are switched off', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    await subscribe(b._id);
    await setPrefs(b._id, { dms: false });
    const dm = await request(app).post('/api/chat/dm').set('Cookie', authCookie(a._id)).send({ userId: b._id });
    await send(a._id, dm.body.data.conversation._id, 'hello');
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('never notifies about someone you have blocked', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const { channelId } = await makeChannel('General');
    await subscribe(b._id);
    const first = await send(b._id, channelId, 'my message');
    await User.updateOne({ _id: b._id }, { $set: { blockedUserIds: [a._id] } });
    await send(a._id, channelId, 'a reply', { replyToId: first.body.data.message._id });
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('notifies the author of a replied-to message', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const { channelId } = await makeChannel('General');
    await subscribe(b._id);
    const first = await send(b._id, channelId, 'Anyone done DAD yet?');
    await send(a._id, channelId, 'Yes, it is tough', { replyToId: first.body.data.message._id });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: String(b._id), title: 'Falcon replied to you in General', kind: 'replies' });
  });

  it('sends one notification per message, for the most personal reason', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const { channelId } = await makeChannel('General');
    await subscribe(b._id);
    await setPrefs(b._id, { general: true });
    const first = await send(b._id, channelId, 'question');
    await send(a._id, channelId, '@Viper answer', { replyToId: first.body.data.message._id });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('mentions');
  });

  it('falls back to the room follow when the personal switch is off', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const { channelId } = await makeChannel('General');
    await subscribe(b._id);
    await setPrefs(b._id, { replies: false, general: true });
    const first = await send(b._id, channelId, 'question');
    await send(a._id, channelId, 'answer', { replyToId: first.body.data.message._id });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'general', title: 'General', body: 'Falcon: answer' });
  });

  it('only notifies room followers about ordinary room messages', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const follower = await createUser({ displayName: nextName() });
    const bystander = await createUser({ displayName: nextName() });
    const { channelId } = await makeChannel('General');
    await subscribe(follower._id);
    await subscribe(bystander._id);
    await setPrefs(follower._id, { general: true });
    await send(a._id, channelId, 'morning all');
    await settle();
    expect(sent.map(s => s.userId)).toEqual([String(follower._id)]);
  });

  it('does not notify followers of a room that cannot be followed', async () => {
    const a = await createUser({ displayName: nextName() });
    const b = await createUser({ displayName: nextName() });
    const { channelId } = await makeChannel('Off Topic');
    await subscribe(b._id);
    await setPrefs(b._id, { general: true, lounge: true, updates: true });
    await send(a._id, channelId, 'hi');
    await settle();
    expect(sent).toHaveLength(0);
  });
});

describe('reactions', () => {
  const react = (userId, messageId, emoji) =>
    request(app).post(`/api/chat/messages/${messageId}/reactions`)
      .set('Cookie', authCookie(userId)).send({ emoji });

  it('tells the author once, and never on removal or a quick re-add', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const { channelId } = await makeChannel('General');
    await subscribe(b._id);
    const msg = await send(b._id, channelId, 'Got 92 on Vigilance');
    const id = msg.body.data.message._id;

    await react(a._id, id, '🔥').expect(200);
    await react(a._id, id, '🔥').expect(200);   // removed
    await react(a._id, id, '🔥').expect(200);   // added again
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      userId: String(b._id), title: 'Falcon reacted 🔥 to your message in General',
      body: 'Got 92 on Vigilance', kind: 'reactions',
    });
  });

  it('respects the reactions switch and ignores your own reactions', async () => {
    const a = await createUser({ displayName: nextName() });
    const b = await createUser({ displayName: nextName() });
    const { channelId } = await makeChannel('General');
    await subscribe(b._id);
    const msg = await send(b._id, channelId, 'hello');
    const id = msg.body.data.message._id;
    await react(b._id, id, '👍');
    await setPrefs(b._id, { reactions: false });
    await react(a._id, id, '🎉');
    await settle();
    expect(sent).toHaveLength(0);
  });
});

describe('dead devices', () => {
  it('forgets a device the push service says is gone', async () => {
    const a = await createUser({ displayName: nextName() });
    const b = await createUser({ displayName: nextName() });
    await subscribe(b._id);
    pushNotify._setTransports({ web: async () => 'gone' });
    const dm = await request(app).post('/api/chat/dm').set('Cookie', authCookie(a._id)).send({ userId: b._id });
    await send(a._id, dm.body.data.conversation._id, 'hello');
    await settle();
    expect(await PushSubscription.countDocuments()).toBe(0);
  });
});

describe('unconfigured', () => {
  it('does nothing at all without push keys', async () => {
    pushNotify._setConfig(null);
    const a = await createUser({ displayName: nextName() });
    const b = await createUser({ displayName: nextName() });
    await PushSubscription.create({ userId: b._id, kind: 'fcm', endpoint: 'tok' });
    const dm = await request(app).post('/api/chat/dm').set('Cookie', authCookie(a._id)).send({ userId: b._id });
    await send(a._id, dm.body.data.conversation._id, 'hello');
    await settle();
    expect(sent).toHaveLength(0);
  });
});
