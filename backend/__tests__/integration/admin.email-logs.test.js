/**
 * admin.email-logs.test.js
 *
 * Integration tests for GET /api/admin/email-logs, with focus on the `userId`
 * filter that powers the per-agent "email history" jump from the Users panel.
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - userId returns only that user's logs, newest first
 *   - userId matches on recipientUserId, so an old address still shows up
 *   - userId composes with type/status filters
 *   - Invalid userId is a 400, not a 500
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createUser, createAdminUser, authCookie,
} = require('../helpers/factories');

const EmailLog = require('../../models/EmailLog');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const log = (props) => EmailLog.create({
  type: 'welcome', status: 'sent', recipientEmail: 'someone@test.com', ...props,
});

describe('GET /api/admin/email-logs — auth guards', () => {
  it('returns 401 for an unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/email-logs');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .get('/api/admin/email-logs')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/email-logs — userId filter', () => {
  it('returns only that user\'s emails, newest first', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ email: 'target@test.com' });
    const other  = await createUser({ email: 'other@test.com' });

    await log({ recipientEmail: 'target@test.com', recipientUserId: target._id, subject: 'Older',  sentAt: new Date('2026-01-01') });
    await log({ recipientEmail: 'target@test.com', recipientUserId: target._id, subject: 'Newer',  sentAt: new Date('2026-02-01'), type: 'app_invite' });
    await log({ recipientEmail: 'other@test.com',  recipientUserId: other._id,  subject: 'Theirs', sentAt: new Date('2026-03-01') });

    const res = await request(app)
      .get(`/api/admin/email-logs?userId=${target._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.logs.map(l => l.subject)).toEqual(['Newer', 'Older']);
  });

  it('matches on recipientUserId, so mail sent to a previous address is included', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ email: 'new-address@test.com' });

    await log({ recipientEmail: 'old-address@test.com', recipientUserId: target._id, subject: 'Sent before the change' });

    const res = await request(app)
      .get(`/api/admin/email-logs?userId=${target._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.logs[0].recipientEmail).toBe('old-address@test.com');
  });

  it('excludes logs with no recipientUserId (e.g. anonymised after deletion)', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ email: 'target@test.com' });

    await log({ recipientEmail: 'target@test.com', recipientUserId: null });

    const res = await request(app)
      .get(`/api/admin/email-logs?userId=${target._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  it('composes with the status filter', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ email: 'target@test.com' });

    await log({ recipientEmail: 'target@test.com', recipientUserId: target._id, status: 'sent',   subject: 'Delivered' });
    await log({ recipientEmail: 'target@test.com', recipientUserId: target._id, status: 'failed', subject: 'Bounced', error: 'boom' });

    const res = await request(app)
      .get(`/api/admin/email-logs?userId=${target._id}&status=failed`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.logs[0].subject).toBe('Bounced');
  });

  it('returns 400 for a malformed userId rather than throwing', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/email-logs?userId=not-an-id')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(400);
  });
});
