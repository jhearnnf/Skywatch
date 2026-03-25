// Mock Resend before any module that loads email.js is required
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'mock-id' }, error: null }),
    },
  })),
}));

process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const crypto   = require('crypto');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const { createUser, createSettings, createPasswordResetToken } = require('../helpers/factories');
const PasswordResetToken     = require('../../models/PasswordResetToken');
const PasswordResetRateLimit = require('../../models/PasswordResetRateLimit');
const User                   = require('../../models/User');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── POST /api/auth/forgot-password ─────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
  it('returns 200 with neutral message for a non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/matches the email provided/i);

    const token = await PasswordResetToken.findOne({ email: 'nobody@test.com' });
    expect(token).toBeNull();
  });

  it('returns 200 with neutral message for a Google-only account (no password)', async () => {
    // Create directly — createUser always injects a password default
    await User.create({ email: 'googleonly@test.com', googleId: 'gid_123' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'googleonly@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/matches the email provided/i);

    const token = await PasswordResetToken.findOne({ email: 'googleonly@test.com' });
    expect(token).toBeNull();
  });

  it('returns 200, creates token doc, and sends email for a valid email/password account', async () => {
    await createUser({ email: 'valid@test.com', password: 'Password123' });

    const { Resend } = require('resend');
    const sendMock = Resend.mock.results[0].value.emails.send;
    sendMock.mockClear();

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'valid@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/matches the email provided/i);

    const token = await PasswordResetToken.findOne({ email: 'valid@test.com' });
    expect(token).not.toBeNull();
    expect(token.tokenHash).toBeDefined();
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(token.usedAt).toBeNull();

    // Give the fire-and-forget email a tick to complete
    await new Promise(r => setTimeout(r, 50));
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('returns 429 on the 3rd request within 24 hours', async () => {
    await createUser({ email: 'ratelimit@test.com', password: 'Password123' });

    await request(app).post('/api/auth/forgot-password').send({ email: 'ratelimit@test.com' });
    await request(app).post('/api/auth/forgot-password').send({ email: 'ratelimit@test.com' });
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'ratelimit@test.com' });

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/24 hours/i);
  });

  it('does not rate-limit when existing timestamps are older than 24 hours', async () => {
    await createUser({ email: 'stale@test.com', password: 'Password123' });

    // Pre-populate with 2 timestamps from 25 hours ago
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await PasswordResetRateLimit.create({
      email: 'stale@test.com',
      requestTimestamps: [old, old],
    });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'stale@test.com' });

    expect(res.status).toBe(200);
  });

  it('returns 400 if email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── POST /api/auth/reset-password ──────────────────────────────────────────
describe('POST /api/auth/reset-password', () => {
  it('resets password with a valid token and allows sign-in with new password', async () => {
    const user = await createUser({ email: 'reset@test.com', password: 'OldPassword1' });
    const { rawToken } = await createPasswordResetToken('reset@test.com');

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewPassword1' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const updated = await User.findById(user._id).select('+password');
    expect(await updated.comparePassword('NewPassword1')).toBe(true);

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const doc = await PasswordResetToken.findOne({ tokenHash });
    expect(doc.usedAt).not.toBeNull();
  });

  it('returns 400 for an expired token', async () => {
    await createUser({ email: 'expired@test.com', password: 'OldPassword1' });
    const { rawToken } = await createPasswordResetToken('expired@test.com', {
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewPassword1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('returns 400 for an already-used token', async () => {
    await createUser({ email: 'used@test.com', password: 'OldPassword1' });
    const { rawToken } = await createPasswordResetToken('used@test.com', {
      usedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewPassword1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been used/i);
  });

  it('returns 400 for an invalid token format', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-valid-token', newPassword: 'NewPassword1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid reset token/i);
  });

  it('returns 400 for a correctly-formatted but unknown token', async () => {
    const unknownToken = crypto.randomBytes(32).toString('hex');

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: unknownToken, newPassword: 'NewPassword1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or has expired/i);
  });

  it('returns 400 if new password is too short', async () => {
    await createUser({ email: 'short@test.com', password: 'OldPassword1' });
    const { rawToken } = await createPasswordResetToken('short@test.com');

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 characters/i);
  });

  it('returns 400 if fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({});

    expect(res.status).toBe(400);
  });
});
