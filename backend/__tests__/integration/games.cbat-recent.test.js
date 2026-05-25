process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatPlaneTurnResult = require('../../models/GameSessionCbatPlaneTurnResult');

const ROUTE              = '/api/games/cbat/recent';
const PLANE_TURN_RESULT     = '/api/games/cbat/plane-turn-2d/result';
const PLANE_TURN_3D_RESULT  = '/api/games/cbat/plane-turn-3d/result';

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

  it('includes userId on every row so the client can highlight the current user', async () => {
    const scorer = await createUser({ agentNumber: '3000005' });
    const scorerCookie = authCookie(scorer._id);
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', scorerCookie)
      .send({ totalRotations: 30, totalTime: 25 });

    const res = await request(app).get(ROUTE).set('Cookie', scorerCookie);
    expect(res.status).toBe(200);
    const row = res.body.data.recent.find(r => r.agentNumber === '3000005');
    expect(row).toBeTruthy();
    expect(row.userId).toBe(String(scorer._id));
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

describe('GET /api/games/cbat/recent — dedupe + 24h window', () => {
  it('keeps only the best plane-turn attempt per user in the last 24h', async () => {
    const user = await createUser({ agentNumber: '3100001' });
    const cookie = authCookie(user._id);

    // Three attempts within 24h — middle one is the best (lowest rotations).
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 40, totalTime: 30 });
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 25, totalTime: 22 });
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 30, totalTime: 26 });

    const res = await request(app).get(ROUTE).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const rows = res.body.data.recent.filter(r => r.userId === String(user._id));
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(25);
    expect(rows[0].time).toBe(22);
  });

  it('breaks score ties by lower totalTime', async () => {
    const user = await createUser({ agentNumber: '3100002' });
    const cookie = authCookie(user._id);

    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 30, totalTime: 40 });
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 30, totalTime: 20 });

    const res = await request(app).get(ROUTE).set('Cookie', cookie);
    const rows = res.body.data.recent.filter(r => r.userId === String(user._id));
    expect(rows).toHaveLength(1);
    expect(rows[0].time).toBe(20);
  });

  it('excludes attempts older than 24h from the feed', async () => {
    const user = await createUser({ agentNumber: '3100003' });
    const cookie = authCookie(user._id);

    // Insert one stale doc directly so createdAt can be backdated past the cutoff.
    await GameSessionCbatPlaneTurnResult.create({
      userId: user._id,
      totalRotations: 10, // would be best by score
      totalTime: 15,
      levelsCompleted: 5,
      mode: '2d',
      createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
    });
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 35, totalTime: 28 });

    const res = await request(app).get(ROUTE).set('Cookie', cookie);
    const rows = res.body.data.recent.filter(r => r.userId === String(user._id));
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(35); // the 26h-old 10-rotation attempt is excluded
  });

  it('keeps a separate row per mode for plane-turn (now distinct gameKeys)', async () => {
    const user = await createUser({ agentNumber: '3100004' });
    const cookie = authCookie(user._id);

    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 30, totalTime: 25 });
    await request(app).post(PLANE_TURN_3D_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 28, totalTime: 24 });

    const res = await request(app).get(ROUTE).set('Cookie', cookie);
    const rows = res.body.data.recent.filter(r => r.userId === String(user._id));
    expect(rows).toHaveLength(2);
    const keys = rows.map(r => r.gameKey).sort();
    expect(keys).toEqual(['plane-turn-2d', 'plane-turn-3d']);
  });

  it('keeps separate rows for different users on the same game', async () => {
    const userA = await createUser({ agentNumber: '3100005' });
    const userB = await createUser({ agentNumber: '3100006' });
    const cookieA = authCookie(userA._id);
    const cookieB = authCookie(userB._id);

    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookieA)
      .send({ totalRotations: 30, totalTime: 25 });
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookieB)
      .send({ totalRotations: 32, totalTime: 27 });

    const res = await request(app).get(ROUTE).set('Cookie', cookieA);
    const planeRows = res.body.data.recent.filter(r => r.gameKey === 'plane-turn-2d');
    expect(planeRows).toHaveLength(2);
    expect(planeRows.map(r => r.userId).sort())
      .toEqual([String(userA._id), String(userB._id)].sort());
  });
});
