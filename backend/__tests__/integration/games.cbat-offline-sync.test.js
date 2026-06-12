process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatAnglesResult = require('../../models/GameSessionCbatAnglesResult');

let user, cookie;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Offline-sync support shared by every CBAT result endpoint (saveCbatResult).
describe('CBAT offline sync — playedAt + clientResultId', () => {
  const URL = '/api/games/cbat/angles/result';

  it('uses a client-supplied playedAt as the stored createdAt', async () => {
    const playedAt = '2026-01-02T03:04:05.000Z';
    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ correctCount: 7, totalTime: 30, grade: 'Good', playedAt });

    expect(res.status).toBe(201);
    const doc = await GameSessionCbatAnglesResult.findById(res.body.data._id).lean();
    expect(new Date(doc.createdAt).toISOString()).toBe(playedAt);
  });

  it('defaults createdAt to now when playedAt is absent', async () => {
    const before = Date.now();
    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ correctCount: 3, totalTime: 20, grade: 'Good' });

    expect(res.status).toBe(201);
    const doc = await GameSessionCbatAnglesResult.findById(res.body.data._id).lean();
    expect(new Date(doc.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('deduplicates retried submissions sharing a clientResultId', async () => {
    const clientResultId = 'cri-test-123';
    const payload = { correctCount: 9, totalTime: 25, grade: 'Outstanding', clientResultId };

    const first  = await request(app).post(URL).set('Cookie', cookie).send(payload);
    const second = await request(app).post(URL).set('Cookie', cookie).send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Same row returned, only one persisted.
    expect(String(second.body.data._id)).toBe(String(first.body.data._id));
    expect(await GameSessionCbatAnglesResult.countDocuments()).toBe(1);
  });

  it('still records distinct submissions without a clientResultId', async () => {
    const payload = { correctCount: 1, totalTime: 10, grade: 'Good' };
    await request(app).post(URL).set('Cookie', cookie).send(payload);
    await request(app).post(URL).set('Cookie', cookie).send(payload);
    expect(await GameSessionCbatAnglesResult.countDocuments()).toBe(2);
  });
});
