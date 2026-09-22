/**
 * migrations/supportTickets — reports filed before tickets get a thread.
 */
process.env.JWT_SECRET = 'test_secret';

const db = require('../helpers/setupDb');
const { createUser, createAdminUser } = require('../helpers/factories');
const ProblemReport    = require('../../models/ProblemReport');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');
const ChatRead         = require('../../models/ChatRead');
const supportTickets   = require('../../migrations/supportTickets');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const quiet = { logger: null };

describe('migrations/supportTickets', () => {
  it('threads a legacy report with its visible replies at their original times, and closes a solved one', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const t0 = new Date('2026-09-01T10:00:00Z');
    const t1 = new Date('2026-09-02T10:00:00Z');
    const t2 = new Date('2026-09-03T10:00:00Z');
    const report = await ProblemReport.create({
      userId: user._id, pageReported: 'CBAT · Instruments', description: 'Needles off the dial', time: t0, solved: true,
      title: 'Instruments needles off the dial',
      updates: [
        { adminUserId: admin._id, time: t1, description: 'internal: DPR bug', isUserVisible: false },
        { adminUserId: admin._id, time: t2, description: 'Fixed in 1.2.49', isUserVisible: true, notificationSent: true },
      ],
    });

    const result = await supportTickets(quiet);
    expect(result.threaded).toBe(1);

    const saved = await ProblemReport.findById(report._id).lean();
    const convo = await ChatConversation.findById(saved.conversationId).lean();
    expect(convo.type).toBe('support');
    expect(String(convo.reportId)).toBe(String(report._id));
    expect(convo.hasReport).toBe(true);
    expect(convo.title).toBe('Instruments needles off the dial');
    expect(convo.status).toBe('closed');
    expect(convo.messageCount).toBe(2);
    expect(new Date(convo.lastMessageAt).toISOString()).toBe(t2.toISOString());

    const msgs = await ChatMessage.find({ conversationId: convo._id }).sort({ createdAt: 1 }).lean();
    expect(msgs.map(m => [m.senderRole, m.body])).toEqual([['user', 'Needles off the dial'], ['admin', 'Fixed in 1.2.49']]);
    expect(new Date(msgs[0].createdAt).toISOString()).toBe(t0.toISOString());

    // The reply predates the migration and was only ever a toast: it comes
    // back unread once rather than being lost.
    const read = await ChatRead.findOne({ userId: user._id, conversationId: convo._id }).lean();
    expect(new Date(read.lastReadAt).toISOString()).toBe(t0.toISOString());
  });

  it('is a no-op the second time, and never threads a reported chat message', async () => {
    const user = await createUser();
    await ProblemReport.create({ userId: user._id, pageReported: 'Login', description: 'Old report' });
    await ProblemReport.create({ userId: user._id, kind: 'chat_message', pageReported: 'Community', description: 'rude' });

    expect((await supportTickets(quiet)).threaded).toBe(1);
    expect((await supportTickets(quiet)).threaded).toBe(0);
    expect(await ChatConversation.countDocuments({ type: 'support' })).toBe(1);
  });

  it('names an untitled support thread after its first user message', async () => {
    const user = await createUser();
    const convo = await ChatConversation.create({ type: 'support', userId: user._id, messageCount: 1 });
    await ChatMessage.create({ conversationId: convo._id, senderUserId: user._id, senderRole: 'user', body: 'How do I change my agent number? It shows the wrong one.' });

    const result = await supportTickets(quiet);
    expect(result.titled).toBe(1);
    expect((await ChatConversation.findById(convo._id)).title).toBe('How do I change my agent number? It shows the wrong one.');
  });
});
