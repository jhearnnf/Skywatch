/**
 * admin.briefs.regenerate-cascade.test.js
 *
 * Integration tests for POST /api/admin/briefs/:id/confirm-regeneration.
 * Verifies that every collection tied to a brief is wiped and user coins
 * are correctly reversed when an admin confirms a regeneration.
 */

process.env.JWT_SECRET = 'test_secret';

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
afterEach(async () => { await db.clearDatabase(); });
afterAll(() => {});

const REASON = 'Test cascade regeneration';

// ── Auth / input guards ────────────────────────────────────────────────────

describe('POST /api/admin/briefs/:id/confirm-regeneration — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const brief = await createBrief();
    const res   = await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .send({ reason: REASON });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const res   = await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(user._id))
      .send({ reason: REASON });
    expect(res.status).toBe(403);
  });

  it('returns 400 when reason is missing', async () => {
    const brief = await createBrief();
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reason/i);
  });

  it('returns 404 when brief does not exist', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/briefs/${new mongoose.Types.ObjectId()}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });
    expect(res.status).toBe(404);
  });
});

// ── Cascade deletion per collection ───────────────────────────────────────

describe('POST /api/admin/briefs/:id/confirm-regeneration — cascade deletions', () => {
  it('marks IntelligenceBriefRead records as deleted for the brief', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createReadRecord(user._id, brief._id);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const record = await IntelligenceBriefRead.findOne({ intelBriefId: brief._id });
    expect(record).not.toBeNull();
    expect(record.briefDeletedNote).toBe('Brief deleted or re-created');
    expect(record.completed).toBe(false);
    expect(record.coinsAwarded).toBe(false);
  });

  it('deletes GameQuizQuestion records for the brief', async () => {
    const brief    = await createBrief();
    const gameType = await createGameType();
    const admin    = await createAdminUser();
    await createQuizQuestions(brief._id, gameType._id, 5);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameQuizQuestion.countDocuments({ intelBriefId: brief._id })).toBe(0);
  });

  it('deletes GameSessionQuizAttempt records for the brief', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createPassedQuizAttempt(user._id, brief._id);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionQuizAttempt.countDocuments({ intelBriefId: brief._id })).toBe(0);
  });

  it('deletes GameSessionQuizResult records for questions belonging to the brief', async () => {
    const brief    = await createBrief();
    const gameType = await createGameType();
    const user     = await createUser();
    const admin    = await createAdminUser();
    const [question] = await createQuizQuestions(brief._id, gameType._id, 1);
    await createQuizResult(user._id, question._id);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionQuizResult.countDocuments({ questionId: question._id })).toBe(0);
  });

  it('deletes GameOrderOfBattle records where brief is the anchor', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createWonBooResult(user._id, brief._id);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameOrderOfBattle.countDocuments({ anchorBriefId: brief._id })).toBe(0);
  });

  it('deletes GameSessionOrderOfBattleResult records for anchor-brief BOO games', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    const { game } = await createWonBooResult(user._id, brief._id);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionOrderOfBattleResult.countDocuments({ gameId: game._id })).toBe(0);
  });

  it('deletes GameFlashcardRecall records containing cards for this brief', async () => {
    const brief    = await createBrief();
    const gameType = await createGameType();
    const admin    = await createAdminUser();
    await createFlashcardGame(brief._id, gameType._id);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameFlashcardRecall.countDocuments({ 'cards.intelBriefId': brief._id })).toBe(0);
  });

  it('deletes GameSessionFlashcardRecallResult records for affected flashcard games', async () => {
    const brief    = await createBrief();
    const gameType = await createGameType();
    const user     = await createUser();
    const admin    = await createAdminUser();
    const game     = await createFlashcardGame(brief._id, gameType._id);
    await createFlashcardResult(user._id, game._id);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionFlashcardRecallResult.countDocuments({ gameId: game._id })).toBe(0);
  });

  it('deletes GameWheresThatAircraft records for this brief', async () => {
    const brief    = await createBrief({ category: 'Aircrafts' });
    const gameType = await createGameType();
    const admin    = await createAdminUser();
    const result   = await createWheresThatAircraftGame(brief._id, gameType._id);
    const gameId   = result.insertedId;

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameWheresThatAircraft.countDocuments({ intelBriefId: brief._id })).toBe(0);
  });

  it('deletes GameSessionWheresThatAircraftResult records for affected WAA games', async () => {
    const brief    = await createBrief({ category: 'Aircrafts' });
    const gameType = await createGameType();
    const user     = await createUser();
    const admin    = await createAdminUser();
    const result   = await createWheresThatAircraftGame(brief._id, gameType._id);
    const gameId   = result.insertedId;
    await createWheresThatAircraftResult(user._id, gameId);

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameSessionWheresThatAircraftResult.countDocuments({ gameId })).toBe(0);
  });

  it('deletes AirstarLog entries with matching briefId', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    await createAirstarLog(user._id, brief._id, { reason: 'brief_read', amount: 10 });
    await createAirstarLog(user._id, brief._id, { reason: 'quiz',       amount: 20 });

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await AirstarLog.countDocuments({ briefId: brief._id })).toBe(0);
  });

  it('clears quizQuestionsEasy and quizQuestionsMedium arrays on the brief document', async () => {
    const gameType = await createGameType();
    const admin    = await createAdminUser();
    const brief    = await createBrief();

    // Assign question IDs directly on the brief doc to simulate a populated brief
    const easyQs   = await createQuizQuestions(brief._id, gameType._id, 3, 'easy');
    const mediumQs = await createQuizQuestions(brief._id, gameType._id, 3, 'medium');
    await IntelligenceBrief.findByIdAndUpdate(brief._id, {
      $set: {
        quizQuestionsEasy:   easyQs.map(q => q._id),
        quizQuestionsMedium: mediumQs.map(q => q._id),
      },
    });

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await IntelligenceBrief.findById(brief._id);
    expect(updated.quizQuestionsEasy).toHaveLength(0);
    expect(updated.quizQuestionsMedium).toHaveLength(0);
  });
});

// ── Coin reversal ──────────────────────────────────────────────────────────

describe('POST /api/admin/briefs/:id/confirm-regeneration — coin reversal', () => {
  it('decrements User.totalAirstars by the sum of deleted log amounts', async () => {
    const brief = await createBrief();
    const admin = await createAdminUser();
    const user  = await createUser({ totalAirstars: 50, cycleAirstars: 50 });
    await createAirstarLog(user._id, brief._id, { amount: 30 });

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await User.findById(user._id);
    expect(updated.totalAirstars).toBe(20);
  });

  it('decrements User.cycleAirstars by the sum of deleted log amounts', async () => {
    const brief = await createBrief();
    const admin = await createAdminUser();
    const user  = await createUser({ totalAirstars: 50, cycleAirstars: 40 });
    await createAirstarLog(user._id, brief._id, { amount: 25 });

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await User.findById(user._id);
    expect(updated.cycleAirstars).toBe(15);
  });

  it('floors totalAirstars at 0 when reversal exceeds current balance', async () => {
    const brief = await createBrief();
    const admin = await createAdminUser();
    const user  = await createUser({ totalAirstars: 10, cycleAirstars: 10 });
    await createAirstarLog(user._id, brief._id, { amount: 50 });

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await User.findById(user._id);
    expect(updated.totalAirstars).toBe(0);
    expect(updated.cycleAirstars).toBe(0);
  });

  it('reverses coins for multiple users independently', async () => {
    const brief  = await createBrief();
    const admin  = await createAdminUser();
    const userA  = await createUser({ totalAirstars: 100, cycleAirstars: 100 });
    const userB  = await createUser({ totalAirstars: 60,  cycleAirstars: 60  });
    await createAirstarLog(userA._id, brief._id, { amount: 30 });
    await createAirstarLog(userB._id, brief._id, { amount: 15 });

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const [a, b] = await Promise.all([User.findById(userA._id), User.findById(userB._id)]);
    expect(a.totalAirstars).toBe(70);
    expect(b.totalAirstars).toBe(45);
  });

  it('does NOT delete AirstarLog entries with briefId:null (daily streak, etc.)', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const admin = await createAdminUser();
    // daily_brief log has no briefId
    await createAirstarLog(user._id, null, { reason: 'daily_brief', amount: 5 });
    await createAirstarLog(user._id, brief._id, { reason: 'brief_read', amount: 10 });

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    // The daily_brief log must still exist
    expect(await AirstarLog.countDocuments({ userId: user._id, reason: 'daily_brief' })).toBe(1);
  });
});

// ── Preservation tests ─────────────────────────────────────────────────────

describe('POST /api/admin/briefs/:id/confirm-regeneration — preserved data', () => {
  it('does NOT delete GameOrderOfBattle records where brief is only a pool choice', async () => {
    const anchorBrief = await createBrief();
    const choiceBrief = await createBrief();
    const user        = await createUser();
    const admin       = await createAdminUser();

    // Create a BOO game anchored to anchorBrief; choiceBrief appears only as a choice
    await GameOrderOfBattle.create({
      anchorBriefId: anchorBrief._id,
      category:      'Aircrafts',
      difficulty:    'easy',
      orderType:     'speed',
      choices:       [{ briefId: choiceBrief._id, correctOrder: 1 }],
    });

    // Regenerate choiceBrief — should NOT delete the BOO game
    await request(app)
      .post(`/api/admin/briefs/${choiceBrief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await GameOrderOfBattle.countDocuments({ anchorBriefId: anchorBrief._id })).toBe(1);
  });

  it('does NOT alter User.loginStreak', async () => {
    const brief = await createBrief();
    const admin = await createAdminUser();
    const user  = await createUser({ loginStreak: 7 });

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    const updated = await User.findById(user._id);
    expect(updated.loginStreak).toBe(7);
  });
});

// ── AdminAction + response shape ───────────────────────────────────────────

describe('POST /api/admin/briefs/:id/confirm-regeneration — audit and response', () => {
  it('creates an AdminAction record with actionType regenerate_brief_cascade', async () => {
    const brief = await createBrief();
    const admin = await createAdminUser();

    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(await AdminAction.countDocuments({ actionType: 'regenerate_brief_cascade' })).toBe(1);
  });

  it('returns deletion counts in the response body', async () => {
    const brief    = await createBrief();
    const gameType = await createGameType();
    const user     = await createUser({ totalAirstars: 20, cycleAirstars: 20 });
    const admin    = await createAdminUser();
    await createReadRecord(user._id, brief._id);
    await createQuizQuestions(brief._id, gameType._id, 3);
    await createPassedQuizAttempt(user._id, brief._id);
    await createWonBooResult(user._id, brief._id);
    await createAirstarLog(user._id, brief._id, { amount: 10 });

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const d = res.body.data;
    expect(d.briefReadsMarked).toBe(1);
    expect(d.quizQuestionsDeleted).toBe(3);
    expect(d.quizAttemptsDeleted).toBe(1);
    expect(d.booGamesDeleted).toBe(1);
    expect(d.booResultsDeleted).toBe(1);
    expect(d.airstarLogsDeleted).toBe(1);
    expect(d.coinsReversed).toBe(10);
    expect(d.usersAffected).toBe(1);
  });

  it('handles a brief with no associated data gracefully (all counts zero)', async () => {
    const brief = await createBrief();
    const admin = await createAdminUser();

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.data.quizQuestionsDeleted).toBe(0);
    expect(res.body.data.airstarLogsDeleted).toBe(0);
    expect(res.body.data.coinsReversed).toBe(0);
  });

  it('is idempotent — double cascade produces no orphaned documents', async () => {
    const brief    = await createBrief();
    const gameType = await createGameType();
    const user     = await createUser({ totalAirstars: 30 });
    const admin    = await createAdminUser();
    await createQuizQuestions(brief._id, gameType._id, 2);
    await createReadRecord(user._id, brief._id);
    await createAirstarLog(user._id, brief._id, { amount: 10 });

    // First cascade
    await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    // Second cascade — should succeed with all-zero counts
    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/confirm-regeneration`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.data.quizQuestionsDeleted).toBe(0);
    expect(res.body.data.airstarLogsDeleted).toBe(0);
    // Hard-deleted collections are empty; brief-read is preserved (soft-deleted)
    expect(await GameQuizQuestion.countDocuments({ intelBriefId: brief._id })).toBe(0);
    const reads = await IntelligenceBriefRead.find({ intelBriefId: brief._id });
    expect(reads).toHaveLength(1);
    expect(reads[0].briefDeletedNote).toBe('Brief deleted or re-created');
    expect(reads[0].completed).toBe(false);
  });
});
