/**
 * GET /api/games/battle-of-order/briefs — paginated BOO brief list with server-computed booState
 *
 * Covers:
 *   Auth guard
 *   state=available: BOO-category briefs not yet won
 *   state=completed: briefs the user has won a BOO game for
 *   state=all:       all BOO-category briefs
 *   booState annotation: active | needs-quiz | needs-read | no-data | completed
 *   search filter
 *   pagination
 */
process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const {
  createUser, createBrief, createQuizQuestions,
  createGameType, createSettings, authCookie,
  createBooBriefs, createReadRecord, createPassedQuizAttempt, createWonBooResult,
} = require('../helpers/factories');
const IntelligenceBrief = require('../../models/IntelligenceBrief');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  await createGameType();
});
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── helpers ──────────────────────────────────────────────────────────────────

// Creates a single Aircrafts brief with topSpeedKph game data
async function createBooBrief(overrides = {}) {
  return IntelligenceBrief.create({
    title:               overrides.title ?? `BOO Brief ${Date.now()}`,
    subtitle:            '',
    category:            'Aircrafts',
    descriptionSections: ['Section.'],
    keywords:            [],
    sources:             [],
    isPublished:         true,
    gameData:            { topSpeedKph: 1000, ...(overrides.gameData ?? {}) },
    ...overrides,
  });
}

// Creates 3 aircraft briefs with game data + read records for userId.
// Satisfies the 3-brief count gate AND the aircraft-reads threshold gate.
async function ensureBooReady(userId) {
  for (let i = 0; i < 3; i++) {
    const b = await createBooBrief({ title: `Filler BOO ${Date.now()}_${i}` });
    await createReadRecord(userId, b._id);
  }
}

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('GET /api/games/battle-of-order/briefs — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/games/battle-of-order/briefs');
    expect(res.status).toBe(401);
  });
});

// ── state=available ───────────────────────────────────────────────────────────

describe('GET /api/games/battle-of-order/briefs?state=available', () => {
  it('returns BOO-category briefs not yet won', async () => {
    const user   = await createUser();
    await ensureBooReady(user._id);
    const brief1 = await createBooBrief({ title: 'Not Won' });
    const brief2 = await createBooBrief({ title: 'Won' });
    await createWonBooResult(user._id, brief2._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toContain('Not Won');
    expect(titles).not.toContain('Won');
  });

  it('only includes BOO-eligible categories', async () => {
    const user = await createUser();
    await createBooBrief({ title: 'Aircraft Brief', category: 'Aircrafts' });
    await createBrief({ title: 'News Brief', category: 'News' });

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=available')
      .set('Cookie', authCookie(user._id));

    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).not.toContain('News Brief');
  });
});

// ── state=completed ───────────────────────────────────────────────────────────

describe('GET /api/games/battle-of-order/briefs?state=completed', () => {
  it('returns only briefs the user has won a BOO game for', async () => {
    const user   = await createUser();
    await ensureBooReady(user._id);
    const brief1 = await createBooBrief({ title: 'Won' });
    const brief2 = await createBooBrief({ title: 'Not Won' });
    await createWonBooResult(user._id, brief1._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=completed')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toContain('Won');
    expect(titles).not.toContain('Not Won');
  });

  it('returns empty list when user has no BOO wins', async () => {
    const user = await createUser();
    await createBooBrief();

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=completed')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.briefs).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });
});

// ── state=all ─────────────────────────────────────────────────────────────────

describe('GET /api/games/battle-of-order/briefs?state=all', () => {
  it('returns all BOO-category briefs regardless of win state', async () => {
    const user   = await createUser();
    const brief1 = await createBooBrief({ title: 'Won' });
    const brief2 = await createBooBrief({ title: 'Not Won' });
    await createWonBooResult(user._id, brief1._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toContain('Won');
    expect(titles).toContain('Not Won');
  });
});

// ── booState annotation ───────────────────────────────────────────────────────

describe('GET /api/games/battle-of-order/briefs — booState', () => {
  it('returns booState=needs-read when brief not yet read', async () => {
    const user  = await createUser();
    await ensureBooReady(user._id);
    const brief = await createBooBrief({ title: 'Target Brief' });

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const b = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(b.booState).toBe('needs-read');
  });

  it('returns booState=quiz-pending when read but quiz not yet playable', async () => {
    const user  = await createUser();
    await ensureBooReady(user._id);
    const brief = await createBooBrief({ title: 'Target Brief' });
    await createReadRecord(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const b = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(b.booState).toBe('quiz-pending');
  });

  it('returns booState=active when read + quiz passed + BOO not won', async () => {
    const user  = await createUser();
    await ensureBooReady(user._id);
    const brief = await createBooBrief({ title: 'Target Brief' });
    await createReadRecord(user._id, brief._id);
    await createPassedQuizAttempt(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const b = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(b.booState).toBe('active');
  });

  it('returns booState=completed when BOO won', async () => {
    const user  = await createUser();
    await ensureBooReady(user._id);
    const brief = await createBooBrief();
    await createWonBooResult(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const b = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(b.booState).toBe('completed');
  });

  it('returns booState=no-data for a BOO-category brief with no game data', async () => {
    const user  = await createUser();
    // Create 3 aircraft briefs without game data + reads to satisfy the aircraft-reads gate
    // (no topSpeedKph so they don't make Aircrafts BOO-eligible)
    for (let i = 0; i < 3; i++) {
      const filler = await IntelligenceBrief.create({
        title: `No-Data Filler ${Date.now()}_${i}`, subtitle: '',
        category: 'Aircrafts', descriptionSections: ['Section.'],
        keywords: [], sources: [], isPublished: true, gameData: {},
      });
      await createReadRecord(user._id, filler._id);
    }
    // Brief in a BOO category but no gameData.topSpeedKph
    const brief = await IntelligenceBrief.create({
      title:               'No Game Data',
      subtitle:            '',
      category:            'Aircrafts',
      descriptionSections: ['Section.'],
      keywords:            [],
      sources:             [],
      isPublished:         true,
      gameData:            {},
    });

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const b = res.body.data.briefs.find(b => b._id === brief._id.toString());
    expect(b.booState).toBe('no-data');
  });

  it('each brief has the required fields', async () => {
    const user = await createUser();
    await createBooBrief();

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all')
      .set('Cookie', authCookie(user._id));

    const brief = res.body.data.briefs[0];
    expect(brief).toHaveProperty('_id');
    expect(brief).toHaveProperty('title');
    expect(brief).toHaveProperty('category');
    expect(brief).toHaveProperty('booState');
  });
});

// ── search ────────────────────────────────────────────────────────────────────

describe('GET /api/games/battle-of-order/briefs — search', () => {
  it('filters by title (case-insensitive)', async () => {
    const user = await createUser();
    await createBooBrief({ title: 'Typhoon Speed' });
    await createBooBrief({ title: 'Tornado Rank' });

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all&search=typhoon')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.briefs).toHaveLength(1);
    expect(res.body.data.briefs[0].title).toBe('Typhoon Speed');
  });
});

// ── pagination ────────────────────────────────────────────────────────────────

describe('GET /api/games/battle-of-order/briefs — pagination', () => {
  it('returns correct page size and total', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) await createBooBrief({ title: `BOO ${i}` });

    const res = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all&limit=2&page=1')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(2);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.totalPages).toBe(3);
  });

  it('second page contains different briefs from first page', async () => {
    const user = await createUser();
    for (let i = 0; i < 4; i++) await createBooBrief({ title: `BOO ${i}` });

    const page1 = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all&limit=2&page=1')
      .set('Cookie', authCookie(user._id));
    const page2 = await request(app)
      .get('/api/games/battle-of-order/briefs?state=all&limit=2&page=2')
      .set('Cookie', authCookie(user._id));

    const ids1 = page1.body.data.briefs.map(b => b._id);
    const ids2 = page2.body.data.briefs.map(b => b._id);
    expect(ids1.filter(id => ids2.includes(id))).toHaveLength(0);
  });
});
