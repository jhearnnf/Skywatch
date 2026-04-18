process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── POST /api/auth/register ────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('registers a new user and returns 201 with cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'newuser@test.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.email).toBe('newuser@test.com');
    expect(res.body.data.user.password).toBeUndefined(); // never exposed
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.body.data.loginAirstarsEarned).toBe(0); // coins only on first brief read
  });

  it('returns 400 if email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'Password123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 if password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@test.com', password: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 characters/i);
  });

  it('returns 409 if email already registered', async () => {
    await createUser({ email: 'dup@test.com', password: 'Password123' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@test.com', password: 'Password123' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already registered/i);
  });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('logs in with correct credentials and returns 200 with cookie', async () => {
    await createUser({ email: 'loginme@test.com', password: 'Password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginme@test.com', password: 'Password123' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.email).toBe('loginme@test.com');
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.body.data.loginAirstarsEarned).toBe(0); // coins only on first brief read
  });

  it('returns 401 with wrong password', async () => {
    await createUser({ email: 'wrongpass@test.com', password: 'Password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpass@test.com', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/incorrect/i);
  });

  it('returns 401 for non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'Password123' });

    expect(res.status).toBe(401);
  });

  it('returns 403 if user is banned', async () => {
    await createUser({ email: 'banned@test.com', password: 'Password123', isBanned: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'banned@test.com', password: 'Password123' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/contact support/i);
  });

  it('returns 400 if credentials are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('clears the jwt cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    // Cookie should be cleared (expires in the past or empty value)
    const cookie = res.headers['set-cookie']?.find(c => c.startsWith('jwt='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('returns user data when authenticated', async () => {
    const user = await createUser({ email: 'meme@test.com', password: 'Password123' });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('meme@test.com');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
