/**
 * Admin — CBAT per-game enable/disable validation
 *
 * Covers PATCH /api/admin/settings handling of cbatGameEnabled (Map field):
 *   - rejects unknown game keys
 *   - rejects non-boolean values
 *   - rejects enabling unimplemented games (visualisation-3d / audio-interrupt / dad)
 *   - persists a valid object
 *   - relaxes min-aircraft enforcement when target/flag is per-game disabled
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const AppSettings = require('../../models/AppSettings');
const { createAdminUser, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

async function patchSettings(cookie, body) {
  return request(app)
    .patch('/api/admin/settings')
    .set('Cookie', cookie)
    .send({ reason: 'test', ...body });
}

describe('PATCH /api/admin/settings — cbatGameEnabled validation', () => {
  it('rejects an unknown game key', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);
    const res = await patchSettings(cookie, { cbatGameEnabled: { 'not-a-game': true } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unknown game key/);
  });

  it('rejects a non-boolean value', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);
    const res = await patchSettings(cookie, { cbatGameEnabled: { target: 'yes' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must be a boolean/);
  });

  it('rejects enabling an unimplemented game (visualisation-3d)', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);
    const res = await patchSettings(cookie, { cbatGameEnabled: { 'visualisation-3d': true } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no backend route yet/);
  });

  it('accepts and persists a valid object', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);
    const res = await patchSettings(cookie, {
      cbatGameEnabled: { target: true, symbols: false, dpt: true },
    });
    expect(res.status).toBe(200);

    const settings = await AppSettings.findOne();
    expect(settings.cbatGameEnabled.get('target')).toBe(true);
    expect(settings.cbatGameEnabled.get('symbols')).toBe(false);
    expect(settings.cbatGameEnabled.get('dpt')).toBe(true);
  });

  it('allows empty cbatTargetAircraftBriefIds when target is per-game disabled', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const res = await patchSettings(cookie, {
      cbatEnabled:                true,
      cbatGameEnabled:            { target: false, flag: true },
      cbatTargetAircraftBriefIds: [],
      cbatFlagAircraftBriefIds:   ['brief_001'],
    });
    expect(res.status).toBe(200);
  });

  it('still rejects empty cbatFlagAircraftBriefIds when flag is per-game enabled', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const res = await patchSettings(cookie, {
      cbatEnabled:                true,
      cbatGameEnabled:            { target: true, flag: true },
      cbatTargetAircraftBriefIds: ['brief_001'],
      cbatFlagAircraftBriefIds:   [],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/FLAG/);
  });
});
