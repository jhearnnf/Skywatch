/**
 * users.heartbeat-geo.test.js
 *
 * POST /api/users/heartbeat carries an optional `geo` payload — the country
 * Vercel's edge worked out from the IP, plus the device's timezone and
 * language — so Admin › Users can answer "which country is this account in?".
 *
 * Coverage:
 *   - Stores the resolved country and the raw signals under `geo`
 *   - Sets firstSeenCountry once and never overwrites it
 *   - Keeps the stored country and raises `mismatch` when IP and timezone disagree
 *   - Leaves the country alone when a beat carries only unusable signals
 *   - Presence (lastSeen) still records when the geo payload is bad/absent
 *   - The Users list returns `geo` on the row
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createRank, authCookie } = require('../helpers/factories');

const User = require('../../models/User');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const beat = (cookie, body) =>
  request(app).post('/api/users/heartbeat').set('Cookie', cookie).send(body ?? {});

describe('POST /api/users/heartbeat — country', () => {
  it('stores the resolved country and the raw signals', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await beat(cookie, { geo: { country: 'gb', timeZone: 'Europe/London', language: 'en-GB' } });
    expect(res.status).toBe(200);

    const saved = await User.findById(user._id).lean();
    expect(saved.geo).toMatchObject({
      country: 'GB', source: 'ip', mismatch: false,
      ipCountry: 'GB', timeZone: 'Europe/London', language: 'en-GB',
    });
    expect(saved.geo.updatedAt).toBeTruthy();
    expect(saved.firstSeenCountry).toBe('GB');
    expect(saved.lastSeen).toBeTruthy();
  });

  it('sets firstSeenCountry once and never overwrites it', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await beat(cookie, { geo: { country: 'GB', timeZone: 'Europe/London' } });
    await beat(cookie, { geo: { country: 'AU', timeZone: 'Australia/Sydney' } });

    const saved = await User.findById(user._id).lean();
    expect(saved.geo.country).toBe('AU');
    expect(saved.firstSeenCountry).toBe('GB');
  });

  it('keeps the stored country and flags a mismatch when the IP disagrees with the timezone', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await beat(cookie, { geo: { country: 'GB', timeZone: 'Europe/London' } });
    await beat(cookie, { geo: { country: 'NL', timeZone: 'Europe/London' } });

    const saved = await User.findById(user._id).lean();
    expect(saved.geo).toMatchObject({ country: 'GB', source: 'ip', mismatch: true, ipCountry: 'NL' });
  });

  it('trusts the timezone over a disagreeing IP on first contact', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await beat(cookie, { geo: { country: 'NL', timeZone: 'Europe/London' } });

    const saved = await User.findById(user._id).lean();
    expect(saved.geo).toMatchObject({ country: 'GB', source: 'timezone', mismatch: true, ipCountry: 'NL' });
    expect(saved.firstSeenCountry).toBe('GB');
  });

  it('records the timezone and language but leaves the country alone when nothing resolves', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await beat(cookie, { geo: { country: 'GB', timeZone: 'Europe/London' } });
    await beat(cookie, { geo: { timeZone: 'UTC', language: 'en' } });

    const saved = await User.findById(user._id).lean();
    expect(saved.geo).toMatchObject({ country: 'GB', source: 'ip', mismatch: false, ipCountry: null, timeZone: 'UTC', language: 'en' });
  });

  it('still records presence when the geo payload is unusable or absent', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    expect((await beat(cookie, { geo: 'GB' })).status).toBe(200);
    expect((await beat(cookie, { geo: { country: 'GBR', timeZone: '<script>' } })).status).toBe(200);
    expect((await beat(cookie, {})).status).toBe(200);

    const saved = await User.findById(user._id).lean();
    expect(saved.lastSeen).toBeTruthy();
    expect(saved.geo?.country ?? null).toBeNull();
    expect(saved.firstSeenCountry).toBeNull();
  });

  it('is returned on the Admin › Users row', async () => {
    await createRank();
    const admin  = await createAdminUser();
    const target = await createUser();
    await beat(authCookie(target._id), { geo: { country: 'CA', timeZone: 'America/Toronto', language: 'en-CA' } });

    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const row = res.body.data.users.find(u => u._id === target._id.toString());
    expect(row.geo).toMatchObject({ country: 'CA', timeZone: 'America/Toronto', language: 'en-CA' });
    expect(row.firstSeenCountry).toBe('CA');
  });
});
