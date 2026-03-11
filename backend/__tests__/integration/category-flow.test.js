/**
 * Category briefs flow — tests the full user journey:
 *   1. Fetching briefs for a category (GET /api/briefs?category=...)
 *   2. Fetching the user's read brief IDs (GET /api/users/me/read-briefs)
 *   3. Opening a brief and tracking the read (GET /api/briefs/:id)
 *   4. The read-briefs list updates correctly after opening
 *
 * This reproduces the bug where /api/users/me/read-briefs was missing,
 * causing Promise.all in CategoryBriefs.jsx to reject entirely and
 * show no briefs at all.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createBrief, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── GET /api/users/me/read-briefs ─────────────────────────────────────────
describe('GET /api/users/me/read-briefs', () => {
  it('returns empty array when user has read nothing', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/users/me/read-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.briefIds).toEqual([]);
  });

  it('returns brief id after the user opens a brief', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // Opening the brief via GET creates the read record
    await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie);

    const res = await request(app)
      .get('/api/users/me/read-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefIds).toContain(brief._id.toString());
  });

  it('returns multiple brief ids after reading several briefs', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'News' });
    const brief2 = await createBrief({ category: 'Aircrafts' });
    const brief3 = await createBrief({ category: 'Bases' });
    const cookie = authCookie(user._id);

    await request(app).get(`/api/briefs/${brief1._id}`).set('Cookie', cookie);
    await request(app).get(`/api/briefs/${brief2._id}`).set('Cookie', cookie);

    const res = await request(app)
      .get('/api/users/me/read-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const ids = res.body.data.briefIds;
    expect(ids).toContain(brief1._id.toString());
    expect(ids).toContain(brief2._id.toString());
    expect(ids).not.toContain(brief3._id.toString());
  });

  it('does not include briefs read by other users', async () => {
    const userA  = await createUser({ email: 'a@test.com' });
    const userB  = await createUser({ email: 'b@test.com' });
    const brief  = await createBrief({ category: 'News' });

    // User A reads the brief
    await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(userA._id));

    // User B should not see it in their read list
    const res = await request(app)
      .get('/api/users/me/read-briefs')
      .set('Cookie', authCookie(userB._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefIds).not.toContain(brief._id.toString());
  });

  it('returns 401 if not authenticated', async () => {
    const res = await request(app).get('/api/users/me/read-briefs');
    expect(res.status).toBe(401);
  });
});

// ── Full category page flow ───────────────────────────────────────────────
describe('Category briefs page — full flow (GET /api/briefs?category + GET /api/users/me/read-briefs)', () => {
  it('both requests succeed and return consistent data for a logged-in user', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'Aircrafts', title: 'Typhoon Brief' });
    const brief2 = await createBrief({ category: 'Aircrafts', title: 'F-35 Brief' });
    await createBrief({ category: 'Bases', title: 'Brize Norton' }); // different category
    const cookie = authCookie(user._id);

    // Simulate opening brief1 (like a user clicking it from a previous visit)
    await request(app).get(`/api/briefs/${brief1._id}`).set('Cookie', cookie);

    // Simulate what CategoryBriefs.jsx does — Promise.all of both endpoints
    const [briefsRes, readRes] = await Promise.all([
      request(app).get('/api/briefs?category=Aircrafts&limit=200').set('Cookie', cookie),
      request(app).get('/api/users/me/read-briefs').set('Cookie', cookie),
    ]);

    expect(briefsRes.status).toBe(200);
    expect(readRes.status).toBe(200);

    const briefs  = briefsRes.body.data.briefs;
    const readIds = new Set(readRes.body.data.briefIds);

    // Only Aircrafts category briefs returned
    expect(briefs.length).toBe(2);
    expect(briefs.every(b => b.category === 'Aircrafts')).toBe(true);

    // isRead flag is set on brief1 via the API's own isRead field
    const b1 = briefs.find(b => b._id === brief1._id.toString());
    const b2 = briefs.find(b => b._id === brief2._id.toString());
    expect(b1.isRead).toBe(true);
    expect(b2.isRead).toBe(false);

    // The read-briefs list matches
    expect(readIds.has(brief1._id.toString())).toBe(true);
    expect(readIds.has(brief2._id.toString())).toBe(false);
  });

  it('both requests return 200 even when no briefs exist for the category', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const [briefsRes, readRes] = await Promise.all([
      request(app).get('/api/briefs?category=Aircrafts&limit=200').set('Cookie', cookie),
      request(app).get('/api/users/me/read-briefs').set('Cookie', cookie),
    ]);

    expect(briefsRes.status).toBe(200);
    expect(readRes.status).toBe(200);
    expect(briefsRes.body.data.briefs).toEqual([]);
    expect(readRes.body.data.briefIds).toEqual([]);
  });

  it('briefs endpoint works for guests (no cookie), read-briefs requires auth', async () => {
    await createBrief({ category: 'Aircrafts' });

    const briefsRes = await request(app).get('/api/briefs?category=Aircrafts&limit=200');
    const readRes   = await request(app).get('/api/users/me/read-briefs');

    expect(briefsRes.status).toBe(200);
    expect(briefsRes.body.data.briefs.length).toBe(1);
    expect(readRes.status).toBe(401); // guests must get 401, not 404
  });
});

// ── Back button / navigation flows ───────────────────────────────────────
describe('Category progress tracking — full read journey', () => {
  it('progress updates correctly as user reads more briefs in a category', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'News' });
    const brief2 = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // Initially 0 read
    let statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(0);
    expect(statsRes.body.data.stats.News.total).toBe(2);

    // Read brief1 (clicking it in the list)
    await request(app).get(`/api/briefs/${brief1._id}`).set('Cookie', cookie);

    statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(1);

    // Read brief2
    await request(app).get(`/api/briefs/${brief2._id}`).set('Cookie', cookie);

    statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(2);
  });

  it('reading the same brief twice does not double-count progress', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie);
    await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie); // click again

    const statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(1); // still 1, not 2
  });
});
