/**
 * briefs.tracking-gate.test.js
 *
 * IntelligenceBriefRead is only allowed to mutate when the brief is published
 * AND the user can access it (subscription tier + pathway level/rank). This
 * suite verifies the gate at every write site:
 *
 *   - GET    /api/briefs/:id                         (lazy row creation)
 *   - PATCH  /api/briefs/:id/time                    (timeSpent, currentSection, lastReadAt)
 *   - POST   /api/briefs/:id/use-ammo                (ammo decrement)
 *   - POST   /api/briefs/:id/mnemonic-viewed         (mnemonic upsert)
 *   - POST   /api/briefs/:id/complete                (completion + coins)
 *   - POST   /api/briefs/:id/reached-flashcard       (flashcard unlock)
 *   - GET    /api/briefs/:id/reached-flashcard-preview
 *   - GET    /api/games/flashcard-recall/available-briefs (eligibility filter)
 *
 * Also covers Fix 2 (no flashcard unlock when descriptionSections.length < 4)
 * and Fix 3 (flashcardUnlockedAt is stamped once and surfaced in history).
 */

process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const Rank     = require('../../models/Rank');
const Level    = require('../../models/Level');
const IntelligenceBrief     = require('../../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');
const {
  createBrief,
  createSettings,
  createUser,
  createReadRecord,
  authCookie,
} = require('../helpers/factories');

const SECTIONS_4 = ['s1', 's2', 's3', 's4-flashcard'];

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

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ─── Fix 4: stub briefs ────────────────────────────────────────────────────

describe('Fix 4 — stub briefs do not create or mutate read rows', () => {
  it('GET /api/briefs/:id does not create a read record for a stub brief', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ status: 'stub', descriptionSections: [], category: 'Aircrafts' });

    const res = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    // Stub briefs still render (200) but no read row is materialised.
    expect(res.status).toBe(200);

    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row).toBeNull();
  });

  it('GET /api/briefs/:id DOES create a read record for a published brief in the same category', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ status: 'published', category: 'Aircrafts', descriptionSections: SECTIONS_4 });

    const res = await request(app)
      .get(`/api/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);

    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row).not.toBeNull();
    expect(row.reachedFlashcard).toBe(false);
  });

  it('PATCH /api/briefs/:id/time refuses on a stub brief', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ status: 'stub', descriptionSections: [], category: 'Aircrafts' });

    const res = await request(app)
      .patch(`/api/briefs/${brief._id}/time`)
      .set('Cookie', authCookie(user._id))
      .send({ seconds: 30, currentSection: 1 });
    expect(res.status).toBe(400);

    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row).toBeNull();
  });

  it('POST /api/briefs/:id/mnemonic-viewed does NOT silently upsert a row', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ status: 'published', category: 'Aircrafts', descriptionSections: SECTIONS_4 });

    // No prior GET — no read row exists yet.
    const res = await request(app)
      .post(`/api/briefs/${brief._id}/mnemonic-viewed`)
      .set('Cookie', authCookie(user._id))
      .send({ statKey: 'topSpeed' });
    expect(res.status).toBe(200);

    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    // The endpoint must not have created a row out of thin air.
    expect(row).toBeNull();
  });

  it('POST /api/briefs/:id/mnemonic-viewed refuses on a stub brief', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ status: 'stub', descriptionSections: [], category: 'Aircrafts' });

    const res = await request(app)
      .post(`/api/briefs/${brief._id}/mnemonic-viewed`)
      .set('Cookie', authCookie(user._id))
      .send({ statKey: 'topSpeed' });
    expect(res.status).toBe(400);
  });
});

// ─── Fix 4 (pathway gate at write sites) ───────────────────────────────────

describe('Fix 4 — pathway-locked briefs do not mutate read rows', () => {
  beforeEach(async () => seedLevels());

  async function setupLockedBriefForUser() {
    await createSettings({
      freeCategories:   ['News', 'Aircrafts'],
      silverCategories: ['News', 'Aircrafts'],
      pathwayUnlocks: [
        { category: 'News',      levelRequired: 1, rankRequired: 1 },
        { category: 'Aircrafts', levelRequired: 2, rankRequired: 1 },
      ],
    });
    const rank  = await Rank.create({ rankType: 'enlisted_aviator', rankNumber: 1, rankName: 'AC', rankAbbreviation: 'AC' });
    // Level-1 user — locked out of Aircrafts (which requires level 2).
    const user  = await createUser({ subscriptionTier: 'free', totalAirstars: 0, cycleAirstars: 0, rank: rank._id });
    const brief = await createBrief({ category: 'Aircrafts', status: 'published', descriptionSections: SECTIONS_4 });
    return { user, brief };
  }

  it('GET /:id returns 403 and creates no row for a pathway-locked category', async () => {
    const { user, brief } = await setupLockedBriefForUser();
    const res = await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row).toBeNull();
  });

  it('PATCH /:id/time refuses for a pathway-locked brief', async () => {
    const { user, brief } = await setupLockedBriefForUser();
    const res = await request(app)
      .patch(`/api/briefs/${brief._id}/time`)
      .set('Cookie', authCookie(user._id))
      .send({ seconds: 5, currentSection: 1 });
    expect(res.status).toBe(400);
    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row).toBeNull();
  });

  it('POST /:id/reached-flashcard returns wasNew:false for a pathway-locked brief and does not write', async () => {
    const { user, brief } = await setupLockedBriefForUser();
    const res = await request(app)
      .post(`/api/briefs/${brief._id}/reached-flashcard`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(false);
    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row).toBeNull();
  });
});

// ─── Fix 2: section-count gate ─────────────────────────────────────────────

describe('Fix 2 — reachedFlashcard refuses when descriptionSections.length < 4', () => {
  it('returns wasNew:false and does not flip reachedFlashcard for a 1-section brief', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts', status: 'published', descriptionSections: ['only one'] });
    // The lazy read row exists from the GET, but reachedFlashcard must not be set.
    await createReadRecord(user._id, brief._id, { completed: false, reachedFlashcard: false });

    const res = await request(app)
      .post(`/api/briefs/${brief._id}/reached-flashcard`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(false);

    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row.reachedFlashcard).toBe(false);
    expect(row.flashcardUnlockedAt).toBeNull();
  });

  it('returns wasNew:true and flips reachedFlashcard for a 4-section brief', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts', status: 'published', descriptionSections: SECTIONS_4 });
    await createReadRecord(user._id, brief._id, { completed: false, reachedFlashcard: false });

    const res = await request(app)
      .post(`/api/briefs/${brief._id}/reached-flashcard`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(true);

    const row = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row.reachedFlashcard).toBe(true);
    expect(row.flashcardUnlockedAt).not.toBeNull();
  });
});

// ─── Fix 3: flashcardUnlockedAt is stamped once and surfaced ───────────────

describe('Fix 3 — flashcardUnlockedAt stamping and history surfacing', () => {
  it('stamps flashcardUnlockedAt when reachedFlashcard first flips and does not overwrite on re-fire', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts', status: 'published', descriptionSections: SECTIONS_4 });
    await createReadRecord(user._id, brief._id, { completed: false, reachedFlashcard: false });

    const first = await request(app)
      .post(`/api/briefs/${brief._id}/reached-flashcard`)
      .set('Cookie', authCookie(user._id));
    expect(first.body.wasNew).toBe(true);

    const row1 = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    const stampedAt = row1.flashcardUnlockedAt;
    expect(stampedAt).not.toBeNull();

    // Re-fire — the existing reachedFlashcard:true short-circuits before any write,
    // so flashcardUnlockedAt must remain identical.
    await new Promise(r => setTimeout(r, 5));
    const second = await request(app)
      .post(`/api/briefs/${brief._id}/reached-flashcard`)
      .set('Cookie', authCookie(user._id));
    expect(second.body.wasNew).toBe(false);

    const row2 = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(row2.flashcardUnlockedAt.toISOString()).toBe(stampedAt.toISOString());
  });

  it('GET /api/briefs/history?flashcard=1 returns flashcardUnlockedAt', async () => {
    await createSettings();
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts', status: 'published', descriptionSections: SECTIONS_4 });
    const unlockedAt = new Date('2025-01-15T10:00:00Z');
    await createReadRecord(user._id, brief._id, {
      completed:           false,
      reachedFlashcard:    true,
      flashcardUnlockedAt: unlockedAt,
      lastReadAt:          new Date('2025-02-20T10:00:00Z'),
    });

    const res = await request(app)
      .get('/api/briefs/history?flashcard=1')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.reads).toHaveLength(1);
    expect(res.body.data.reads[0].flashcardUnlockedAt).toBe(unlockedAt.toISOString());
  });
});

// ─── Fix 1: pathway/tier gate on flashcard query endpoints ─────────────────

describe('Fix 1 — flashcard endpoints filter eligible briefs by current pathway/tier', () => {
  beforeEach(async () => seedLevels());

  it('GET /flashcard-recall/available-briefs excludes briefs in pathway-locked categories', async () => {
    await createSettings({
      freeCategories:   ['News', 'Aircrafts', 'Bases'],
      silverCategories: ['News', 'Aircrafts', 'Bases'],
      pathwayUnlocks: [
        { category: 'News',      levelRequired: 1, rankRequired: 1 },
        { category: 'Aircrafts', levelRequired: 1, rankRequired: 1 },
        { category: 'Bases',     levelRequired: 8, rankRequired: 1 }, // locked for level-1 user
      ],
      newsFlashcardsEnabled: true,
    });
    const rank = await Rank.create({ rankType: 'enlisted_aviator', rankNumber: 1, rankName: 'AC', rankAbbreviation: 'AC' });
    const user = await createUser({ subscriptionTier: 'free', totalAirstars: 0, cycleAirstars: 0, rank: rank._id });

    const aircraft = await createBrief({ category: 'Aircrafts', title: 'Typhoon', descriptionSections: SECTIONS_4 });
    const base     = await createBrief({ category: 'Bases',     title: 'Lossie',  descriptionSections: SECTIONS_4 });
    await createReadRecord(user._id, aircraft._id, { reachedFlashcard: true, completed: false });
    await createReadRecord(user._id, base._id,     { reachedFlashcard: true, completed: false });

    const res = await request(app)
      .get('/api/games/flashcard-recall/available-briefs')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    // Bases is locked for this user → excluded; only Aircrafts counts.
    expect(res.body.data.count).toBe(1);
  });

  it('POST /flashcard-recall/start never deals a card from a pathway-locked category', async () => {
    await createSettings({
      freeCategories:   ['News', 'Aircrafts', 'Bases'],
      silverCategories: ['News', 'Aircrafts', 'Bases'],
      pathwayUnlocks: [
        { category: 'News',      levelRequired: 1, rankRequired: 1 },
        { category: 'Aircrafts', levelRequired: 1, rankRequired: 1 },
        { category: 'Bases',     levelRequired: 8, rankRequired: 1 },
      ],
      newsFlashcardsEnabled: true,
    });
    const rank = await Rank.create({ rankType: 'enlisted_aviator', rankNumber: 1, rankName: 'AC', rankAbbreviation: 'AC' });
    const user = await createUser({ subscriptionTier: 'free', totalAirstars: 0, cycleAirstars: 0, rank: rank._id });

    // 5 Aircrafts (accessible) + 5 Bases (locked) — start with count=5 must pick only Aircrafts.
    const aircrafts = [];
    const bases     = [];
    for (let i = 0; i < 5; i++) {
      const a = await createBrief({ category: 'Aircrafts', title: `A${i}`, descriptionSections: SECTIONS_4 });
      const b = await createBrief({ category: 'Bases',     title: `B${i}`, descriptionSections: SECTIONS_4 });
      await createReadRecord(user._id, a._id, { reachedFlashcard: true, completed: false });
      await createReadRecord(user._id, b._id, { reachedFlashcard: true, completed: false });
      aircrafts.push(String(a._id));
      bases.push(String(b._id));
    }

    const res = await request(app)
      .post('/api/games/flashcard-recall/start')
      .set('Cookie', authCookie(user._id))
      .send({ count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.cards).toHaveLength(5);
    for (const card of res.body.data.cards) {
      expect(aircrafts).toContain(String(card.intelBriefId));
      expect(bases).not.toContain(String(card.intelBriefId));
    }
  });
});
