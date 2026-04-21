/**
 * GET /api/briefs/:id/reached-flashcard-preview
 * Lets the client pre-fetch the projected flashcard-reach outcome on section 3
 * so the collect animation can fire instantly on section 4 without waiting on
 * the POST round-trip. Must mirror the POST via a shared helper and must not
 * commit any state.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const User    = require('../../models/User');
const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');
const { createUser, createBrief, createReadRecord, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const SECTIONS = ['s1', 's2', 's3', 's4'];

describe('GET /api/briefs/:id/reached-flashcard-preview', () => {
  it('returns wasNew: true with a projected count of 1 for a fresh user', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const user   = await createUser();
    const brief  = await createBrief({ category: 'Aircrafts', descriptionSections: SECTIONS });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reached-flashcard-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(true);
    expect(res.body.flashcardCount).toBe(1);
    expect(res.body.gameUnlocksGranted).toEqual([]);
  });

  it('returns wasNew: false when already reached', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const user   = await createUser();
    const brief  = await createBrief({ descriptionSections: SECTIONS });
    await createReadRecord(user._id, brief._id, { completed: false, reachedFlashcard: true });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reached-flashcard-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(false);
    expect(res.body.flashcardCount).toBeUndefined();
  });

  it('returns wasNew: false when the brief is already completed', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const user   = await createUser();
    const brief  = await createBrief({ descriptionSections: SECTIONS });
    await createReadRecord(user._id, brief._id, { completed: true });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reached-flashcard-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(false);
  });

  it('projects gameUnlocksGranted=["flashcard"] when this reach crosses the 5-brief threshold', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const user   = await createUser();
    // 4 prior reaches
    for (let i = 0; i < 4; i++) {
      const b = await createBrief({ category: 'Aircrafts', title: `Aircraft ${i}`, descriptionSections: SECTIONS });
      await createReadRecord(user._id, b._id, { completed: false, reachedFlashcard: true });
    }
    const fifth  = await createBrief({ category: 'Bases', title: 'Fifth base', descriptionSections: SECTIONS });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${fifth._id}/reached-flashcard-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(true);
    expect(res.body.flashcardCount).toBe(5);
    expect(res.body.gameUnlocksGranted).toEqual(['flashcard']);
  });

  it('does not project the flashcard unlock if the user already has it', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const user   = await createUser({ gameUnlocks: { flashcard: { unlockedAt: new Date() } } });
    for (let i = 0; i < 4; i++) {
      const b = await createBrief({ category: 'Aircrafts', title: `Aircraft ${i}`, descriptionSections: SECTIONS });
      await createReadRecord(user._id, b._id, { completed: false, reachedFlashcard: true });
    }
    const fifth  = await createBrief({ category: 'Bases', title: 'Fifth base', descriptionSections: SECTIONS });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${fifth._id}/reached-flashcard-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.gameUnlocksGranted).toEqual([]);
  });

  it('excludes News briefs from the projected count when newsFlashcardsEnabled=false', async () => {
    await createSettings({ newsFlashcardsEnabled: false });
    const user   = await createUser();
    // 4 prior non-News reaches
    for (let i = 0; i < 4; i++) {
      const b = await createBrief({ category: 'Aircrafts', title: `Aircraft ${i}`, descriptionSections: SECTIONS });
      await createReadRecord(user._id, b._id, { completed: false, reachedFlashcard: true });
    }
    const newsFifth = await createBrief({ category: 'News', title: 'News fifth', descriptionSections: SECTIONS });
    const cookie    = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${newsFifth._id}/reached-flashcard-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(true);
    expect(res.body.flashcardCount).toBe(4); // News target doesn't count toward the gate
    expect(res.body.gameUnlocksGranted).toEqual([]);
  });

  it('does not commit — no read record is created, follow-up POST still reports wasNew: true', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const user   = await createUser();
    const brief  = await createBrief({ category: 'Aircrafts', descriptionSections: SECTIONS });
    const cookie = authCookie(user._id);

    const preview = await request(app)
      .get(`/api/briefs/${brief._id}/reached-flashcard-preview`)
      .set('Cookie', cookie);
    expect(preview.status).toBe(200);
    expect(preview.body.wasNew).toBe(true);

    // No read record was written by the preview
    const recAfterPreview = await IntelligenceBriefRead.findOne({ userId: user._id, intelBriefId: brief._id });
    expect(recAfterPreview).toBeNull();

    // Preview did not grant the unlock either
    const userAfterPreview = await User.findById(user._id);
    expect(userAfterPreview.gameUnlocks?.flashcard?.unlockedAt ?? null).toBeNull();

    const commit = await request(app)
      .post(`/api/briefs/${brief._id}/reached-flashcard`)
      .set('Cookie', cookie);
    expect(commit.status).toBe(200);
    expect(commit.body.wasNew).toBe(true);
    expect(commit.body.flashcardCount).toBe(preview.body.flashcardCount);
    expect(commit.body.gameUnlocksGranted).toEqual(preview.body.gameUnlocksGranted);
  });

  it('returns 404 for a missing brief', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/briefs/507f1f77bcf86cd799439011/reached-flashcard-preview')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  it('returns 400 for a stub brief', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const user   = await createUser();
    const brief  = await createBrief({ status: 'stub', descriptionSections: [] });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reached-flashcard-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    await createSettings({ newsFlashcardsEnabled: true });
    const brief = await createBrief({ descriptionSections: SECTIONS });

    const res = await request(app).get(`/api/briefs/${brief._id}/reached-flashcard-preview`);

    expect(res.status).toBe(401);
  });
});
