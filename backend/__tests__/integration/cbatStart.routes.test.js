process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatStart = require('../../models/GameSessionCbatStart');
const { CBAT_GAMES }       = require('../../constants/cbatGames');

let user, cookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('POST /api/games/cbat/:gameKey/start — auth', () => {
  it('returns 401 without auth cookie', async () => {
    const res = await request(app).post('/api/games/cbat/target/start');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/games/cbat/:gameKey/start — validation', () => {
  it('returns 400 for an unknown gameKey', async () => {
    const res = await request(app)
      .post('/api/games/cbat/not-a-real-game/start')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Unknown game');
  });
});

describe('POST /api/games/cbat/:gameKey/start — success', () => {
  it('returns 201 and creates one GameSessionCbatStart doc', async () => {
    const res = await request(app)
      .post('/api/games/cbat/target/start')
      .set('Cookie', cookie);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.gameKey).toBe('target');

    const count = await GameSessionCbatStart.countDocuments({ userId: user._id });
    expect(count).toBe(1);
  });

  it('creates a new doc on each call (two calls = two docs)', async () => {
    await request(app).post('/api/games/cbat/angles/start').set('Cookie', cookie);
    await request(app).post('/api/games/cbat/angles/start').set('Cookie', cookie);

    const count = await GameSessionCbatStart.countDocuments({ userId: user._id });
    expect(count).toBe(2);
  });

  it('accepts all valid gameKeys defined in CBAT_GAMES', async () => {
    const keys = Object.keys(CBAT_GAMES);
    for (const key of keys) {
      const res = await request(app)
        .post(`/api/games/cbat/${key}/start`)
        .set('Cookie', cookie);
      expect(res.status).toBe(201);
    }

    const count = await GameSessionCbatStart.countDocuments({ userId: user._id });
    expect(count).toBe(keys.length);
  });

  it('stores userId from the authenticated session', async () => {
    await request(app).post('/api/games/cbat/symbols/start').set('Cookie', cookie);

    const doc = await GameSessionCbatStart.findOne({ userId: user._id });
    expect(doc).not.toBeNull();
    expect(doc.userId.toString()).toBe(user._id.toString());
  });
});
