/**
 * admin.user-cbat-date.test.js
 *
 * Tests for PATCH /api/admin/users/:id/cbat-date — the date a user sits the
 * real CBAT, typed in by an admin from the Admin › Users expanded row.
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - Stores a YYYY-MM-DD date as UTC midnight of that day
 *   - Rejects anything that is not a real calendar date
 *   - Empty string clears (stores null)
 *   - 404 for an unknown user id
 *   - The list endpoint returns the stored date on the row
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
const { parseCbatDate } = require('../../routes/admin');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

function setDate(cookie, id, cbatDate) {
  const req = request(app).patch(`/api/admin/users/${id}/cbat-date`);
  if (cookie) req.set('Cookie', cookie);
  return req.send({ cbatDate });
}

describe('parseCbatDate', () => {
  it('stores a calendar date as UTC midnight', () => {
    expect(parseCbatDate('2026-10-05').toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('returns null for empty input', () => {
    expect(parseCbatDate('')).toBeNull();
    expect(parseCbatDate('   ')).toBeNull();
    expect(parseCbatDate(null)).toBeNull();
    expect(parseCbatDate(undefined)).toBeNull();
  });

  it.each([
    ['05/10/2026'],
    ['2026-13-01'],
    ['2026-02-30'],
    ['tomorrow'],
    ['2026-10-05T12:00:00Z'],
  ])('rejects %s', (input) => {
    expect(parseCbatDate(input)).toBe(false);
  });
});

describe('PATCH /api/admin/users/:id/cbat-date', () => {
  beforeEach(async () => { await createRank(); });

  it('returns 401 with no auth cookie', async () => {
    const user = await createUser();
    const res  = await setDate(null, user._id, '2026-10-05');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const caller = await createUser();
    const target = await createUser();
    const res    = await setDate(authCookie(caller._id), target._id, '2026-10-05');
    expect(res.status).toBe(403);
  });

  it('stores the date', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setDate(authCookie(admin._id), target._id, '2026-10-05');

    expect(res.status).toBe(200);
    expect(res.body.data.cbatDate).toBe('2026-10-05T00:00:00.000Z');

    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatDate.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('rejects a value that is not a calendar date', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setDate(authCookie(admin._id), target._id, '2026-02-30');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/calendar date/i);
    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatDate).toBeNull();
  });

  it('clears the date with an empty string', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();
    await User.findByIdAndUpdate(target._id, { cbatDate: new Date('2026-10-05T00:00:00.000Z') });

    const res = await setDate(authCookie(admin._id), target._id, '');

    expect(res.status).toBe(200);
    expect(res.body.data.cbatDate).toBeNull();
    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatDate).toBeNull();
  });

  it('returns 404 for an unknown user', async () => {
    const admin = await createAdminUser();
    const res   = await setDate(authCookie(admin._id), '64b000000000000000000000', '2026-10-05');
    expect(res.status).toBe(404);
  });

  it('is returned on the Users list row', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();
    await User.findByIdAndUpdate(target._id, { cbatDate: new Date('2026-10-05T00:00:00.000Z') });

    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const row = res.body.data.users.find(u => u._id === target._id.toString());
    expect(row.cbatDate).toBe('2026-10-05T00:00:00.000Z');
  });
});
