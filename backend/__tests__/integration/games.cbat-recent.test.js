process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const ROUTE              = '/api/games/cbat/recent';
const PLANE_TURN_RESULT  = '/api/games/cbat/plane-turn/result';

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('GET /api/games/cbat/recent — visibility', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).get(ROUTE);
    expect(res.status).toBe(401);
  });

  it('returns 200 for non-admin users (was admin-only before)', async () => {
    const user = await createUser({ agentNumber: '3000001' });
    const cookie = authCookie(user._id);

    const res = await request(app).get(ROUTE).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.recent)).toBe(true);
  });

  it('omits email for non-admins but includes agentNumber + displayName', async () => {
    const scorer = await createUser({
      email: 'scorer@test.com',
      agentNumber: '3000002',
      displayName: 'Maverick',
      displayNameLower: 'maverick',
    });
    const scorerCookie = authCookie(scorer._id);
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', scorerCookie)
      .send({ totalRotations: 30, totalTime: 25 });

    const viewer = await createUser({ email: 'viewer@test.com', agentNumber: '3000003' });
    const viewerCookie = authCookie(viewer._id);

    const res = await request(app).get(ROUTE).set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
    const row = res.body.data.recent.find(r => r.agentNumber === '3000002');
    expect(row).toBeTruthy();
    expect(row.email).toBeUndefined();
    expect(row.displayName).toBe('Maverick');
    expect(row.agentNumber).toBe('3000002');
  });

  it('includes email for admins', async () => {
    const scorer = await createUser({ email: 'scorer@test.com', agentNumber: '3000004' });
    const scorerCookie = authCookie(scorer._id);
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', scorerCookie)
      .send({ totalRotations: 30, totalTime: 25 });

    const admin = await createUser({ email: 'admin@test.com', isAdmin: true });
    const adminCookie = authCookie(admin._id);

    const res = await request(app).get(ROUTE).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const row = res.body.data.recent.find(r => r.agentNumber === '3000004');
    expect(row).toBeTruthy();
    expect(row.email).toBe('scorer@test.com');
  });
});
