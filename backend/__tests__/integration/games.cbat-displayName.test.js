process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const RESULT_URL       = '/api/games/cbat/plane-turn-2d/result';
const LEADERBOARD_URL  = '/api/games/cbat/plane-turn-2d/leaderboard';

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CBAT leaderboard surfaces displayName', () => {
  it('returns displayName on leaderboard rows when set', async () => {
    const named = await createUser({
      agentNumber: '2000001',
      displayName: 'Maverick',
      displayNameLower: 'maverick',
    });
    const namedCookie = authCookie(named._id);

    await request(app).post(RESULT_URL).set('Cookie', namedCookie)
      .send({ totalRotations: 25, totalTime: 22 });

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', namedCookie);

    expect(res.status).toBe(200);
    const row = res.body.data.leaderboard.find(e => !e.isFake && e.agentNumber === '2000001');
    expect(row).toBeTruthy();
    expect(row.displayName).toBe('Maverick');
  });

  it('returns displayName on myBest when set', async () => {
    const named = await createUser({
      agentNumber: '2000002',
      displayName: 'Iceman',
      displayNameLower: 'iceman',
    });
    const namedCookie = authCookie(named._id);

    await request(app).post(RESULT_URL).set('Cookie', namedCookie)
      .send({ totalRotations: 22, totalTime: 18 });

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', namedCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.myBest.displayName).toBe('Iceman');
  });

  it('returns null displayName for users who have not set one', async () => {
    const plain = await createUser({ agentNumber: '2000003' });
    const cookie = authCookie(plain._id);

    await request(app).post(RESULT_URL).set('Cookie', cookie)
      .send({ totalRotations: 28, totalTime: 25 });

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

    const row = res.body.data.leaderboard.find(e => !e.isFake && e.agentNumber === '2000003');
    expect(row).toBeTruthy();
    expect(row.displayName == null).toBe(true);
  });
});
