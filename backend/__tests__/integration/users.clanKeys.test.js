process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, authCookie } = require('../helpers/factories');
const User    = require('../../models/User');

// CLAN's key layout is an account setting like the theme: it comes back on
// /auth/me so the same keys work on every device, and new accounts start on
// the grouped layout rather than the scattered R/Y/G + A-D one.

beforeAll(async () => { await db.connect(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const setLayout = (cookie, layout) =>
  request(app).patch('/api/users/me/clan-keys').set('Cookie', cookie).send({ layout });

describe('PATCH /api/users/me/clan-keys', () => {
  it('defaults every account to the grouped layout', async () => {
    const user = await createUser();
    const res  = await request(app).get('/api/auth/me').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.user.clanKeyLayout).toBe('grouped');
  });

  it('saves the layout on the account and brings it back on /auth/me', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);
    const res    = await setLayout(cookie, 'letters');
    expect(res.status).toBe(200);
    expect(res.body.data.user.clanKeyLayout).toBe('letters');

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.data.user.clanKeyLayout).toBe('letters');
  });

  it('rejects an unknown layout without touching the account', async () => {
    const user = await createUser();
    const res  = await setLayout(authCookie(user._id), 'dvorak');
    expect(res.status).toBe(400);

    const stored = await User.findById(user._id).lean();
    expect(stored.clanKeyLayout).toBe('grouped');
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).patch('/api/users/me/clan-keys').send({ layout: 'mirrored' });
    expect(res.status).toBe(401);
  });
});
