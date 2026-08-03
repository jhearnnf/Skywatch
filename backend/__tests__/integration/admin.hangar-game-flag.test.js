/**
 * admin.hangar-game-flag.test.js
 *
 * Tests for the hangarGameEnabled boolean. It controls whether the Hangar
 * game (/immerse) is on for all users and gets a nav entry. Default is false;
 * admins keep URL access regardless, which is enforced client-side.
 *
 * Also pins the retirement of the former `featureFlags.world3d` tri-state,
 * which this setting replaced: it must no longer be backfilled and must be
 * rejected as an unknown flag key.
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

describe('hangarGameEnabled — default', () => {
  it('defaults to false when getSettings runs on a doc without the field', async () => {
    const s = await AppSettings.getSettings();
    expect(s.hangarGameEnabled).toBe(false);
  });

  it('is exposed on the public GET /api/settings response', async () => {
    await createSettings();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.hangarGameEnabled).toBe(false);
  });
});

describe('PATCH /api/admin/settings — hangarGameEnabled', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('rejects non-admin users with 403', async () => {
    const user = await createUser();
    const res  = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(user._id))
      .send({ hangarGameEnabled: true, reason: 'try enable' });
    expect(res.status).toBe(403);

    const saved = await AppSettings.findOne();
    expect(saved.hangarGameEnabled).toBe(false);
  });

  it('persists true when toggled on by an admin', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ hangarGameEnabled: true, reason: 'launch the hangar' });
    expect(res.status).toBe(200);

    const saved = await AppSettings.findOne();
    expect(saved.hangarGameEnabled).toBe(true);

    const pub = await request(app).get('/api/settings');
    expect(pub.body.hangarGameEnabled).toBe(true);
  });

  it('persists false round-trip', async () => {
    const admin = await createAdminUser();
    await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ hangarGameEnabled: true, reason: 'on' });

    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ hangarGameEnabled: false, reason: 'back off' });
    expect(res.status).toBe(200);

    const saved = await AppSettings.findOne();
    expect(saved.hangarGameEnabled).toBe(false);
  });
});

describe('featureFlags.world3d — retired', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('is no longer backfilled by getSettings', async () => {
    const s = await AppSettings.getSettings();
    expect(s.featureFlags.get('world3d')).toBeUndefined();
  });

  it('is rejected as an unknown flag key with 400', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { world3d: 'everyone' }, reason: 'stale client' });
    expect(res.status).toBe(400);
  });

  it('still accepts the flags that remain', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { rsvpReader: 'admin', briefReel: 'off' }, reason: 'unrelated' });
    expect(res.status).toBe(200);

    const saved = await AppSettings.findOne();
    expect(saved.featureFlags.get('rsvpReader')).toBe('admin');
  });
});
