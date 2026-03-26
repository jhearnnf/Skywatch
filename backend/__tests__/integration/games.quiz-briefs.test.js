/**
 * GET /api/games/quiz/briefs — paginated brief list with server-computed quizState
 *
 * Covers:
 *   Auth guard
 *   state=available: only playable briefs not yet passed, annotated active/needs-read
 *   state=completed: only passed briefs (even if questions later removed)
 *   state=all:       all playable briefs
 *   search filter
 *   pagination (page/limit/totalPages/total)
 *   availableMode in available response
 *   quizState field on each brief
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser, createBrief, createQuizQuestions,
  createGameType, createSettings, authCookie,
  createReadRecord, createPassedQuizAttempt,
} = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  await createGameType();
});
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── helpers ──────────────────────────────────────────────────────────────────

async function setupPlayableBrief(overrides = {}) {
  const gt    = await createGameType();
  const brief = await createBrief({ category: 'News', ...overrides });
  await createQuizQuestions(brief._id, gt._id, 5, 'easy');
  return brief;
}

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('GET /api/games/quiz/briefs — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/games/quiz/briefs');
    expect(res.status).toBe(401);
  });
});

// ── state=available ───────────────────────────────────────────────────────────

describe('GET /api/games/quiz/briefs?state=available', () => {
  it('returns only playable briefs the user has not yet passed', async () => {
    const user   = await createUser();
    const brief1 = await setupPlayableBrief({ title: 'Unpassed Brief' });
    const brief2 = await setupPlayableBrief({ title: 'Passed Brief' });
    await createPassedQuizAttempt(user._id, brief2._id);

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toContain('Unpassed Brief');
    expect(titles).not.toContain('Passed Brief');
  });

  it('annotates brief as active when user has read it', async () => {
    const user  = await createUser();
    const brief = await setupPlayableBrief();
    await createReadRecord(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const b = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(b.quizState).toBe('active');
  });

  it('annotates brief as needs-read when user has not read it', async () => {
    const user  = await createUser();
    const brief = await setupPlayableBrief();

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const b = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(b.quizState).toBe('needs-read');
  });

  it('returns availableMode=active when any brief is read and available', async () => {
    const user  = await createUser();
    const brief = await setupPlayableBrief();
    await createReadRecord(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.availableMode).toBe('active');
  });

  it('returns availableMode=needs-read when no briefs are read yet', async () => {
    const user = await createUser();
    await setupPlayableBrief();

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.availableMode).toBe('needs-read');
  });

  it('returns availableMode=all-passed when all playable briefs are passed', async () => {
    const user  = await createUser();
    const brief = await setupPlayableBrief();
    await createPassedQuizAttempt(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    // No available briefs left — list is empty and availableMode signals all passed
    expect(res.body.data.briefs).toHaveLength(0);
    expect(res.body.data.availableMode).toBe('all-passed');
  });

  it('returns empty list when no briefs have questions', async () => {
    const user = await createUser();
    await createBrief({ category: 'News' }); // no questions

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });
});

// ── state=completed ───────────────────────────────────────────────────────────

describe('GET /api/games/quiz/briefs?state=completed', () => {
  it('returns only briefs the user has passed', async () => {
    const user   = await createUser();
    const brief1 = await setupPlayableBrief({ title: 'Passed' });
    const brief2 = await setupPlayableBrief({ title: 'Not Passed' });
    await createPassedQuizAttempt(user._id, brief1._id);

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=completed')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toContain('Passed');
    expect(titles).not.toContain('Not Passed');
  });

  it('annotates all returned briefs with quizState=passed', async () => {
    const user  = await createUser();
    const brief = await setupPlayableBrief();
    await createPassedQuizAttempt(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=completed')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.briefs.every(b => b.quizState === 'passed')).toBe(true);
  });

  it('returns empty list when user has not passed any quizzes', async () => {
    const user = await createUser();
    await setupPlayableBrief();

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=completed')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.briefs).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  it('does not return availableMode (only relevant for available tab)', async () => {
    const user  = await createUser();
    const brief = await setupPlayableBrief();
    await createPassedQuizAttempt(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=completed')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.availableMode).toBeNull();
  });
});

// ── state=all ─────────────────────────────────────────────────────────────────

describe('GET /api/games/quiz/briefs?state=all', () => {
  it('returns all playable briefs regardless of pass state', async () => {
    const user   = await createUser();
    const brief1 = await setupPlayableBrief({ title: 'Passed' });
    const brief2 = await setupPlayableBrief({ title: 'Not Passed' });
    await createPassedQuizAttempt(user._id, brief1._id);

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toContain('Passed');
    expect(titles).toContain('Not Passed');
  });

  it('excludes briefs with fewer than 5 questions', async () => {
    const user  = await createUser();
    const gt    = await createGameType();
    const brief = await createBrief({ title: 'Too Few Questions', category: 'News' });
    await createQuizQuestions(brief._id, gt._id, 3, 'easy'); // only 3

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).not.toContain('Too Few Questions');
  });
});

// ── search ────────────────────────────────────────────────────────────────────

describe('GET /api/games/quiz/briefs — search', () => {
  it('filters by title (case-insensitive)', async () => {
    const user = await createUser();
    await setupPlayableBrief({ title: 'Typhoon Aircraft', category: 'News' });
    await setupPlayableBrief({ title: 'RAF Bases',        category: 'News' });

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=all&search=typhoon')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(1);
    expect(res.body.data.briefs[0].title).toBe('Typhoon Aircraft');
  });

  it('returns empty list when search matches nothing', async () => {
    const user = await createUser();
    await setupPlayableBrief({ title: 'Typhoon' });

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=all&search=xyzzy')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.briefs).toHaveLength(0);
  });
});

// ── pagination ────────────────────────────────────────────────────────────────

describe('GET /api/games/quiz/briefs — pagination', () => {
  it('returns correct page size', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) await setupPlayableBrief({ title: `Brief ${i}` });

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=all&limit=2&page=1')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(2);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.totalPages).toBe(3);
    expect(res.body.data.page).toBe(1);
  });

  it('returns the second page correctly', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) await setupPlayableBrief({ title: `Brief ${i}` });

    const page1 = await request(app)
      .get('/api/games/quiz/briefs?state=all&limit=2&page=1')
      .set('Cookie', authCookie(user._id));
    const page2 = await request(app)
      .get('/api/games/quiz/briefs?state=all&limit=2&page=2')
      .set('Cookie', authCookie(user._id));

    const ids1 = page1.body.data.briefs.map(b => b._id);
    const ids2 = page2.body.data.briefs.map(b => b._id);
    // No overlap between pages
    expect(ids1.filter(id => ids2.includes(id))).toHaveLength(0);
  });

  it('clamps limit to 50', async () => {
    const user = await createUser();
    for (let i = 0; i < 3; i++) await setupPlayableBrief();

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=all&limit=999')
      .set('Cookie', authCookie(user._id));

    // Should not throw; returns at most 50
    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBeLessThanOrEqual(50);
  });

  it('each brief has the required fields', async () => {
    const user = await createUser();
    await setupPlayableBrief();

    const res = await request(app)
      .get('/api/games/quiz/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const brief = res.body.data.briefs[0];
    expect(brief).toHaveProperty('_id');
    expect(brief).toHaveProperty('title');
    expect(brief).toHaveProperty('category');
    expect(brief).toHaveProperty('quizState');
  });
});
