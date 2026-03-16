/**
 * Category briefs flow — tests the full user journey:
 *   1. Fetching briefs for a category (GET /api/briefs?category=...)
 *   2. Fetching the user's read/started brief IDs (GET /api/users/me/read-briefs)
 *   3. Opening a brief creates a "started" record (GET /api/briefs/:id)
 *   4. Completing a brief via POST /complete moves it from startedIds → briefIds
 *
 * Note: opening a brief does NOT count as "read" — only POST /complete does.
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

  it('opening a brief puts it in startedIds, not briefIds', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // Opening the brief via GET creates the read record (not yet completed)
    await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie);

    const res = await request(app)
      .get('/api/users/me/read-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefIds).not.toContain(brief._id.toString());
    expect(res.body.data.startedIds).toContain(brief._id.toString());
  });

  it('completing a brief moves it from startedIds into briefIds', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie);
    await request(app).post(`/api/briefs/${brief._id}/complete`).set('Cookie', cookie);

    const res = await request(app)
      .get('/api/users/me/read-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefIds).toContain(brief._id.toString());
    expect(res.body.data.startedIds).not.toContain(brief._id.toString());
  });

  it('opening multiple briefs puts them all in startedIds', async () => {
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
    const { briefIds, startedIds } = res.body.data;
    // Neither has been completed — both in startedIds, none in briefIds
    expect(startedIds).toContain(brief1._id.toString());
    expect(startedIds).toContain(brief2._id.toString());
    expect(startedIds).not.toContain(brief3._id.toString());
    expect(briefIds).not.toContain(brief1._id.toString());
    expect(briefIds).not.toContain(brief2._id.toString());
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
  it('opening a brief sets isStarted on the list endpoint, not isRead', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'Aircrafts', title: 'Typhoon Brief' });
    const brief2 = await createBrief({ category: 'Aircrafts', title: 'F-35 Brief' });
    await createBrief({ category: 'Bases', title: 'Brize Norton' }); // different category
    const cookie = authCookie(user._id);

    // Open brief1 but do NOT complete it
    await request(app).get(`/api/briefs/${brief1._id}`).set('Cookie', cookie);

    const [briefsRes, readRes] = await Promise.all([
      request(app).get('/api/briefs?category=Aircrafts&limit=200').set('Cookie', cookie),
      request(app).get('/api/users/me/read-briefs').set('Cookie', cookie),
    ]);

    expect(briefsRes.status).toBe(200);
    expect(readRes.status).toBe(200);

    const briefs     = briefsRes.body.data.briefs;
    const readIds    = new Set(readRes.body.data.briefIds);
    const startedIds = new Set(readRes.body.data.startedIds);

    expect(briefs.length).toBe(2);
    expect(briefs.every(b => b.category === 'Aircrafts')).toBe(true);

    const b1 = briefs.find(b => b._id === brief1._id.toString());
    const b2 = briefs.find(b => b._id === brief2._id.toString());

    // Opened but not completed — isStarted true, isRead false
    expect(b1.isRead).toBe(false);
    expect(b1.isStarted).toBe(true);
    expect(b2.isRead).toBe(false);
    expect(b2.isStarted).toBe(false);

    expect(startedIds.has(brief1._id.toString())).toBe(true);
    expect(readIds.has(brief1._id.toString())).toBe(false);
    expect(readIds.has(brief2._id.toString())).toBe(false);
  });

  it('completing a brief makes isRead true and isStarted false on the list endpoint', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'Aircrafts', title: 'Typhoon Brief' });
    const cookie = authCookie(user._id);

    await request(app).get(`/api/briefs/${brief1._id}`).set('Cookie', cookie);
    await request(app).post(`/api/briefs/${brief1._id}/complete`).set('Cookie', cookie);

    const briefsRes = await request(app)
      .get('/api/briefs?category=Aircrafts&limit=200')
      .set('Cookie', cookie);

    const b1 = briefsRes.body.data.briefs.find(b => b._id === brief1._id.toString());
    expect(b1.isRead).toBe(true);
    expect(b1.isStarted).toBe(false);
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
  it('opening a brief does NOT increment category progress', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    let statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(0);
    expect(statsRes.body.data.stats.News.total).toBe(1);

    // Open the brief (does not complete it)
    await request(app).get(`/api/briefs/${brief1._id}`).set('Cookie', cookie);

    statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    // Still 0 — must click Complete Brief first
    expect(statsRes.body.data.stats.News.done).toBe(0);
  });

  it('progress updates correctly only after completing briefs', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'News' });
    const brief2 = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // Initially 0 completed
    let statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(0);
    expect(statsRes.body.data.stats.News.total).toBe(2);

    // Open + complete brief1
    await request(app).get(`/api/briefs/${brief1._id}`).set('Cookie', cookie);
    await request(app).post(`/api/briefs/${brief1._id}/complete`).set('Cookie', cookie);

    statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(1);

    // Open + complete brief2
    await request(app).get(`/api/briefs/${brief2._id}`).set('Cookie', cookie);
    await request(app).post(`/api/briefs/${brief2._id}/complete`).set('Cookie', cookie);

    statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(2);
  });

  it('completing the same brief twice does not double-count progress', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie);
    await request(app).post(`/api/briefs/${brief._id}/complete`).set('Cookie', cookie);
    await request(app).post(`/api/briefs/${brief._id}/complete`).set('Cookie', cookie); // repeat

    const statsRes = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);
    expect(statsRes.body.data.stats.News.done).toBe(1); // still 1
  });
});
