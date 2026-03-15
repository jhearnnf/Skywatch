/**
 * subscription.access.test.js
 *
 * Comprehensive subscription gating tests across all endpoints and tier combinations.
 *
 * Settings used throughout:
 *   freeCategories:   ['News']
 *   silverCategories: ['News', 'Aircrafts', 'Bases']
 *   Gold:             all categories (no restriction)
 *
 * Tier matrix:
 *   free          → only News
 *   trial active  → same as silver (News, Aircrafts, Bases)
 *   trial expired → same as free (only News)
 *   silver        → News, Aircrafts, Bases
 *   gold          → everything
 */

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
const AppSettings = require('../../models/AppSettings');

// Predictable settings used across all tests
const S = {
  freeCategories:   ['News'],
  silverCategories: ['News', 'Aircrafts', 'Bases'],
};

// A category that is silver-tier (not free, not gold-only)
const SILVER_CAT  = 'Aircrafts';
// A category that is gold-only (not in silverCategories)
const GOLD_CAT    = 'Treaties';
// A category accessible to everyone
const FREE_CAT    = 'News';

// Trial user whose trial is still active (started now, lasts 5 days)
function activeTrial(extra = {}) {
  return {
    subscriptionTier:  'trial',
    trialStartDate:    new Date(),
    trialDurationDays: 5,
    ...extra,
  };
}

// Trial user whose trial expired yesterday
function expiredTrial(extra = {}) {
  const past = new Date();
  past.setDate(past.getDate() - 2);
  return {
    subscriptionTier:  'trial',
    trialStartDate:    past,
    trialDurationDays: 1,
    ...extra,
  };
}

beforeAll(async () => { await db.connect(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── Expired trial — treated as free ───────────────────────────────────────
describe('Expired trial — treated as free tier', () => {
  beforeEach(() => createSettings(S));

  it('GET /api/briefs/:id — expired trial + free category → 200', async () => {
    const user  = await createUser(expiredTrial());
    const brief = await createBrief({ category: FREE_CAT });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('GET /api/briefs/:id — expired trial + silver category → 403', async () => {
    const user  = await createUser(expiredTrial());
    const brief = await createBrief({ category: SILVER_CAT });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('GET /api/briefs/:id — expired trial + gold-only category → 403', async () => {
    const user  = await createUser(expiredTrial());
    const brief = await createBrief({ category: GOLD_CAT });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('POST /api/games/quiz/start — expired trial + silver category → 403', async () => {
    const gameType = await createGameType();
    const user     = await createUser(expiredTrial());
    const brief    = await createBrief({ category: SILVER_CAT });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(403);
  });
});

// ── GET /api/briefs/:id — complete tier matrix ────────────────────────────
describe('GET /api/briefs/:id — complete tier matrix', () => {
  beforeEach(() => createSettings(S));

  it('silver user + gold-only category → 403', async () => {
    const user  = await createUser({ subscriptionTier: 'silver' });
    const brief = await createBrief({ category: GOLD_CAT });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('active trial + silver category → 200', async () => {
    const user  = await createUser(activeTrial());
    const brief = await createBrief({ category: SILVER_CAT });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('active trial + gold-only category → 403', async () => {
    const user  = await createUser(activeTrial());
    const brief = await createBrief({ category: GOLD_CAT });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('gold user + gold-only category → 200', async () => {
    const user  = await createUser({ subscriptionTier: 'gold' });
    const brief = await createBrief({ category: GOLD_CAT });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('403 response includes a message field', async () => {
    const user  = await createUser({ subscriptionTier: 'free' });
    const brief = await createBrief({ category: SILVER_CAT });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
  });
});

// ── GET /api/briefs (list) — isLocked labelling for all tiers ─────────────
describe('GET /api/briefs — isLocked labelling for all tiers', () => {
  beforeEach(async () => {
    await createSettings(S);
    await createBrief({ category: FREE_CAT,   title: 'Free Brief' });
    await createBrief({ category: SILVER_CAT, title: 'Silver Brief' });
    await createBrief({ category: GOLD_CAT,   title: 'Gold Brief' });
  });

  it('free user: free brief isLocked:false, silver brief isLocked:true, gold brief isLocked:true', async () => {
    const user = await createUser({ subscriptionTier: 'free' });
    const res  = await request(app).get('/api/briefs').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs.find(b => b.category === FREE_CAT).isLocked).toBe(false);
    expect(briefs.find(b => b.category === SILVER_CAT).isLocked).toBe(true);
    expect(briefs.find(b => b.category === GOLD_CAT).isLocked).toBe(true);
  });

  it('silver user: free+silver briefs isLocked:false, gold brief isLocked:true', async () => {
    const user = await createUser({ subscriptionTier: 'silver' });
    const res  = await request(app).get('/api/briefs').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs.find(b => b.category === FREE_CAT).isLocked).toBe(false);
    expect(briefs.find(b => b.category === SILVER_CAT).isLocked).toBe(false);
    expect(briefs.find(b => b.category === GOLD_CAT).isLocked).toBe(true);
  });

  it('gold user: all briefs isLocked:false', async () => {
    const user = await createUser({ subscriptionTier: 'gold' });
    const res  = await request(app).get('/api/briefs').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    briefs.forEach(b => expect(b.isLocked).toBe(false));
  });

  it('active trial: silver brief isLocked:false, gold brief isLocked:true', async () => {
    const user = await createUser(activeTrial());
    const res  = await request(app).get('/api/briefs').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs.find(b => b.category === SILVER_CAT).isLocked).toBe(false);
    expect(briefs.find(b => b.category === GOLD_CAT).isLocked).toBe(true);
  });

  it('expired trial: silver brief isLocked:true (same as free)', async () => {
    const user = await createUser(expiredTrial());
    const res  = await request(app).get('/api/briefs').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs.find(b => b.category === FREE_CAT).isLocked).toBe(false);
    expect(briefs.find(b => b.category === SILVER_CAT).isLocked).toBe(true);
  });
});

// ── GET /api/briefs?category=X (category-filtered list) ───────────────────
describe('GET /api/briefs?category=X — isLocked on category-filtered list', () => {
  beforeEach(() => createSettings(S));

  it('free user + locked category → 200 with isLocked:true on all returned briefs', async () => {
    const user = await createUser({ subscriptionTier: 'free' });
    await createBrief({ category: SILVER_CAT, title: 'Aircraft 1' });
    await createBrief({ category: SILVER_CAT, title: 'Aircraft 2' });

    const res = await request(app)
      .get(`/api/briefs?category=${SILVER_CAT}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs.length).toBeGreaterThan(0);
    briefs.forEach(b => expect(b.isLocked).toBe(true));
  });

  it('silver user + silver category → isLocked:false on all briefs', async () => {
    const user = await createUser({ subscriptionTier: 'silver' });
    await createBrief({ category: SILVER_CAT, title: 'Aircraft 1' });

    const res = await request(app)
      .get(`/api/briefs?category=${SILVER_CAT}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    res.body.data.briefs.forEach(b => expect(b.isLocked).toBe(false));
  });

  it('silver user + gold-only category → isLocked:true on all briefs', async () => {
    const user = await createUser({ subscriptionTier: 'silver' });
    await createBrief({ category: GOLD_CAT, title: 'Treaties 1' });

    const res = await request(app)
      .get(`/api/briefs?category=${GOLD_CAT}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    res.body.data.briefs.forEach(b => expect(b.isLocked).toBe(true));
  });

  it('gold user + any category → isLocked:false on all briefs', async () => {
    const user = await createUser({ subscriptionTier: 'gold' });
    await createBrief({ category: GOLD_CAT, title: 'Treaties 1' });

    const res = await request(app)
      .get(`/api/briefs?category=${GOLD_CAT}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    res.body.data.briefs.forEach(b => expect(b.isLocked).toBe(false));
  });

  it('unauthenticated + locked category → isLocked:true on briefs (guest tier applied)', async () => {
    await createBrief({ category: SILVER_CAT });

    const res = await request(app).get(`/api/briefs?category=${SILVER_CAT}`);
    expect(res.status).toBe(200);
    // Guests get isLocked flag based on guestCategories setting
    res.body.data.briefs.forEach(b => expect(b.isLocked).toBe(true));
  });
});

// ── GET /api/briefs/category-counts — public, all categories ─────────────
//
// category-counts is intentionally a public endpoint that returns ALL
// categories regardless of tier. The frontend uses it to display brief
// counts on locked category cards so guests can still see what's available.
describe('GET /api/briefs/category-counts — returns all categories for all tiers', () => {
  beforeEach(async () => {
    await createSettings(S);
    await createBrief({ category: FREE_CAT });
    await createBrief({ category: SILVER_CAT });
    await createBrief({ category: GOLD_CAT });
  });

  it('unauthenticated → all categories returned (including locked ones)', async () => {
    const res = await request(app).get('/api/briefs/category-counts');
    expect(res.status).toBe(200);
    const counts = res.body.data.counts;
    expect(counts[FREE_CAT]).toBe(1);
    expect(counts[SILVER_CAT]).toBe(1);
    expect(counts[GOLD_CAT]).toBe(1);
  });

  it('free user → all categories returned (including locked ones)', async () => {
    const user = await createUser({ subscriptionTier: 'free' });
    const res  = await request(app)
      .get('/api/briefs/category-counts')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const counts = res.body.data.counts;
    expect(counts[FREE_CAT]).toBe(1);
    expect(counts[SILVER_CAT]).toBe(1);
    expect(counts[GOLD_CAT]).toBe(1);
  });

  it('silver user → all categories returned', async () => {
    const user = await createUser({ subscriptionTier: 'silver' });
    const res  = await request(app)
      .get('/api/briefs/category-counts')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const counts = res.body.data.counts;
    expect(counts[FREE_CAT]).toBe(1);
    expect(counts[SILVER_CAT]).toBe(1);
    expect(counts[GOLD_CAT]).toBe(1);
  });

  it('gold user → all categories returned', async () => {
    const user = await createUser({ subscriptionTier: 'gold' });
    const res  = await request(app)
      .get('/api/briefs/category-counts')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const counts = res.body.data.counts;
    expect(counts[FREE_CAT]).toBe(1);
    expect(counts[SILVER_CAT]).toBe(1);
    expect(counts[GOLD_CAT]).toBe(1);
  });

  it('active trial → all categories returned', async () => {
    const user = await createUser(activeTrial());
    const res  = await request(app)
      .get('/api/briefs/category-counts')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const counts = res.body.data.counts;
    expect(counts[FREE_CAT]).toBe(1);
    expect(counts[SILVER_CAT]).toBe(1);
    expect(counts[GOLD_CAT]).toBe(1);
  });
});

// ── GET /api/briefs/unread-categories — tier filtering ────────────────────
describe('GET /api/briefs/unread-categories — tier access filtering', () => {
  beforeEach(async () => {
    await createSettings(S);
    await createBrief({ category: FREE_CAT });
    await createBrief({ category: SILVER_CAT });
    await createBrief({ category: GOLD_CAT });
  });

  it('unauthenticated → only free categories returned', async () => {
    const res = await request(app).get('/api/briefs/unread-categories');
    expect(res.status).toBe(200);
    const names = res.body.data.categories.map(c => c.name);
    expect(names).toContain(FREE_CAT);
    expect(names).not.toContain(SILVER_CAT);
    expect(names).not.toContain(GOLD_CAT);
  });

  it('free user → only free categories returned', async () => {
    const user = await createUser({ subscriptionTier: 'free' });
    const res  = await request(app)
      .get('/api/briefs/unread-categories')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const names = res.body.data.categories.map(c => c.name);
    expect(names).toContain(FREE_CAT);
    expect(names).not.toContain(SILVER_CAT);
    expect(names).not.toContain(GOLD_CAT);
  });

  it('silver user → free + silver categories, not gold-only', async () => {
    const user = await createUser({ subscriptionTier: 'silver' });
    const res  = await request(app)
      .get('/api/briefs/unread-categories')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const names = res.body.data.categories.map(c => c.name);
    expect(names).toContain(FREE_CAT);
    expect(names).toContain(SILVER_CAT);
    expect(names).not.toContain(GOLD_CAT);
  });

  it('gold user → all categories returned', async () => {
    const user = await createUser({ subscriptionTier: 'gold' });
    const res  = await request(app)
      .get('/api/briefs/unread-categories')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const names = res.body.data.categories.map(c => c.name);
    expect(names).toContain(FREE_CAT);
    expect(names).toContain(SILVER_CAT);
    expect(names).toContain(GOLD_CAT);
  });

  it('active trial → same as silver', async () => {
    const user = await createUser(activeTrial());
    const res  = await request(app)
      .get('/api/briefs/unread-categories')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const names = res.body.data.categories.map(c => c.name);
    expect(names).toContain(SILVER_CAT);
    expect(names).not.toContain(GOLD_CAT);
  });
});

// ── POST /api/games/quiz/start — complete tier matrix ─────────────────────
describe('POST /api/games/quiz/start — complete tier matrix', () => {
  let gameType;

  beforeEach(async () => {
    await createSettings(S);
    gameType = await createGameType();
  });

  it('silver user + silver category → not 403', async () => {
    const user  = await createUser({ subscriptionTier: 'silver' });
    const brief = await createBrief({ category: SILVER_CAT });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).not.toBe(403);
  });

  it('active trial + silver category → not 403', async () => {
    const user  = await createUser(activeTrial());
    const brief = await createBrief({ category: SILVER_CAT });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).not.toBe(403);
  });

  it('active trial + gold-only category → 403', async () => {
    const user  = await createUser(activeTrial());
    const brief = await createBrief({ category: GOLD_CAT });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(403);
  });

  it('expired trial + silver category → 403', async () => {
    const user  = await createUser(expiredTrial());
    const brief = await createBrief({ category: SILVER_CAT });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(403);
  });

  it('silver user + gold-only category → 403', async () => {
    const user  = await createUser({ subscriptionTier: 'silver' });
    const brief = await createBrief({ category: GOLD_CAT });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(403);
    expect(res.body.category).toBe(GOLD_CAT);
  });
});

// ── Settings change propagates immediately ────────────────────────────────
describe('Settings changes propagate to access control immediately', () => {
  it('revoking a category from freeCategories blocks access on next request', async () => {
    // Start with Aircrafts accessible to free users
    await createSettings({ freeCategories: [FREE_CAT, SILVER_CAT], silverCategories: [FREE_CAT, SILVER_CAT] });

    const user  = await createUser({ subscriptionTier: 'free' });
    const brief = await createBrief({ category: SILVER_CAT });

    // First request — should succeed
    const before = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(before.status).toBe(200);

    // Admin removes Aircrafts from freeCategories
    await AppSettings.findOneAndUpdate({}, { freeCategories: [FREE_CAT] });

    // Next request — should now be blocked
    const after = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(after.status).toBe(403);
  });

  it('adding a category to freeCategories grants access on next request', async () => {
    // Start with Aircrafts locked for free users
    await createSettings({ freeCategories: [FREE_CAT], silverCategories: [FREE_CAT, SILVER_CAT] });

    const user  = await createUser({ subscriptionTier: 'free' });
    const brief = await createBrief({ category: SILVER_CAT });

    // First request — should be blocked
    const before = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(before.status).toBe(403);

    // Admin adds Aircrafts to freeCategories
    await AppSettings.findOneAndUpdate({}, { freeCategories: [FREE_CAT, SILVER_CAT] });

    // Next request — should now succeed
    const after = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(after.status).toBe(200);
  });
});
