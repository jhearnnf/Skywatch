/**
 * admin.world3d-flag.test.js
 *
 * Tests for the world3d tri-state feature flag. The flag controls whether
 * the /immerse route is reachable for a user (off | admin | everyone).
 * Default is 'off'; the admin PATCH validator must accept world3d and
 * reject unknown values.
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

describe('featureFlags.world3d — backfill', () => {
  it('defaults to "off" when getSettings runs on a doc without the field', async () => {
    const s = await AppSettings.getSettings();
    expect(s.featureFlags.get('world3d')).toBe('off');
  });

  it('is exposed on the public GET /api/settings response', async () => {
    await createSettings();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.featureFlags?.world3d).toBe('off');
  });
});

describe('PATCH /api/admin/settings — world3d flag', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('rejects non-admin users with 403', async () => {
    const user = await createUser();
    const res  = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(user._id))
      .send({ featureFlags: { world3d: 'admin' }, reason: 'try enable' });
    expect(res.status).toBe(403);
  });

  it('persists "admin" when toggled by an admin', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { world3d: 'admin' }, reason: 'enable for testing' });
    expect(res.status).toBe(200);

    const saved = await AppSettings.findOne();
    expect(saved.featureFlags.get('world3d')).toBe('admin');

    const pub = await request(app).get('/api/settings');
    expect(pub.body.featureFlags.world3d).toBe('admin');
  });

  it('persists "everyone" round-trip', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { world3d: 'everyone' }, reason: 'roll out' });
    expect(res.status).toBe(200);
    const saved = await AppSettings.findOne();
    expect(saved.featureFlags.get('world3d')).toBe('everyone');
  });

  it('rejects an invalid flag value with 400', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { world3d: 'yes' }, reason: 'broken' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown flag key with 400', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { bogus: 'admin' }, reason: 'typo' });
    expect(res.status).toBe(400);
  });
});
