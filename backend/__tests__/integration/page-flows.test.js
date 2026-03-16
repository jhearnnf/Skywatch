/**
 * Page action flows — API integration tests covering the user actions
 * triggered by clicking buttons on each page:
 *
 *  Home page:       loads latest briefs, category stats
 *  Learn page:      loads category counts, category stats
 *  Category page:   loads briefs for category, loads read-brief IDs
 *  Brief page:      opens a brief (tracks read, awards coins)
 *  Quiz page:       start → answer questions → finish
 *  Profile page:    view stats, change difficulty
 *  Rankings page:   leaderboard, user levels
 *  Report page:     submit a problem report
 *  Login page:      register, log in, log out
 *  Auth guard:      protected endpoints reject unauthenticated users
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createBrief, createSettings,
  createGameType, createQuizQuestions, authCookie,
} = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── Home page loads ───────────────────────────────────────────────────────
describe('Home page API calls', () => {
  it('GET /api/briefs?limit=4 — loads latest briefs strip', async () => {
    await createBrief({ title: 'A' });
    await createBrief({ title: 'B' });

    const res = await request(app).get('/api/briefs?limit=4');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.briefs)).toBe(true);
    expect(res.body.data.briefs.length).toBeLessThanOrEqual(4);
  });

  it('GET /api/briefs/category-stats — loads subject area progress (logged in)', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);
    await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie);

    const res = await request(app)
      .get('/api/briefs/category-stats')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.stats).toBeDefined();
  });

  it('GET /api/briefs/category-stats — works for guest (no cookie)', async () => {
    const res = await request(app).get('/api/briefs/category-stats');
    expect(res.status).toBe(200);
  });
});

// ── Learn page loads ──────────────────────────────────────────────────────
describe('Learn page API calls', () => {
  it('GET /api/briefs/category-counts — loads brief counts per category', async () => {
    await createBrief({ category: 'News' });
    await createBrief({ category: 'Aircrafts' });

    const res = await request(app).get('/api/briefs/category-counts');

    expect(res.status).toBe(200);
    expect(res.body.data.counts).toBeDefined();
  });
});

// ── Category page (CategoryBriefs) button interactions ────────────────────
describe('Category page API calls', () => {
  it('loads briefs for a category with limit=200', async () => {
    await createBrief({ category: 'Aircrafts', title: 'Typhoon' });
    await createBrief({ category: 'Aircrafts', title: 'F-35' });
    await createBrief({ category: 'News', title: 'Other' });

    const res = await request(app).get('/api/briefs?category=Aircrafts&limit=200');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(2);
    expect(res.body.data.briefs.every(b => b.category === 'Aircrafts')).toBe(true);
  });

  it('"Back" button — navigates to /learn (route resolves as category list)', async () => {
    // Simulated by the category-counts endpoint that Learn page loads
    const res = await request(app).get('/api/briefs/category-counts');
    expect(res.status).toBe(200);
  });

  it('search filter — returns only matching briefs within category', async () => {
    await createBrief({ category: 'Aircrafts', title: 'Typhoon Deep Dive' });
    await createBrief({ category: 'Aircrafts', title: 'F-35 Overview' });

    const res = await request(app).get('/api/briefs?category=Aircrafts&search=Typhoon&limit=200');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(1);
    expect(res.body.data.briefs[0].title).toBe('Typhoon Deep Dive');
  });

  it('clicking a brief — GET /api/briefs/:id tracks read (no coins on open)', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.brief._id).toBe(brief._id.toString());
    // Coins are deferred to POST /complete, not awarded on open
    expect(res.body.data.aircoinsEarned).toBeUndefined();
  });

  it('opening a brief puts it in startedIds (not briefIds) on read-briefs list', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'Aircrafts' });
    const cookie = authCookie(user._id);

    await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', cookie);

    const res = await request(app)
      .get('/api/users/me/read-briefs')
      .set('Cookie', cookie);

    // Not completed yet — in startedIds only
    expect(res.body.data.startedIds).toContain(brief._id.toString());
    expect(res.body.data.briefIds).not.toContain(brief._id.toString());
  });
});

// ── Brief reader page button interactions ─────────────────────────────────
describe('Brief reader page API calls', () => {
  it('"Take the quiz" — quiz status loads for the brief', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/games/quiz/status/${brief._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(false);
  });

  it('"Take the quiz" returns hasCompleted=true after finishing the quiz', async () => {
    const user        = await createUser();
    const brief       = await createBrief({ category: 'News' });
    const gameType    = await createGameType();
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const cookie = authCookie(user._id);

    // Start quiz
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });

    const { attemptId, gameSessionId, questions } = startRes.body.data;

    // Answer all questions
    for (const q of questions) {
      await request(app)
        .post('/api/games/quiz/result')
        .set('Cookie', cookie)
        .send({ attemptId, gameSessionId, questionId: q._id, selectedAnswerId: q.correctAnswerId });
    }

    // Finish
    await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    // Check status
    const statusRes = await request(app)
      .get(`/api/games/quiz/status/${brief._id}`)
      .set('Cookie', cookie);

    expect(statusRes.body.data.hasCompleted).toBe(true);
  });
});

// ── Profile page button interactions ─────────────────────────────────────
describe('Profile page API calls', () => {
  it('loads user stats', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/users/stats')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.totalAircoins).toBeDefined();
    expect(res.body.data.brifsRead).toBeDefined();
  });

  it('"Standard" difficulty button — PATCH /api/users/me/difficulty to easy', async () => {
    const user   = await createUser({ difficultySetting: 'medium' });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/difficulty')
      .set('Cookie', cookie)
      .send({ difficulty: 'easy' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.difficultySetting).toBe('easy');
  });

  it('"Advanced" difficulty button — PATCH /api/users/me/difficulty to medium', async () => {
    const user   = await createUser({ difficultySetting: 'easy' });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/difficulty')
      .set('Cookie', cookie)
      .send({ difficulty: 'medium' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.difficultySetting).toBe('medium');
  });

  it('invalid difficulty value returns 400', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/difficulty')
      .set('Cookie', cookie)
      .send({ difficulty: 'god_mode' });

    expect(res.status).toBe(400);
  });

  it('loads user level data (levels list)', async () => {
    const res = await request(app).get('/api/users/levels');
    expect(res.status).toBe(200);
  });

  it('loads RAF ranks list', async () => {
    const res = await request(app).get('/api/users/ranks');
    expect(res.status).toBe(200);
  });
});

// ── Rankings page button interactions ─────────────────────────────────────
describe('Rankings page API calls', () => {
  it('leaderboard loads with agents ordered by totalAircoins', async () => {
    await createUser({ email: 'rich@test.com',  totalAircoins: 999 });
    await createUser({ email: 'poor@test.com',  totalAircoins: 1   });

    const res = await request(app).get('/api/users/leaderboard');

    expect(res.status).toBe(200);
    const agents = res.body.data.agents;
    expect(agents.length).toBeGreaterThan(0);
    if (agents.length >= 2) {
      expect(agents[0].totalAircoins).toBeGreaterThanOrEqual(agents[1].totalAircoins);
    }
  });

  it('leaderboard is public — no auth required', async () => {
    const res = await request(app).get('/api/users/leaderboard');
    expect(res.status).toBe(200);
  });

  it('leaderboard does not expose passwords', async () => {
    await createUser({ email: 'secret@test.com', password: 'Password123' });
    const res = await request(app).get('/api/users/leaderboard');
    res.body.data.agents.forEach(a => {
      expect(a.password).toBeUndefined();
      expect(a.googleId).toBeUndefined();
    });
  });
});

// ── Report Problem page button interactions ───────────────────────────────
describe('Report Problem page API calls', () => {
  it('"Submit" button — POST /api/users/report-problem', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', cookie)
      .send({ pageReported: '/learn/Aircrafts', description: 'Brief list is empty' });

    expect(res.status).toBe(201);
    expect(res.body.data.report.description).toBe('Brief list is empty');
  });

  it('returns 400 if description is missing', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', cookie)
      .send({ pageReported: '/learn' });

    expect(res.status).toBe(400);
  });

  it('returns 401 if not logged in', async () => {
    const res = await request(app)
      .post('/api/users/report-problem')
      .send({ pageReported: '/learn', description: 'Bug' });

    expect(res.status).toBe(401);
  });
});

// ── Login / Register page button interactions ─────────────────────────────
describe('Login page API calls', () => {
  it('"Create Account" button — POST /api/auth/register', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'newagent@raf.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('newagent@raf.com');
  });

  it('"Sign In" button — POST /api/auth/login', async () => {
    await createUser({ email: 'agent@raf.com', password: 'Password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'agent@raf.com', password: 'Password123' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('agent@raf.com');
  });

  it('"Sign In" with wrong password returns 401', async () => {
    await createUser({ email: 'agent@raf.com', password: 'Password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'agent@raf.com', password: 'WrongPass99' });

    expect(res.status).toBe(401);
  });

  it('"Sign out" button — POST /api/auth/logout clears cookie', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    // Cookie should be cleared (Set-Cookie header empties the jwt)
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(/jwt=/);
  });

  it('GET /api/auth/me — returns current user when authenticated', async () => {
    const user   = await createUser({ email: 'me@raf.com' });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('me@raf.com');
  });

  it('GET /api/auth/me — returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ── Play page (game selection) ────────────────────────────────────────────
describe('Play page API calls', () => {
  it('quiz "Start" button — POST /api/games/quiz/start (5 questions returned)', async () => {
    const user     = await createUser();
    const brief    = await createBrief({ category: 'News' });
    const gameType = await createGameType();
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const cookie = authCookie(user._id);

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });

    expect(res.status).toBe(200);
    expect(res.body.data.questions.length).toBe(5);
    expect(res.body.data.attemptId).toBeDefined();
  });

  it('quiz "Start" returns 400 when brief has fewer than 5 questions', async () => {
    const user     = await createUser();
    const brief    = await createBrief({ category: 'News' });
    const gameType = await createGameType();
    await createQuizQuestions(brief._id, gameType._id, 3, 'easy');
    const cookie = authCookie(user._id);

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });

    expect(res.status).toBe(400);
  });

  it('quiz "Quit" — POST /api/games/quiz/attempt/:id/finish with status=abandoned', async () => {
    const user     = await createUser();
    const brief    = await createBrief({ category: 'News' });
    const gameType = await createGameType();
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const cookie = authCookie(user._id);

    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });

    const { attemptId } = startRes.body.data;

    const res = await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'abandoned' });

    expect(res.status).toBe(200);
    expect(res.body.data.aircoinsEarned).toBe(0);
  });
});

// ── Auth guard — protected routes reject unauthenticated requests ──────────
describe('Auth guard — protected endpoints', () => {
  const protectedRoutes = [
    { method: 'get',   path: '/api/users/stats' },
    { method: 'get',   path: '/api/users/me/read-briefs' },
    { method: 'get',   path: '/api/users/aircoins/history' },
    { method: 'patch', path: '/api/users/me/difficulty', body: { difficulty: 'easy' } },
    { method: 'post',  path: '/api/users/report-problem', body: { description: 'x' } },
    { method: 'post',  path: '/api/games/quiz/start', body: { briefId: '000000000000000000000001' } },
  ];

  protectedRoutes.forEach(({ method, path, body }) => {
    it(`${method.toUpperCase()} ${path} returns 401 without cookie`, async () => {
      let req = request(app)[method](path);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(401);
    });
  });
});
