/**
 * admin.update-cover-flag.test.js
 *
 * updateCoverEnabled switches on the full-page "Update available" cover on
 * Profile for everyone on an old build. Off by default so it cannot fire before
 * the new release is live on the web and Google Play; an admin flips it from
 * Profile. Backend responsibility: default false, admin-only toggle, boolean
 * only, exposed on the public settings endpoint.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createAdminUser,
  createUser,
  createRank,
  authCookie,
} = require('../helpers/factories');

const AppSettings = require('../../models/AppSettings');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

describe('updateCoverEnabled — AppSettings default', () => {
  it('defaults to false', async () => {
    const s = await AppSettings.getSettings();
    expect(s.updateCoverEnabled).toBe(false);
  });

  it('is exposed on the public GET /api/settings response', async () => {
    await createSettings();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.updateCoverEnabled).toBe(false);
  });
});

describe('PATCH /api/admin/settings — updateCoverEnabled', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('rejects non-admin users with 403', async () => {
    const user = await createUser();
    const res  = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(user._id))
      .send({ updateCoverEnabled: true, reason: 'try enable' });

    expect(res.status).toBe(403);
  });

  it('persists when an admin turns it on, and back off', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const on = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', cookie)
      .send({ updateCoverEnabled: true, reason: 'release is live' });
    expect(on.status).toBe(200);
    expect((await request(app).get('/api/settings')).body.updateCoverEnabled).toBe(true);

    const off = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', cookie)
      .send({ updateCoverEnabled: false, reason: 'turn off' });
    expect(off.status).toBe(200);
    expect((await AppSettings.findOne()).updateCoverEnabled).toBe(false);
  });

  it('rejects a non-boolean value', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ updateCoverEnabled: 'yes', reason: 'bad value' });

    expect(res.status).toBe(400);
    expect((await AppSettings.findOne()).updateCoverEnabled).toBe(false);
  });
});
