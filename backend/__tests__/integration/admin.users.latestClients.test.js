/**
 * admin.users.latestClients.test.js
 *
 * GET /api/admin/users (and /users/search) return `latestClients` — the newest
 * native release seen in the wild per platform. The admin panel compares each
 * account's last-known build against it to show LATEST / OUTDATED.
 *
 * Coverage:
 *   - Ranks by numeric buildNumber, not by version-name string ordering
 *   - Omits web (a commit sha has no ordering — the browser answers that)
 *   - Null per platform when nobody has reported one
 *   - Search returns the population-wide yardstick, not the yardstick of the
 *     matched users (otherwise searching one stale user makes them look current)
 *   - lastClients is included on each user row
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createRank, authCookie } = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const clientsFor = (platform, version, build, buildNumber) => ({
  lastClients: { [platform]: { version, build, buildNumber, lastSeenAt: new Date() } },
});

describe('GET /api/admin/users — latestClients', () => {
  beforeEach(async () => { await createRank(); });

  it('reports the highest Android versionCode as latest', async () => {
    // "1.10.0" sorts BELOW "1.9.0" as a string — ranking must use the numeric
    // versionCode, which the store guarantees is monotonic.
    const admin = await createAdminUser();
    await createUser(clientsFor('android', '1.9.0',  '9',  9));
    await createUser(clientsFor('android', '1.10.0', '10', 10));

    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.latestClients.android).toEqual({ version: '1.10.0', build: '10' });
  });

  it('does not report a latest web build', async () => {
    const admin = await createAdminUser();
    await createUser(clientsFor('web', '1.2.3', 'a3f9c21', null));

    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));
    expect(res.body.data.latestClients.web).toBeUndefined();
  });

  it('is null for a platform nobody has reported', async () => {
    const admin = await createAdminUser();
    const res   = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));
    expect(res.body.data.latestClients.android).toBeNull();
    expect(res.body.data.latestClients.ios).toBeNull();
  });

  it('includes each user\'s last-known builds', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({
      email: 'dual@test.com',
      lastClients: {
        android: { version: '1.2.3', build: '7',       buildNumber: 7,    lastSeenAt: new Date() },
        web:     { version: '1.3.0', build: 'bb11cc2', buildNumber: null, lastSeenAt: new Date() },
      },
    });

    const res  = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));
    const row  = res.body.data.users.find(u => u._id === user._id.toString());
    expect(row.lastClients.android).toMatchObject({ version: '1.2.3', build: '7' });
    expect(row.lastClients.web).toMatchObject({ version: '1.3.0', build: 'bb11cc2' });
  });

  it('search returns the population-wide latest, not the matched user\'s build', async () => {
    const admin = await createAdminUser();
    await createUser(clientsFor('android', '1.10.0', '10', 10));
    const stale = await createUser({ email: 'stale@test.com', ...clientsFor('android', '1.2.3', '7', 7) });

    const res = await request(app)
      .get('/api/admin/users/search?q=stale@test.com')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.users.map(u => u._id)).toContain(stale._id.toString());
    expect(res.body.data.latestClients.android).toEqual({ version: '1.10.0', build: '10' });
  });
});
