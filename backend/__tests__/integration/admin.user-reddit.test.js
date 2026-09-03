/**
 * admin.user-reddit.test.js
 *
 * Tests for PATCH /api/admin/users/:id/reddit — the Reddit handle an admin links
 * to an account from the Admin › Users expanded row.
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - Stores a bare handle
 *   - Normalises every paste shape an admin might arrive with
 *   - Rejects a handle that is not a valid Reddit username
 *   - Empty string unlinks (stores null)
 *   - 404 for an unknown user id
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createAdminUser,
  createUser,
  createRank,
  authCookie,
} = require('../helpers/factories');

const User = require('../../models/User');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

function setReddit(cookie, id, redditUsername) {
  const req = request(app).patch(`/api/admin/users/${id}/reddit`);
  if (cookie) req.set('Cookie', cookie);
  return req.send({ redditUsername });
}

describe('PATCH /api/admin/users/:id/reddit', () => {
  beforeEach(async () => { await createRank(); });

  it('returns 401 with no auth cookie', async () => {
    const user = await createUser();
    const res  = await setReddit(null, user._id, 'someone');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const caller = await createUser();
    const target = await createUser();
    const res    = await setReddit(authCookie(caller._id), target._id, 'someone');
    expect(res.status).toBe(403);
  });

  it('stores a bare handle', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setReddit(authCookie(admin._id), target._id, 'flying_badger');

    expect(res.status).toBe(200);
    expect(res.body.data.redditUsername).toBe('flying_badger');

    const dbUser = await User.findById(target._id);
    expect(dbUser.redditUsername).toBe('flying_badger');
  });

  // The admin pastes whatever they had on the clipboard; all of these are the
  // same account and must land as the same bare handle.
  it.each([
    ['u/flying_badger'],
    ['/u/flying_badger'],
    ['@flying_badger'],
    ['user/flying_badger'],
    ['https://www.reddit.com/user/flying_badger/'],
    ['https://reddit.com/u/flying_badger'],
    ['https://www.reddit.com/user/flying_badger/?utm_source=share'],
    ['  flying_badger  '],
  ])('normalises %s to the bare handle', async (input) => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setReddit(authCookie(admin._id), target._id, input);

    expect(res.status).toBe(200);
    expect(res.body.data.redditUsername).toBe('flying_badger');
  });

  it('rejects a handle that is not a valid Reddit username', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setReddit(authCookie(admin._id), target._id, 'not a username!');

    expect(res.status).toBe(400);
    const dbUser = await User.findById(target._id);
    expect(dbUser.redditUsername ?? null).toBeNull();
  });

  it('unlinks the account when sent an empty string', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ redditUsername: 'flying_badger' });

    const res = await setReddit(authCookie(admin._id), target._id, '');

    expect(res.status).toBe(200);
    expect(res.body.data.redditUsername).toBeNull();

    const dbUser = await User.findById(target._id);
    expect(dbUser.redditUsername).toBeNull();
  });

  it('defaults a new account to no linked handle', async () => {
    const target = await createUser();
    const dbUser = await User.findById(target._id);
    expect(dbUser.redditUsername).toBeNull();
  });

  it('returns 404 for an unknown user id', async () => {
    const admin = await createAdminUser();
    const res   = await setReddit(authCookie(admin._id), '507f1f77bcf86cd799439011', 'someone');
    expect(res.status).toBe(404);
  });
});
