process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createBrief,
  createSettings,
  createUser,
  createReadRecord,
  authCookie,
} = require('../helpers/factories');
const AppSettings = require('../../models/AppSettings');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Helpers — each test writes its own settings + user + briefs so the
// newsFlashcardsEnabled flag is applied before any route is called.
async function setupWithFlag(newsFlashcardsEnabled) {
  await createSettings({ newsFlashcardsEnabled });
  const user = await createUser();
  // Mix of News + non-News briefs, each with a descriptionSections[3] so
  // the flashcard-recall/start route can build valid cards.
  const sections = ['s1', 's2', 's3', 's4-flashcard-text'];
  const news1    = await createBrief({ category: 'News',      title: 'News A', descriptionSections: sections });
  const news2    = await createBrief({ category: 'News',      title: 'News B', descriptionSections: sections });
  const news3    = await createBrief({ category: 'News',      title: 'News C', descriptionSections: sections });
  const aircraft = await createBrief({ category: 'Aircrafts', title: 'Typhoon', descriptionSections: sections });
  const bases    = await createBrief({ category: 'Bases',     title: 'Lossiemouth', descriptionSections: sections });

  // User has reached the flashcard on all five
  for (const b of [news1, news2, news3, aircraft, bases]) {
    await createReadRecord(user._id, b._id, { completed: false, reachedFlashcard: true });
  }
  return { user, news: [news1, news2, news3], nonNews: [aircraft, bases] };
}

describe('GET /api/games/flashcard-recall/available-briefs — News gating', () => {
  it('excludes News-category briefs from count when newsFlashcardsEnabled=false', async () => {
    const { user } = await setupWithFlag(false);
    const res = await request(app)
      .get('/api/games/flashcard-recall/available-briefs')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2); // only the 2 non-News briefs count
  });

  it('includes News-category briefs in count when newsFlashcardsEnabled=true', async () => {
    const { user } = await setupWithFlag(true);
    const res = await request(app)
      .get('/api/games/flashcard-recall/available-briefs')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(5); // all briefs count
  });
});

describe('POST /api/games/flashcard-recall/start — News gating', () => {
  it('never picks News-category briefs when newsFlashcardsEnabled=false', async () => {
    const { user, nonNews } = await setupWithFlag(false);
    const res = await request(app)
      .post('/api/games/flashcard-recall/start')
      .set('Cookie', authCookie(user._id))
      .send({ count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.cards).toHaveLength(2);
    const nonNewsIds = nonNews.map(b => String(b._id));
    for (const card of res.body.data.cards) {
      expect(nonNewsIds).toContain(String(card.intelBriefId));
      expect(card.category).not.toBe('News');
    }
  });

  it('refuses when only News briefs are available and News is disabled', async () => {
    await createSettings({ newsFlashcardsEnabled: false });
    const user = await createUser();
    const sections = ['s1', 's2', 's3', 's4'];
    for (let i = 0; i < 5; i++) {
      const b = await createBrief({ category: 'News', title: `News ${i}`, descriptionSections: sections });
      await createReadRecord(user._id, b._id, { completed: false, reachedFlashcard: true });
    }
    const res = await request(app)
      .post('/api/games/flashcard-recall/start')
      .set('Cookie', authCookie(user._id))
      .send({ count: 5 });
    expect(res.status).toBe(400);
    expect(res.body.available).toBe(0);
  });

  it('includes News-category briefs in the pool when newsFlashcardsEnabled=true', async () => {
    const { user } = await setupWithFlag(true);
    const res = await request(app)
      .post('/api/games/flashcard-recall/start')
      .set('Cookie', authCookie(user._id))
      .send({ count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.cards).toHaveLength(5);
  });
});

describe('POST /api/briefs/:id/reached-flashcard — unlock gate ignores News when disabled', () => {
  it('does not grant flashcard unlock when 5 News briefs reached but News is disabled', async () => {
    await createSettings({ newsFlashcardsEnabled: false });
    const user = await createUser();
    const sections = ['s1', 's2', 's3', 's4'];
    // 4 prior News reads
    const priorNews = [];
    for (let i = 0; i < 4; i++) {
      const b = await createBrief({ category: 'News', title: `News prior ${i}`, descriptionSections: sections });
      await createReadRecord(user._id, b._id, { completed: false, reachedFlashcard: true });
      priorNews.push(b);
    }
    // 5th News brief — this one is "newly reached"
    const fifth = await createBrief({ category: 'News', title: 'News fifth', descriptionSections: sections });

    const res = await request(app)
      .post(`/api/briefs/${fifth._id}/reached-flashcard`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.wasNew).toBe(true);
    expect(res.body.flashcardCount).toBe(0); // none of the 5 count toward the gate
    expect(res.body.gameUnlocksGranted).toEqual([]);
  });

  it('grants flashcard unlock when 5 non-News briefs reached', async () => {
    await createSettings({ newsFlashcardsEnabled: false });
    const user = await createUser();
    const sections = ['s1', 's2', 's3', 's4'];
    // 4 prior non-News reads
    for (let i = 0; i < 4; i++) {
      const b = await createBrief({ category: 'Aircrafts', title: `Aircraft ${i}`, descriptionSections: sections });
      await createReadRecord(user._id, b._id, { completed: false, reachedFlashcard: true });
    }
    const fifth = await createBrief({ category: 'Bases', title: 'Base fifth', descriptionSections: sections });

    const res = await request(app)
      .post(`/api/briefs/${fifth._id}/reached-flashcard`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.flashcardCount).toBe(5);
    expect(res.body.gameUnlocksGranted).toEqual(['flashcard']);
  });

  it('still persists reachedFlashcard record for News briefs when disabled (silent collection)', async () => {
    await createSettings({ newsFlashcardsEnabled: false });
    const user = await createUser();
    const newsBrief = await createBrief({ category: 'News', title: 'News silent', descriptionSections: ['a','b','c','d'] });

    await request(app)
      .post(`/api/briefs/${newsBrief._id}/reached-flashcard`)
      .set('Cookie', authCookie(user._id));

    // Flip setting on — count should now include the silently persisted read
    await AppSettings.findOneAndUpdate({}, { newsFlashcardsEnabled: true });

    const res = await request(app)
      .get('/api/games/flashcard-recall/available-briefs')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });
});
