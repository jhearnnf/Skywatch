/**
 * NOTE: Read tracking in Skywatch works via GET /api/briefs/:id (authenticated).
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

  it('marks isRead=true for briefs the user has opened', async () => {
    const user  = await createUser();
    const brief = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // Opening a brief (GET /:id) is what creates the read record
    await openBrief(brief._id, cookie);

    const res = await request(app)
      .get('/api/briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const found = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(found?.isRead).toBe(true);
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
    expect(res.body.data.aircoinsEarned).toBeGreaterThan(0); // coins awarded on first read
  });

  it('does not award coins on repeated fetches of the same brief', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie); // first visit — coins awarded
    const res = await openBrief(brief._id, cookie); // second visit

    expect(res.status).toBe(200);
    expect(res.body.data.aircoinsEarned).toBe(0);
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
});

// ── GET /api/briefs/category-stats ────────────────────────────────────────
describe('GET /api/briefs/category-stats', () => {
  it('returns per-category totals and done counts for logged-in user', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'News' });
    await createBrief({ category: 'News' }); // brief2 — not read
    const cookie = authCookie(user._id);

    // Reading is tracked by fetching the brief
    await openBrief(brief1._id, cookie);

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
