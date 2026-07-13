/**
 * admin.slim-mode-flag.test.js
 *
 * Tests for the slimModeEnabled feature flag. When on, the website is slimmed
 * to the CBAT-only experience (admins exempt, enforced client-side). Backend
 * responsibility here is just: default false, admin can toggle, and the public
 * settings endpoint exposes it.
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

describe('slimModeEnabled — AppSettings default', () => {
  it('defaults to false when a settings doc is created without the field', async () => {
    const s = await AppSettings.getSettings();
    expect(s.slimModeEnabled).toBe(false);
  });

  it('is exposed on the public GET /api/settings response', async () => {
    await createSettings();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.slimModeEnabled).toBe(false);
  });
});

describe('PATCH /api/admin/settings — slimModeEnabled', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('rejects non-admin users with 403', async () => {
    const user = await createUser();
    const res  = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(user._id))
      .send({ slimModeEnabled: true, reason: 'try enable' });

    expect(res.status).toBe(403);
  });

  it('persists the flag when toggled on by an admin and exposes it publicly', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ slimModeEnabled: true, reason: 'enable slim site mode' });

    expect(res.status).toBe(200);
    const saved = await AppSettings.findOne();
    expect(saved.slimModeEnabled).toBe(true);

    const pub = await request(app).get('/api/settings');
    expect(pub.body.slimModeEnabled).toBe(true);
  });

  it('can be toggled back off', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', cookie)
      .send({ slimModeEnabled: true, reason: 'enable' });

    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', cookie)
      .send({ slimModeEnabled: false, reason: 'disable' });

    expect(res.status).toBe(200);
    const saved = await AppSettings.findOne();
    expect(saved.slimModeEnabled).toBe(false);
  });
});
