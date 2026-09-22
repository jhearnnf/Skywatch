/**
 * Support tickets in the Community rail.
 *
 * A reply to a problem report used to reach its author as a one-off toast on
 * whatever page they were on. The report is now listed in the rail with the
 * team's replies under it, for as long as it is open — plus, once resolved,
 * until the last reply has been read. These cover what the overview lists, what
 * the navbar badge counts, and what "seen" clears.
 */
process.env.JWT_SECRET = 'test_secret';

// No model call for a title from inside the suite.
jest.mock('../../utils/reportTitle', () => ({
  ...jest.requireActual('../../utils/reportTitle'),
  scheduleReportTitle: jest.fn(),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const ProblemReport    = require('../../models/ProblemReport');
const UserNotification = require('../../models/UserNotification');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

async function fileReport(user, description = 'The needles are off the dial on Instruments') {
  const res = await request(app)
    .post('/api/users/report-problem')
    .set('Cookie', authCookie(user._id))
    .send({ description, pageReported: '/cbat/instruments' });
  return res.body.data.report;
}

async function reply(admin, reportId, description, extra = {}) {
  return request(app)
    .post(`/api/admin/problems/${reportId}/update`)
    .set('Cookie', authCookie(admin._id))
    .send({ description, notifyUser: true, sendNotification: true, ...extra });
}

const overview = (user) => request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));
const unread   = (user) => request(app).get('/api/chat/unread/me').set('Cookie', authCookie(user._id));
const seen     = (user, id) => request(app).post(`/api/users/me/reports/${id}/seen`).set('Cookie', authCookie(user._id));

describe('GET /api/chat/overview — tickets', () => {
  it('lists nothing for a member with no reports', async () => {
    const user = await createUser();
    const res = await overview(user);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets).toEqual([]);
  });

  it('lists an open report with only the replies the team chose to show', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const report = await fileReport(user);
    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'internal: probably the DPR bug', notifyUser: false });
    await reply(admin, report._id, 'Thanks, we can reproduce this and are on it.');

    const res = await overview(user);
    const [ticket] = res.body.data.tickets;
    expect(res.body.data.tickets).toHaveLength(1);
    expect(ticket._id).toBe(String(report._id));
    expect(ticket.title).toBe('The needles are off the dial on Instruments');
    expect(ticket.pageReported).toBe('CBAT · Instruments');
    expect(ticket.solved).toBe(false);
    expect(ticket.updates.map(u => u.description)).toEqual(['Thanks, we can reproduce this and are on it.']);
    expect(ticket.unread).toBe(true);
    expect(ticket.unreadCount).toBe(1);
    expect(ticket.preview.body).toBe('Thanks, we can reproduce this and are on it.');
  });

  it('uses the generated title once it has been written', async () => {
    const user = await createUser();
    const report = await fileReport(user);
    await ProblemReport.updateOne({ _id: report._id }, { $set: { title: 'Instruments needles drawn off the dial' } });
    const [ticket] = (await overview(user)).body.data.tickets;
    expect(ticket.title).toBe('Instruments needles drawn off the dial');
  });

  it('shortens a long report into the row title', async () => {
    const user = await createUser();
    await fileReport(user, 'x'.repeat(200));
    const [ticket] = (await overview(user)).body.data.tickets;
    expect(ticket.title.length).toBeLessThanOrEqual(80);
    expect(ticket.title.endsWith('…')).toBe(true);
    expect(ticket.description).toHaveLength(200);
  });

  // "We've fixed it" is the one reply the author must not miss.
  it('keeps a resolved ticket listed until its last reply has been seen', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const report = await fileReport(user);
    await reply(admin, report._id, 'Fixed in the latest build.', { solved: true });

    let tickets = (await overview(user)).body.data.tickets;
    expect(tickets).toHaveLength(1);
    expect(tickets[0].solved).toBe(true);

    await seen(user, report._id);
    tickets = (await overview(user)).body.data.tickets;
    expect(tickets).toEqual([]);
  });

  it('drops a resolved ticket with no reply to read', async () => {
    const user  = await createUser();
    const report = await fileReport(user);
    await ProblemReport.updateOne({ _id: report._id }, { $set: { solved: true } });
    expect((await overview(user)).body.data.tickets).toEqual([]);
  });

  it('never lists a reported chat message as a ticket', async () => {
    const user = await createUser();
    await ProblemReport.create({
      userId: user._id, kind: 'chat_message', pageReported: 'Community',
      description: 'rude message', solved: false,
    });
    expect((await overview(user)).body.data.tickets).toEqual([]);
  });

  it('only ever lists the viewer\'s own reports', async () => {
    const user  = await createUser();
    const other = await createUser({ email: 'other@example.com' });
    await fileReport(other);
    expect((await overview(user)).body.data.tickets).toEqual([]);
  });
});

describe('GET /api/chat/unread/me — ticket replies', () => {
  it('counts unread replies on the number, and the seen stamp clears them', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const report = await fileReport(user);

    let res = await unread(user);
    expect(res.body.data.ticketReplies).toBe(0);
    const before = res.body.data.personalUnread;

    await reply(admin, report._id, 'Looking into it.');
    await reply(admin, report._id, 'Found it.');

    res = await unread(user);
    expect(res.body.data.ticketReplies).toBe(2);
    expect(res.body.data.personalUnread).toBe(before + 2);
    expect(res.body.data.hasUnread).toBe(true);

    await seen(user, report._id);
    res = await unread(user);
    expect(res.body.data.ticketReplies).toBe(0);
    expect(res.body.data.personalUnread).toBe(before);
  });

  it('a reply after the last look counts again', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const report = await fileReport(user);
    await reply(admin, report._id, 'Looking into it.');
    await seen(user, report._id);
    // Distinct timestamps: the seen stamp and the next reply must not tie.
    await new Promise(r => setTimeout(r, 5));
    await reply(admin, report._id, 'Found it.');

    const [ticket] = (await overview(user)).body.data.tickets;
    expect(ticket.unreadCount).toBe(1);
  });
});

describe('POST /api/users/me/reports/:id/seen', () => {
  it('clears the in-app notification rows for that report too', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const report = await fileReport(user);
    await reply(admin, report._id, 'Looking into it.');
    expect(await UserNotification.countDocuments({ userId: user._id, read: false })).toBe(1);

    const res = await seen(user, report._id);
    expect(res.status).toBe(200);
    expect(await UserNotification.countDocuments({ userId: user._id, read: false })).toBe(0);
  });

  it('refuses to stamp someone else\'s report', async () => {
    const user  = await createUser();
    const other = await createUser({ email: 'other@example.com' });
    const report = await fileReport(other);

    const res = await seen(user, report._id);
    expect(res.status).toBe(404);
    expect((await ProblemReport.findById(report._id)).userSeenAt).toBeNull();
  });

  it('404s on a malformed id', async () => {
    const user = await createUser();
    expect((await seen(user, 'not-an-id')).status).toBe(404);
  });
});
