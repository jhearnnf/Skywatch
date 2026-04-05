/**
 * admin.beta-tester.test.js
 *
 * Tests for the betaTesterAutoGold admin setting.
 * When enabled, every newly registered account is automatically granted gold subscription.
 *
 * Coverage:
 *   - Auth guards on the settings toggle (401, 403, 400 no reason, 200 success)
 *   - Auto-gold on instant registration (emailConfirmationEnabled: false)
 *   - Auto-gold on email-verified registration
 *   - Auto-gold on Google OAuth new account
 *   - Existing Google OAuth account is NOT upgraded on sign-in
 *   - Retroactive safety: existing free user stays free when flag is toggled on
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createAdminUser,
  createUser,
  createRank,
  authCookie,
} = require('../helpers/factories');

const AppSettings = require('../../models/AppSettings');
const User        = require('../../models/User');
const PendingRegistration = require('../../models/PendingRegistration');

// ── Google OAuth mock ─────────────────────────────────────────────────────────
// Must be at module level so Jest hoists it before any require() calls.
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn().mockResolvedValue({
      getPayload: () => ({
        sub:   'google_sub_abc123',
        email: 'betauser@gmail.com',
      }),
    }),
  })),
}));

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function toggleBetaGold(adminCookie, value = true, reason = 'Enable beta gold for testing') {
  return request(app)
    .patch('/api/admin/settings')
    .set('Cookie', adminCookie)
    .send({ betaTesterAutoGold: value, reason });
}

// ── Block 1: Auth guards on PATCH /api/admin/settings ─────────────────────────
describe('PATCH /api/admin/settings — betaTesterAutoGold auth guards', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('returns 401 with no auth cookie', async () => {
    const res = await request(app)
      .patch('/api/admin/settings')
      .send({ betaTesterAutoGold: true, reason: 'test' });

    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const user = await createUser();
    const res  = await toggleBetaGold(authCookie(user._id));

    expect(res.status).toBe(403);
  });

  it('returns 400 when reason is missing', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ betaTesterAutoGold: true });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reason/i);
  });

  it('returns 400 when reason is blank', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ betaTesterAutoGold: true, reason: '   ' });

    expect(res.status).toBe(400);
  });

  it('returns 200 and persists the flag for a valid admin request', async () => {
    const admin = await createAdminUser();
    const res   = await toggleBetaGold(authCookie(admin._id), true);

    expect(res.status).toBe(200);
    const saved = await AppSettings.findOne();
    expect(saved.betaTesterAutoGold).toBe(true);
  });

  it('can be toggled back off by an admin', async () => {
    const admin = await createAdminUser();
    await toggleBetaGold(authCookie(admin._id), true);
    const res = await toggleBetaGold(authCookie(admin._id), false, 'Disabling beta gold');

    expect(res.status).toBe(200);
    const saved = await AppSettings.findOne();
    expect(saved.betaTesterAutoGold).toBe(false);
  });
});

// ── Block 2: Auto-gold on instant registration ────────────────────────────────
describe('Instant registration (emailConfirmationEnabled: false)', () => {
  beforeEach(async () => { await createRank(); });

  it('grants gold to a new user when betaTesterAutoGold is true', async () => {
    await createSettings({ emailConfirmationEnabled: false, betaTesterAutoGold: true });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'beta@test.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.subscriptionTier).toBe('gold');

    const dbUser = await User.findOne({ email: 'beta@test.com' });
    expect(dbUser.subscriptionTier).toBe('gold');
    expect(dbUser.subscriptionStartDate).toBeDefined();
  });

  it('leaves subscriptionTier as free when betaTesterAutoGold is false', async () => {
    await createSettings({ emailConfirmationEnabled: false, betaTesterAutoGold: false });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'regular@test.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.subscriptionTier).toBe('free');
  });

  it('leaves subscriptionTier as free when betaTesterAutoGold is absent (default)', async () => {
    await createSettings({ emailConfirmationEnabled: false });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'default@test.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.subscriptionTier).toBe('free');
  });
});

// ── Block 3: Auto-gold on email-verified registration ────────────────────────
describe('Email-verified registration (emailConfirmationEnabled: true)', () => {
  beforeEach(async () => { await createRank(); });

  it('grants gold after email verification when betaTesterAutoGold is true', async () => {
    await createSettings({ emailConfirmationEnabled: true, betaTesterAutoGold: true });

    // Seed a pending registration directly (bypasses the email send)
    const email = 'betaverify@test.com';
    await PendingRegistration.create({
      email,
      password: 'Password123',
      code:      '123456',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ email, code: '123456' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.subscriptionTier).toBe('gold');

    const dbUser = await User.findOne({ email });
    expect(dbUser.subscriptionTier).toBe('gold');
    expect(dbUser.subscriptionStartDate).toBeDefined();
  });

  it('leaves subscriptionTier as free after email verification when betaTesterAutoGold is false', async () => {
    await createSettings({ emailConfirmationEnabled: true, betaTesterAutoGold: false });

    const email = 'regularverify@test.com';
    await PendingRegistration.create({
      email,
      password: 'Password123',
      code:      '654321',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ email, code: '654321' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.subscriptionTier).toBe('free');
  });
});

// ── Block 4: Auto-gold on Google OAuth ───────────────────────────────────────
describe('Google OAuth registration', () => {
  beforeEach(async () => { await createRank(); });

  it('grants gold to a brand-new Google account when betaTesterAutoGold is true', async () => {
    await createSettings({ betaTesterAutoGold: true });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'mock_google_token' });

    expect(res.status).toBe(200);
    expect(res.body.data.isNew).toBe(true);

    const dbUser = await User.findOne({ email: 'betauser@gmail.com' });
    expect(dbUser.subscriptionTier).toBe('gold');
    expect(dbUser.subscriptionStartDate).toBeDefined();
  });

  it('leaves subscriptionTier as free for a new Google account when betaTesterAutoGold is false', async () => {
    await createSettings({ betaTesterAutoGold: false });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'mock_google_token' });

    expect(res.status).toBe(200);
    const dbUser = await User.findOne({ email: 'betauser@gmail.com' });
    expect(dbUser.subscriptionTier).toBe('free');
  });

  it('does NOT upgrade an existing user signing in with Google when betaTesterAutoGold is true', async () => {
    await createSettings({ betaTesterAutoGold: true });

    // Pre-create the user so the Google path takes the "existing user" branch
    const existing = await createUser({ email: 'betauser@gmail.com', subscriptionTier: 'free' });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'mock_google_token' });

    expect(res.status).toBe(200);
    expect(res.body.data.isNew).toBeUndefined();

    const dbUser = await User.findById(existing._id);
    expect(dbUser.subscriptionTier).toBe('free');
  });
});

// ── Block 5: Retroactive safety ───────────────────────────────────────────────
describe('Retroactive safety — existing users are unaffected', () => {
  it('does not change an existing free user when the flag is toggled on', async () => {
    await createRank();
    await createSettings({ betaTesterAutoGold: false });

    const freeUser = await createUser({ subscriptionTier: 'free' });
    const admin    = await createAdminUser();

    await toggleBetaGold(authCookie(admin._id), true);

    const dbUser = await User.findById(freeUser._id);
    expect(dbUser.subscriptionTier).toBe('free');
  });
});
