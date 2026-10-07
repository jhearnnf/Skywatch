process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, authCookie } = require('../helpers/factories');
const User    = require('../../models/User');

// Feeds the "Music Off" tile on Admin › Stats: the first time a player turns
// the music off is stamped on the account and never overwritten.

beforeAll(async () => { await db.connect(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const report = (cookie, via) =>
  request(app).post('/api/users/me/music-off').set('Cookie', cookie).send({ via });

describe('POST /api/users/me/music-off', () => {
  it('stamps the first report with how the music was turned off', async () => {
    const user = await createUser();
    const res = await report(authCookie(user._id), 'mute');
    expect(res.status).toBe(200);
    const saved = await User.findById(user._id);
    expect(saved.musicOffAt).toBeInstanceOf(Date);
    expect(saved.musicOffVia).toBe('mute');
  });

  it('keeps the first report and ignores later ones', async () => {
    const user = await createUser();
    const cookie = authCookie(user._id);
    await report(cookie, 'volume');
    const first = (await User.findById(user._id)).musicOffAt;
    await report(cookie, 'mute');
    const saved = await User.findById(user._id);
    expect(saved.musicOffVia).toBe('volume');
    expect(saved.musicOffAt.getTime()).toBe(first.getTime());
  });

  it('rejects an unknown source', async () => {
    const user = await createUser();
    const res = await report(authCookie(user._id), 'shouting');
    expect(res.status).toBe(400);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).post('/api/users/me/music-off').send({ via: 'mute' });
    expect(res.status).toBe(401);
  });
});
