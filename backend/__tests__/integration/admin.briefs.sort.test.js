/**
 * Admin briefs list — badge sort order
 *
 * Expected order:
 *   1st  — 1 badge  (highest priority)
 *   2nd  — 2 badges
 *   3rd  — 3 badges
 *   last — 0 badges
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createAdminUser, createBrief, createSettings, createGameType, authCookie } = require('../helpers/factories');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const GameQuizQuestion  = require('../../models/GameQuizQuestion');
const Media             = require('../../models/Media');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); await createGameType(); });
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── helpers ──────────────────────────────────────────────────────────────────

function makeKeywords(n = 10) {
  return Array.from({ length: n }, (_, i) => ({ keyword: `keyword${i + 1}` }));
}

async function addQuizQuestions(briefId, gameTypeId, count = 10, difficulty = 'easy') {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const answers = Array.from({ length: 7 }, (_, j) => ({ title: `A${j} Q${i}` }));
    const q = new GameQuizQuestion({
      intelBriefId: briefId,
      gameTypeId,
      question:     `Q${i + 1}: placeholder?`,
      difficulty,
      answers,
    });
    q.correctAnswerId = q.answers[0]._id;
    await q.save();
    ids.push(q._id);
  }
  return ids;
}

async function addMedia(briefId) {
  const media = await Media.create({
    mediaType:          'picture',
    mediaUrl:           'https://example.com/img.jpg',
    cloudinaryPublicId: 'test/public_id',
  });
  await IntelligenceBrief.findByIdAndUpdate(briefId, { $push: { media: media._id } });
}

async function addFullQuiz(briefId, gameTypeId) {
  const easyIds   = await addQuizQuestions(briefId, gameTypeId, 10, 'easy');
  const mediumIds = await addQuizQuestions(briefId, gameTypeId, 10, 'medium');
  await IntelligenceBrief.findByIdAndUpdate(briefId, {
    quizQuestionsEasy:   easyIds,
    quizQuestionsMedium: mediumIds,
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/briefs — badge sort order', () => {
  it('sorts 1-badge briefs first, then 2, then 3, then 0 last', async () => {
    const admin    = await createAdminUser();
    const gameType = await GameQuizQuestion.db.model('GameType').findOne({ gameTitle: 'quiz' });

    // 0 badges
    const zero = await createBrief({ title: 'Zero badges' });

    // 1 badge — K only
    const one = await createBrief({ title: 'One badge' });
    await IntelligenceBrief.findByIdAndUpdate(one._id, { keywords: makeKeywords(20) });

    // 2 badges — K + M
    const two = await createBrief({ title: 'Two badges' });
    await IntelligenceBrief.findByIdAndUpdate(two._id, { keywords: makeKeywords(20) });
    await addMedia(two._id);

    // 3 badges — K + Q + M
    const three = await createBrief({ title: 'Three badges' });
    await IntelligenceBrief.findByIdAndUpdate(three._id, { keywords: makeKeywords(20) });
    await addFullQuiz(three._id, gameType._id);
    await addMedia(three._id);

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);

    expect(titles.indexOf('One badge')).toBeLessThan(titles.indexOf('Two badges'));
    expect(titles.indexOf('Two badges')).toBeLessThan(titles.indexOf('Three badges'));
    expect(titles.indexOf('Three badges')).toBeLessThan(titles.indexOf('Zero badges'));
    expect(titles[titles.length - 1]).toBe('Zero badges');
  });

  it('places 0-badge briefs last even when inserted first', async () => {
    const admin = await createAdminUser();

    const zero = await createBrief({ title: 'No badges — inserted first' });
    const one  = await createBrief({ title: 'Has K badge' });
    await IntelligenceBrief.findByIdAndUpdate(one._id, { keywords: makeKeywords(20) });

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles[0]).toBe('Has K badge');
    expect(titles[titles.length - 1]).toBe('No badges — inserted first');
  });

  it('Q badge requires both easy AND medium questions >= 10', async () => {
    const admin    = await createAdminUser();
    const gameType = await GameQuizQuestion.db.model('GameType').findOne({ gameTitle: 'quiz' });

    // Only easy questions — Q badge not earned, so this is 1-badge (K only)
    const easyOnly = await createBrief({ title: 'Easy only (1 badge)' });
    const easyIds  = await addQuizQuestions(easyOnly._id, gameType._id, 10, 'easy');
    await IntelligenceBrief.findByIdAndUpdate(easyOnly._id, {
      keywords:          makeKeywords(20),
      quizQuestionsEasy: easyIds,
    });

    // Full quiz (easy + medium) — Q badge earned, so this is 2-badge (K + Q)
    const full = await createBrief({ title: 'Full quiz (2 badges)' });
    await IntelligenceBrief.findByIdAndUpdate(full._id, { keywords: makeKeywords(20) });
    await addFullQuiz(full._id, gameType._id);

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles.indexOf('Easy only (1 badge)')).toBeLessThan(titles.indexOf('Full quiz (2 badges)'));
  });

  it('sort=newest orders by updatedAt desc, ignoring badge order', async () => {
    const admin = await createAdminUser();

    const oldest = await createBrief({ title: 'Oldest brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      oldest._id,
      { keywords: makeKeywords(20), updatedAt: new Date('2025-01-01') },
      { timestamps: false },
    );
    const middle = await createBrief({ title: 'Middle brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      middle._id,
      { updatedAt: new Date('2025-06-01') },
      { timestamps: false },
    );
    const newest = await createBrief({ title: 'Newest brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      newest._id,
      { updatedAt: new Date('2025-12-01') },
      { timestamps: false },
    );

    const res = await request(app)
      .get('/api/admin/briefs?sort=newest')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toEqual(['Newest brief', 'Middle brief', 'Oldest brief']);
  });

  it('sort=oldest orders by updatedAt asc, ignoring badge order', async () => {
    const admin = await createAdminUser();

    const oldest = await createBrief({ title: 'Oldest brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      oldest._id,
      { keywords: makeKeywords(20), updatedAt: new Date('2025-01-01') },
      { timestamps: false },
    );
    const middle = await createBrief({ title: 'Middle brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      middle._id,
      { updatedAt: new Date('2025-06-01') },
      { timestamps: false },
    );
    const newest = await createBrief({ title: 'Newest brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      newest._id,
      { updatedAt: new Date('2025-12-01') },
      { timestamps: false },
    );

    const res = await request(app)
      .get('/api/admin/briefs?sort=oldest')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toEqual(['Oldest brief', 'Middle brief', 'Newest brief']);
  });

  it('hideStubs=true excludes stub briefs from results', async () => {
    const admin = await createAdminUser();

    const stub = await createBrief({ title: 'Stub brief' });
    await IntelligenceBrief.findByIdAndUpdate(stub._id, { status: 'stub' });
    const published = await createBrief({ title: 'Published brief' });
    await IntelligenceBrief.findByIdAndUpdate(published._id, { status: 'published' });

    const all = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));
    expect(all.body.data.briefs.map(b => b.title).sort()).toEqual(['Published brief', 'Stub brief']);

    const filtered = await request(app)
      .get('/api/admin/briefs?hideStubs=true')
      .set('Cookie', authCookie(admin._id));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.briefs.map(b => b.title)).toEqual(['Published brief']);
    expect(filtered.body.data.total).toBe(1);
  });

  it('M badge requires cloudinaryPublicId — media without it does not count', async () => {
    const admin = await createAdminUser();

    // Media without cloudinaryPublicId — M badge NOT earned (1 badge: K only)
    const noCloudinary = await createBrief({ title: 'No cloudinary (1 badge)' });
    await IntelligenceBrief.findByIdAndUpdate(noCloudinary._id, { keywords: makeKeywords(20) });
    const bareMedia = await Media.create({ mediaType: 'picture', mediaUrl: 'https://example.com/img.jpg' });
    await IntelligenceBrief.findByIdAndUpdate(noCloudinary._id, { $push: { media: bareMedia._id } });

    // Media WITH cloudinaryPublicId — M badge earned (2 badges: K + M)
    const withCloudinary = await createBrief({ title: 'With cloudinary (2 badges)' });
    await IntelligenceBrief.findByIdAndUpdate(withCloudinary._id, { keywords: makeKeywords(20) });
    await addMedia(withCloudinary._id);

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles.indexOf('No cloudinary (1 badge)')).toBeLessThan(titles.indexOf('With cloudinary (2 badges)'));
  });
});
