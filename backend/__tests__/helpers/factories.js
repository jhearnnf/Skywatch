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
const GameWheresThatAircraft   = require('../../models/GameWheresThatAircraft');
const GameSessionWheresThatAircraftResult  = require('../../models/GameSessionWheresThatAircraftResult');
const AirstarLog           = require('../../models/AirstarLog');
const AdminAction          = require('../../models/AdminAction');
const GameType             = require('../../models/GameType');
const AppSettings          = require('../../models/AppSettings');
const IntelLead            = require('../../models/IntelLead');
const { SUBCATEGORIES }    = require('../../constants/categories');

// Pick a deterministic default subcategory for tests that don't care which one
// is used. Returns '' for categories that define no subcategories (e.g. News).
function defaultSubcategory(category) {
  const subs = SUBCATEGORIES[category] ?? [];
  return subs[0] ?? '';
}

// Permissive pathway unlocks used as the default in tests: every category is
// accessible from the start (level 1, rank 1) so subscription-only tests are
// not affected by pathway gating. Override in pathway-specific tests.
const PERMISSIVE_PATHWAY_UNLOCKS = [
  'News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training',
  'Roles', 'Threats', 'Allies', 'Missions', 'AOR', 'Tech',
  'Terminology', 'Treaties', 'Heritage', 'Actors',
].map(category => ({ category, levelRequired: 1, rankRequired: 1 }));

// ── AppSettings ────────────────────────────────────────────────────────────
async function createSettings(overrides = {}) {
  // $setOnInsert seeds defaults on first call; $set applies overrides on every
  // call so tests can tighten settings mid-test (e.g. narrow freeCategories).
  // Any key present in overrides is excluded from $setOnInsert to avoid Mongo's
  // "conflict at path" error when the same key appears in both operators.
  const defaults = {
    _singleton: true,
    airstarsFirstLogin:         5,
    airstarsStreakBonus:        2,
    airstarsPerWinEasy:         10,
    airstarsPerWinMedium:       20,
    airstars100Percent:         15,
    passThresholdEasy:          60,
    passThresholdMedium:        60,
    easyAnswerCount:            3,
    mediumAnswerCount:          5,
    emailConfirmationEnabled:   false,
    // Permissive Case Files defaults so existing fixtures don't have to opt in;
    // gating-specific tests override these explicitly.
    caseFilesEnabled:           true,
    caseFilesTiers:             ['admin', 'gold', 'silver', 'free'],
    caseFilesDailyLimitFree:    100,
    caseFilesDailyLimitSilver:  100,
    caseFilesDailyLimitGold:    100,
    freeCategories:        ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'],
    silverCategories:      ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'],
    guestCategories:       ['News'],
    pathwayUnlocks:        PERMISSIVE_PATHWAY_UNLOCKS,
  };
  const setOnInsert = Object.fromEntries(
    Object.entries(defaults).filter(([k]) => !(k in overrides))
  );
  return AppSettings.findOneAndUpdate(
    { _singleton: true },
    {
      $setOnInsert: setOnInsert,
      ...(Object.keys(overrides).length ? { $set: overrides } : {}),
    },
    { upsert: true, returnDocument: 'after' }
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
        awardedAirstars:  10,
        ...overrides,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
}

// ── Rank ───────────────────────────────────────────────────────────────────
async function createRank(overrides = {}) {
  return Rank.create({
    rankNumber:       overrides.rankNumber       ?? 1,
    rankName:         overrides.rankName         ?? 'Aircraftman',
    rankAbbreviation: overrides.rankAbbreviation ?? 'AC',
    rankType:         overrides.rankType         ?? 'enlisted_aviator',
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
  const category = overrides.category ?? 'News';
  return IntelligenceBrief.create({
    title:               overrides.title ?? `Test Brief ${Date.now()}`,
    subtitle:            overrides.subtitle ?? '',
    category,
    subcategory:         overrides.subcategory ?? defaultSubcategory(category),
    descriptionSections: overrides.descriptionSections ?? ['Section one text.', 'Section two text.'],
    keywords:            overrides.keywords ?? [],
    sources:             overrides.sources ?? [],
    isPublished:         overrides.isPublished !== undefined ? overrides.isPublished : true,
    status:              overrides.status ?? 'published',
    ...overrides,
  });
}

// ── Quiz Questions ─────────────────────────────────────────────────────────
// Creates `count` questions for a brief with exactly 7 answers each (schema requirement)
async function createQuizQuestions(briefId, gameTypeId, count = 5, difficulty = 'easy') {
  const questions = [];
  for (let i = 0; i < count; i++) {
    // Build 7 answers (schema validator requires exactly 7)
    const answers = Array.from({ length: 7 }, (_, j) => ({
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
      subcategory:         overrides.subcategory ?? defaultSubcategory(category),
      descriptionSections: ['Section text.'],
      keywords:            [],
      sources:             [],
      isPublished:         true,
      status:              'published',
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

// Creates `count` Training briefs with trainingWeekStart + weeksOfTraining for BOO tests
async function createTrainingBooBriefs(count, overrides = {}) {
  const briefs = [];
  for (let i = 0; i < count; i++) {
    const b = await IntelligenceBrief.create({
      title:               overrides.title ?? `Training Brief ${Date.now()}_${i}`,
      subtitle:            '',
      category:            'Training',
      subcategory:         overrides.subcategory ?? defaultSubcategory('Training'),
      descriptionSections: ['Section text.'],
      keywords:            [],
      sources:             [],
      isPublished:         true,
      status:              'published',
      gameData: {
        trainingWeekStart: (i + 1) * 2,        // 2, 4, 6 … pipeline start
        trainingWeekEnd:   (i + 1) * 2 + 1,    // 3, 5, 7 …
        weeksOfTraining:   (i + 1) * 4,        // 4, 8, 12 … weeks duration
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

// ── AirstarLog ─────────────────────────────────────────────────────────────
async function createAirstarLog(userId, briefId, overrides = {}) {
  return AirstarLog.create({
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
    airstarsEarned: 0,
    ...overrides,
  });
}

// ── GameWheresThatAircraft + result ────────────────────────────────────────────
async function createWheresThatAircraftGame(briefId, gameTypeId, overrides = {}) {
  // Bypass the pre-save hook that validates category by using insertOne directly
  return GameWheresThatAircraft.collection.insertOne({
    _id:               new mongoose.Types.ObjectId(),
    gameTypeId:        new mongoose.Types.ObjectId(gameTypeId),
    intelBriefId:      new mongoose.Types.ObjectId(briefId),
    silhouetteImageUrl: overrides.silhouetteImageUrl ?? 'https://example.com/silhouette.jpg',
  });
}

async function createWheresThatAircraftResult(userId, gameId, overrides = {}) {
  return GameSessionWheresThatAircraftResult.create({
    userId,
    gameId,
    gameSessionId:   overrides.gameSessionId ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    userAnswer:      overrides.userAnswer    ?? 'Typhoon',
    isCorrect:       overrides.isCorrect     ?? true,
    airstarsEarned:  0,
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
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
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
  createTrainingBooBriefs,
  createReadRecord,
  createPassedQuizAttempt,
  createWonBooResult,
  createAirstarLog,
  createFlashcardGame,
  createFlashcardResult,
  createWheresThatAircraftGame,
  createWheresThatAircraftResult,
  createAdminAction,
  createPasswordResetToken,
};
