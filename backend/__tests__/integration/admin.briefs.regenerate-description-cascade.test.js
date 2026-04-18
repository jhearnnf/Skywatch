/**
 * admin.briefs.regenerate-description-cascade.test.js
 *
 * Integration tests for POST /api/admin/ai/regenerate-description/:id.
 * Verifies that the cascade (wipe all user data tied to the brief) runs
 * before the AI generates new description sections.
 *
 * The OpenRouter call is mocked at the global fetch level.
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../../app');
const db       = require('../helpers/setupDb');

const {
  createSettings, createGameType,
  createUser, createAdminUser, authCookie,
  createBrief,
  createQuizQuestions, createQuizResult,
  createReadRecord,
  createPassedQuizAttempt,
  createWonBooResult,
  createAirstarLog,
  createFlashcardGame, createFlashcardResult,
  createWheresThatAircraftGame, createWheresThatAircraftResult,
} = require('../helpers/factories');

const IntelligenceBrief               = require('../../models/IntelligenceBrief');
const IntelligenceBriefRead           = require('../../models/IntelligenceBriefRead');
const GameQuizQuestion                = require('../../models/GameQuizQuestion');
const GameSessionQuizAttempt          = require('../../models/GameSessionQuizAttempt');
const GameSessionQuizResult           = require('../../models/GameSessionQuizResult');
const GameOrderOfBattle               = require('../../models/GameOrderOfBattle');
const GameSessionOrderOfBattleResult  = require('../../models/GameSessionOrderOfBattleResult');
const GameFlashcardRecall             = require('../../models/GameFlashcardRecall');
const GameSessionFlashcardRecallResult = require('../../models/GameSessionFlashcardRecallResult');
const GameWheresThatAircraft              = require('../../models/GameWheresThatAircraft');
const GameSessionWheresThatAircraftResult = require('../../models/GameSessionWheresThatAircraftResult');
const AirstarLog                      = require('../../models/AirstarLog');
const AdminAction                     = require('../../models/AdminAction');
const User                            = require('../../models/User');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});
afterAll(() => {});

const REASON = 'Test description regeneration';

// Mock OpenRouter to return valid description sections
const MOCK_DESC_JSON = JSON.stringify({
  descriptionSections: [
    'Freshly generated section one.',
    'Freshly generated section two.',
  ],
});

function mockOpenRouter(content) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content } }] })),
  });
}

function mockAiFetch() {
  return jest.spyOn(global, 'fetch').mockImplementation((url) => {
    if (String(url).includes('openrouter.ai')) return mockOpenRouter(MOCK_DESC_JSON);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ── Cascade deletion per collection ─────────────────────────────────────────

describe('POST /api/admin/ai/regenerate-description/:id — cascade deletions', () => {
  it('marks IntelligenceBriefRead records as deleted for the brief', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createReadRecord(user._id, brief._id);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const record = await IntelligenceBriefRead.findOne({ intelBriefId: brief._id });
    expect(record).not.toBeNull();
    expect(record.briefDeletedNote).toBe('Brief deleted or re-created');
    expect(record.completed).toBe(false);
    expect(record.coinsAwarded).toBe(false);
  });

  it('marks IntelligenceBriefRead records with reachedFlashcard: true', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createReadRecord(user._id, brief._id, { reachedFlashcard: true });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const record = await IntelligenceBriefRead.findOne({ intelBriefId: brief._id });
    expect(record).not.toBeNull();
    expect(record.briefDeletedNote).toBe('Brief deleted or re-created');
    expect(record.completed).toBe(false);
  });

  it('deletes GameQuizQuestion records for the brief', async () => {
    mockAiFetch();
    const brief    = await createBrief();
    const gameType = await createGameType();
    const admin    = await createAdminUser();
    await createQuizQuestions(brief._id, gameType._id, 5);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameQuizQuestion.countDocuments({ intelBriefId: brief._id })).toBe(0);
  });

  it('deletes GameSessionQuizAttempt records for the brief', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createPassedQuizAttempt(user._id, brief._id);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionQuizAttempt.countDocuments({ intelBriefId: brief._id })).toBe(0);
  });

  it('deletes GameSessionQuizResult records for questions belonging to the brief', async () => {
    mockAiFetch();
    const brief    = await createBrief();
    const gameType = await createGameType();
    const user     = await createUser();
    const admin    = await createAdminUser();
    const [question] = await createQuizQuestions(brief._id, gameType._id, 1);
    await createQuizResult(user._id, question._id);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionQuizResult.countDocuments({ questionId: question._id })).toBe(0);
  });

  it('deletes GameOrderOfBattle records where brief is the anchor', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createWonBooResult(user._id, brief._id);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameOrderOfBattle.countDocuments({ anchorBriefId: brief._id })).toBe(0);
  });

  it('deletes GameSessionOrderOfBattleResult records for anchor-brief BOO games', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    const { game } = await createWonBooResult(user._id, brief._id);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionOrderOfBattleResult.countDocuments({ gameId: game._id })).toBe(0);
  });

  it('deletes GameFlashcardRecall records containing cards for this brief', async () => {
    mockAiFetch();
    const brief    = await createBrief();
    const gameType = await createGameType();
    const admin    = await createAdminUser();
    await createFlashcardGame(brief._id, gameType._id);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameFlashcardRecall.countDocuments({ 'cards.intelBriefId': brief._id })).toBe(0);
  });

  it('deletes GameSessionFlashcardRecallResult records for affected flashcard games', async () => {
    mockAiFetch();
    const brief    = await createBrief();
    const gameType = await createGameType();
    const user     = await createUser();
    const admin    = await createAdminUser();
    const game     = await createFlashcardGame(brief._id, gameType._id);
    await createFlashcardResult(user._id, game._id);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionFlashcardRecallResult.countDocuments({ gameId: game._id })).toBe(0);
  });

  it('deletes GameWheresThatAircraft records for this brief', async () => {
    mockAiFetch();
    const brief    = await createBrief({ category: 'Aircrafts' });
    const gameType = await createGameType();
    const admin    = await createAdminUser();
    const result   = await createWheresThatAircraftGame(brief._id, gameType._id);
    const gameId   = result.insertedId;

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameWheresThatAircraft.countDocuments({ intelBriefId: brief._id })).toBe(0);
  });

  it('deletes GameSessionWheresThatAircraftResult records for affected WAA games', async () => {
    mockAiFetch();
    const brief    = await createBrief({ category: 'Aircrafts' });
    const gameType = await createGameType();
    const user     = await createUser();
    const admin    = await createAdminUser();
    const result   = await createWheresThatAircraftGame(brief._id, gameType._id);
    const gameId   = result.insertedId;
    await createWheresThatAircraftResult(user._id, gameId);

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionWheresThatAircraftResult.countDocuments({ gameId })).toBe(0);
  });

  it('deletes AirstarLog entries with matching briefId', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createAirstarLog(user._id, brief._id, { reason: 'brief_read', amount: 10 });
    await createAirstarLog(user._id, brief._id, { reason: 'quiz',       amount: 20 });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await AirstarLog.countDocuments({ briefId: brief._id })).toBe(0);
  });

  it('clears quizQuestionsEasy and quizQuestionsMedium arrays on the brief document', async () => {
    mockAiFetch();
    const gameType = await createGameType();
    const admin    = await createAdminUser();
    const brief    = await createBrief();

    const easyQs   = await createQuizQuestions(brief._id, gameType._id, 3, 'easy');
    const mediumQs = await createQuizQuestions(brief._id, gameType._id, 3, 'medium');
    await IntelligenceBrief.findByIdAndUpdate(brief._id, {
      $set: {
        quizQuestionsEasy:   easyQs.map(q => q._id),
        quizQuestionsMedium: mediumQs.map(q => q._id),
      },
    });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await IntelligenceBrief.findById(brief._id);
    expect(updated.quizQuestionsEasy).toHaveLength(0);
    expect(updated.quizQuestionsMedium).toHaveLength(0);
  });
});

// ── Coin reversal ──────────────────────────────────────────────────────────

describe('POST /api/admin/ai/regenerate-description/:id — coin reversal', () => {
  it('decrements User.totalAirstars by the sum of deleted log amounts', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const admin = await createAdminUser();
    const user  = await createUser({ totalAirstars: 50, cycleAirstars: 50 });
    await createAirstarLog(user._id, brief._id, { amount: 30 });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await User.findById(user._id);
    expect(updated.totalAirstars).toBe(20);
  });

  it('decrements User.cycleAirstars by the sum of deleted log amounts', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const admin = await createAdminUser();
    const user  = await createUser({ totalAirstars: 50, cycleAirstars: 40 });
    await createAirstarLog(user._id, brief._id, { amount: 25 });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await User.findById(user._id);
    expect(updated.cycleAirstars).toBe(15);
  });

  it('floors totalAirstars at 0 when reversal exceeds current balance', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const admin = await createAdminUser();
    const user  = await createUser({ totalAirstars: 10, cycleAirstars: 10 });
    await createAirstarLog(user._id, brief._id, { amount: 50 });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await User.findById(user._id);
    expect(updated.totalAirstars).toBe(0);
    expect(updated.cycleAirstars).toBe(0);
  });

  it('does NOT delete AirstarLog entries with briefId:null (daily streak, etc.)', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createAirstarLog(user._id, null, { reason: 'daily_brief', amount: 5 });
    await createAirstarLog(user._id, brief._id, { reason: 'brief_read', amount: 10 });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await AirstarLog.countDocuments({ userId: user._id, reason: 'daily_brief' })).toBe(1);
  });
});

// ── Preservation tests ─────────────────────────────────────────────────────

describe('POST /api/admin/ai/regenerate-description/:id — preserved data', () => {
  it('does NOT delete GameOrderOfBattle records where brief is only a pool choice', async () => {
    mockAiFetch();
    const anchorBrief = await createBrief();
    const choiceBrief = await createBrief();
    const user        = await createUser();
    const admin       = await createAdminUser();

    await GameOrderOfBattle.create({
      anchorBriefId: anchorBrief._id,
      category:      'Aircrafts',
      difficulty:    'easy',
      orderType:     'speed',
      choices:       [{ briefId: choiceBrief._id, correctOrder: 1 }],
    });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${choiceBrief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameOrderOfBattle.countDocuments({ anchorBriefId: anchorBrief._id })).toBe(1);
  });

  it('does NOT alter User.loginStreak', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const admin = await createAdminUser();
    const user  = await createUser({ loginStreak: 7 });

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await User.findById(user._id);
    expect(updated.loginStreak).toBe(7);
  });
});

// ── AdminAction + response shape ──────────────────────────────────────────

describe('POST /api/admin/ai/regenerate-description/:id — audit and response', () => {
  it('creates an AdminAction record with actionType regenerate_description_cascade', async () => {
    mockAiFetch();
    const brief = await createBrief();
    const admin = await createAdminUser();

    await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await AdminAction.countDocuments({ actionType: 'regenerate_description_cascade' })).toBe(1);
  });

  it('returns cascade deletion counts in data.cascade', async () => {
    mockAiFetch();
    const brief    = await createBrief();
    const gameType = await createGameType();
    const user     = await createUser({ totalAirstars: 20, cycleAirstars: 20 });
    const admin    = await createAdminUser();
    await createReadRecord(user._id, brief._id);
    await createQuizQuestions(brief._id, gameType._id, 3);
    await createPassedQuizAttempt(user._id, brief._id);
    await createAirstarLog(user._id, brief._id, { amount: 10 });

    const res = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const c = res.body.data.cascade;
    expect(c.briefReadsMarked).toBe(1);
    expect(c.quizQuestionsDeleted).toBe(3);
    expect(c.quizAttemptsDeleted).toBe(1);
    expect(c.airstarLogsDeleted).toBe(1);
    expect(c.coinsReversed).toBe(10);
    expect(c.usersAffected).toBe(1);
  });

  it('still returns descriptionSections after cascade', async () => {
    mockAiFetch();
    const brief = await createBrief({ title: 'Test Brief' });
    const admin = await createAdminUser();

    const res = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.descriptionSections)).toBe(true);
    expect(res.body.data.descriptionSections.length).toBeGreaterThan(0);
  });
});
