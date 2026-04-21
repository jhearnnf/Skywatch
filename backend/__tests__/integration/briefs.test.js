/**
 * NOTE: Read tracking in SkyWatch works via GET /api/briefs/:id (authenticated).
 * The first fetch of a brief creates an IntelligenceBriefRead record.
 * The frontend also calls POST /api/briefs/:id/read, but that route does not exist;
 * however, reads are already tracked by the GET so the quiz/progress still works.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createBrief, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Helper: simulate a user opening a brief (which tracks the read)
async function openBrief(briefId, cookie) {
  return request(app).get(`/api/briefs/${briefId}`).set('Cookie', cookie);
}

// ── GET /api/briefs ────────────────────────────────────────────────────────
describe('GET /api/briefs', () => {
  it('returns an array of briefs', async () => {
    await createBrief({ title: 'Brief One', category: 'News' });
    await createBrief({ title: 'Brief Two', category: 'Aircrafts' });

    const res = await request(app).get('/api/briefs');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.briefs)).toBe(true);
    expect(res.body.data.briefs.length).toBe(2);
  });

  it('filters by category', async () => {
    await createBrief({ category: 'News' });
    await createBrief({ category: 'Aircrafts' });

    const res = await request(app).get('/api/briefs?category=News');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.every(b => b.category === 'News')).toBe(true);
    expect(res.body.data.briefs.length).toBe(1);
  });

  it('filters by search term', async () => {
    await createBrief({ title: 'Typhoon Deep Dive', category: 'Aircrafts' });
    await createBrief({ title: 'RAF Bases Overview', category: 'Bases' });

    const res = await request(app).get('/api/briefs?search=Typhoon');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(1);
    expect(res.body.data.briefs[0].title).toBe('Typhoon Deep Dive');
  });

  it('respects limit param', async () => {
    for (let i = 0; i < 5; i++) await createBrief({ title: `Brief ${i}` });

    const res = await request(app).get('/api/briefs?limit=3');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(3);
  });

  it('marks isStarted=true (not isRead) for briefs the user has opened but not completed', async () => {
    const user  = await createUser();
    const brief = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // Opening creates a read record but does NOT complete it
    await openBrief(brief._id, cookie);

    const res = await request(app)
      .get('/api/briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const found = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(found?.isRead).toBe(false);
    expect(found?.isStarted).toBe(true);
  });

  it('marks isRead=true after the user completes a brief', async () => {
    const user  = await createUser();
    const brief = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie);
    await request(app).post(`/api/briefs/${brief._id}/complete`).set('Cookie', cookie);

    const res = await request(app)
      .get('/api/briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const found = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(found?.isRead).toBe(true);
    expect(found?.isStarted).toBe(false);
  });
});

// ── GET /api/briefs — isLocked per tier ───────────────────────────────────
describe('GET /api/briefs — isLocked by subscription tier', () => {
  beforeEach(async () => {
    await createSettings({
      guestCategories:  ['News'],
      freeCategories:   ['News'],
      silverCategories: ['News', 'Aircrafts'],
    });
  });

  // ── Gold tier ──────────────────────────────────────────────────────────
  it('gold-tier user: isLocked=false for every category', async () => {
    const user   = await createUser({ subscriptionTier: 'gold' });
    const cookie = authCookie(user._id);
    await createBrief({ category: 'News' });
    await createBrief({ category: 'Aircrafts' });
    await createBrief({ category: 'Ranks' });

    const res = await request(app).get('/api/briefs').set('Cookie', cookie);

    expect(res.status).toBe(200);
    res.body.data.briefs.forEach(b => {
      expect(b.isLocked).toBe(false);
    });
  });

  it('gold-tier user: accessible category (News) is not locked', async () => {
    const user   = await createUser({ subscriptionTier: 'gold' });
    const cookie = authCookie(user._id);
    await createBrief({ category: 'News' });

    const res = await request(app).get('/api/briefs').set('Cookie', cookie);

    expect(res.body.data.briefs[0].isLocked).toBe(false);
  });

  it('gold-tier user: typically-locked category (Ranks) is not locked', async () => {
    const user   = await createUser({ subscriptionTier: 'gold' });
    const cookie = authCookie(user._id);
    await createBrief({ category: 'Ranks' });

    const res = await request(app).get('/api/briefs').set('Cookie', cookie);

    expect(res.body.data.briefs[0].isLocked).toBe(false);
  });

  // ── Silver tier ────────────────────────────────────────────────────────
  it('silver-tier user: isLocked=false for categories in silverCategories', async () => {
    const user   = await createUser({ subscriptionTier: 'silver' });
    const cookie = authCookie(user._id);
    await createBrief({ category: 'Aircrafts' });

    const res = await request(app).get('/api/briefs').set('Cookie', cookie);

    expect(res.body.data.briefs[0].isLocked).toBe(false);
  });

  it('silver-tier user: isLocked=true for categories outside silverCategories', async () => {
    const user   = await createUser({ subscriptionTier: 'silver' });
    const cookie = authCookie(user._id);
    await createBrief({ category: 'Ranks' }); // not in silverCategories

    const res = await request(app).get('/api/briefs').set('Cookie', cookie);

    expect(res.body.data.briefs[0].isLocked).toBe(true);
  });

  // ── Free tier ──────────────────────────────────────────────────────────
  it('free-tier user: isLocked=false for categories in freeCategories', async () => {
    const user   = await createUser({ subscriptionTier: 'free' });
    const cookie = authCookie(user._id);
    await createBrief({ category: 'News' });

    const res = await request(app).get('/api/briefs').set('Cookie', cookie);

    expect(res.body.data.briefs[0].isLocked).toBe(false);
  });

  it('free-tier user: isLocked=true for categories outside freeCategories', async () => {
    const user   = await createUser({ subscriptionTier: 'free' });
    const cookie = authCookie(user._id);
    await createBrief({ category: 'Aircrafts' }); // not in freeCategories

    const res = await request(app).get('/api/briefs').set('Cookie', cookie);

    expect(res.body.data.briefs[0].isLocked).toBe(true);
  });

  // ── Guest (unauthenticated) ────────────────────────────────────────────
  it('guest (no cookie): isLocked=false for categories in guestCategories', async () => {
    await createBrief({ category: 'News' });

    const res = await request(app).get('/api/briefs');

    expect(res.body.data.briefs[0].isLocked).toBe(false);
  });

  it('guest (no cookie): isLocked=true for categories outside guestCategories', async () => {
    await createBrief({ category: 'Aircrafts' });

    const res = await request(app).get('/api/briefs');

    expect(res.body.data.briefs[0].isLocked).toBe(true);
  });

  it('unauthenticated request does not expose isRead on any brief', async () => {
    await createBrief({ category: 'News' });

    const res = await request(app).get('/api/briefs');

    expect(res.body.data.briefs[0].isRead).toBe(false);
  });
});

// ── GET /api/briefs/:id ────────────────────────────────────────────────────
describe('GET /api/briefs/:id', () => {
  it('returns a single brief by id', async () => {
    const brief = await createBrief({ title: 'Specific Brief' });

    const res = await request(app).get(`/api/briefs/${brief._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.brief.title).toBe('Specific Brief');
  });

  it('returns 404 for unknown id', async () => {
    const { Types } = require('mongoose');
    const res = await request(app).get(`/api/briefs/${new Types.ObjectId()}`);
    expect(res.status).toBe(404);
  });

  it('creates a read record on first authenticated fetch', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    const res = await openBrief(brief._id, cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.readRecord).not.toBeNull();
    // Coins are NOT awarded on open — only on complete
    expect(res.body.data.airstarsEarned).toBeUndefined();
    expect(res.body.data.dailyCoinsEarned).toBeUndefined();
  });

  it('does not award coins on repeated fetches — coins are deferred to /complete', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    const res1 = await openBrief(brief._id, cookie);
    const res2 = await openBrief(brief._id, cookie);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Neither response contains coin data
    expect(res1.body.data.airstarsEarned).toBeUndefined();
    expect(res2.body.data.airstarsEarned).toBeUndefined();
  });
});

// ── GET /api/briefs/category-counts ───────────────────────────────────────
describe('GET /api/briefs/category-counts', () => {
  it('returns counts per category', async () => {
    await createBrief({ category: 'News' });
    await createBrief({ category: 'News' });
    await createBrief({ category: 'Aircrafts' });

    const res = await request(app).get('/api/briefs/category-counts');

    expect(res.status).toBe(200);
    expect(res.body.data.counts).toBeDefined();
  });

  it('is a public endpoint — no cookie required', async () => {
    await createBrief({ category: 'News' });
    const res = await request(app).get('/api/briefs/category-counts');
    expect(res.status).toBe(200);
  });

  it('returns counts for ALL categories regardless of tier — including locked ones', async () => {
    // guestCategories = ['News'] by default — Aircrafts is locked for guests
    await createBrief({ category: 'News' });
    await createBrief({ category: 'Aircrafts' });

    const res = await request(app).get('/api/briefs/category-counts');

    expect(res.status).toBe(200);
    const { counts } = res.body.data;
    // Both categories must be present regardless of guest tier
    expect(counts.News).toBe(1);
    expect(counts.Aircrafts).toBe(1);
  });

  it('returns correct counts for multiple briefs per category', async () => {
    await createBrief({ category: 'News' });
    await createBrief({ category: 'News' });
    await createBrief({ category: 'Ranks' });

    const res = await request(app).get('/api/briefs/category-counts');

    expect(res.status).toBe(200);
    expect(res.body.data.counts.News).toBe(2);
    expect(res.body.data.counts.Ranks).toBe(1);
  });
});

// ── GET /api/briefs/public-stats ──────────────────────────────────────────
describe('GET /api/briefs/public-stats', () => {
  it('is a public endpoint — no cookie required', async () => {
    const res = await request(app).get('/api/briefs/public-stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('returns zero counts when no briefs exist', async () => {
    const res = await request(app).get('/api/briefs/public-stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalBriefs).toBe(0);
    expect(res.body.data.totalQuestions).toBe(0);
  });

  it('only counts published briefs (excludes stubs)', async () => {
    await createBrief({ status: 'published' });
    await createBrief({ status: 'published' });
    await createBrief({ status: 'stub' });

    const res = await request(app).get('/api/briefs/public-stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalBriefs).toBe(2);
  });

  it('sums easy + medium quiz question references on published briefs', async () => {
    const mongoose = require('mongoose');
    const fakeIds = n => Array.from({ length: n }, () => new mongoose.Types.ObjectId());
    await createBrief({
      status: 'published',
      quizQuestionsEasy:   fakeIds(3),
      quizQuestionsMedium: fakeIds(2),
    });
    await createBrief({
      status: 'published',
      quizQuestionsEasy:   fakeIds(1),
      quizQuestionsMedium: fakeIds(4),
    });
    await createBrief({
      status: 'stub',
      quizQuestionsEasy:   fakeIds(5),
    });

    const res = await request(app).get('/api/briefs/public-stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalBriefs).toBe(2);
    expect(res.body.data.totalQuestions).toBe(3 + 2 + 1 + 4);
  });
});

// ── Guest brief access (GET /api/briefs/:id) ──────────────────────────────
// Guests share the free-tier category list — there is no separate guest gate
// on brief reading. Guests are blocked at game endpoints (quiz, BOO, etc.)
// instead.
describe('GET /api/briefs/:id — guest brief access', () => {
  beforeEach(async () => {
    await createSettings();
  });

  it('guest can read a brief in a free-tier category', async () => {
    const brief = await createBrief({ category: 'News' });
    const res   = await request(app).get(`/api/briefs/${brief._id}`);
    expect(res.status).toBe(200);
  });

  it('guest can read a brief in any category the free tier allows', async () => {
    // Aircrafts is in the default freeCategories list, so guests can read it too.
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app).get(`/api/briefs/${brief._id}`);
    expect(res.status).toBe(200);
  });

  it('guest is blocked from a brief in a category NOT in freeCategories', async () => {
    // Tighten freeCategories to ['News'] only — guests follow the same list.
    await createSettings({ freeCategories: ['News'] });
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app).get(`/api/briefs/${brief._id}`);
    expect(res.status).toBe(403);
  });

  it('authenticated free-tier user can read a News brief', async () => {
    const user   = await createUser({ subscriptionTier: 'free' });
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await createSettings({ freeCategories: ['News'] });
    const res = await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
  });
});

// ── GET /api/briefs — guest isLocked flags ────────────────────────────────
// isLocked for guests reflects the free-tier category list.
describe('GET /api/briefs — guest isLocked', () => {
  it('marks isLocked=false for briefs in free-tier categories', async () => {
    await createSettings();
    await createBrief({ category: 'News' });
    const res = await request(app).get('/api/briefs');
    expect(res.status).toBe(200);
    const brief = res.body.data.briefs.find(b => b.category === 'News');
    expect(brief.isLocked).toBe(false);
  });

  it('marks isLocked=true for briefs in categories outside freeCategories', async () => {
    await createSettings({ freeCategories: ['News'] });
    await createBrief({ category: 'Aircrafts' });
    const res = await request(app).get('/api/briefs');
    expect(res.status).toBe(200);
    const brief = res.body.data.briefs.find(b => b.category === 'Aircrafts');
    expect(brief.isLocked).toBe(true);
  });
});

// ── GET /api/briefs/category-stats ────────────────────────────────────────
describe('GET /api/briefs/category-stats', () => {
  it('returns per-category totals and done counts for logged-in user', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'News' });
    await createBrief({ category: 'News' }); // brief2 — not completed
    const cookie = authCookie(user._id);

    // Open and complete brief1 — only completed briefs count as "done"
    await openBrief(brief1._id, cookie);
    await request(app).post(`/api/briefs/${brief1._id}/complete`).set('Cookie', cookie);

    const res = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const stats = res.body.data.stats;
    expect(stats.News.total).toBe(2);
    expect(stats.News.done).toBe(1);
  });

  it('returns totals with done=0 when no briefs have been read', async () => {
    await createBrief({ category: 'News' });
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.stats.News.done).toBe(0);
  });

  it('returns 200 for guest (no cookie) with totals only', async () => {
    await createBrief({ category: 'News' });

    const res = await request(app).get('/api/briefs/category-stats');

    expect(res.status).toBe(200);
    expect(res.body.data.stats.News.total).toBe(1);
    expect(res.body.data.stats.News.done).toBe(0);
  });
});

// ── GET /api/health ────────────────────────────────────────────────────────
describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
