/**
 * admin.user-cbat-passed.test.js
 *
 * Tests for PATCH /api/admin/users/:id/cbat-passed — the per-account "passed the
 * real CBAT" flag set by hand from the Admin › Users list (expanded row).
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - Sets cbatPassed true / false and returns the new value
 *   - Stamps cbatPassedAt on set, clears it on unset
 *   - Coerces truthy/falsy bodies to a boolean
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

function setPassed(cookie, id, cbatPassed) {
  const req = request(app).patch(`/api/admin/users/${id}/cbat-passed`);
  if (cookie) req.set('Cookie', cookie);
  return req.send({ cbatPassed });
}

describe('PATCH /api/admin/users/:id/cbat-passed', () => {
  beforeEach(async () => { await createRank(); });

  it('returns 401 with no auth cookie', async () => {
    const user = await createUser();
    const res  = await setPassed(null, user._id, true);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const caller = await createUser();            // not an admin
    const target = await createUser();
    const res    = await setPassed(authCookie(caller._id), target._id, true);
    expect(res.status).toBe(403);
  });

  it('marks a user as having passed and stamps the date', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setPassed(authCookie(admin._id), target._id, true);

    expect(res.status).toBe(200);
    expect(res.body.data.cbatPassed).toBe(true);
    expect(res.body.data.cbatPassedAt).toBeTruthy();

    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatPassed).toBe(true);
    expect(dbUser.cbatPassedAt).toBeInstanceOf(Date);
  });

  it('clears the flag and the date when unset', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ cbatPassed: true, cbatPassedAt: new Date() });

    const res = await setPassed(authCookie(admin._id), target._id, false);

    expect(res.status).toBe(200);
    expect(res.body.data.cbatPassed).toBe(false);
    expect(res.body.data.cbatPassedAt ?? null).toBeNull();

    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatPassed).toBe(false);
    expect(dbUser.cbatPassedAt).toBeNull();
  });

  it('defaults a new account to not passed', async () => {
    const target = await createUser();
    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatPassed).toBe(false);
    expect(dbUser.cbatPassedAt).toBeNull();
  });

  it('coerces a non-boolean body to a boolean', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setPassed(authCookie(admin._id), target._id, 'yes');

    expect(res.status).toBe(200);
    expect(res.body.data.cbatPassed).toBe(true);
  });

  it('returns 404 for an unknown user id', async () => {
    const admin = await createAdminUser();
    const res   = await setPassed(authCookie(admin._id), '507f1f77bcf86cd799439011', true);
    expect(res.status).toBe(404);
  });
});
