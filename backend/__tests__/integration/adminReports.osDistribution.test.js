process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

let admin, cookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  admin  = await createAdminUser({ agentNumber: '1000099' });
  cookie = authCookie(admin._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const seen = new Date();

describe('GET /api/admin/reports/snapshot — OS distribution', () => {
  it('counts accounts ever seen on each OS, with overlap and an unreported bucket', async () => {
    // admin (created in beforeEach) has no osSeen → unreported.
    // Windows-only user.
    await createUser({ agentNumber: '1000001', osSeen: { windows: seen } });
    // A user seen on BOTH windows and android — counts toward each OS, once each.
    await createUser({ agentNumber: '1000002', osSeen: { windows: seen, android: seen } });
    // Mac + iOS user.
    await createUser({ agentNumber: '1000003', osSeen: { mac: seen, ios: seen } });
    // Never fingerprinted → unreported.
    await createUser({ agentNumber: '1000004' });

    const res = await request(app)
      .get('/api/admin/reports/snapshot')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const os = res.body.data.osDistribution;
    expect(os).toEqual({
      windows: 2,    // users 1 and 2
      mac: 1,        // user 3
      linux: 0,
      ios: 1,        // user 3
      android: 1,    // user 2
      unreported: 2, // admin + user 4
    });
  });

  it('reports every account as unreported when no OS has ever been seen', async () => {
    await createUser({ agentNumber: '1000005' });

    const res = await request(app)
      .get('/api/admin/reports/snapshot')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const os = res.body.data.osDistribution;
    // admin + one user, neither fingerprinted.
    expect(os).toEqual({ windows: 0, mac: 0, linux: 0, ios: 0, android: 0, unreported: 2 });
  });
});
