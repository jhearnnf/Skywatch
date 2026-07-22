/**
 * admin.user-email.test.js
 *
 * Tests for POST /api/admin/users/:id/email — the admin-composed email sender
 * behind the Users panel "email user" button.
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - Field validation (400 on missing subject/heading/body)
 *   - 404 on unknown user
 *   - Happy path: Resend called once, EmailLog row written, response echoes recipient
 *   - Resend failure surfaces as 502 and logs a failed EmailLog row
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createAdminUser,
  createUser,
  authCookie,
} = require('../helpers/factories');

const EmailLog = require('../../models/EmailLog');

const validBody = {
  subject:  'You’re invited to test the SkyWatch Android app',
  heading:  'Android Test Flight',
  subtitle: 'Agent 42 — you’ve been selected.',
  body:     'Hello Agent 42,\n\nOpt in here: https://play.google.com/apps/testing/academy.skywatch.app\n\n— The SkyWatch Team',
  ctaText:  'Join the Testers Group',
  ctaUrl:   'https://groups.google.com/g/skywatch-app-testers',
  type:     'app_invite',
};

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

describe('POST /api/admin/users/:id/email — auth guards', () => {
  it('returns 401 with no auth cookie', async () => {
    const target = await createUser();
    const res = await request(app)
      .post(`/api/admin/users/${target._id}/email`)
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const target = await createUser();
    const nonAdmin = await createUser();
    const res = await request(app)
      .post(`/api/admin/users/${target._id}/email`)
      .set('Cookie', authCookie(nonAdmin._id))
      .send(validBody);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/users/:id/email — validation', () => {
  it.each(['subject', 'heading', 'body'])('returns 400 when %s is missing', async (field) => {
    const admin  = await createAdminUser();
    const target = await createUser({ email: 'target@test.com' });
    const body   = { ...validBody, [field]: '' };

    const res = await request(app)
      .post(`/api/admin/users/${target._id}/email`)
      .set('Cookie', authCookie(admin._id))
      .send(body);

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown user id', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/users/507f1f77bcf86cd799439011/email')
      .set('Cookie', authCookie(admin._id))
      .send(validBody);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/users/:id/email — sending', () => {
  it('sends the email, logs it, and echoes the recipient', async () => {
    await createSettings();
    const admin  = await createAdminUser();
    const target = await createUser({ email: 'target@test.com' });

    const { __sendMock: sendMock } = require('resend');
    sendMock.mockClear();

    const res = await request(app)
      .post(`/api/admin/users/${target._id}/email`)
      .set('Cookie', authCookie(admin._id))
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.data.sentTo).toBe('target@test.com');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentArgs = sendMock.mock.calls[0][0];
    expect(sentArgs.to).toBe('target@test.com');
    expect(sentArgs.subject).toBe(validBody.subject);
    // CTA button renders
    expect(sentArgs.html).toContain('Join the Testers Group');
    // A URL pasted into the body is auto-linked
    expect(sentArgs.html).toContain('<a href="https://play.google.com/apps/testing/academy.skywatch.app"');

    const log = await EmailLog.findOne({ recipientEmail: 'target@test.com' });
    expect(log).not.toBeNull();
    expect(log.type).toBe('app_invite');
    expect(log.status).toBe('sent');
    expect(log.recipientUserId.toString()).toBe(target._id.toString());
  });

  it('returns 502 and logs a failed row when Resend errors', async () => {
    await createSettings();
    const admin  = await createAdminUser();
    const target = await createUser({ email: 'fail@test.com' });

    const { __sendMock: sendMock } = require('resend');
    sendMock.mockClear();
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'Resend down' } });

    const res = await request(app)
      .post(`/api/admin/users/${target._id}/email`)
      .set('Cookie', authCookie(admin._id))
      .send(validBody);

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Resend down/);

    const log = await EmailLog.findOne({ recipientEmail: 'fail@test.com' });
    expect(log).not.toBeNull();
    expect(log.status).toBe('failed');
  });
});
