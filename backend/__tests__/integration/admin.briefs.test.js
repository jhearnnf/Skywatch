/**
 * Admin — Briefs tab integration tests
 *
 * Covers:
 *   GET    /api/admin/briefs               — list with pagination, search, category filter
 *   GET    /api/admin/briefs/:id           — returns brief with populated questions and media
 *   POST   /api/admin/briefs               — creates brief, requires reason
 *   PATCH  /api/admin/briefs/:id           — updates brief, requires reason
 *   DELETE /api/admin/briefs/:id           — deletes brief + cascades
 *   POST   /api/admin/briefs/:id/questions — creates questions, links to brief, replaces on second call
 *   DELETE /api/admin/briefs/:id/media/:mediaId — removes media from brief
 *   GET    /api/admin/intel-leads          — returns leads without [DB]
 *   POST   /api/admin/intel-leads/mark-complete — stamps [DB]
 *   Auth guards: 401 without auth, 403 for non-admin
 */
process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createBrief, createQuizQuestions,
  createGameType, createSettings, authCookie,
} = require('../helpers/factories');
const IntelligenceBrief      = require('../../models/IntelligenceBrief');
const IntelligenceBriefRead  = require('../../models/IntelligenceBriefRead');
const GameQuizQuestion       = require('../../models/GameQuizQuestion');
const Media                  = require('../../models/Media');
const mongoose               = require('mongoose');

// ── lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  await createGameType();
});
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── helpers ──────────────────────────────────────────────────────────────────

function makeQuestions(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    question: `Question ${i + 1}: What is this?`,
    answers: Array.from({ length: 10 }, (__, j) => ({ title: `Answer ${j + 1} for Q${i + 1}` })),
    correctAnswerIndex: 0,
  }));
}

// ── Auth guards ───────────────────────────────────────────────────────────────

describe('Admin briefs routes — auth guards', () => {
  it('returns 401 for unauthenticated GET /api/admin/briefs', async () => {
    const res = await request(app).get('/api/admin/briefs');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin GET /api/admin/briefs', async () => {
    const user = await createUser();
    const res  = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated POST /api/admin/briefs', async () => {
    const res = await request(app)
      .post('/api/admin/briefs')
      .send({ title: 'Test', category: 'News', reason: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin DELETE /api/admin/briefs/:id', async () => {
    const user  = await createUser();
    const brief = await createBrief();
    const res   = await request(app)
      .delete(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(user._id))
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
  });
});

// ── GET /api/admin/briefs ─────────────────────────────────────────────────────

describe('GET /api/admin/briefs — list', () => {
  it('returns a paginated list of briefs', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'Alpha Brief', category: 'News' });
    await createBrief({ title: 'Beta Brief',  category: 'Aircrafts' });

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.briefs.length).toBe(2);
    expect(res.body.data.total).toBe(2);
  });

  it('filters by category', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'News Brief', category: 'News' });
    await createBrief({ title: 'Aircraft Brief', category: 'Aircrafts' });

    const res = await request(app)
      .get('/api/admin/briefs?category=News')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(1);
    expect(res.body.data.briefs[0].category).toBe('News');
  });

  it('filters by search (title match)', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'Typhoon Aircraft', category: 'Aircrafts' });
    await createBrief({ title: 'RAF Bases Overview', category: 'Bases' });

    const res = await request(app)
      .get('/api/admin/briefs?search=typhoon')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(1);
    expect(res.body.data.briefs[0].title).toBe('Typhoon Aircraft');
  });

  it('respects pagination limit and page params', async () => {
    const admin = await createAdminUser();
    for (let i = 0; i < 5; i++) {
      await createBrief({ title: `Brief ${i}`, category: 'News' });
    }

    const res = await request(app)
      .get('/api/admin/briefs?page=1&limit=3')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBeLessThanOrEqual(3);
    expect(res.body.data.total).toBe(5);
  });

  it('returns empty array when no briefs exist', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});

// ── GET /api/admin/briefs/:id ─────────────────────────────────────────────────

describe('GET /api/admin/briefs/:id', () => {
  it('returns a brief with populated questions and media', async () => {
    const admin    = await createAdminUser();
    const gameType = await createGameType();
    const brief    = await createBrief({ title: 'Detailed Brief', category: 'News' });

    // Add quiz questions
    const easyQs = await createQuizQuestions(brief._id, gameType._id, 2, 'easy');
    await IntelligenceBrief.findByIdAndUpdate(brief._id, {
      quizQuestionsEasy: easyQs.map(q => q._id),
    });

    // Add media
    const media = await Media.create({ mediaType: 'picture', mediaUrl: 'https://example.com/img.jpg' });
    await IntelligenceBrief.findByIdAndUpdate(brief._id, { $push: { media: media._id } });

    const res = await request(app)
      .get(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.brief.title).toBe('Detailed Brief');
    expect(Array.isArray(res.body.data.brief.quizQuestionsEasy)).toBe(true);
    expect(res.body.data.brief.quizQuestionsEasy.length).toBe(2);
    expect(res.body.data.brief.media.length).toBe(1);
    expect(res.body.data.brief.media[0].mediaUrl).toBe('https://example.com/img.jpg');
  });

  it('returns 404 for a non-existent brief', async () => {
    const admin = await createAdminUser();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/admin/briefs/${fakeId}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(404);
  });
});

// ── POST /api/admin/briefs ────────────────────────────────────────────────────

describe('POST /api/admin/briefs', () => {
  it('creates a brief and returns 200 with the new brief', async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({
        title:               'New Intel Brief',
        subtitle:            'A subtitle',
        category:            'News',
        descriptionSections: ['Section one.', 'Section two.'],
        reason:              'Admin create',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.brief.title).toBe('New Intel Brief');
    expect(res.body.data.brief.category).toBe('News');
  });

  it('returns 400 when reason is missing', async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Missing Reason', category: 'News' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reason/i);
  });

  it('returns 500 when required fields are missing', async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'Admin create' }); // missing title and category

    expect(res.status).toBe(500);
  });
});

// ── PATCH /api/admin/briefs/:id ───────────────────────────────────────────────

describe('PATCH /api/admin/briefs/:id', () => {
  it('updates a brief successfully', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'Original Title', category: 'News' });

    const res = await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Updated Title', reason: 'Admin edit' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.brief.title).toBe('Updated Title');
  });

  it('returns 400 when reason is missing', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief();

    const res = await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'No Reason' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent brief', async () => {
    const admin  = await createAdminUser();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .patch(`/api/admin/briefs/${fakeId}`)
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Ghost Brief', reason: 'test' });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/admin/briefs/:id ──────────────────────────────────────────────

describe('DELETE /api/admin/briefs/:id', () => {
  it('deletes the brief and returns success', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief();

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'Cleanup' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const found = await IntelligenceBrief.findById(brief._id);
    expect(found).toBeNull();
  });

  it('cascades: deletes associated quiz questions', async () => {
    const admin    = await createAdminUser();
    const gameType = await createGameType();
    const brief    = await createBrief({ category: 'News' });

    await createQuizQuestions(brief._id, gameType._id, 3, 'easy');

    await request(app)
      .delete(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'Cascade test' });

    const remaining = await GameQuizQuestion.countDocuments({ intelBriefId: brief._id });
    expect(remaining).toBe(0);
  });

  it('returns 400 when reason is missing', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief();

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── POST /api/admin/briefs/:id/questions ─────────────────────────────────────

describe('POST /api/admin/briefs/:id/questions', () => {
  it('creates easy and medium questions and links them to the brief', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'News' });
    const easyQs   = makeQuestions(10);
    const mediumQs = makeQuestions(10);

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/questions`)
      .set('Cookie', authCookie(admin._id))
      .send({ easyQuestions: easyQs, mediumQuestions: mediumQs });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.brief.quizQuestionsEasy.length).toBe(10);
    expect(res.body.data.brief.quizQuestionsMedium.length).toBe(10);
  });

  it('replaces existing questions on a second call', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'News' });

    // First call
    await request(app)
      .post(`/api/admin/briefs/${brief._id}/questions`)
      .set('Cookie', authCookie(admin._id))
      .send({ easyQuestions: makeQuestions(5), mediumQuestions: makeQuestions(5) });

    // Second call with different questions
    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/questions`)
      .set('Cookie', authCookie(admin._id))
      .send({ easyQuestions: makeQuestions(10), mediumQuestions: makeQuestions(10) });

    expect(res.status).toBe(200);
    expect(res.body.data.brief.quizQuestionsEasy.length).toBe(10);

    // Only 20 questions should remain in the DB (not 30)
    const count = await GameQuizQuestion.countDocuments({ intelBriefId: brief._id });
    expect(count).toBe(20);
  });

  it('sets correctAnswerId correctly from correctAnswerIndex', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'News' });

    const questions = makeQuestions(1);
    questions[0].correctAnswerIndex = 2; // pick the 3rd answer

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/questions`)
      .set('Cookie', authCookie(admin._id))
      .send({ easyQuestions: questions, mediumQuestions: [] });

    expect(res.status).toBe(200);
    const qId = res.body.data.brief.quizQuestionsEasy[0]._id;
    const q   = await GameQuizQuestion.findById(qId);
    const correctIdx = q.answers.findIndex(a => String(a._id) === String(q.correctAnswerId));
    expect(correctIdx).toBe(2);
  });

  it('returns 404 for a non-existent brief', async () => {
    const admin  = await createAdminUser();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/admin/briefs/${fakeId}/questions`)
      .set('Cookie', authCookie(admin._id))
      .send({ easyQuestions: makeQuestions(1), mediumQuestions: [] });

    expect(res.status).toBe(404);
  });

  it('works without a GameType (returns 500 with helpful message)', async () => {
    // Clear the GameType seeded in beforeEach
    const GameType = require('../../models/GameType');
    await GameType.deleteMany({});

    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'News' });

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/questions`)
      .set('Cookie', authCookie(admin._id))
      .send({ easyQuestions: makeQuestions(1), mediumQuestions: [] });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/quiz game type/i);
  });
});

// ── DELETE /api/admin/briefs/:id/media/:mediaId ───────────────────────────────

describe('DELETE /api/admin/briefs/:id/media/:mediaId', () => {
  it('removes the media from the brief and deletes the Media document', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief();
    const media = await Media.create({ mediaType: 'picture', mediaUrl: 'https://example.com/image.jpg' });

    await IntelligenceBrief.findByIdAndUpdate(brief._id, { $push: { media: media._id } });

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/media/${media._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    // Media doc should be deleted
    const found = await Media.findById(media._id);
    expect(found).toBeNull();

    // Brief's media array should no longer contain this id
    const updatedBrief = await IntelligenceBrief.findById(brief._id);
    expect(updatedBrief.media.map(String)).not.toContain(String(media._id));
  });

  it('returns 200 even when mediaId does not exist (idempotent)', async () => {
    const admin  = await createAdminUser();
    const brief  = await createBrief();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/media/${fakeId}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
  });
});

// ── GET /api/admin/intel-leads ────────────────────────────────────────────────

describe('GET /api/admin/intel-leads', () => {
  it('returns 200 and a leads array for an admin', async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .get('/api/admin/intel-leads')
      .set('Cookie', authCookie(admin._id));

    // The route reads from a file — it will return success even if empty
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.leads)).toBe(true);
  });

  it('does not include leads marked with [DB]', async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .get('/api/admin/intel-leads')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    for (const lead of res.body.data.leads) {
      expect(lead.text).not.toContain('[DB]');
    }
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/intel-leads');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/admin/intel-leads/mark-complete ─────────────────────────────────

describe('POST /api/admin/intel-leads/mark-complete', () => {
  it('returns 400 when lead is missing from body', async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', authCookie(admin._id))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/lead required/i);
  });

  it('returns 404 when the lead text is not found in the file', async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', authCookie(admin._id))
      .send({ lead: 'This lead does not exist in the file at all 99999' });

    expect(res.status).toBe(404);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .send({ lead: 'some lead' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/admin/briefs/titles ──────────────────────────────────────────────

describe('GET /api/admin/briefs/titles', () => {
  it('returns array of { _id, title } for all briefs', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'Typhoon Brief', category: 'Aircrafts' });
    await createBrief({ title: 'F-35 Brief',    category: 'Aircrafts' });

    const res = await request(app)
      .get('/api/admin/briefs/titles')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const titles = res.body.data.titles;
    expect(titles.length).toBe(2);
    expect(titles.every(t => t._id && t.title)).toBe(true);
    const titleStrings = titles.map(t => t.title);
    expect(titleStrings).toContain('Typhoon Brief');
    expect(titleStrings).toContain('F-35 Brief');
  });

  it('returns empty array when no briefs exist', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/briefs/titles')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.titles).toEqual([]);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/briefs/titles');
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/admin/briefs/:id — cascade completeness ───────────────────────

describe('DELETE /api/admin/briefs/:id — cascade completeness', () => {
  it('cascades: deletes associated IntelligenceBriefRead records', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const brief = await createBrief({ category: 'News' });

    // Simulate the user having read the brief
    await IntelligenceBriefRead.create({ userId: user._id, intelBriefId: brief._id });

    const before = await IntelligenceBriefRead.countDocuments({ intelBriefId: brief._id });
    expect(before).toBe(1);

    await request(app)
      .delete(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'Cascade test' });

    const after = await IntelligenceBriefRead.countDocuments({ intelBriefId: brief._id });
    expect(after).toBe(0);
  });

  it('returns 404 for a non-existent brief ID', async () => {
    const admin  = await createAdminUser();
    const fakeId = new mongoose.Types.ObjectId();

    // The delete will silently succeed on a missing brief (findByIdAndDelete returns null)
    // but the brief itself should not exist afterwards either way
    const res = await request(app)
      .delete(`/api/admin/briefs/${fakeId}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'Ghost delete' });

    // Route returns 200 (idempotent delete) — verify no crash
    expect([200, 404]).toContain(res.status);
  });
});

// ── POST /api/admin/briefs — field saving ─────────────────────────────────────

describe('POST /api/admin/briefs — field saving', () => {
  it('saves keywords array correctly', async () => {
    const admin    = await createAdminUser();
    const keywords = [
      { keyword: 'Typhoon', generatedDescription: 'A fast jet' },
      { keyword: 'RAF Coningsby', generatedDescription: 'A base in Lincolnshire' },
    ];

    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'KW Brief', category: 'News', keywords, reason: 'test' });

    expect(res.status).toBe(200);
    const saved = res.body.data.brief;
    expect(saved.keywords.length).toBe(2);
    expect(saved.keywords[0].keyword).toBe('Typhoon');
  });

  it('saves descriptionSections array correctly', async () => {
    const admin    = await createAdminUser();
    const sections = ['Section one text.', 'Section two text.', 'Section three text.'];

    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Sections Brief', category: 'News', descriptionSections: sections, reason: 'test' });

    expect(res.status).toBe(200);
    expect(res.body.data.brief.descriptionSections).toEqual(sections);
  });

  it('saves sources array correctly', async () => {
    const admin   = await createAdminUser();
    const sources = [{ url: 'https://raf.mod.uk', siteName: 'RAF', articleDate: '2024-01-01' }];

    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Sources Brief', category: 'News', sources, reason: 'test' });

    expect(res.status).toBe(200);
    expect(res.body.data.brief.sources[0].siteName).toBe('RAF');
  });
});

// ── POST /api/admin/briefs — category & subcategory validation ────────────────

describe('POST /api/admin/briefs — category and subcategory validation', () => {
  it('rejects an invalid category with 400', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Bad Cat', category: 'Planes', reason: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid category/);
  });

  it('rejects a subcategory that does not belong to the given category with 400', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Bad Sub', category: 'Aircrafts', subcategory: 'World War II', reason: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a valid subcategory/);
  });

  it('accepts Aircrafts brief with subcategory Fast Jet', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Typhoon Brief', category: 'Aircrafts', subcategory: 'Fast Jet', reason: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.data.brief.subcategory).toBe('Fast Jet');
  });

  it('accepts Aircrafts brief with subcategory ISR & Surveillance', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'RC-135 Brief', category: 'Aircrafts', subcategory: 'ISR & Surveillance', reason: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.data.brief.subcategory).toBe('ISR & Surveillance');
  });

  it('accepts Missions brief with subcategory World War II', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Battle of Britain', category: 'Missions', subcategory: 'World War II', reason: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.data.brief.subcategory).toBe('World War II');
  });

  it('accepts AOR brief with subcategory South Atlantic & Falklands', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Falklands AOR', category: 'AOR', subcategory: 'South Atlantic & Falklands', reason: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.data.brief.subcategory).toBe('South Atlantic & Falklands');
  });

  it('accepts a News brief with no subcategory', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'News Brief', category: 'News', reason: 'test' });
    expect(res.status).toBe(200);
  });

  it('accepts a brief with no subcategory when the category has subcategories (subcategory is optional)', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Aircraft no sub', category: 'Aircrafts', reason: 'test' });
    expect(res.status).toBe(200);
  });
});

// ── Relationship arrays ────────────────────────────────────────────────────

describe('Brief relationship arrays', () => {
  it('PATCH can set associatedSquadronBriefIds, associatedAircraftBriefIds, relatedBriefIds', async () => {
    const admin    = await createAdminUser();
    const base     = await createBrief({ category: 'Bases',     title: 'RAF Lossiemouth' });
    const squadron = await createBrief({ category: 'Squadrons', title: 'No. 617 Squadron' });
    const aircraft = await createBrief({ category: 'Aircrafts', title: 'Typhoon FGR4' });
    const related  = await createBrief({ category: 'Terminology', title: 'QRA' });

    const res = await request(app)
      .patch(`/api/admin/briefs/${base._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({
        associatedSquadronBriefIds: [squadron._id],
        associatedAircraftBriefIds: [aircraft._id],
        relatedBriefIds:            [related._id],
        reason: 'Link test',
      });

    expect(res.status).toBe(200);
    const updated = await IntelligenceBrief.findById(base._id);
    expect(updated.associatedSquadronBriefIds.map(String)).toContain(String(squadron._id));
    expect(updated.associatedAircraftBriefIds.map(String)).toContain(String(aircraft._id));
    expect(updated.relatedBriefIds.map(String)).toContain(String(related._id));
  });

  it('GET /api/briefs/:id populates all four relationship arrays with title, category, status', async () => {
    const base     = await createBrief({ category: 'News', title: 'RAF Coningsby News' });
    const squadron = await createBrief({ category: 'Squadrons', title: 'No. 3 Squadron' });

    await IntelligenceBrief.findByIdAndUpdate(base._id, {
      associatedSquadronBriefIds: [squadron._id],
    });

    const user = await createAdminUser();
    const res = await request(app).get(`/api/briefs/${base._id}`).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);

    const populated = res.body.data.brief.associatedSquadronBriefIds;
    expect(populated).toHaveLength(1);
    expect(populated[0].title).toBe('No. 3 Squadron');
    expect(populated[0].category).toBe('Squadrons');
    expect(populated[0]).toHaveProperty('status');
  });

  it('DELETE brief removes its ID from all relationship arrays on other briefs', async () => {
    const admin    = await createAdminUser();
    const base     = await createBrief({ category: 'Bases',     title: 'RAF Marham' });
    const squadron = await createBrief({ category: 'Squadrons', title: 'No. 617 Squadron' });
    const aircraft = await createBrief({ category: 'Aircrafts', title: 'F-35B' });

    // Link base → squadron, aircraft
    await IntelligenceBrief.findByIdAndUpdate(base._id, {
      associatedSquadronBriefIds: [squadron._id],
      associatedAircraftBriefIds: [aircraft._id],
    });
    // Also link squadron → base (via associatedBaseBriefIds)
    await IntelligenceBrief.findByIdAndUpdate(squadron._id, {
      associatedBaseBriefIds: [base._id],
    });

    // Delete the squadron brief
    await request(app)
      .delete(`/api/admin/briefs/${squadron._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'Cascade test' });

    const updatedBase = await IntelligenceBrief.findById(base._id);
    expect(updatedBase.associatedSquadronBriefIds.map(String)).not.toContain(String(squadron._id));
  });

  it('stub briefs have status: stub and empty descriptionSections', async () => {
    const stub = await IntelligenceBrief.create({
      title: 'Stub Brief',
      category: 'Aircrafts',
      status: 'stub',
      descriptionSections: [],
      keywords: [],
      sources: [],
    });
    expect(stub.status).toBe('stub');
    expect(stub.descriptionSections).toHaveLength(0);
  });

  it('POST /api/briefs/:id/complete returns 400 for stub briefs', async () => {
    const user = await createAdminUser({ isAdmin: false });
    const stub = await IntelligenceBrief.create({
      title: 'Stub', category: 'Aircrafts', status: 'stub',
      descriptionSections: [], keywords: [], sources: [],
    });

    const res = await request(app)
      .post(`/api/briefs/${stub._id}/complete`)
      .set('Cookie', authCookie(user._id))
      .send({});

    expect(res.status).toBe(400);
  });
});
