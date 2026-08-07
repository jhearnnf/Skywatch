/**
 * Medals feed — a channel exactly one bot writes, that users react to.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const seedChatBot = require('../../seeds/seedChatBot');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');
const User             = require('../../models/User');
const {
  postMedalToChannel, chatMedalsEnabled, buildMedalMessage, resetChatMedalsCache,
} = require('../../utils/chatMedals');

beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); resetChatMedalsCache(); });
afterEach(async () => { await db.clearDatabase(); resetChatMedalsCache(); });
afterAll(async () => { await db.closeDatabase(); });

const medalsChannel = () =>
  ChatConversation.findOne({ type: 'channel', 'channel.slug': 'medals' });

const DETAIL = {
  medal: { emoji: '🥇', word: 'Gold' },
  gameLabel: 'Trace Practise 2D',
  agent: 'Falcon',
  score: 940,
  previousRank: 3,
};

describe('seeding', () => {
  it('creates a bot-only Medals feed with notifications off', async () => {
    await seedChatBot();
    const channel = await medalsChannel();

    expect(channel.channel.postPolicy).toBe('bot');
    expect(String(channel.channel.postBotUserId)).toBeTruthy();
    // Off by design: a badge on every podium finish would train people to
    // ignore the dot, costing it its meaning in every other channel too.
    expect(channel.channel.notifyMembers).toBe(false);
  });

  it('does not resurrect the feed once an admin removes it', async () => {
    await seedChatBot();
    await ChatConversation.deleteOne({ 'channel.slug': 'medals' });
    await ChatConversation.create({
      type: 'channel', isArchived: true,
      channel: { name: 'Medals', slug: 'medals', postPolicy: 'bot' },
    });

    await seedChatBot();
    expect(await ChatConversation.countDocuments({ 'channel.slug': 'medals' })).toBe(1);
  });
});

describe('who can post', () => {
  it('refuses everyone, including admins', async () => {
    await seedChatBot();
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const user  = await createUser({ displayName: 'Falcon' });
    const id = (await medalsChannel())._id;

    for (const who of [admin, user]) {
      const res = await request(app).post(`/api/chat/conversations/${id}/messages`)
        .set('Cookie', authCookie(who._id)).send({ body: 'nice one' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CHANNEL_READ_ONLY');
    }
  });

  it('lets the medal bot post through its own path', async () => {
    await seedChatBot();
    const message = await postMedalToChannel(DETAIL);

    expect(message).toBeTruthy();
    expect(message.body).toContain('🥇');
    expect(message.body).toContain('Falcon');
    const channel = await medalsChannel();
    expect(channel.messageCount).toBe(1);
  });

  it('is readable by any signed-in user', async () => {
    await seedChatBot();
    await postMedalToChannel(DETAIL);
    const user = await createUser({ displayName: 'Falcon' });

    const id = (await medalsChannel())._id;
    const res = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(1);
    expect(res.body.data.conversation.postPolicy).toBe('bot');
  });
});

describe('buildMedalMessage', () => {
  it('names the agent as the leaderboard does and mentions the move', () => {
    expect(buildMedalMessage(DETAIL))
      .toBe('🥇 Falcon took Gold on Trace Practise 2D with 940. Up from 3rd.');
  });

  it('omits the move for a first-ever placing', () => {
    expect(buildMedalMessage({ ...DETAIL, previousRank: null }))
      .toBe('🥇 Falcon took Gold on Trace Practise 2D with 940.');
  });

  it('carries the difficulty through for a split game', () => {
    // Easier and Hard are separate boards, so the label detection hands over
    // already names which one — see cbatLabelWithDifficulty.
    expect(buildMedalMessage({ ...DETAIL, gameLabel: 'FLAG (Hard)', previousRank: null }))
      .toBe('🥇 Falcon took Gold on FLAG (Hard) with 940.');
  });
});

describe('names in the feed', () => {
  it('shows a name with an underscore as typed, not markdown-escaped', () => {
    // The bug: agentLabel escaped markdown for the old Discord sink's benefit,
    // so the chat feed - which renders plain text - printed "SkyWatch\_Dev".
    const { agentLabel } = require('../../utils/medals');
    const label = agentLabel({ displayName: 'SkyWatch_Dev' });

    expect(label).toBe('SkyWatch_Dev');
    expect(buildMedalMessage({ ...DETAIL, agent: label }))
      .toContain('SkyWatch_Dev took Gold');
    expect(buildMedalMessage({ ...DETAIL, agent: label })).not.toContain('\\');
  });

  it('leaves every markdown character alone in chat', () => {
    const { agentLabel } = require('../../utils/medals');
    for (const name of ['a_b', 'a*b', 'a~b', 'a`b', 'a|b', 'a[b]']) {
      expect(agentLabel({ displayName: name })).toBe(name);
    }
  });

  it('falls back to the agent number, then to a placeholder', () => {
    const { agentLabel } = require('../../utils/medals');
    expect(agentLabel({ agentNumber: '1234567' })).toBe('Agent 1234567');
    expect(agentLabel({})).toBe('An agent');
  });
});

describe('chatMedalsEnabled', () => {
  it('is off with no channel, on once seeded', async () => {
    expect(await chatMedalsEnabled()).toBe(false);
    resetChatMedalsCache();
    await seedChatBot();
    expect(await chatMedalsEnabled()).toBe(true);
  });

  it('is off once the channel is archived', async () => {
    await seedChatBot();
    await ChatConversation.updateOne({ 'channel.slug': 'medals' }, { $set: { isArchived: true } });
    resetChatMedalsCache();
    expect(await chatMedalsEnabled()).toBe(false);
  });
});

describe('notifications', () => {
  it('keeps a notifications-off channel out of the unread count', async () => {
    await seedChatBot();
    await postMedalToChannel(DETAIL);
    const user = await createUser({ displayName: 'Falcon' });

    const unread = await request(app).get('/api/chat/unread/me').set('Cookie', authCookie(user._id));
    expect(unread.body.data.totalUnread).toBe(0);

    const overview = await request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));
    expect(overview.body.data.channels.find(c => c.slug === 'medals').unread).toBe(false);
  });

  it('counts it again once an admin turns notifications on', async () => {
    await seedChatBot();
    await postMedalToChannel(DETAIL);
    const admin = await createUser({ isAdmin: true });
    const user  = await createUser({ displayName: 'Falcon' });
    const id = (await medalsChannel())._id;

    const res = await request(app).patch(`/api/chat/admin/channels/${id}`)
      .set('Cookie', authCookie(admin._id)).send({ notifyMembers: true });
    expect(res.status).toBe(200);

    const unread = await request(app).get('/api/chat/unread/me').set('Cookie', authCookie(user._id));
    expect(unread.body.data.totalUnread).toBe(1);
  });
});

describe('reactions', () => {
  const react = async (userId, messageId, emoji) =>
    request(app).post(`/api/chat/messages/${messageId}/reactions`)
      .set('Cookie', authCookie(userId)).send({ emoji });

  it('lets an ordinary user react to a message they cannot reply to', async () => {
    await seedChatBot();
    const posted = await postMedalToChannel(DETAIL);
    const user = await createUser({ displayName: 'Falcon' });

    const res = await react(user._id, posted._id, '🎉');
    expect(res.status).toBe(200);
    expect(res.body.data.message.reactions).toEqual([
      { emoji: '🎉', count: 1, mine: true },
    ]);
  });

  it('toggles off on a second press', async () => {
    await seedChatBot();
    const posted = await postMedalToChannel(DETAIL);
    const user = await createUser({ displayName: 'Falcon' });

    await react(user._id, posted._id, '🎉');
    const res = await react(user._id, posted._id, '🎉');
    expect(res.body.data.message.reactions).toEqual([]);
  });

  it('counts each user once and reports mine per viewer', async () => {
    await seedChatBot();
    const posted = await postMedalToChannel(DETAIL);
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    await react(a._id, posted._id, '🔥');
    await react(a._id, posted._id, '🔥'); // toggled off
    await react(a._id, posted._id, '🔥'); // and back on
    const res = await react(b._id, posted._id, '🔥');

    expect(res.body.data.message.reactions[0]).toEqual({ emoji: '🔥', count: 2, mine: true });

    const id = (await medalsChannel())._id;
    const asA = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id));
    expect(asA.body.data.messages[0].reactions[0].mine).toBe(true);

    const outsider = await createUser({ displayName: 'Nomad' });
    const asC = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(outsider._id));
    expect(asC.body.data.messages[0].reactions[0]).toEqual({ emoji: '🔥', count: 2, mine: false });
  });

  it('rejects an emoji outside the fixed set', async () => {
    await seedChatBot();
    const posted = await postMedalToChannel(DETAIL);
    const user = await createUser({ displayName: 'Falcon' });

    const res = await react(user._id, posted._id, '🍆');
    expect(res.status).toBe(400);
  });

  it('refuses a chat-banned user', async () => {
    // Otherwise reacting would just be a quieter way to keep participating.
    await seedChatBot();
    const posted = await postMedalToChannel(DETAIL);
    const user = await createUser({ displayName: 'Falcon' });
    await User.updateOne({ _id: user._id }, { $set: { chatBannedAt: new Date() } });

    const res = await react(user._id, posted._id, '🎉');
    expect(res.status).toBe(403);
  });

  it('refuses a message the user cannot see', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const outsider = await createUser({ displayName: 'Nomad' });

    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(a._id)).send({ userId: b._id });
    const sent = await request(app).post(`/api/chat/conversations/${dm.body.data.conversation._id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'private' });

    const res = await react(outsider._id, sent.body.data.message._id, '🎉');
    expect(res.status).toBe(403);
  });

  it('refuses a removed message', async () => {
    await seedChatBot();
    const posted = await postMedalToChannel(DETAIL);
    const admin = await createUser({ isAdmin: true });
    const user  = await createUser({ displayName: 'Falcon' });

    await request(app).delete(`/api/chat/admin/messages/${posted._id}`)
      .set('Cookie', authCookie(admin._id));

    const res = await react(user._id, posted._id, '🎉');
    expect(res.status).toBe(404);
  });
});
