/**
 * Chat bot — access control and knowledge upload.
 *
 * The reply pipeline itself is unit-tested in unit/chatBot.test.js; this covers
 * who can reach the bot and how its guide gets in.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const seedChatBot = require('../../seeds/seedChatBot');
const ChatConversation = require('../../models/ChatConversation');
const BotKnowledge     = require('../../models/BotKnowledge');
const ChatMessage      = require('../../models/ChatMessage');
const User             = require('../../models/User');

beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const GUIDE_HTML = `<!doctype html><html><body><script>
const TESTS = [{ id:'flag', name:'Figures, Logistics and Groups', abbr:'FLAG',
  facts:[{c:'green',tag:'Core rule',t:'Only circled aircraft count.',n:'Fix your practice.'}] }];
</script></body></html>`;

describe('seedChatBot', () => {
  it('creates one bot account that nothing can sign in as', async () => {
    const { guideBotId } = await seedChatBot();
    const bot = await User.findById(guideBotId).select('+password');

    expect(bot.isBot).toBe(true);
    expect(bot.password).toBeUndefined();
    expect(bot.googleId).toBeUndefined();
  });

  it('is idempotent', async () => {
    await seedChatBot();
    await seedChatBot();
    // Two bots: the guide bot and the medal bot.
    expect(await User.countDocuments({ isBot: true })).toBe(2);
  });

  it('repairs a bot row that predates the isBot flag', async () => {
    const { guideBotId } = await seedChatBot();
    await User.updateOne({ _id: guideBotId }, { $set: { isBot: false } });

    await seedChatBot();
    expect((await User.findById(guideBotId)).isBot).toBe(true);
  });
});

describe('who can message the bot', () => {
  it('lets an admin open a DM with it', async () => {
    const { guideBotId: botId } = await seedChatBot();
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });

    const res = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(admin._id)).send({ userId: botId });

    expect(res.status).toBe(200);
    const convo = await ChatConversation.findById(res.body.data.conversation._id);
    expect(String(convo.botUserId)).toBe(String(botId));
  });

  it('refuses a non-admin', async () => {
    const { guideBotId: botId } = await seedChatBot();
    const user  = await createUser({ displayName: 'Falcon' });

    const res = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(user._id)).send({ userId: botId });

    expect(res.status).toBe(403);
    expect(await ChatConversation.countDocuments({ type: 'dm' })).toBe(0);
  });

  it('stops a demoted admin posting into a bot DM that already exists', async () => {
    // The second gate. Creating the thread is not a permanent licence to use it.
    const { guideBotId: botId } = await seedChatBot();
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });

    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(admin._id)).send({ userId: botId });
    const id = dm.body.data.conversation._id;

    await User.updateOne({ _id: admin._id }, { $set: { isAdmin: false } });

    const res = await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'still there?' });
    expect(res.status).toBe(403);
  });
});

describe('bots describe themselves', () => {
  it('gives each bot its own description, not one hardcoded label', async () => {
    // The sidebar used to call every bot "Answers from the CBAT community
    // guide", which is nonsense for one that only posts medals.
    const { guideBotId, medalBotId } = await seedChatBot();

    const guide = await User.findById(guideBotId).lean();
    const medal = await User.findById(medalBotId).lean();

    expect(guide.botDescription).toMatch(/guide/i);
    expect(medal.botDescription).toMatch(/medals channel/i);
    expect(guide.botDescription).not.toBe(medal.botDescription);
  });

  it('marks the medal bot as taking no direct messages', async () => {
    const { guideBotId, medalBotId } = await seedChatBot();
    expect((await User.findById(guideBotId)).botAnswersDms).toBe(true);
    expect((await User.findById(medalBotId)).botAnswersDms).toBe(false);
  });

  it('refuses a DM to a poster bot, so nothing sits unanswered', async () => {
    const { medalBotId } = await seedChatBot();
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });

    const res = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(admin._id)).send({ userId: medalBotId });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/posts to a channel/i);
    expect(await ChatConversation.countDocuments({ type: 'dm' })).toBe(0);
  });

  it('repairs the flags on a bot row that predates them', async () => {
    const { medalBotId } = await seedChatBot();
    await User.updateOne({ _id: medalBotId }, {
      $set: { botAnswersDms: true }, $unset: { botDescription: 1 },
    });

    await seedChatBot();
    const medal = await User.findById(medalBotId);
    // Left as-is, the medal bot would answer DMs with CBAT guide answers.
    expect(medal.botAnswersDms).toBe(false);
    expect(medal.botDescription).toMatch(/medals channel/i);
  });
});

describe('bots have a face of their own', () => {
  it('gives each bot a stable key to pick its avatar from', async () => {
    const { guideBotId, medalBotId } = await seedChatBot();

    expect((await User.findById(guideBotId)).botKey).toBe('guide');
    expect((await User.findById(medalBotId)).botKey).toBe('medal');
  });

  it('keeps the key when a bot is renamed', async () => {
    // The avatar must not follow the display name: an admin retitling the medal
    // bot would otherwise silently swap the face it has been posting under.
    const { medalBotId } = await seedChatBot();
    await User.updateOne({ _id: medalBotId }, { $set: { displayName: 'Podium' } });

    await seedChatBot();
    const medal = await User.findById(medalBotId);
    expect(medal.displayName).toBe('Podium');
    expect(medal.botKey).toBe('medal');
  });

  it('repairs a bot row that predates the key', async () => {
    const { guideBotId } = await seedChatBot();
    await User.updateOne({ _id: guideBotId }, { $unset: { botKey: 1 } });

    await seedChatBot();
    expect((await User.findById(guideBotId)).botKey).toBe('guide');
  });

  it('sends isBot and the key with the sender profile', async () => {
    // Without these the client falls through to the rank badge, and a bot —
    // which has no rank — ends up wearing the "AC" every new account shows.
    const { medalBotId } = await seedChatBot();
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });

    const made = await request(app).post('/api/chat/admin/channels')
      .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
    const channelId = made.body.data.channel._id;
    await ChatMessage.create({
      conversationId:    channelId,
      senderUserId:      medalBotId,
      senderRole:        'user',
      senderDisplayName: 'Medal Bot',
      body:              'Falcon takes gold on Target.',
    });

    const res = await request(app).get(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.senders[String(medalBotId)]).toMatchObject({
      isBot: true, botKey: 'medal',
    });
  });

  it('sends the key with the sidebar bot list', async () => {
    await seedChatBot();
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });

    const res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(admin._id));
    expect(res.body.data.bots[0].botKey).toBe('guide');
  });

  it('sends the key with the user card', async () => {
    const { guideBotId } = await seedChatBot();
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });

    const res = await request(app).get(`/api/chat/users/${guideBotId}/card`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.user).toMatchObject({ isBot: true, botKey: 'guide' });
  });
});

describe('the bot is not a player', () => {
  it('never appears on the leaderboard', async () => {
    const { guideBotId: botId } = await seedChatBot();
    await User.updateOne({ _id: botId }, { $set: { totalAirstars: 999999 } });
    await createUser({ displayName: 'Falcon', totalAirstars: 10 });

    const res = await request(app).get('/api/users/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.data.agents.map(a => String(a._id))).not.toContain(String(botId));
  });
});

describe('overview', () => {
  it('advertises the bot to admins, with no thread until one is opened', async () => {
    const { guideBotId: botId } = await seedChatBot();
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });

    let res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(admin._id));
    // Only the guide bot: the medal bot posts to a channel and takes no DMs,
    // so listing it as a DM target would promise a reply it cannot give.
    expect(res.body.data.bots).toHaveLength(1);
    expect(res.body.data.bots[0].conversationId).toBeNull();
    expect(res.body.data.bots[0].description).toMatch(/CBAT community guide/i);

    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(admin._id)).send({ userId: botId });

    res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(admin._id));
    const guide = res.body.data.bots.find(b => b.conversationId);
    expect(String(guide.conversationId)).toBe(String(dm.body.data.conversation._id));
    // A bot thread is listed under bots, never mixed into real conversations.
    expect(res.body.data.dms).toHaveLength(0);
  });

  it('does not advertise it to ordinary users', async () => {
    await seedChatBot();
    const user = await createUser({ displayName: 'Falcon' });

    const res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));
    expect(res.body.data.bots).toEqual([]);
  });
});

describe('knowledge upload', () => {
  it('parses the guide and reports what it found', async () => {
    const admin = await createUser({ isAdmin: true });

    const res = await request(app).put('/api/chat/admin/bot/knowledge')
      .set('Cookie', authCookie(admin._id))
      .send({ filename: 'guide.html', html: GUIDE_HTML });

    expect(res.status).toBe(200);
    expect(res.body.data.knowledge.stats.tests).toBe(1);
    expect(res.body.data.knowledge.stats.facts).toBe(1);

    const stored = await BotKnowledge.findOne({ slug: 'cbat-guide' });
    expect(stored.corpus).toContain('Only circled aircraft count.');
    // Stored in Mongo, deliberately: the file lives in a gitignored folder
    // outside backend/, which Railway never ships.
    expect(stored.sourceFilename).toBe('guide.html');
  });

  it('replaces the previous guide rather than accumulating copies', async () => {
    const admin = await createUser({ isAdmin: true });
    const c = authCookie(admin._id);

    await request(app).put('/api/chat/admin/bot/knowledge').set('Cookie', c)
      .send({ filename: 'v1.html', html: GUIDE_HTML });
    await request(app).put('/api/chat/admin/bot/knowledge').set('Cookie', c)
      .send({ filename: 'v2.html', html: GUIDE_HTML });

    expect(await BotKnowledge.countDocuments({})).toBe(1);
    expect((await BotKnowledge.findOne({})).sourceFilename).toBe('v2.html');
  });

  it('rejects a file that is not the guide, with a usable message', async () => {
    const admin = await createUser({ isAdmin: true });
    const res = await request(app).put('/api/chat/admin/bot/knowledge')
      .set('Cookie', authCookie(admin._id))
      .send({ filename: 'holiday.html', html: '<html><body>hello</body></html>' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/does not look like the CBAT guide/i);
    expect(await BotKnowledge.countDocuments({})).toBe(0);
  });

  it('rejects an empty upload', async () => {
    const admin = await createUser({ isAdmin: true });
    const res = await request(app).put('/api/chat/admin/bot/knowledge')
      .set('Cookie', authCookie(admin._id)).send({ html: '' });
    expect(res.status).toBe(400);
  });

  it('accepts the minified guide text as well as the HTML', async () => {
    const admin = await createUser({ isAdmin: true });
    const c = authCookie(admin._id);

    // Whatever the admin picks, the bot must end up with the same material.
    await request(app).put('/api/chat/admin/bot/knowledge').set('Cookie', c)
      .send({ filename: 'guide.html', text: GUIDE_HTML });
    const fromHtml = await BotKnowledge.findOne({ slug: 'cbat-guide' }).lean();

    const res = await request(app).put('/api/chat/admin/bot/knowledge').set('Cookie', c)
      .send({ filename: 'CBAT_Guide_Minified.txt', text: fromHtml.corpus });

    expect(res.status).toBe(200);
    const fromText = await BotKnowledge.findOne({ slug: 'cbat-guide' }).lean();
    expect(fromText.sourceFilename).toBe('CBAT_Guide_Minified.txt');
    expect(fromText.corpus).toBe(fromHtml.corpus);
    // Sections are what keep retrieval alive. Storing the text alone would send
    // the whole guide on every question, with nothing in the UI to show it.
    expect(fromText.sections.TESTS).toHaveLength(fromHtml.sections.TESTS.length);
    expect(fromText.stats.tests).toBe(fromHtml.stats.tests);
  });

  it('still accepts the old `html` body key from an older client', async () => {
    const admin = await createUser({ isAdmin: true });
    const res = await request(app).put('/api/chat/admin/bot/knowledge')
      .set('Cookie', authCookie(admin._id))
      .send({ filename: 'guide.html', html: GUIDE_HTML });
    expect(res.status).toBe(200);
  });

  it('rejects a text file that is not a rendered guide', async () => {
    const admin = await createUser({ isAdmin: true });
    const res = await request(app).put('/api/chat/admin/bot/knowledge')
      .set('Cookie', authCookie(admin._id))
      .send({ filename: 'shopping.txt', text: 'milk, bread, revise for the CBAT' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/does not look like the CBAT guide/i);
    expect(await BotKnowledge.countDocuments({})).toBe(0);
  });

  it('is admin-only, both ways', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const c = authCookie(user._id);

    expect((await request(app).put('/api/chat/admin/bot/knowledge')
      .set('Cookie', c).send({ html: GUIDE_HTML })).status).toBe(403);
    expect((await request(app).get('/api/chat/admin/bot/knowledge')
      .set('Cookie', c)).status).toBe(403);
  });
});
