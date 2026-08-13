/**
 * Admin — CBAT per-game enable/disable validation
 *
 * Covers PATCH /api/admin/settings handling of cbatGameEnabled (Map field):
 *   - silently drops unknown / legacy game keys (e.g. renamed games still
 *     echoed back by the frontend) instead of failing the whole save
 *   - rejects non-boolean values
 *   - persists a valid object (every game is now implemented and toggleable)
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
  // The frontend can echo back legacy/renamed keys (e.g. 'audio-interrupt'
  // before it was renamed to 'act') from the DB. Rejecting the whole save
  // when an unknown key shows up would silently revert every admin Settings
  // change — see commit 39b9ab7. Validation now drops unknown keys instead.
  it('silently drops unknown game keys without failing the save', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);
    const res = await patchSettings(cookie, {
      cbatGameEnabled: { 'not-a-game': true, target: false },
    });
    expect(res.status).toBe(200);

    const settings = await AppSettings.findOne();
    expect(settings.cbatGameEnabled.get('not-a-game')).toBeUndefined();
    expect(settings.cbatGameEnabled.get('target')).toBe(false);
  });

  it('rejects a non-boolean value', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);
    const res = await patchSettings(cookie, { cbatGameEnabled: { target: 'yes' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must be a boolean/);
  });

  it('persists enabling dad (now implemented with a backend route)', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);
    const res = await patchSettings(cookie, { cbatGameEnabled: { dad: true } });
    expect(res.status).toBe(200);

    const settings = await AppSettings.findOne();
    expect(settings.cbatGameEnabled.get('dad')).toBe(true);
  });

  // The five tests that completed the RAF roster. A key missing from
  // CBAT_KNOWN_KEYS in routes/admin.js is dropped SILENTLY (see the first test
  // in this file), so an unwired game's toggle would appear in the admin UI,
  // flip on screen, save without error and do nothing at all.
  it.each(['sit', 'slt', 'vlt', 'matf', 'vigilance'])(
    'persists the %s toggle rather than dropping it as an unknown key',
    async (gameKey) => {
      const admin  = await createAdminUser();
      const cookie = authCookie(admin._id);
      const res = await patchSettings(cookie, { cbatGameEnabled: { [gameKey]: false } });
      expect([gameKey, res.status]).toEqual([gameKey, 200]);

      const settings = await AppSettings.findOne();
      expect([gameKey, settings.cbatGameEnabled.get(gameKey)]).toEqual([gameKey, false]);
    },
  );

  // The Easier halves have no admin toggle of their own — the parent game's
  // toggle gates the page, because the route is /cbat/sit whichever difficulty
  // is picked. They still have to be accepted here: the frontend echoes back
  // the whole stored map on every save, so rejecting them would break the save.
  it.each(['sit-easier', 'slt-easier', 'vlt-easier', 'matf-easier'])(
    'accepts %s echoed back from the stored map',
    async (gameKey) => {
      const admin  = await createAdminUser();
      const cookie = authCookie(admin._id);
      const res = await patchSettings(cookie, { cbatGameEnabled: { [gameKey]: false } });
      expect([gameKey, res.status]).toEqual([gameKey, 200]);

      const settings = await AppSettings.findOne();
      expect([gameKey, settings.cbatGameEnabled.get(gameKey)]).toEqual([gameKey, false]);
    },
  );

  it('defaults every new game to enabled', async () => {
    const settings = await AppSettings.getSettings();
    for (const key of ['sit', 'slt', 'vlt', 'matf', 'vigilance']) {
      expect([key, settings.cbatGameEnabled.get(key)]).toEqual([key, true]);
    }
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

  it('persists trace-1 and numerical-ops toggles (known keys, not dropped)', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);
    const res = await patchSettings(cookie, {
      cbatGameEnabled: { 'trace-1': false, 'numerical-ops': false },
    });
    expect(res.status).toBe(200);

    const settings = await AppSettings.findOne();
    expect(settings.cbatGameEnabled.get('trace-1')).toBe(false);
    expect(settings.cbatGameEnabled.get('numerical-ops')).toBe(false);
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
