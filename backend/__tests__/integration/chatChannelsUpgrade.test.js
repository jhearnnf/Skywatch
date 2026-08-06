/**
 * chatChannelsUpgrade migration — runs on every boot, so idempotency is the
 * property that matters most here.
 */
process.env.JWT_SECRET = 'test_secret';

const db = require('../helpers/setupDb');
const chatChannelsUpgrade = require('../../migrations/chatChannelsUpgrade');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');

const silent = { log: () => {} };

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const channels = () =>
  ChatConversation.find({ type: 'channel' }).sort({ 'channel.order': 1 }).lean();

describe('seeding', () => {
  it('creates Announcements above General on an empty database', async () => {
    await chatChannelsUpgrade({ logger: silent });

    const rows = await channels();
    expect(rows.map(c => c.channel.slug)).toEqual(['announcements', 'general']);
    expect(rows[0].channel.order).toBeLessThan(rows[1].channel.order);
    // Announcements is a noticeboard; General is a conversation.
    expect(rows[0].channel.adminOnly).toBe(true);
    expect(rows[1].channel.adminOnly).toBe(false);
  });

  it('is idempotent — a second run creates nothing', async () => {
    await chatChannelsUpgrade({ logger: silent });
    await chatChannelsUpgrade({ logger: silent });

    expect(await ChatConversation.countDocuments({ type: 'channel' })).toBe(2);
  });

  it('adds Announcements to an install that already had General', async () => {
    await ChatConversation.create({
      type: 'channel',
      isArchived: false,
      channel: { name: 'General', slug: 'general', order: 0 },
    });

    const res = await chatChannelsUpgrade({ logger: silent });

    expect(res.seededAnnouncements).toBe(true);
    expect(await ChatConversation.exists({ 'channel.slug': 'announcements' })).toBeTruthy();
  });

  it('does not resurrect an archived Announcements channel', async () => {
    // Archiving is how an admin removes a channel while keeping transcripts.
    // Bringing it back on the next deploy would override that decision.
    await chatChannelsUpgrade({ logger: silent });
    await ChatConversation.updateOne(
      { 'channel.slug': 'announcements' },
      { $set: { isArchived: true, archivedAt: new Date() } },
    );

    await chatChannelsUpgrade({ logger: silent });

    expect(await ChatConversation.countDocuments({ 'channel.slug': 'announcements' })).toBe(1);
    const row = await ChatConversation.findOne({ 'channel.slug': 'announcements' });
    expect(row.isArchived).toBe(true);
  });
});

describe('backfill', () => {
  it('types legacy conversations as support and counts their messages', async () => {
    // A pre-upgrade document: no `type`, no `messageCount`.
    const legacy = await ChatConversation.collection.insertOne({
      userId: new (require('mongoose').Types.ObjectId)(),
      status: 'open',
      startedByRole: 'user',
      lastMessageAt: new Date(),
    });
    await ChatMessage.create({
      conversationId: legacy.insertedId, senderRole: 'user', body: 'hello',
    });

    const res = await chatChannelsUpgrade({ logger: silent });

    expect(res.typed).toBe(1);
    const row = await ChatConversation.findById(legacy.insertedId);
    expect(row.type).toBe('support');
    expect(row.messageCount).toBe(1);
  });

  it('leaves the open-support unique index able to coexist with channels', async () => {
    // The bug this migration exists to prevent: the legacy index filtered only
    // on status:'open', so every channel and DM collided on userId:null.
    await chatChannelsUpgrade({ logger: silent });

    await ChatConversation.create({
      type: 'channel', isArchived: false,
      channel: { name: 'Second', slug: 'second', order: 5 },
    });
    await ChatConversation.create({
      type: 'channel', isArchived: false,
      channel: { name: 'Third', slug: 'third', order: 6 },
    });

    expect(await ChatConversation.countDocuments({ type: 'channel' })).toBe(4);
  });
});
