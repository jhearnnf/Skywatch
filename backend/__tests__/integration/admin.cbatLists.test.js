/**
 * Admin — CBAT aircraft allowlist validation tests
 *
 * Covers the PATCH /api/admin/settings guard that rejects empty
 * cbatTargetAircraftBriefIds or cbatFlagAircraftBriefIds when cbatEnabled=true.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createAdminUser, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Helper — PATCH /api/admin/settings as admin with a mandatory reason field.
async function patchSettings(adminCookie, body) {
  return request(app)
    .patch('/api/admin/settings')
    .set('Cookie', adminCookie)
    .send({ reason: 'test', ...body });
}

describe('PATCH /api/admin/settings — CBAT aircraft allowlist validation', () => {
  it('returns 400 when cbatEnabled=true and cbatFlagAircraftBriefIds is empty', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const res = await patchSettings(cookie, {
      cbatEnabled:             true,
      cbatFlagAircraftBriefIds:   [],
      // Provide a valid non-empty Target list so only the FLAG check fires
      cbatTargetAircraftBriefIds: ['brief_001'],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/FLAG/);
  });

  it('returns 400 when cbatEnabled=true and cbatTargetAircraftBriefIds is empty', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const res = await patchSettings(cookie, {
      cbatEnabled:                true,
      cbatTargetAircraftBriefIds: [],
      // Provide a valid non-empty FLAG list so only the Target check fires
      cbatFlagAircraftBriefIds:   ['brief_001'],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Target/);
  });

  it('succeeds (200) when cbatEnabled=true and both lists are non-empty', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const res = await patchSettings(cookie, {
      cbatEnabled:                true,
      cbatTargetAircraftBriefIds: ['brief_001'],
      cbatFlagAircraftBriefIds:   ['brief_002'],
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('succeeds (200) when cbatEnabled=true but cbatFlagAircraftBriefIds is omitted entirely', async () => {
    // The guard only validates keys that are explicitly present in the PATCH body.
    // Omitting cbatFlagAircraftBriefIds should NOT trigger the 400.
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const res = await patchSettings(cookie, {
      cbatEnabled:                true,
      cbatTargetAircraftBriefIds: ['brief_001'],
      // cbatFlagAircraftBriefIds intentionally absent
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('succeeds (200) when cbatEnabled=true but cbatTargetAircraftBriefIds is omitted entirely', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const res = await patchSettings(cookie, {
      cbatEnabled:              true,
      cbatFlagAircraftBriefIds: ['brief_002'],
      // cbatTargetAircraftBriefIds intentionally absent
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });
});
