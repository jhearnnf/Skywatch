process.env.JWT_SECRET = 'test_secret';

const jwt     = require('jsonwebtoken');
const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings } = require('../helpers/factories');
const { RENEW_AFTER_MS, TOKEN_TTL_DAYS } = require('../../utils/authToken');
const SystemLog = require('../../models/SystemLog');

// Sessions used to be a flat 7 days with no renewal, so every user was logged
// out weekly however often they used the app — and because the frontend kept a
// cached user for offline play, that expiry didn't produce a login prompt, it
// produced an app that silently stopped recording. Long window + sliding
// renewal means an active user never sees a login screen at all.

// Sign a token as though it were issued `ageMs` ago.
const agedCookie = (userId, ageMs) => {
  const iat = Math.floor((Date.now() - ageMs) / 1000);
  const token = jwt.sign(
    { id: String(userId), iat },
    process.env.JWT_SECRET,
    { expiresIn: `${TOKEN_TTL_DAYS}d` },
  );
  return `jwt=${token}`;
};

const setCookieHeader = (res) => [].concat(res.headers['set-cookie'] ?? []).join(';');

let user;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  user = await createUser({ agentNumber: '2000001' });
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('sliding session renewal', () => {
  it('does not re-issue a cookie for a freshly-issued token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', agedCookie(user._id, 60 * 1000));

    expect(res.status).toBe(200);
    expect(setCookieHeader(res)).not.toContain('jwt=');
  });

  it('re-issues the cookie once the token is past the renewal threshold', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', agedCookie(user._id, RENEW_AFTER_MS + 60 * 1000));

    expect(res.status).toBe(200);
    expect(setCookieHeader(res)).toContain('jwt=');
  });

  it('keeps an old-but-valid session working rather than logging the user out', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', agedCookie(user._id, 60 * 24 * 60 * 60 * 1000)); // 60 days

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
  });

  it('still rejects a genuinely expired token with 401', async () => {
    const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const res = await request(app).get('/api/auth/me').set('Cookie', `jwt=${token}`);
    expect(res.status).toBe(401);
  });

  it('returns a fresh token in the body so native can slide its Bearer session', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', agedCookie(user._id, 60 * 1000));

    expect(res.status).toBe(200);
    expect(typeof res.body.data.token).toBe('string');
    const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET);
    expect(decoded.id).toBe(String(user._id));
  });

  it('issues tokens with the long TTL, not the old 7 days', async () => {
    expect(TOKEN_TTL_DAYS).toBeGreaterThanOrEqual(30);
  });
});

describe('POST /api/users/diagnostics/unreachable', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/users/diagnostics/unreachable').send({});
    expect(res.status).toBe(401);
  });

  it('records an api_unreachable log against the user', async () => {
    const res = await request(app)
      .post('/api/users/diagnostics/unreachable')
      .set('Cookie', agedCookie(user._id, 60 * 1000))
      .send({
        origin: 'https://www.skywatch.academy',
        failingForMs: 90 * 60 * 1000,
        queuedCount: 12,
        lastError: 'Failed to fetch',
      });

    expect(res.status).toBe(201);
    const log = await SystemLog.findOne({ type: 'api_unreachable' });
    expect(String(log.userId)).toBe(String(user._id));
    expect(log.origin).toBe('https://www.skywatch.academy');
    expect(log.queuedCount).toBe(12);
    expect(log.failingForMs).toBe(90 * 60 * 1000);
  });

  it('coerces junk values rather than storing them', async () => {
    const res = await request(app)
      .post('/api/users/diagnostics/unreachable')
      .set('Cookie', agedCookie(user._id, 60 * 1000))
      .send({ failingForMs: 'nonsense', queuedCount: -5 });

    expect(res.status).toBe(201);
    const log = await SystemLog.findOne({ type: 'api_unreachable' });
    expect(log.failingForMs).toBe(0);
    expect(log.queuedCount).toBe(0);
  });
});
