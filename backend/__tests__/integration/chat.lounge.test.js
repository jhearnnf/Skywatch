/**
 * The CBAT lounge — the room behind the mini chat on the games hub.
 *
 * Three things are specific to it and covered here: the seed, the one endpoint
 * the widget starts from, and the fact that writing a message pushes it to
 * anyone holding a live stream. The stream ITSELF (an HTTP response that never
 * ends) is exercised through the subscriber map rather than over supertest,
 * which has nothing sensible to do with a response that stays open —
 * unit/chatStream.test.js covers that side.
 */
process.env.JWT_SECRET = 'test_secret';

jest.mock('../../utils/openRouter', () => ({
  ...jest.requireActual('../../utils/openRouter'),
  callOpenRouter: jest.fn(),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const seedCbatLounge   = require('../../seeds/seedCbatLounge');
const seedChatBot      = require('../../seeds/seedChatBot');
const chatStream       = require('../../utils/chatStream');
const ChatConversation = require('../../models/ChatConversation');
const BotKnowledge     = require('../../models/BotKnowledge');
const ChatMessage      = require('../../models/ChatMessage');
const { callOpenRouter } = require('../../utils/openRouter');
const { BRIEF_POINTER }  = require('../../utils/chatBot');

const { LOUNGE_SLUG } = seedCbatLounge;

beforeAll(async () => {
  await db.connect();
  await ChatConversation.syncIndexes();
});
beforeEach(async () => {
  await createSettings();
  chatStream._reset();
  jest.clearAllMocks();
  callOpenRouter.mockResolvedValue({
    choices: [{ message: { content: 'Only circled aircraft count.' } }],
  });
});
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const lounge = (userId) =>
  request(app).get('/api/chat/lounge').set('Cookie', authCookie(userId));

const send = (userId, conversationId, body) =>
  request(app).post(`/api/chat/conversations/${conversationId}/messages`)
    .set('Cookie', authCookie(userId)).send({ body });

// The bot posts detached from the request, so the assertion has to wait for it.
const settle = () => new Promise(r => setTimeout(r, 60));

const listener = (userId = 'someone') => {
  const events = [];
  return { userId, events, send: (event, data) => events.push({ event, data }), close: () => {} };
};

describe('seedCbatLounge', () => {
  it('creates one everyone-can-post channel, muted for the Community badge', async () => {
    await seedCbatLounge();
    const convo = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();

    expect(convo.type).toBe('channel');
    expect(convo.channel.postPolicy).toBe('everyone');
    // This room is chatty and has its own dot on the widget. Letting it badge
    // the nav item as well would keep that dot permanently lit.
    expect(convo.channel.notifyMembers).toBe(false);
  });

  it('is idempotent', async () => {
    await seedCbatLounge();
    await seedCbatLounge();
    expect(await ChatConversation.countDocuments({ 'channel.slug': LOUNGE_SLUG })).toBe(1);
  });

  it('does not resurrect a room an admin archived', async () => {
    await seedCbatLounge();
    await ChatConversation.updateOne({ 'channel.slug': LOUNGE_SLUG }, { $set: { isArchived: true } });

    await seedCbatLounge();
    expect(await ChatConversation.countDocuments({ 'channel.slug': LOUNGE_SLUG })).toBe(1);
    expect((await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG })).isArchived).toBe(true);
  });
});

describe('GET /api/chat/lounge', () => {
  it('gives the widget the conversation, the bot to address and a post verdict', async () => {
    await seedCbatLounge();
    await seedChatBot();
    const falcon = await createUser({ displayName: 'Falcon' });

    const res = await lounge(falcon._id);

    expect(res.status).toBe(200);
    expect(res.body.data.title).toContain('CBAT Lounge');
    expect(res.body.data.canPost).toBe(true);
    expect(res.body.data.botName).toBe('Guide Bot');
    expect(res.body.data.unread).toBe(false);
  });

  it('404s when the room has been archived, so the widget can hide itself', async () => {
    await seedCbatLounge();
    await ChatConversation.updateOne({ 'channel.slug': LOUNGE_SLUG }, { $set: { isArchived: true } });
    const falcon = await createUser({ displayName: 'Falcon' });

    expect((await lounge(falcon._id)).status).toBe(404);
  });

  it('reports a user with no display name as unable to post, without a 403', async () => {
    // The widget shows the name form in place of its composer, so this has to
    // arrive as data rather than as an error.
    await seedCbatLounge();
    const nameless = await createUser({});

    const res = await lounge(nameless._id);
    expect(res.status).toBe(200);
    expect(res.body.data.canPost).toBe(false);
    expect(res.body.data.displayNameRequired).toBe(true);
  });

  it('reports a chat-banned user as unable to post', async () => {
    await seedCbatLounge();
    const banned = await createUser({ displayName: 'Rogue', chatBannedAt: new Date() });

    const res = await lounge(banned._id);
    expect(res.body.data.canPost).toBe(false);
    expect(res.body.data.chatBanned).toBe(true);
  });

  it('flags unread even though the room is muted for the Community badge', async () => {
    // The widget's dot and the nav dot are different signals: this room is
    // deliberately excluded from the second and must still drive the first.
    await seedCbatLounge();
    const falcon = await createUser({ displayName: 'Falcon' });
    const viper  = await createUser({ displayName: 'Viper' });
    const convo  = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();

    await send(viper._id, convo._id, 'anyone about?');

    expect((await lounge(falcon._id)).body.data.unread).toBe(true);
    // The Community badge stays dark for the same message.
    const badge = await request(app).get('/api/chat/unread/me').set('Cookie', authCookie(falcon._id));
    expect(badge.body.data.hasUnread).toBe(false);
  });

  it('clears once the reader opens the panel', async () => {
    await seedCbatLounge();
    const falcon = await createUser({ displayName: 'Falcon' });
    const viper  = await createUser({ displayName: 'Viper' });
    const convo  = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();

    await send(viper._id, convo._id, 'anyone about?');
    await request(app).post(`/api/chat/conversations/${convo._id}/read`)
      .set('Cookie', authCookie(falcon._id));

    expect((await lounge(falcon._id)).body.data.unread).toBe(false);
  });

  it('never dots you for your own message', async () => {
    await seedCbatLounge();
    const falcon = await createUser({ displayName: 'Falcon' });
    const convo  = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();

    await send(falcon._id, convo._id, 'hello');
    expect((await lounge(falcon._id)).body.data.unread).toBe(false);
  });
});

describe('pushing to a live stream', () => {
  it('pushes a posted message to everyone listening on that conversation', async () => {
    await seedCbatLounge();
    const falcon = await createUser({ displayName: 'Falcon' });
    const convo  = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();

    const watcher = listener();
    chatStream.subscribe(convo._id, watcher);

    await send(falcon._id, convo._id, 'anyone about?');

    const pushed = watcher.events.filter(e => e.event === 'message');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].data.body).toBe('anyone about?');
    expect(pushed[0].data.senderDisplayName).toBe('Falcon');
    expect(String(pushed[0].data.senderUserId)).toBe(String(falcon._id));
  });

  it('does not push another conversation\'s traffic', async () => {
    await seedCbatLounge();
    const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
    const falcon = await createUser({ displayName: 'Falcon' });
    const convo  = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();
    const other  = await request(app).post('/api/chat/admin/channels')
      .set('Cookie', authCookie(admin._id)).send({ name: 'General' });

    const watcher = listener();
    chatStream.subscribe(convo._id, watcher);

    await send(falcon._id, other.body.data.channel._id, 'over here');
    expect(watcher.events.filter(e => e.event === 'message')).toHaveLength(0);
  });

  it('tells listeners to refetch when a moderator removes a message', async () => {
    // No body on the wire: what a non-admin may see is decided in one place,
    // the messages route, and a push carrying the text would be a second.
    await seedCbatLounge();
    const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
    const falcon = await createUser({ displayName: 'Falcon' });
    const convo  = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();

    const posted = await send(falcon._id, convo._id, 'something regrettable');
    const watcher = listener();
    chatStream.subscribe(convo._id, watcher);

    await request(app).delete(`/api/chat/admin/messages/${posted.body.data.message._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(watcher.events.some(e => e.event === 'refresh')).toBe(true);
  });

  it('rejects a stream on a conversation you cannot read', async () => {
    const falcon = await createUser({ displayName: 'Falcon' });
    const viper  = await createUser({ displayName: 'Viper' });
    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(viper._id)).send({ userId: String(falcon._id) });
    const stranger = await createUser({ displayName: 'Stranger' });

    const res = await request(app)
      .get(`/api/chat/conversations/${dm.body.data.conversation._id}/stream`)
      .set('Cookie', authCookie(stranger._id));

    expect(res.status).toBe(403);
  });
});

describe('the guide bot in the lounge', () => {
  async function seedGuide(adminId) {
    await seedChatBot();
    await BotKnowledge.create({
      slug: 'cbat-guide',
      title: 'CBAT community guide',
      corpus: '=== CBAT COMMUNITY GUIDE ===\nOnly circled aircraft count.\n=== END OF GUIDE ===',
      uploadedByUserId: adminId,
    });
  }

  it('answers briefly and points at the full-size channel', async () => {
    await seedCbatLounge();
    const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
    const falcon = await createUser({ displayName: 'Falcon' });
    await seedGuide(admin._id);
    const convo = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();

    await send(falcon._id, convo._id, '@Guide Bot what is FLAG?');
    await settle();

    const reply = await ChatMessage.findOne({
      conversationId: convo._id, senderDisplayName: 'Guide Bot',
    }).lean();
    expect(reply.body).toContain('Only circled aircraft count.');
    expect(reply.body).toContain(BRIEF_POINTER);
  });

  it('answers a normal channel at full length, with no pointer', async () => {
    // Brief mode is the lounge's, not the bot's: the room people went to on
    // purpose still gets a full answer.
    const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
    const falcon = await createUser({ displayName: 'Falcon' });
    await seedGuide(admin._id);
    const made = await request(app).post('/api/chat/admin/channels')
      .set('Cookie', authCookie(admin._id)).send({ name: 'General' });

    await send(falcon._id, made.body.data.channel._id, '@Guide Bot what is FLAG?');
    await settle();

    const reply = await ChatMessage.findOne({ senderDisplayName: 'Guide Bot' }).lean();
    expect(reply.body).not.toContain(BRIEF_POINTER);
  });
});
