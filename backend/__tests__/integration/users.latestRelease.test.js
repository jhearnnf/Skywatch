/**
 * users.latestRelease.test.js
 *
 * GET /api/users/latest-release tells the installed app which native build is
 * the newest one in the wild, so Profile can offer a Play Store link when the
 * device is behind.
 *
 * Coverage:
 *   - Reports the highest reported build per platform, not the most recent one
 *   - Keeps the two native platforms independent
 *   - Answers null for a platform nobody has reported
 *   - Ignores web clients entirely (a commit sha has no ordering)
 *   - Public: no session required, and no account data in the response
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, authCookie } = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const beat = (cookie, client) =>
  request(app).post('/api/users/heartbeat').set('Cookie', cookie).send({ client });

// Registers a user and reports one build for them, which is the only way the
// "latest release" figure is ever populated.
async function reportBuild(client) {
  const user = await createUser();
  await beat(authCookie(user._id), client);
  return user;
}

const latest = () => request(app).get('/api/users/latest-release');

describe('GET /api/users/latest-release', () => {
  it('reports the highest Android build, not the most recently reported one', async () => {
    await reportBuild({ platform: 'android', version: '1.3.0', build: '31' });
    // Reported second, but it is an older release — an outdated device beating
    // must never drag the yardstick backwards.
    await reportBuild({ platform: 'android', version: '1.2.0', build: '12' });

    const res = await latest();
    expect(res.status).toBe(200);
    expect(res.body.data.latest.android).toEqual({ version: '1.3.0', build: '31' });
  });

  it('tracks iOS separately from Android', async () => {
    await reportBuild({ platform: 'android', version: '1.3.0', build: '31' });
    await reportBuild({ platform: 'ios',     version: '1.1.0', build: '9'  });

    const res = await latest();
    expect(res.body.data.latest.android).toEqual({ version: '1.3.0', build: '31' });
    expect(res.body.data.latest.ios).toEqual({ version: '1.1.0', build: '9' });
  });

  it('answers null for a platform nobody has reported', async () => {
    await reportBuild({ platform: 'android', version: '1.3.0', build: '31' });

    const res = await latest();
    expect(res.body.data.latest.ios).toBeNull();
  });

  it('ignores web clients — a commit sha is not a release number', async () => {
    await reportBuild({ platform: 'web', version: '1.9.0', build: 'a3f9c21' });

    const res = await latest();
    expect(res.body.data.latest.android).toBeNull();
    expect(res.body.data.latest.ios).toBeNull();
    expect(res.body.data.latest.web).toBeUndefined();
  });

  it('is public, and names no account', async () => {
    await reportBuild({ platform: 'android', version: '1.3.0', build: '31' });

    // No cookie set at all.
    const res = await latest();
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/agentNumber|email|lastSeen|_id/);
  });
});
