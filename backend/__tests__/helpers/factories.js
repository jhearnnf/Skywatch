const crypto               = require('crypto');
const jwt                  = require('jsonwebtoken');
const mongoose             = require('mongoose');
const User                 = require('../../models/User');
const PasswordResetToken     = require('../../models/PasswordResetToken');
const PasswordResetRateLimit = require('../../models/PasswordResetRateLimit');
const Rank                 = require('../../models/Rank');
const IntelligenceBrief    = require('../../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');
const GameQuizQuestion     = require('../../models/GameQuizQuestion');
const GameSessionQuizAttempt = require('../../models/GameSessionQuizAttempt');
const GameSessionQuizResult  = require('../../models/GameSessionQuizResult');
const GameOrderOfBattle    = require('../../models/GameOrderOfBattle');
const GameSessionOrderOfBattleResult = require('../../models/GameSessionOrderOfBattleResult');
const GameFlashcardRecall  = require('../../models/GameFlashcardRecall');
const GameSessionFlashcardRecallResult = require('../../models/GameSessionFlashcardRecallResult');
const GameWhosAtAircraft   = require('../../models/GameWhosAtAircraft');
const GameSessionWhosAtAircraftResult  = require('../../models/GameSessionWhosAtAircraftResult');
const AircoinLog           = require('../../models/AircoinLog');
const AdminAction          = require('../../models/AdminAction');
const GameType             = require('../../models/GameType');
const AppSettings          = require('../../models/AppSettings');
const IntelLead            = require('../../models/IntelLead');

// ── AppSettings ────────────────────────────────────────────────────────────
async function createSettings(overrides = {}) {
  return AppSettings.findOneAndUpdate(
    { _singleton: true },
    {
      $setOnInsert: {
        _singleton: true,
        aircoinsFirstLogin:    5,
        aircoinsStreakBonus:   2,
        aircoinsPerWinEasy:    10,
        aircoinsPerWinMedium:  20,
        aircoins100Percent:    15,
        passThresholdEasy:     60,
        passThresholdMedium:   60,
        easyAnswerCount:       3,
        mediumAnswerCount:     5,
        freeCategories:        ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'],
        silverCategories:      ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'],
        guestCategories:       ['News'],
        ...overrides,
      },
    },
    { upsert: true, new: true }
  );
}

// ── GameType ───────────────────────────────────────────────────────────────
async function createGameType(overrides = {}) {
  return GameType.findOneAndUpdate(
    { gameTitle: 'quiz' },
    {
      $setOnInsert: {
        gameTitle:        'quiz',
        allowedCategories: ['News', 'Aircrafts', 'Bases', 'Ranks'],
        tutorialSteps:    [],
        gameDescription:  'Answer multiple choice questions',
        awardedAircoins:  10,
        ...overrides,
      },
    },
    { upsert: true, new: true }
  );
}

// ── Rank ───────────────────────────────────────────────────────────────────
async function createRank(overrides = {}) {
  return Rank.create({
    rankNumber:       overrides.rankNumber    ?? 1,
    title:            overrides.title         ?? 'Aircraftsman',
    abbreviation:     overrides.abbreviation  ?? 'AC',
    description:      overrides.description   ?? 'Entry rank',
    aircoinsRequired: overrides.aircoinsRequired ?? 0,
    ...overrides,
  });
}

// ── User ───────────────────────────────────────────────────────────────────
async function createUser(overrides = {}) {
  const defaults = {
    email:             `user_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password:          'Password123',
    difficultySetting: 'easy',
  };
  return User.create({ ...defaults, ...overrides });
}

async function createAdminUser(overrides = {}) {
  return createUser({ isAdmin: true, ...overrides });
}

// Returns a signed JWT cookie string for use in supertest
function authCookie(userId) {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'test_secret', { expiresIn: '7d' });
  return `jwt=${token}`;
}

// ── Brief ──────────────────────────────────────────────────────────────────
async function createBrief(overrides = {}) {
  return IntelligenceBrief.create({
    title:               overrides.title ?? `Test Brief ${Date.now()}`,
    subtitle:            overrides.subtitle ?? '',
    category:            overrides.category ?? 'News',
    descriptionSections: overrides.descriptionSections ?? ['Section one text.', 'Section two text.'],
    keywords:            overrides.keywords ?? [],
    sources:             overrides.sources ?? [],
    isPublished:         overrides.isPublished !== undefined ? overrides.isPublished : true,
    ...overrides,
  });
}

// ── Quiz Questions ─────────────────────────────────────────────────────────
// Creates `count` questions for a brief with exactly 10 answers each (schema requirement)
async function createQuizQuestions(briefId, gameTypeId, count = 5, difficulty = 'easy') {
  const questions = [];
  for (let i = 0; i < count; i++) {
    // Build 10 answers (schema validator requires exactly 10)
    const answers = Array.from({ length: 10 }, (_, j) => ({
      title: j === 0 ? `Correct answer for Q${i}` : `Wrong answer ${j} for Q${i}`,
    }));
    const q = new GameQuizQuestion({
      intelBriefId: briefId,
      gameTypeId,
      question:     `Question ${i + 1}: What is the answer?`,
      difficulty,
      answers,
    });
    // Set correctAnswerId to first answer's auto-generated _id
    q.correctAnswerId = q.answers[0]._id;
    await q.save();
    questions.push(q);
  }
  return questions;
}

// ── BOO Briefs ─────────────────────────────────────────────────────────────
// Creates `count` Aircrafts briefs with topSpeedKph game data for BOO tests
async function createBooBriefs(count, category = 'Aircrafts', overrides = {}) {
  const briefs = [];
  for (let i = 0; i < count; i++) {
    const b = await IntelligenceBrief.create({
      title:               overrides.title ?? `BOO Brief ${Date.now()}_${i}`,
      subtitle:            '',
      category,
      descriptionSections: ['Section text.'],
      keywords:            [],
      sources:             [],
      isPublished:         true,
      gameData: {
        topSpeedKph:     (i + 1) * 500,       // 500, 1000, 1500 … kph
        yearIntroduced:  1980 + i * 5,
        ...( overrides.gameData ?? {} ),
      },
    });
    briefs.push(b);
  }
  return briefs;
}

// ── IntelligenceBriefRead ──────────────────────────────────────────────────
async function createReadRecord(userId, briefId, overrides = {}) {
  return IntelligenceBriefRead.create({
    userId,
    intelBriefId: briefId,
    completed:    overrides.completed !== undefined ? overrides.completed : true,
    coinsAwarded: overrides.coinsAwarded ?? false,
    ...overrides,
  });
}

// ── GameSessionQuizAttempt (won) ───────────────────────────────────────────
async function createPassedQuizAttempt(userId, briefId, overrides = {}) {
  return GameSessionQuizAttempt.create({
    userId,
    intelBriefId:  briefId,
    gameSessionId: `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    difficulty:    overrides.difficulty ?? 'easy',
    status:        'completed',
    won:           true,
    ...overrides,
  });
}

// ── GameOrderOfBattle + GameSessionOrderOfBattleResult (won) ──────────────
async function createWonBooResult(userId, anchorBriefId, overrides = {}) {
  const game = await GameOrderOfBattle.create({
    anchorBriefId,
    category:   overrides.category  ?? 'Aircrafts',
    difficulty: overrides.difficulty ?? 'easy',
    orderType:  overrides.orderType  ?? 'speed',
    choices:    [],
  });
  const result = await GameSessionOrderOfBattleResult.create({
    userId,
    gameId: game._id,
    won:    true,
    userChoices: [],
  });
  return { game, result };
}

// ── GameSessionQuizResult ──────────────────────────────────────────────────
async function createQuizResult(userId, questionId, overrides = {}) {
  return GameSessionQuizResult.create({
    userId,
    questionId,
    gameSessionId: overrides.gameSessionId ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    isCorrect:     overrides.isCorrect ?? true,
    ...overrides,
  });
}

// ── AircoinLog ─────────────────────────────────────────────────────────────
async function createAircoinLog(userId, briefId, overrides = {}) {
  return AircoinLog.create({
    userId,
    briefId:  briefId ?? null,
    amount:   overrides.amount ?? 10,
    reason:   overrides.reason ?? 'brief_read',
    label:    overrides.label  ?? 'Read brief',
    ...overrides,
  });
}

// ── GameFlashcardRecall + result ───────────────────────────────────────────
async function createFlashcardGame(briefId, gameTypeId, overrides = {}) {
  return GameFlashcardRecall.create({
    gameTypeId,
    cards: [{
      intelBriefId:      briefId,
      displayedQuestion: overrides.question ?? 'What is the Typhoon?',
      displayedAnswer:   overrides.answer   ?? 'A fast jet.',
    }],
  });
}

async function createFlashcardResult(userId, gameId, overrides = {}) {
  return GameSessionFlashcardRecallResult.create({
    userId,
    gameId,
    gameSessionId: overrides.gameSessionId ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    cardResults:   [],
    aircoinsEarned: 0,
    ...overrides,
  });
}

// ── GameWhosAtAircraft + result ────────────────────────────────────────────
async function createWhosAtAircraftGame(briefId, gameTypeId, overrides = {}) {
  // Bypass the pre-save hook that validates category by using insertOne directly
  return GameWhosAtAircraft.collection.insertOne({
    _id:               new mongoose.Types.ObjectId(),
    gameTypeId:        new mongoose.Types.ObjectId(gameTypeId),
    intelBriefId:      new mongoose.Types.ObjectId(briefId),
    silhouetteImageUrl: overrides.silhouetteImageUrl ?? 'https://example.com/silhouette.jpg',
  });
}

async function createWhosAtAircraftResult(userId, gameId, overrides = {}) {
  return GameSessionWhosAtAircraftResult.create({
    userId,
    gameId,
    gameSessionId:   overrides.gameSessionId ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    userAnswer:      overrides.userAnswer    ?? 'Typhoon',
    isCorrect:       overrides.isCorrect     ?? true,
    aircoinsEarned:  0,
    ...overrides,
  });
}

// ── PasswordResetToken ─────────────────────────────────────────────────────
async function createPasswordResetToken(email, overrides = {}) {
  const rawToken  = overrides.rawToken ?? crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const doc = await PasswordResetToken.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      tokenHash,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      usedAt:    overrides.usedAt    ?? null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { doc, rawToken, tokenHash };
}

// ── AdminAction ────────────────────────────────────────────────────────────
async function createAdminAction(adminId, overrides = {}) {
  return AdminAction.create({
    userId:     adminId,
    actionType: overrides.actionType ?? 'edit_brief',
    reason:     overrides.reason     ?? 'Test reason',
    ...overrides,
  });
}

// ── IntelLead ──────────────────────────────────────────────────────────────
async function createLead(overrides = {}) {
  return IntelLead.create({
    title:       overrides.title      ?? `Test Lead ${Date.now()}_${Math.random().toString(36).slice(2)}`,
    nickname:    overrides.nickname   ?? '',
    subtitle:    overrides.subtitle   ?? '',
    category:    overrides.category   ?? 'News',
    subcategory: overrides.subcategory ?? '',
    section:     overrides.section    ?? '',
    subsection:  overrides.subsection ?? '',
    isPublished: overrides.isPublished !== undefined ? overrides.isPublished : false,
    ...overrides,
  });
}

module.exports = {
  createSettings,
  createLead,
  createGameType,
  createRank,
  createUser,
  createAdminUser,
  authCookie,
  createBrief,
  createQuizQuestions,
  createQuizResult,
  createBooBriefs,
  createReadRecord,
  createPassedQuizAttempt,
  createWonBooResult,
  createAircoinLog,
  createFlashcardGame,
  createFlashcardResult,
  createWhosAtAircraftGame,
  createWhosAtAircraftResult,
  createAdminAction,
  createPasswordResetToken,
};
