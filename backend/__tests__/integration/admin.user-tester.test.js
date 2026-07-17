/**
 * admin.user-tester.test.js
 *
 * Tests for PATCH /api/admin/users/:id/tester — the per-account "tester" flag
 * used by the Admin › Users panel (floats offline testers to the top of the
 * offline group + gives their row a red/amber "TESTER" watermark).
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - Sets isTester true / false and returns the new value
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

function setTester(cookie, id, isTester) {
  const req = request(app).patch(`/api/admin/users/${id}/tester`);
  if (cookie) req.set('Cookie', cookie);
  return req.send({ isTester });
}

describe('PATCH /api/admin/users/:id/tester', () => {
  beforeEach(async () => { await createRank(); });

  it('returns 401 with no auth cookie', async () => {
    const user = await createUser();
    const res  = await setTester(null, user._id, true);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const admin  = await createUser();            // not an admin
    const target = await createUser();
    const res    = await setTester(authCookie(admin._id), target._id, true);
    expect(res.status).toBe(403);
  });

  it('flags a user as a tester and persists it', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setTester(authCookie(admin._id), target._id, true);

    expect(res.status).toBe(200);
    expect(res.body.data.isTester).toBe(true);
    const dbUser = await User.findById(target._id);
    expect(dbUser.isTester).toBe(true);
  });

  it('unflags a tester', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ isTester: true });

    const res = await setTester(authCookie(admin._id), target._id, false);

    expect(res.status).toBe(200);
    expect(res.body.data.isTester).toBe(false);
    const dbUser = await User.findById(target._id);
    expect(dbUser.isTester).toBe(false);
  });

  it('coerces a non-boolean body to a boolean', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setTester(authCookie(admin._id), target._id, 'yes');

    expect(res.status).toBe(200);
    expect(res.body.data.isTester).toBe(true);
  });

  it('returns 404 for an unknown user id', async () => {
    const admin = await createAdminUser();
    const res   = await setTester(authCookie(admin._id), '507f1f77bcf86cd799439011', true);
    expect(res.status).toBe(404);
  });
});
