process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createGameType,
  createUser,
  createBrief,
  createQuizQuestions,
  authCookie,
} = require('../helpers/factories');

// Predictable test settings
const TEST_SETTINGS = {
  freeCategories:   ['News'],
  silverCategories: ['News', 'Aircrafts', 'Bases'],
};

beforeAll(async () => {
  await db.connect();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── GET /api/briefs/:id — category access ──────────────────────────────────
describe('GET /api/briefs/:id — category access', () => {
  beforeEach(async () => {
    await createSettings(TEST_SETTINGS);
  });

  it('free user + News brief → 200', async () => {
    const user  = await createUser({ subscriptionTier: 'free' });
    const brief = await createBrief({ category: 'News' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('free user + Aircrafts brief → 403', async () => {
    const user  = await createUser({ subscriptionTier: 'free' });
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('silver user + Aircrafts brief → 200', async () => {
    const user  = await createUser({ subscriptionTier: 'silver' });
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('silver user + brief outside silverCategories (Treaties) → 403', async () => {
    const user  = await createUser({ subscriptionTier: 'silver' });
    const brief = await createBrief({ category: 'Treaties' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('gold user + any category → 200', async () => {
    const user  = await createUser({ subscriptionTier: 'gold' });
    const brief = await createBrief({ category: 'Treaties' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('unauthenticated + guest category → 200', async () => {
    const brief = await createBrief({ category: 'News' }); // News is in guestCategories
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`);
    expect(res.status).toBe(200);
  });

  it('unauthenticated + locked category → 403', async () => {
    const brief = await createBrief({ category: 'Aircrafts' }); // not in guestCategories
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`);
    expect(res.status).toBe(403);
  });

  it('active trial user + silver category → 200', async () => {
    const user  = await createUser({
      subscriptionTier:  'trial',
      trialStartDate:    new Date(),
      trialDurationDays: 5,
    });
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });
});

// ── GET /api/briefs — isLocked labelling ──────────────────────────────────
describe('GET /api/briefs — isLocked labelling', () => {
  beforeEach(async () => {
    await createSettings(TEST_SETTINGS);
  });

  it('authenticated free user: locked-category brief has isLocked:true, News brief has isLocked:false', async () => {
    const user      = await createUser({ subscriptionTier: 'free' });
    await createBrief({ category: 'News',      title: 'News Brief' });
    await createBrief({ category: 'Aircrafts', title: 'Aircraft Brief' });

    const res = await request(app)
      .get('/api/briefs')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    const newsBrief     = briefs.find(b => b.category === 'News');
    const aircraftBrief = briefs.find(b => b.category === 'Aircrafts');

    expect(newsBrief.isLocked).toBe(false);
    expect(aircraftBrief.isLocked).toBe(true);
  });

  it('unauthenticated: isLocked reflects guest tier (News=false, Aircrafts=true)', async () => {
    await createBrief({ category: 'News' });
    await createBrief({ category: 'Aircrafts' });

    const res = await request(app).get('/api/briefs');
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    const newsBrief     = briefs.find(b => b.category === 'News');
    const aircraftBrief = briefs.find(b => b.category === 'Aircrafts');
    expect(newsBrief.isLocked).toBe(false);
    expect(aircraftBrief.isLocked).toBe(true);
  });
});

// ── POST /api/games/quiz/start — category gate ────────────────────────────
describe('POST /api/games/quiz/start — category gate', () => {
  let gameType;

  beforeEach(async () => {
    await createSettings(TEST_SETTINGS);
    gameType = await createGameType();
  });

  it('free user + quiz for locked-category brief → 403', async () => {
    const user  = await createUser({ subscriptionTier: 'free' });
    const brief = await createBrief({ category: 'Aircrafts' });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/upgrade/i);
    expect(res.body.category).toBe('Aircrafts');
  });

  it('free user + quiz for News brief → not 403 (200 or 400)', async () => {
    const user  = await createUser({ subscriptionTier: 'free' });
    const brief = await createBrief({ category: 'News' });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).not.toBe(403);
    expect([200, 400]).toContain(res.status);
  });

  it('gold user + quiz for any category → not 403', async () => {
    const user  = await createUser({ subscriptionTier: 'gold' });
    const brief = await createBrief({ category: 'Treaties' });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).not.toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const brief = await createBrief({ category: 'News' });

    const res = await request(app)
      .post('/api/games/quiz/start')
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(401);
  });
});
