process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const { createSettings } = require('../helpers/factories');
const AppSettings = require('../../models/AppSettings');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

beforeAll(async () => { await db.connect(); });
afterEach(async () => {
  await db.clearDatabase();
  delete process.env.TURNSTILE_SECRET_KEY;
  jest.restoreAllMocks();
});
afterAll(async () => db.closeDatabase());

// Helper: mock global fetch to respond to Cloudflare siteverify with a canned result.
// Any other URL falls through to the real network (we don't make other calls in these tests).
function mockSiteverify({ success, errorCodes = [] }) {
  jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (String(url).startsWith(SITEVERIFY_URL)) {
      return { json: async () => ({ success, 'error-codes': errorCodes }) };
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });
}

describe('POST /api/auth/register — signup CAPTCHA', () => {
  it('flag OFF: registers normally even without captchaToken', async () => {
    await createSettings({ signupCaptchaEnabled: false, emailConfirmationEnabled: false });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nocaptcha@test.com', password: 'Password123' });
    expect(res.status).toBe(201);
  });

  it('flag ON + missing token: rejects with 400 and captchaFailed flag', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    await createSettings({ signupCaptchaEnabled: true, emailConfirmationEnabled: false });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'notoken@test.com', password: 'Password123' });
    expect(res.status).toBe(400);
    expect(res.body.captchaFailed).toBe(true);
  });

  it('flag ON + invalid token: rejects with 400', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    await createSettings({ signupCaptchaEnabled: true, emailConfirmationEnabled: false });
    mockSiteverify({ success: false, errorCodes: ['invalid-input-response'] });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'badtoken@test.com', password: 'Password123', captchaToken: 'bad-token' });
    expect(res.status).toBe(400);
    expect(res.body.captchaFailed).toBe(true);
  });

  it('flag ON + valid token: registration succeeds', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    await createSettings({ signupCaptchaEnabled: true, emailConfirmationEnabled: false });
    mockSiteverify({ success: true });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'goodtoken@test.com', password: 'Password123', captchaToken: 'ok-token' });
    expect(res.status).toBe(201);
  });

  it('flag ON but TURNSTILE_SECRET_KEY missing: allows signup (unconfigured fallback)', async () => {
    await createSettings({ signupCaptchaEnabled: true, emailConfirmationEnabled: false });
    // No siteverify mock set — should never be called because the helper short-circuits.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nokey@test.com', password: 'Password123' });
    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalled();
  });
});
