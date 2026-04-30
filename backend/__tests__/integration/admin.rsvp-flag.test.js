/**
 * admin.rsvp-flag.test.js
 *
 * Tests for the rsvpReaderEnabled feature flag. When off, the frontend
 * hides the RSVP hold-to-read affordance and suppresses the RSVP tutorial
 * step. Backend responsibility here is just: default false, admin can
 * toggle, and the public settings endpoint exposes it.
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

describe('rsvpReaderEnabled — AppSettings default', () => {
  it('defaults to false when a settings doc is created without the field', async () => {
    const s = await AppSettings.getSettings();
    expect(s.rsvpReaderEnabled).toBe(false);
  });

  it('is exposed on the public GET /api/settings response', async () => {
    await createSettings();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.rsvpReaderEnabled).toBe(false);
  });
});

describe('PATCH /api/admin/settings — rsvpReaderEnabled', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('rejects non-admin users with 403', async () => {
    const user = await createUser();
    const res  = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(user._id))
      .send({ rsvpReaderEnabled: true, reason: 'try enable' });

    expect(res.status).toBe(403);
  });

  it('persists the flag when toggled on by an admin', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ rsvpReaderEnabled: true, reason: 'enable rsvp reader' });

    expect(res.status).toBe(200);
    const saved = await AppSettings.findOne();
    expect(saved.rsvpReaderEnabled).toBe(true);

    const pub = await request(app).get('/api/settings');
    expect(pub.body.rsvpReaderEnabled).toBe(true);
  });

  it('can be toggled back off', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', cookie)
      .send({ rsvpReaderEnabled: true, reason: 'enable' });

    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', cookie)
      .send({ rsvpReaderEnabled: false, reason: 'disable' });

    expect(res.status).toBe(200);
    const saved = await AppSettings.findOne();
    expect(saved.rsvpReaderEnabled).toBe(false);
  });
});
