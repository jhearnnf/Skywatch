process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, authCookie } = require('../helpers/factories');
const User    = require('../../models/User');

// The theme is an account setting, not a browser one: it has to come back on
// /auth/me so every device the user signs in on wears the same look, and the
// default has to be the SkyWatch theme so nobody is dropped into the Real CBAT
// look without asking for it.

beforeAll(async () => { await db.connect(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const setTheme = (cookie, theme) =>
  request(app).patch('/api/users/me/theme').set('Cookie', cookie).send({ theme });

describe('PATCH /api/users/me/theme', () => {
  it('defaults every account to the SkyWatch theme', async () => {
    const user = await createUser();
    const res  = await request(app).get('/api/auth/me').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.user.uiTheme).toBe('skywatch');
  });

  it('saves the Real CBAT theme on the account and returns the updated user', async () => {
    const user = await createUser();
    const res  = await setTheme(authCookie(user._id), 'cbat');
    expect(res.status).toBe(200);
    expect(res.body.data.user.uiTheme).toBe('cbat');

    const stored = await User.findById(user._id).lean();
    expect(stored.uiTheme).toBe('cbat');
  });

  it('comes back on /auth/me so the next sign-in wears the saved theme', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);
    await setTheme(cookie, 'cbat');

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body.data.user.uiTheme).toBe('cbat');
  });

  it('lets the user switch back to the SkyWatch theme', async () => {
    const user   = await createUser({ uiTheme: 'cbat' });
    const cookie = authCookie(user._id);
    const res    = await setTheme(cookie, 'skywatch');
    expect(res.status).toBe(200);
    expect(res.body.data.user.uiTheme).toBe('skywatch');
  });

  it('rejects an unknown theme without touching the account', async () => {
    const user = await createUser();
    const res  = await setTheme(authCookie(user._id), 'neon');
    expect(res.status).toBe(400);

    const stored = await User.findById(user._id).lean();
    expect(stored.uiTheme).toBe('skywatch');
  });

  it('rejects a missing theme', async () => {
    const user = await createUser();
    const res  = await request(app).patch('/api/users/me/theme').set('Cookie', authCookie(user._id)).send({});
    expect(res.status).toBe(400);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).patch('/api/users/me/theme').send({ theme: 'cbat' });
    expect(res.status).toBe(401);
  });
});
