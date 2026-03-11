const jwt                  = require('jsonwebtoken');
const User                 = require('../../models/User');
const Rank                 = require('../../models/Rank');
const IntelligenceBrief    = require('../../models/IntelligenceBrief');
const GameQuizQuestion     = require('../../models/GameQuizQuestion');
const GameType             = require('../../models/GameType');
const AppSettings          = require('../../models/AppSettings');

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

module.exports = {
  createSettings,
  createGameType,
  createRank,
  createUser,
  createAdminUser,
  authCookie,
  createBrief,
  createQuizQuestions,
};
