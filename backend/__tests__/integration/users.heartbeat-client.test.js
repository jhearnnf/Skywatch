/**
 * users.heartbeat-client.test.js
 *
 * POST /api/users/heartbeat now carries an optional `client` payload — which
 * build of the app the caller is running — so Admin › Users can answer "what
 * version were they on when they were last online?".
 *
 * Coverage:
 *   - Stores version/build/lastSeenAt under the reporting platform
 *   - Parses Android's numeric versionCode into buildNumber (drives "latest")
 *   - Keeps a non-numeric web build out of buildNumber
 *   - Retains the other platform's record when a user switches device
 *   - Rejects unknown platforms and malformed version strings
 *   - Presence (lastSeen) still records when the client payload is bad/absent —
 *     the Users Online count must not depend on version reporting working
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, authCookie } = require('../helpers/factories');

const User = require('../../models/User');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const beat = (cookie, body) =>
  request(app).post('/api/users/heartbeat').set('Cookie', cookie).send(body ?? {});

describe('POST /api/users/heartbeat — client build reporting', () => {
  it('records an Android build under lastClients.android', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await beat(cookie, { client: { platform: 'android', version: '1.2.3', build: '7' } });
    expect(res.status).toBe(200);

    const saved = await User.findById(user._id).lean();
    expect(saved.lastClients.android).toMatchObject({
      version: '1.2.3',
      build: '7',
      buildNumber: 7,
    });
    expect(saved.lastClients.android.lastSeenAt).toBeTruthy();
    expect(saved.lastSeen).toBeTruthy();
  });

  it('stores a web commit sha without inventing a buildNumber', async () => {
    // buildNumber is what "latest native release" is ranked by. A sha is not
    // ordered, so it must never land in that field and skew the ranking.
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await beat(cookie, { client: { platform: 'web', version: '1.2.3', build: 'a3f9c21' } });

    const saved = await User.findById(user._id).lean();
    expect(saved.lastClients.web).toMatchObject({ version: '1.2.3', build: 'a3f9c21' });
    expect(saved.lastClients.web.buildNumber).toBeNull();
  });

  it('keeps the Android record when the same user next appears on web', async () => {
    // The whole point of storing per-platform: switching to the browser must not
    // erase what they were last running on the phone.
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await beat(cookie, { client: { platform: 'android', version: '1.2.3', build: '7' } });
    await beat(cookie, { client: { platform: 'web',     version: '1.3.0', build: 'bb11cc2' } });

    const saved = await User.findById(user._id).lean();
    expect(saved.lastClients.android).toMatchObject({ version: '1.2.3', build: '7' });
    expect(saved.lastClients.web).toMatchObject({ version: '1.3.0', build: 'bb11cc2' });
  });

  it('overwrites the same platform on upgrade', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    await beat(cookie, { client: { platform: 'android', version: '1.2.3', build: '7' } });
    await beat(cookie, { client: { platform: 'android', version: '1.3.0', build: '8' } });

    const saved = await User.findById(user._id).lean();
    expect(saved.lastClients.android).toMatchObject({ version: '1.3.0', build: '8', buildNumber: 8 });
  });

  it.each([
    ['unknown platform',   { platform: 'playstation', version: '1.2.3', build: '7' }],
    ['missing platform',   { version: '1.2.3', build: '7' }],
    ['missing version',    { platform: 'android', build: '7' }],
    ['markup in version',  { platform: 'web', version: '<script>x</script>', build: '1' }],
    ['over-long version',  { platform: 'web', version: 'v'.repeat(80), build: '1' }],
    ['non-object client',  'android-1.2.3'],
  ])('ignores a bad client payload (%s) but still records presence', async (_label, client) => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await beat(cookie, { client });
    expect(res.status).toBe(200);

    const saved = await User.findById(user._id).lean();
    expect(saved.lastSeen).toBeTruthy();
    expect(saved.lastClients?.web ?? null).toBeNull();
    expect(saved.lastClients?.android ?? null).toBeNull();
  });

  it('still records presence with no body at all', async () => {
    // The old client sends a bare POST. It must keep counting as online.
    const user   = await createUser();
    const res    = await beat(authCookie(user._id));
    expect(res.status).toBe(200);
    expect((await User.findById(user._id).lean()).lastSeen).toBeTruthy();
  });

  it('requires auth', async () => {
    const res = await request(app).post('/api/users/heartbeat').send({});
    expect(res.status).toBe(401);
  });
});
