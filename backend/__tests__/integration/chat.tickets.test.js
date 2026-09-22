/**
 * Support tickets: a problem report and a support chat are the same thing.
 *
 * A report used to be a one-way form with admin notes, and a support chat a
 * separate two-way thread. Now a report opens a support thread with the
 * report as its first message; the team replies there; the reporter answers
 * there; resolving it closes the thread. These cover the join: what filing a
 * report creates, what the rail lists, what an admin reply from the Reports
 * tab does, and the solved/closed mirror in both directions.
 */
process.env.JWT_SECRET = 'test_secret';

// No model call for a title from inside the suite.
jest.mock('../../utils/reportTitle', () => ({
  ...jest.requireActual('../../utils/reportTitle'),
  scheduleTicketTitle: jest.fn(),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const ProblemReport    = require('../../models/ProblemReport');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const cookie = (u) => authCookie(u._id);

async function fileReport(user, description = 'The needles are off the dial on Instruments') {
  const res = await request(app)
    .post('/api/users/report-problem')
    .set('Cookie', cookie(user))
    .send({ description, pageReported: '/cbat/instruments' });
  return res.body.data;
}

const adminUpdate = (admin, reportId, body) =>
  request(app).post(`/api/admin/problems/${reportId}/update`).set('Cookie', cookie(admin)).send(body);

const overview = (user) => request(app).get('/api/chat/overview').set('Cookie', cookie(user));
const messagesOf = (user, id) => request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', cookie(user));
const post = (user, id, body) =>
  request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', cookie(user)).send({ body });

describe('filing a report opens a ticket', () => {
  it('creates a support thread with the report as the first message, linked both ways', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const { report, conversationId } = await fileReport(user);

    const convo = await ChatConversation.findById(conversationId).lean();
    expect(convo.type).toBe('support');
    expect(String(convo.userId)).toBe(String(user._id));
    expect(String(convo.reportId)).toBe(String(report._id));
    expect(convo.status).toBe('open');
    expect(convo.title).toBe('The needles are off the dial on Instruments');

    const saved = await ProblemReport.findById(report._id).lean();
    expect(String(saved.conversationId)).toBe(String(convo._id));

    const msgs = await ChatMessage.find({ conversationId: convo._id }).lean();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].senderRole).toBe('user');
    expect(msgs[0].body).toBe('The needles are off the dial on Instruments');
  });

  it('gives a second problem its own ticket', async () => {
    const user = await createUser();
    const a = await fileReport(user, 'First problem, the sound never plays');
    const b = await fileReport(user, 'Second problem, the map never loads');
    expect(a.conversationId).not.toBe(b.conversationId);
    expect(await ChatConversation.countDocuments({ type: 'support', userId: user._id, status: 'open' })).toBe(2);
  });

  it('shows the reporter the ticket, and an admin the report context too', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const { conversationId } = await fileReport(user);

    const mine = await messagesOf(user, conversationId);
    expect(mine.status).toBe(200);
    expect(mine.body.data.conversation.title).toBe('The needles are off the dial on Instruments');
    expect(mine.body.data.conversation.reportId).toBeTruthy();
    expect(mine.body.data.conversation.report).toBeUndefined();

    const theirs = await messagesOf(admin, conversationId);
    expect(theirs.body.data.conversation.report.pageReported).toBe('CBAT · Instruments');
    expect(Array.isArray(theirs.body.data.conversation.report.environmentSummary)).toBe(true);
  });
});

describe('GET /api/chat/overview — tickets', () => {
  it('lists nothing for a member with no tickets', async () => {
    const user = await createUser();
    const res = await overview(user);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets).toEqual([]);
    expect(res.body.data.support).toBeUndefined();
  });

  it('lists an open ticket with its title and the last reply as preview', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const { conversationId } = await fileReport(user);
    await post(admin, conversationId, 'Thanks, we can reproduce this.');

    const [ticket] = (await overview(user)).body.data.tickets;
    expect(ticket._id).toBe(conversationId);
    expect(ticket.title).toBe('The needles are off the dial on Instruments');
    expect(ticket.status).toBe('open');
    expect(ticket.unread).toBe(true);
    expect(ticket.personalUnread).toBe(1);
    expect(ticket.preview.body).toBe('Thanks, we can reproduce this.');
    expect(ticket.preview.senderDisplayName).toBe('SkyWatch Support');
  });

  it('leaves a blank "Message the team" ticket out until something is typed', async () => {
    const user = await createUser();
    const start = await request(app).post('/api/chat/conversations').set('Cookie', cookie(user));
    expect((await overview(user)).body.data.tickets).toEqual([]);

    await post(user, start.body.data.conversation._id, 'Is there a way to reset my scores?');
    const [ticket] = (await overview(user)).body.data.tickets;
    expect(ticket._id).toBe(start.body.data.conversation._id);
    expect(ticket.title).toBe('Is there a way to reset my scores?');
  });

  // "We've fixed it" is the one reply the author must not miss.
  it('keeps a resolved ticket listed until its closing line has been read', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const { report, conversationId } = await fileReport(user);
    await adminUpdate(admin, report._id, { description: 'Fixed in the latest build.', notifyUser: true, solved: true });

    let tickets = (await overview(user)).body.data.tickets;
    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe('closed');

    await request(app).post(`/api/chat/conversations/${conversationId}/read`).set('Cookie', cookie(user));
    tickets = (await overview(user)).body.data.tickets;
    expect(tickets).toEqual([]);
  });

  it('never lists a reported chat message as a ticket', async () => {
    const user = await createUser();
    await ProblemReport.create({
      userId: user._id, kind: 'chat_message', pageReported: 'Community',
      description: 'rude message', solved: false,
    });
    expect((await overview(user)).body.data.tickets).toEqual([]);
    expect(await ChatConversation.countDocuments({ type: 'support' })).toBe(0);
  });
});

describe('admin reply from the Reports tab', () => {
  it('posts a visible update into the thread as SkyWatch Support', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const { report, conversationId } = await fileReport(user);

    const res = await adminUpdate(admin, report._id, { description: 'On it, thanks.', notifyUser: true, sendEmail: false });
    expect(res.status).toBe(200);

    const msgs = (await messagesOf(user, conversationId)).body.data.messages;
    expect(msgs.map(m => m.body)).toEqual(['The needles are off the dial on Instruments', 'On it, thanks.']);
    expect(msgs[1].senderDisplayName).toBe('SkyWatch Support');

    const saved = await ProblemReport.findById(report._id).lean();
    expect(saved.updates[0].isUserVisible).toBe(true);
    expect(saved.updates[0].notificationSent).toBe(true);
    expect(saved.updates[0].emailSent).toBe(false);
  });

  it('keeps an internal note out of the thread', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const { report, conversationId } = await fileReport(user);

    await adminUpdate(admin, report._id, { description: 'probably the DPR bug', notifyUser: false });

    expect(await ChatMessage.countDocuments({ conversationId })).toBe(1);
    const saved = await ProblemReport.findById(report._id).lean();
    expect(saved.updates[0].isUserVisible).toBe(false);
  });

  it('marking solved resolves the thread, and reopening reopens it', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const { report, conversationId } = await fileReport(user);

    await adminUpdate(admin, report._id, { description: 'Fixed.', notifyUser: true, solved: true });
    let convo = await ChatConversation.findById(conversationId).lean();
    expect(convo.status).toBe('closed');
    expect((await ProblemReport.findById(report._id)).solved).toBe(true);

    await adminUpdate(admin, report._id, { description: 'Reopening, not fixed after all.', solved: false });
    convo = await ChatConversation.findById(conversationId).lean();
    expect(convo.status).toBe('open');
    expect((await ProblemReport.findById(report._id)).solved).toBe(false);
  });

  it('threads a report that predates tickets on first admin reply', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const legacy = await ProblemReport.create({ userId: user._id, pageReported: 'Login', description: 'Old report' });

    await adminUpdate(admin, legacy._id, { description: 'Looking now.', notifyUser: true });

    const saved = await ProblemReport.findById(legacy._id).lean();
    expect(saved.conversationId).toBeTruthy();
    const bodies = (await ChatMessage.find({ conversationId: saved.conversationId }).sort({ createdAt: 1 }).lean()).map(m => m.body);
    expect(bodies).toEqual(['Old report', 'Looking now.']);
  });
});

describe('the solved/closed mirror from the chat side', () => {
  it('a user replying to a resolved ticket reopens it and the report', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const { report, conversationId } = await fileReport(user);
    await adminUpdate(admin, report._id, { description: 'Fixed.', notifyUser: true, solved: true });

    const res = await post(user, conversationId, 'Still broken for me');
    expect(res.status).toBe(200);

    expect((await ChatConversation.findById(conversationId)).status).toBe('open');
    expect((await ProblemReport.findById(report._id)).solved).toBe(false);
    const bodies = (await ChatMessage.find({ conversationId }).sort({ createdAt: 1 }).lean()).map(m => m.body);
    expect(bodies).toContain('Reopened with a new message');
  });

  it('closing the thread from the console marks the report solved', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const { report, conversationId } = await fileReport(user);

    await request(app).post(`/api/chat/admin/conversations/${conversationId}/close`).set('Cookie', cookie(admin));
    expect((await ProblemReport.findById(report._id)).solved).toBe(true);

    await request(app).post(`/api/chat/admin/conversations/${conversationId}/reopen`).set('Cookie', cookie(admin));
    expect((await ProblemReport.findById(report._id)).solved).toBe(false);
  });

  it('the reporter marking it resolved solves the report', async () => {
    const user = await createUser();
    const { report, conversationId } = await fileReport(user);
    await request(app).post(`/api/chat/conversations/${conversationId}/close`).set('Cookie', cookie(user));
    expect((await ProblemReport.findById(report._id)).solved).toBe(true);
  });
});
