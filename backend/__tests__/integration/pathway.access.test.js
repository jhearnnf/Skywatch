/**
 * pathway.access.test.js
 *
 * Tests that pathway (level + rank) gating is enforced at all access points,
 * independently from and in addition to the subscription-tier check.
 *
 * Settings used throughout:
 *   freeCategories:   ['News', 'Aircrafts', 'Bases']   ← all subscription-accessible
 *   silverCategories: ['News', 'Aircrafts', 'Bases']
 *   pathwayUnlocks:
 *     News:     level 1, rank 1  (all users can access from start)
 *     Aircrafts: level 2, rank 1  (level gate only)
 *     Bases:     level 1, rank 2  (rank gate only)
 *
 * This setup means subscription never blocks any of these three categories.
 * Any locking in the tests is purely due to pathway requirements.
 */

process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const Rank     = require('../../models/Rank');
const Level    = require('../../models/Level');
const Media    = require('../../models/Media');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const {
  createSettings,
  createGameType,
  createUser,
  createBrief,
  createQuizQuestions,
  authCookie,
} = require('../helpers/factories');

// Seed level thresholds matching the real curve — required for pathway level gating.
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

// ── Fixture data ──────────────────────────────────────────────────────────────

const S = {
  freeCategories:   ['News', 'Aircrafts', 'Bases'],
  silverCategories: ['News', 'Aircrafts', 'Bases'],
  pathwayUnlocks: [
    { category: 'News',      levelRequired: 1, rankRequired: 1 },
    { category: 'Aircrafts', levelRequired: 2, rankRequired: 1 }, // level gate
    { category: 'Bases',     levelRequired: 1, rankRequired: 2 }, // rank gate
  ],
};

// Airstars needed to reach level 2 (mirrors LEVEL_THRESHOLDS[1] = 100)
const LEVEL_2_COINS = 100;

async function createRankDoc(rankNumber) {
  return Rank.create({
    rankType:         'enlisted_aviator',
    rankNumber,
    rankName:         `Rank ${rankNumber}`,
    rankAbbreviation: `R${rankNumber}`,
  });
}

beforeAll(async () => { await db.connect(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── Helpers ───────────────────────────────────────────────────────────────────

// User who passes all pathway requirements for Aircrafts (level 2, rank 1)
async function userLevel2Rank1() {
  const rank = await createRankDoc(1);
  return createUser({ subscriptionTier: 'free', totalAirstars: LEVEL_2_COINS, rank: rank._id });
}

// User who passes all pathway requirements for Bases (level 1, rank 2)
async function userLevel1Rank2() {
  const rank = await createRankDoc(2);
  return createUser({ subscriptionTier: 'free', totalAirstars: 0, rank: rank._id });
}

// User who fails Aircrafts level gate (level 1, rank 1)
async function userLevel1Rank1() {
  const rank = await createRankDoc(1);
  return createUser({ subscriptionTier: 'free', totalAirstars: 0, rank: rank._id });
}

// User who fails Bases rank gate (level 2, rank 1)
async function userLevel2WrongRank() {
  const rank = await createRankDoc(1);
  return createUser({ subscriptionTier: 'free', totalAirstars: LEVEL_2_COINS, rank: rank._id });
}

// ── GET /api/briefs/:id — pathway gate ───────────────────────────────────────
describe('GET /api/briefs/:id — pathway gating', () => {
  beforeEach(async () => {
    await createSettings(S);
    await seedLevels();
  });

  it('level 1 user cannot open a level-2 category brief → 403', async () => {
    const user  = await userLevel1Rank1();
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('pathway');
    expect(res.body.levelRequired).toBe(2);
    expect(res.body.rankRequired).toBe(1);
  });

  it('level 2 user can open a level-2 category brief → 200', async () => {
    const user  = await userLevel2Rank1();
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('rank-1 user cannot open a rank-2 category brief → 403', async () => {
    const user  = await userLevel2WrongRank();
    const brief = await createBrief({ category: 'Bases' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('pathway');
    expect(res.body.rankRequired).toBe(2);
  });

  it('rank-2 user can open a rank-2 category brief → 200', async () => {
    const user  = await userLevel1Rank2();
    const brief = await createBrief({ category: 'Bases' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('user with higher rank than required satisfies lower requirement → 200', async () => {
    const rank = await createRankDoc(3);
    const user = await createUser({ subscriptionTier: 'free', totalAirstars: 0, rank: rank._id });
    const brief = await createBrief({ category: 'Bases' }); // rankRequired: 2
    const res  = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('level-1 News brief is accessible to all users → 200', async () => {
    const user  = await userLevel1Rank1();
    const brief = await createBrief({ category: 'News' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('guest can read any free-tier brief — pathway gating does not apply to guests', async () => {
    // Guests are treated as free-tier for brief access; the guest gate lives at
    // game endpoints (quiz start, BOO, etc.), not brief reading.
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app).get(`/api/briefs/${brief._id}`);
    expect(res.status).toBe(200);
  });
});

// ── GET /api/briefs (list) — isLocked flag ────────────────────────────────────
describe('GET /api/briefs — isLocked flag includes pathway lock', () => {
  beforeEach(async () => {
    await createSettings(S);
    await seedLevels();
    await createBrief({ category: 'News',      title: 'News Brief' });
    await createBrief({ category: 'Aircrafts', title: 'Aircraft Brief' });
    await createBrief({ category: 'Bases',     title: 'Bases Brief' });
  });

  it('level-1 rank-1 user: News unlocked, Aircrafts locked, Bases locked', async () => {
    const user = await userLevel1Rank1();
    const res  = await request(app).get('/api/briefs').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs.find(b => b.category === 'News').isLocked).toBe(false);
    expect(briefs.find(b => b.category === 'Aircrafts').isLocked).toBe(true);
    expect(briefs.find(b => b.category === 'Bases').isLocked).toBe(true);
  });

  it('level-2 rank-1 user: News + Aircrafts unlocked, Bases locked (rank gate)', async () => {
    const user = await userLevel2Rank1();
    const res  = await request(app).get('/api/briefs').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs.find(b => b.category === 'News').isLocked).toBe(false);
    expect(briefs.find(b => b.category === 'Aircrafts').isLocked).toBe(false);
    expect(briefs.find(b => b.category === 'Bases').isLocked).toBe(true);
  });

  it('level-1 rank-2 user: all three categories unlocked (rank bypasses level gate)', async () => {
    // Per isPathwayUnlocked rule: if userRank > unlock.rankRequired the level check
    // is bypassed — the user has already progressed past the rank at which this
    // category first unlocked, so level resets during rank progression don't re-lock it.
    const user = await userLevel1Rank2();
    const res  = await request(app).get('/api/briefs').set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs.find(b => b.category === 'News').isLocked).toBe(false);
    expect(briefs.find(b => b.category === 'Aircrafts').isLocked).toBe(false);
    expect(briefs.find(b => b.category === 'Bases').isLocked).toBe(false);
  });
});

// ── GET /api/briefs/random-unlocked — pathway filter ─────────────────────────
describe('GET /api/briefs/random-unlocked — excludes pathway-locked categories', () => {
  beforeEach(async () => {
    await createSettings(S);
    await seedLevels();
  });

  it('level-1 user never receives an Aircrafts or Bases brief', async () => {
    // Seed many briefs so randomness does not mask failures
    for (let i = 0; i < 10; i++) {
      await createBrief({ category: 'Aircrafts', title: `Aircraft ${i}`, status: 'published' });
      await createBrief({ category: 'Bases',     title: `Base ${i}`,     status: 'published' });
    }
    await createBrief({ category: 'News', title: 'News Brief', status: 'published' });

    const user = await userLevel1Rank1();
    // Run several times to detect probabilistic leakage
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(app)
        .get('/api/briefs/random-unlocked')
        .set('Cookie', authCookie(user._id));
      // Either 200 (News) or 404 (no accessible briefs — all read)
      if (res.status === 200) {
        const brief = await require('../../models/IntelligenceBrief').findById(res.body.data.briefId).lean();
        expect(brief.category).toBe('News');
      } else {
        expect(res.status).toBe(404);
      }
    }
  });

  it('level-2 rank-1 user can receive an Aircrafts brief but not a Bases brief', async () => {
    for (let i = 0; i < 5; i++) {
      await createBrief({ category: 'Aircrafts', title: `Aircraft ${i}`, status: 'published' });
      await createBrief({ category: 'Bases',     title: `Base ${i}`,     status: 'published' });
    }

    const user     = await userLevel2Rank1();
    const received = new Set();
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await request(app)
        .get('/api/briefs/random-unlocked')
        .set('Cookie', authCookie(user._id));
      if (res.status === 200) {
        const brief = await require('../../models/IntelligenceBrief').findById(res.body.data.briefId).lean();
        received.add(brief.category);
      }
    }
    expect(received.has('Aircrafts')).toBe(true);
    expect(received.has('Bases')).toBe(false);
  });
});

// ── GET /api/briefs/random-unlocked — excludes contentless briefs ────────────
describe('GET /api/briefs/random-unlocked — excludes briefs without descriptionSections', () => {
  beforeEach(async () => {
    await createSettings(S);
    await seedLevels();
  });

  it('never returns a published brief with empty descriptionSections', async () => {
    // Create a published brief with no content (the bug scenario)
    await createBrief({
      category: 'News',
      title: 'Empty Published Brief',
      status: 'published',
      descriptionSections: [],
    });
    // Create a properly published brief with content
    await createBrief({
      category: 'News',
      title: 'Full Brief',
      status: 'published',
      descriptionSections: ['Section one.', 'Section two.'],
    });

    const user = await userLevel1Rank1();
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await request(app)
        .get('/api/briefs/random-unlocked')
        .set('Cookie', authCookie(user._id));
      expect(res.status).toBe(200);
      const brief = await require('../../models/IntelligenceBrief').findById(res.body.data.briefId).lean();
      expect(brief.title).toBe('Full Brief');
      expect(brief.descriptionSections.length).toBeGreaterThan(0);
    }
  });

  it('returns 404 when only contentless published briefs exist', async () => {
    await createBrief({
      category: 'News',
      title: 'Empty Brief Only',
      status: 'published',
      descriptionSections: [],
    });

    const user = await userLevel1Rank1();
    const res = await request(app)
      .get('/api/briefs/random-unlocked')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(404);
  });

  it('never returns a stub brief', async () => {
    await createBrief({
      category: 'News',
      title: 'Stub Brief',
      status: 'stub',
      descriptionSections: [],
    });
    await createBrief({
      category: 'News',
      title: 'Published Brief',
      status: 'published',
      descriptionSections: ['Content here.'],
    });

    const user = await userLevel1Rank1();
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await request(app)
        .get('/api/briefs/random-unlocked')
        .set('Cookie', authCookie(user._id));
      expect(res.status).toBe(200);
      const brief = await require('../../models/IntelligenceBrief').findById(res.body.data.briefId).lean();
      expect(brief.status).toBe('published');
      expect(brief.title).toBe('Published Brief');
    }
  });
});

// ── GET /api/briefs/pathway/:category — pathway gate ─────────────────────────
describe('GET /api/briefs/pathway/:category — pathway gating', () => {
  beforeEach(async () => {
    await createSettings(S);
    await seedLevels();
  });

  it('level-1 user cannot access /pathway/Aircrafts → 403', async () => {
    const user = await userLevel1Rank1();
    const res  = await request(app)
      .get('/api/briefs/pathway/Aircrafts')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('pathway');
  });

  it('level-2 user can access /pathway/Aircrafts → 200', async () => {
    const user = await userLevel2Rank1();
    const res  = await request(app)
      .get('/api/briefs/pathway/Aircrafts')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('rank-1 user cannot access /pathway/Bases → 403', async () => {
    const user = await userLevel2WrongRank();
    const res  = await request(app)
      .get('/api/briefs/pathway/Bases')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('pathway');
  });
});

// ── GET /api/briefs/pathway/:category — nextBrief images ─────────────────────
describe('GET /api/briefs/pathway/:category — nextBrief images', () => {
  beforeEach(async () => {
    await createSettings(S);
    await seedLevels();
  });

  async function attachImage(briefId, url) {
    const m = await Media.create({ mediaType: 'picture', mediaUrl: url });
    await IntelligenceBrief.findByIdAndUpdate(briefId, { $push: { media: m._id } });
    return m;
  }

  it('returns picture URLs for the first unread published brief', async () => {
    const user   = await userLevel1Rank1();
    const first  = await createBrief({ category: 'News', title: 'First',  priorityNumber: 1, eventDate: new Date('2026-01-03') });
    const second = await createBrief({ category: 'News', title: 'Second', priorityNumber: 2, eventDate: new Date('2026-01-02') });
    await attachImage(first._id,  'https://example.com/a.jpg');
    await attachImage(first._id,  'https://example.com/b.jpg');
    await attachImage(second._id, 'https://example.com/c.jpg');

    const res = await request(app)
      .get('/api/briefs/pathway/News')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.nextBrief).toBeTruthy();
    expect(String(res.body.data.nextBrief.id)).toBe(String(first._id));
    expect(res.body.data.nextBrief.images).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
  });

  it('skips stub briefs when picking the next-unread brief', async () => {
    const user = await userLevel1Rank1();
    const stub = await createBrief({ category: 'News', title: 'Stub',      status: 'stub',      eventDate: new Date('2026-01-05') });
    const pub  = await createBrief({ category: 'News', title: 'Published', status: 'published', eventDate: new Date('2026-01-04') });
    await attachImage(stub._id, 'https://example.com/stub.jpg');
    await attachImage(pub._id,  'https://example.com/pub.jpg');

    const res = await request(app)
      .get('/api/briefs/pathway/News')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(String(res.body.data.nextBrief.id)).toBe(String(pub._id));
    expect(res.body.data.nextBrief.images).toEqual(['https://example.com/pub.jpg']);
  });

  it('returns nextBrief = null when the brief has no picture media', async () => {
    const user = await userLevel1Rank1();
    await createBrief({ category: 'News', title: 'No Media', eventDate: new Date('2026-01-01') });

    const res = await request(app)
      .get('/api/briefs/pathway/News')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.nextBrief).toBeNull();
  });

  it('caps returned images at 5', async () => {
    const user  = await userLevel1Rank1();
    const brief = await createBrief({ category: 'News', title: 'Many', eventDate: new Date('2026-01-01') });
    for (let i = 0; i < 7; i++) await attachImage(brief._id, `https://example.com/${i}.jpg`);

    const res = await request(app)
      .get('/api/briefs/pathway/News')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.nextBrief.images).toHaveLength(5);
  });
});

// ── POST /api/games/quiz/start — pathway gate ─────────────────────────────────
describe('POST /api/games/quiz/start — pathway gating', () => {
  let gameType;
  beforeEach(async () => {
    await createSettings(S);
    await seedLevels();
    gameType = await createGameType();
  });

  it('level-1 user cannot start a quiz for an Aircrafts brief → 403', async () => {
    const user  = await userLevel1Rank1();
    const brief = await createBrief({ category: 'Aircrafts' });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('pathway');
  });

  it('level-2 user can start a quiz for an Aircrafts brief → not 403', async () => {
    const user  = await userLevel2Rank1();
    const brief = await createBrief({ category: 'Aircrafts' });
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).not.toBe(403);
  });
});

// ── Pathway + subscription: both gates must pass ──────────────────────────────
describe('Pathway and subscription checks are independent (both must pass)', () => {
  it('silver user at level 1 cannot open a level-2 brief → 403 pathway', async () => {
    await createSettings(S);
    const rank  = await createRankDoc(1);
    const user  = await createUser({ subscriptionTier: 'silver', totalAirstars: 0, rank: rank._id });
    const brief = await createBrief({ category: 'Aircrafts' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('pathway');
  });

  it('free user at level 2 accessing a gold-only category → 403 subscription (not pathway)', async () => {
    await createSettings({
      freeCategories:   ['News'],
      silverCategories: ['News', 'Aircrafts'],
      pathwayUnlocks: [
        { category: 'Treaties', levelRequired: 1, rankRequired: 1 },
      ],
    });
    const rank  = await createRankDoc(1);
    const user  = await createUser({ subscriptionTier: 'free', totalAirstars: LEVEL_2_COINS, rank: rank._id });
    const brief = await createBrief({ category: 'Treaties' });
    const res   = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    // Subscription check fires first — no 'pathway' reason
    expect(res.body.reason).toBeUndefined();
  });
});
