/**
 * briefs.nextPathway.test.js
 *
 * Tests for GET /api/briefs/next-pathway-brief and the priority-ordered
 * GET /api/briefs/random-in-progress behaviour.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const Rank    = require('../../models/Rank');
const Level   = require('../../models/Level');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const {
  createSettings,
  createUser,
  createBrief,
  createReadRecord,
  authCookie,
} = require('../helpers/factories');

async function seedLevels() {
  await Level.insertMany([
    { levelNumber: 1,  airstarsToNextLevel: 100  },
    { levelNumber: 2,  airstarsToNextLevel: 250  },
    { levelNumber: 3,  airstarsToNextLevel: 500  },
    { levelNumber: 4,  airstarsToNextLevel: 850  },
    { levelNumber: 5,  airstarsToNextLevel: 1300 },
    { levelNumber: 6,  airstarsToNextLevel: 1850 },
    { levelNumber: 7,  airstarsToNextLevel: 2500 },
    { levelNumber: 8,  airstarsToNextLevel: 3250 },
    { levelNumber: 9,  airstarsToNextLevel: 4100 },
    { levelNumber: 10, airstarsToNextLevel: null },
  ]);
}

async function createRankDoc(rankNumber) {
  return Rank.create({
    rankType:         'enlisted_aviator',
    rankNumber,
    rankName:         `Rank ${rankNumber}`,
    rankAbbreviation: `R${rankNumber}`,
  });
}

async function makeUser() {
  const rank = await createRankDoc(1);
  return createUser({ subscriptionTier: 'gold', totalAirstars: 0, rank: rank._id });
}

beforeAll(async () => { await db.connect(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── next-pathway-brief ────────────────────────────────────────────────────────
describe('GET /api/briefs/next-pathway-brief', () => {
  beforeEach(async () => {
    await createSettings();
    await seedLevels();
  });

  it('returns the lowest-priority uncompleted brief within the chosen category', async () => {
    const user = await makeUser();
    // Priority 2 is the hole — 1, 3, 4 already completed
    const b1 = await createBrief({ category: 'News', title: 'News 1', priorityNumber: 1 });
    const b2 = await createBrief({ category: 'News', title: 'News 2', priorityNumber: 2 });
    const b3 = await createBrief({ category: 'News', title: 'News 3', priorityNumber: 3 });
    const b4 = await createBrief({ category: 'News', title: 'News 4', priorityNumber: 4 });
    await createReadRecord(user._id, b1._id, { completed: true });
    await createReadRecord(user._id, b3._id, { completed: true });
    await createReadRecord(user._id, b4._id, { completed: true });

    // Force category choice by making News the only accessible category with briefs
    const res = await request(app)
      .get('/api/briefs/next-pathway-brief')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(String(res.body.data.briefId)).toBe(String(b2._id));
  });

  it('returns priority 5 when priorities 1–4 are all completed', async () => {
    const user = await makeUser();
    const briefs = [];
    for (let p = 1; p <= 5; p++) {
      briefs.push(await createBrief({ category: 'News', title: `News ${p}`, priorityNumber: p }));
    }
    for (let i = 0; i < 4; i++) {
      await createReadRecord(user._id, briefs[i]._id, { completed: true });
    }

    const res = await request(app)
      .get('/api/briefs/next-pathway-brief')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(String(res.body.data.briefId)).toBe(String(briefs[4]._id));
  });

  it('excludes stub briefs', async () => {
    const user = await makeUser();
    await createBrief({ category: 'News', title: 'Stub 1', priorityNumber: 1, status: 'stub' });
    const pub = await createBrief({ category: 'News', title: 'Published', priorityNumber: 2, status: 'published' });

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(app)
        .get('/api/briefs/next-pathway-brief')
        .set('Cookie', authCookie(user._id));
      expect(res.status).toBe(200);
      expect(String(res.body.data.briefId)).toBe(String(pub._id));
    }
  });

  it('excludes briefs without descriptionSections', async () => {
    const user = await makeUser();
    await createBrief({ category: 'News', title: 'Empty', priorityNumber: 1, descriptionSections: [] });
    const full = await createBrief({ category: 'News', title: 'Full', priorityNumber: 2, descriptionSections: ['content'] });

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(app)
        .get('/api/briefs/next-pathway-brief')
        .set('Cookie', authCookie(user._id));
      expect(res.status).toBe(200);
      expect(String(res.body.data.briefId)).toBe(String(full._id));
    }
  });

  it('excludes pathway-locked categories', async () => {
    await createSettings({
      freeCategories:   ['News', 'Aircrafts'],
      silverCategories: ['News', 'Aircrafts'],
      pathwayUnlocks: [
        { category: 'News',      levelRequired: 1, rankRequired: 1 },
        { category: 'Aircrafts', levelRequired: 5, rankRequired: 1 }, // locked for our user
      ],
    });
    const rank = await createRankDoc(1);
    const user = await createUser({ subscriptionTier: 'free', totalAirstars: 0, rank: rank._id });

    await createBrief({ category: 'Aircrafts', title: 'AC 1', priorityNumber: 1 });
    const news = await createBrief({ category: 'News', title: 'News 1', priorityNumber: 1 });

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(app)
        .get('/api/briefs/next-pathway-brief')
        .set('Cookie', authCookie(user._id));
      expect(res.status).toBe(200);
      expect(String(res.body.data.briefId)).toBe(String(news._id));
      expect(res.body.data.category).toBe('News');
    }
  });

  it('excludes subscription-locked categories', async () => {
    await createSettings({
      freeCategories:   ['News'],
      silverCategories: ['News', 'Aircrafts'],
    });
    const rank = await createRankDoc(1);
    const user = await createUser({ subscriptionTier: 'free', totalAirstars: 0, rank: rank._id });

    await createBrief({ category: 'Aircrafts', title: 'AC 1', priorityNumber: 1 });
    const news = await createBrief({ category: 'News', title: 'News 1', priorityNumber: 1 });

    const res = await request(app)
      .get('/api/briefs/next-pathway-brief')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(String(res.body.data.briefId)).toBe(String(news._id));
  });

  it('returns 404 when every accessible brief is already completed', async () => {
    const user = await makeUser();
    const b1 = await createBrief({ category: 'News', title: 'News 1', priorityNumber: 1 });
    await createReadRecord(user._id, b1._id, { completed: true });

    const res = await request(app)
      .get('/api/briefs/next-pathway-brief')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(404);
  });

  it('skips in-progress briefs so Daily Mission does not duplicate Jump Back In', async () => {
    const user = await makeUser();
    const inProgress = await createBrief({ category: 'News', title: 'In Progress', priorityNumber: 1 });
    const unread     = await createBrief({ category: 'News', title: 'Unread',      priorityNumber: 2 });
    await createReadRecord(user._id, inProgress._id, { completed: false });

    const res = await request(app)
      .get('/api/briefs/next-pathway-brief')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(String(res.body.data.briefId)).toBe(String(unread._id));
  });

  it('returns 404 when every accessible brief is either completed or in-progress', async () => {
    const user = await makeUser();
    const b1 = await createBrief({ category: 'News', title: 'b1', priorityNumber: 1 });
    const b2 = await createBrief({ category: 'News', title: 'b2', priorityNumber: 2 });
    await createReadRecord(user._id, b1._id, { completed: true });
    await createReadRecord(user._id, b2._id, { completed: false });

    const res = await request(app)
      .get('/api/briefs/next-pathway-brief')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(404);
  });

  it('randomly picks among accessible categories, then selects lowest-priority within', async () => {
    const user = await makeUser();
    // Two categories, each with multiple priorities. After many attempts we should
    // see both categories chosen, and within each the lowest-priority brief is returned.
    const newsLowest = await createBrief({ category: 'News', title: 'News low', priorityNumber: 1 });
    await createBrief({ category: 'News', title: 'News hi', priorityNumber: 5 });
    const acLowest = await createBrief({ category: 'Aircrafts', title: 'AC low', priorityNumber: 1 });
    await createBrief({ category: 'Aircrafts', title: 'AC hi', priorityNumber: 7 });

    const seen = new Set();
    for (let attempt = 0; attempt < 30; attempt++) {
      const res = await request(app)
        .get('/api/briefs/next-pathway-brief')
        .set('Cookie', authCookie(user._id));
      expect(res.status).toBe(200);
      const returnedId = String(res.body.data.briefId);
      // Within whichever category was chosen, the lowest-priority brief must be returned
      expect([String(newsLowest._id), String(acLowest._id)]).toContain(returnedId);
      seen.add(returnedId);
    }
    // Over 30 attempts, both categories should have been picked at least once
    expect(seen.size).toBe(2);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/briefs/next-pathway-brief');
    expect(res.status).toBe(401);
  });
});

// ── random-in-progress priority ordering ──────────────────────────────────────
describe('GET /api/briefs/random-in-progress — priority ordering', () => {
  beforeEach(async () => {
    await createSettings();
    await seedLevels();
  });

  it('returns the in-progress brief with the lowest priorityNumber', async () => {
    const user = await makeUser();
    const b1 = await createBrief({ category: 'News', title: 'P1', priorityNumber: 1 });
    const b3 = await createBrief({ category: 'News', title: 'P3', priorityNumber: 3 });
    const b7 = await createBrief({ category: 'News', title: 'P7', priorityNumber: 7 });

    // Three in-progress reads; the endpoint should deterministically pick P1
    await createReadRecord(user._id, b7._id, { completed: false });
    await createReadRecord(user._id, b3._id, { completed: false });
    await createReadRecord(user._id, b1._id, { completed: false });

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(app)
        .get('/api/briefs/random-in-progress')
        .set('Cookie', authCookie(user._id));
      expect(res.status).toBe(200);
      expect(String(res.body.data.briefId)).toBe(String(b1._id));
    }
  });

  it('sorts null priorities last', async () => {
    const user = await makeUser();
    const bNull = await createBrief({ category: 'News', title: 'unranked', priorityNumber: null });
    const b5    = await createBrief({ category: 'News', title: 'P5',       priorityNumber: 5 });
    await createReadRecord(user._id, bNull._id, { completed: false });
    await createReadRecord(user._id, b5._id,    { completed: false });

    const res = await request(app)
      .get('/api/briefs/random-in-progress')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(String(res.body.data.briefId)).toBe(String(b5._id));
  });

  it('returns null data when no in-progress briefs exist', async () => {
    const user = await makeUser();
    const res  = await request(app)
      .get('/api/briefs/random-in-progress')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('falls back to the next accessible in-progress brief when the top pick is tier-locked', async () => {
    await createSettings({
      freeCategories:   ['News'],
      silverCategories: ['News', 'Aircrafts'],
    });
    const rank = await createRankDoc(1);
    const user = await createUser({ subscriptionTier: 'free', totalAirstars: 0, rank: rank._id });

    // Heritage brief has the lowest priority but free tier can't access it
    const heritage = await createBrief({ category: 'Heritage', title: 'RAF Core Values', priorityNumber: 1 });
    const news     = await createBrief({ category: 'News',     title: 'News',            priorityNumber: 5 });
    await createReadRecord(user._id, heritage._id, { completed: false });
    await createReadRecord(user._id, news._id,     { completed: false });

    const res = await request(app)
      .get('/api/briefs/random-in-progress')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(String(res.body.data.briefId)).toBe(String(news._id));
  });

  it('falls back when the top pick is pathway-locked even though tier allows it', async () => {
    await createSettings({
      freeCategories:   ['News', 'Aircrafts'],
      silverCategories: ['News', 'Aircrafts'],
      pathwayUnlocks: [
        { category: 'News',      levelRequired: 1, rankRequired: 1 },
        { category: 'Aircrafts', levelRequired: 5, rankRequired: 1 }, // locked at L1
      ],
    });
    const rank = await createRankDoc(1);
    const user = await createUser({ subscriptionTier: 'silver', totalAirstars: 0, rank: rank._id });

    const ac   = await createBrief({ category: 'Aircrafts', title: 'AC', priorityNumber: 1 });
    const news = await createBrief({ category: 'News',      title: 'News', priorityNumber: 5 });
    await createReadRecord(user._id, ac._id,   { completed: false });
    await createReadRecord(user._id, news._id, { completed: false });

    const res = await request(app)
      .get('/api/briefs/random-in-progress')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(String(res.body.data.briefId)).toBe(String(news._id));
  });

  it('returns null when every in-progress brief is in a locked category', async () => {
    await createSettings({
      freeCategories:   ['News'],
      silverCategories: ['News', 'Aircrafts'],
    });
    const rank = await createRankDoc(1);
    const user = await createUser({ subscriptionTier: 'free', totalAirstars: 0, rank: rank._id });

    const heritage = await createBrief({ category: 'Heritage', title: 'RAF Core Values', priorityNumber: 1 });
    await createReadRecord(user._id, heritage._id, { completed: false });

    const res = await request(app)
      .get('/api/briefs/random-in-progress')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('does not delete the read record for a locked brief — it reappears once access is restored', async () => {
    await createSettings({
      freeCategories:   ['News'],
      silverCategories: ['News', 'Aircrafts'],
    });
    const rank = await createRankDoc(1);
    const user = await createUser({ subscriptionTier: 'free', totalAirstars: 0, rank: rank._id });

    const ac = await createBrief({ category: 'Aircrafts', title: 'AC', priorityNumber: 1 });
    await createReadRecord(user._id, ac._id, { completed: false });

    // While tier is free, Aircrafts is locked → null
    let res = await request(app)
      .get('/api/briefs/random-in-progress')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();

    // User upgrades — read record persists, and Jump Back In re-surfaces it
    const User = require('../../models/User');
    await User.findByIdAndUpdate(user._id, { subscriptionTier: 'silver' });

    res = await request(app)
      .get('/api/briefs/random-in-progress')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(String(res.body.data.briefId)).toBe(String(ac._id));
  });
});
