/**
 * admin.user-display-name.test.js
 *
 * Tests for PATCH /api/admin/users/:id/display-name — an admin renaming a
 * user (or clearing their name back to "Agent N") from the Admin › Users
 * expanded row.
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - A reason is required, like every other action against an account
 *   - Stores the name and its lowercase mirror, stamps the rename cooldown,
 *     and writes a rename_user AdminAction
 *   - Rejects a name that fails the shared display-name rules
 *   - Rejects a reserved prefix even though the caller is an admin
 *   - 409 when another account already holds the name (case-insensitive)
 *   - Empty string clears the name and unsets the lowercase mirror
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

const User        = require('../../models/User');
const AdminAction = require('../../models/AdminAction');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

function rename(cookie, id, body) {
  const req = request(app).patch(`/api/admin/users/${id}/display-name`);
  if (cookie) req.set('Cookie', cookie);
  return req.send({ reason: 'silly name', ...body });
}

describe('PATCH /api/admin/users/:id/display-name', () => {
  beforeEach(async () => { await createRank(); });

  it('returns 401 with no auth cookie', async () => {
    const user = await createUser();
    const res  = await rename(null, user._id, { displayName: 'Falcon' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const caller = await createUser();
    const target = await createUser();
    const res    = await rename(authCookie(caller._id), target._id, { displayName: 'Falcon' });
    expect(res.status).toBe(403);
  });

  it('requires a reason', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ displayName: 'CumBum', displayNameLower: 'cumbum' });

    const res = await rename(authCookie(admin._id), target._id, { displayName: 'Falcon', reason: '' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reason/i);
    expect((await User.findById(target._id)).displayName).toBe('CumBum');
  });

  it('renames the user, stamps the cooldown and audits it', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ displayName: 'CumBum', displayNameLower: 'cumbum' });
    const before = Date.now();

    const res = await rename(authCookie(admin._id), target._id, { displayName: 'Well Behaved' });

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Well Behaved');

    const dbUser = await User.findById(target._id);
    expect(dbUser.displayName).toBe('Well Behaved');
    expect(dbUser.displayNameLower).toBe('well behaved');
    expect(dbUser.displayNameChangedAt.getTime()).toBeGreaterThanOrEqual(before);

    const audit = await AdminAction.findOne({ actionType: 'rename_user' });
    expect(audit).toBeTruthy();
    expect(audit.userId.toString()).toBe(admin._id.toString());
    expect(audit.targetUserId.toString()).toBe(target._id.toString());
    expect(audit.reason).toBe('silly name');
  });

  it('rejects a name that fails the display-name rules', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ displayName: 'CumBum', displayNameLower: 'cumbum' });

    const res = await rename(authCookie(admin._id), target._id, { displayName: 'no' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 3/i);
    expect((await User.findById(target._id)).displayName).toBe('CumBum');
    expect(await AdminAction.countDocuments()).toBe(0);
  });

  it('rejects a reserved prefix even from an admin', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await rename(authCookie(admin._id), target._id, { displayName: 'Admin Bob' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reserved/i);
  });

  it('returns 409 when another account already holds the name', async () => {
    const admin  = await createAdminUser();
    await createUser({ displayName: 'Falcon', displayNameLower: 'falcon' });
    const target = await createUser();

    const res = await rename(authCookie(admin._id), target._id, { displayName: 'FALCON' });

    expect(res.status).toBe(409);
    expect((await User.findById(target._id)).displayName).toBeNull();
  });

  it('clears the name with an empty string', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ displayName: 'CumBum', displayNameLower: 'cumbum' });

    const res = await rename(authCookie(admin._id), target._id, { displayName: '' });

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBeNull();
    const dbUser = await User.findById(target._id).lean();
    expect(dbUser.displayName).toBeNull();
    expect(dbUser).not.toHaveProperty('displayNameLower');
  });

  it('returns 404 for an unknown user', async () => {
    const admin = await createAdminUser();
    const res   = await rename(authCookie(admin._id), '64b000000000000000000000', { displayName: 'Falcon' });
    expect(res.status).toBe(404);
  });
});
