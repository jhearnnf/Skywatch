process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const mongoose = require('mongoose');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const Level   = require('../../models/Level');
const Rank    = require('../../models/Rank');
const { CYCLE_THRESHOLD } = require('../../utils/awardCoins');
const {
  createAdminUser,
  createSettings,
  authCookie,
} = require('../helpers/factories');

const ENDPOINT = '/api/admin/economy-viability';

// Seed 10 level docs matching the real curve
async function seedLevels() {
  const levels = [
    { levelNumber: 1,  aircoinsToNextLevel: 100  },
    { levelNumber: 2,  aircoinsToNextLevel: 250  },
    { levelNumber: 3,  aircoinsToNextLevel: 500  },
    { levelNumber: 4,  aircoinsToNextLevel: 850  },
    { levelNumber: 5,  aircoinsToNextLevel: 1300 },
    { levelNumber: 6,  aircoinsToNextLevel: 1850 },
    { levelNumber: 7,  aircoinsToNextLevel: 2500 },
    { levelNumber: 8,  aircoinsToNextLevel: 3250 },
    { levelNumber: 9,  aircoinsToNextLevel: 4100 },
    { levelNumber: 10, aircoinsToNextLevel: null  },
  ];
  await Level.insertMany(levels);
}

let admin, cookie;

beforeAll(async () => { await db.connect(); });
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

beforeEach(async () => {
  await createSettings({
    aircoinsPerBriefRead:        5,
    aircoinsPerWinEasy:          10,
    aircoinsPerWinMedium:        20,
    aircoins100Percent:          15,
    aircoinsOrderOfBattleEasy:   8,
    aircoinsOrderOfBattleMedium: 18,
    aircoinsWhereAircraftRound1: 5,
    aircoinsWhereAircraftRound2: 10,
    aircoinsWhereAircraftBonus:  5,
  });
  await seedLevels();
  admin  = await createAdminUser();
  cookie = authCookie(admin._id);
});

// ── Auth guard ─────────────────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get(ENDPOINT);
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as non-admin', async () => {
    const { createUser } = require('../helpers/factories');
    const user   = await createUser();
    const cookie = authCookie(user._id);
    const res    = await request(app).get(ENDPOINT).set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});

// ── Empty DB ───────────────────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — no content', () => {
  it('returns zeros when no published briefs or ranks exist', async () => {
    const res = await request(app).get(ENDPOINT).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const { normal, advanced, content } = res.body.data;
    expect(content.totalBriefs).toBe(0);
    expect(normal.total).toBe(0);
    expect(advanced.total).toBe(0);
    expect(normal.completedCycles).toBe(0);
    expect(normal.finalRank).toBeNull();
  });
});

// ── Coin arithmetic ────────────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — arithmetic', () => {
  beforeEach(async () => {
    const fakeId = () => new mongoose.Types.ObjectId();

    // Brief 1: Aircrafts, BOO-eligible, 3 easy + 2 medium questions
    await IntelligenceBrief.create({
      title:               'Eurofighter Typhoon',
      category:            'Aircrafts',
      descriptionSections: ['Text.'],
      gameData:            { topSpeedKph: 1500 },
      quizQuestionsEasy:   [fakeId(), fakeId(), fakeId()],
      quizQuestionsMedium: [fakeId(), fakeId()],
    });

    // Brief 2: News, no BOO, no questions
    await IntelligenceBrief.create({
      title:               'RAF News Item',
      category:            'News',
      descriptionSections: ['Text.'],
    });

    // Brief 3: Ranks, BOO-eligible, 1 easy + 4 medium questions
    await IntelligenceBrief.create({
      title:               'Flight Lieutenant',
      category:            'Ranks',
      descriptionSections: ['Text.'],
      gameData:            { rankHierarchyOrder: 7 },
      quizQuestionsEasy:   [fakeId()],
      quizQuestionsMedium: [fakeId(), fakeId(), fakeId(), fakeId()],
    });
  });

  it('returns correct content summary', async () => {
    const res = await request(app).get(ENDPOINT).set('Cookie', cookie);
    const { content } = res.body.data;

    expect(content.totalBriefs).toBe(3);
    expect(content.booEligibleBriefs).toBe(2); // Aircrafts + Ranks
    expect(content.totalEasyQ).toBe(4);        // 3 + 0 + 1
    expect(content.briefsWithEasyQ).toBe(2);
    expect(content.totalMediumQ).toBe(6);      // 2 + 0 + 4
    expect(content.briefsWithMediumQ).toBe(2);
    expect(content.wtaPerBrief).toBe(20);      // 5 + 10 + 5
  });

  it('calculates correct Normal total', async () => {
    const res = await request(app).get(ENDPOINT).set('Cookie', cookie);
    const { normal } = res.body.data;

    // reads: 3 × 5 = 15
    // quiz:  4 × 10 + 2 × 15 = 40 + 30 = 70
    // boo:   2 × 8 = 16
    // wta:   3 × 20 = 60
    // total: 161
    expect(normal.reads).toBe(15);
    expect(normal.quiz).toBe(70);
    expect(normal.boo).toBe(16);
    expect(normal.wta).toBe(60);
    expect(normal.total).toBe(161);
  });

  it('calculates correct Advanced total', async () => {
    const res = await request(app).get(ENDPOINT).set('Cookie', cookie);
    const { advanced } = res.body.data;

    // reads: 3 × 5 = 15
    // quiz:  6 × 20 + 2 × 15 = 120 + 30 = 150
    // boo:   2 × 18 = 36
    // wta:   3 × 20 = 60
    // total: 261
    expect(advanced.reads).toBe(15);
    expect(advanced.quiz).toBe(150);
    expect(advanced.boo).toBe(36);
    expect(advanced.wta).toBe(60);
    expect(advanced.total).toBe(261);
  });

  it('reports correct level when coins are below first cycle threshold', async () => {
    const res = await request(app).get(ENDPOINT).set('Cookie', cookie);
    const { normal, advanced } = res.body.data;

    // 161 coins: L1 needs 100 to advance → passes L1, L2 needs 250 more → 161 < 350 cumulative → L2
    expect(normal.finalLevel).toBe(2);
    expect(normal.completedCycles).toBe(0);
    expect(normal.finalRank).toBeNull();

    // 261 coins: cumulative to L3 = 350 → 261 < 350 → L2
    expect(advanced.finalLevel).toBe(2);
    expect(advanced.completedCycles).toBe(0);
  });
});

// ── Rank promotion logic ───────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — rank progression', () => {
  beforeEach(async () => {
    await Rank.insertMany([
      { rankNumber: 1, rankType: 'enlisted_aviator',      rankName: 'Aircraftman',          rankAbbreviation: 'AC'  },
      { rankNumber: 2, rankType: 'enlisted_aviator',      rankName: 'Leading Aircraftman',   rankAbbreviation: 'LAC' },
      { rankNumber: 3, rankType: 'non_commissioned_aircrew', rankName: 'Senior Aircraftman', rankAbbreviation: 'SAC' },
    ]);
  });

  it('correctly counts rank promotions and identifies final rank + level', async () => {
    // Build enough content to earn 2 full cycles (29400 coins) in Advanced scenario
    // CYCLE_THRESHOLD = 14700, so we need total ≥ 29400 advanced coins
    // Each brief (advanced): 5 (read) + 20×20 (med quiz) + 15 (100% bonus) + 18 (BOO) + 20 (WTA) = 458
    // Need ≥ 65 briefs. Let's use a simpler approach: create briefs and check arithmetic.

    // Use 60 Aircrafts briefs each with 10 medium questions + BOO gameData
    // Advanced per brief: 5 + (10×20 + 15) + 18 + 20 = 5 + 215 + 18 + 20 = 258
    // 60 briefs × 258 = 15480 → 1 full cycle (15480 > 14700), completedCycles = 1
    const fakeId = () => new mongoose.Types.ObjectId();
    const medQs  = Array.from({ length: 10 }, fakeId);
    for (let i = 0; i < 60; i++) {
      await IntelligenceBrief.create({
        title:               `Aircraft ${i}`,
        category:            'Aircrafts',
        descriptionSections: ['Text.'],
        isPublished:         true,
        gameData:            { topSpeedKph: (i + 1) * 100 },
        quizQuestionsMedium: medQs,
      });
    }

    const res = await request(app).get(ENDPOINT).set('Cookie', cookie);
    expect(res.status).toBe(200);

    const { advanced, totalRanks, cycleThreshold } = res.body.data;
    expect(cycleThreshold).toBe(CYCLE_THRESHOLD);
    expect(totalRanks).toBe(3);

    // 60 × 258 = 15480 total advanced coins
    expect(advanced.total).toBe(60 * (5 + (10 * 20 + 15) + 18 + 20));
    // 1 completed cycle → rank 1 (Aircraftman)
    expect(advanced.completedCycles).toBe(1);
    expect(advanced.finalRank.rankName).toBe('Aircraftman');
    expect(advanced.atMaxRank).toBe(false);
    expect(advanced.shortfall).toBeGreaterThan(0);
  });

  it('marks atMaxRank true when coins cover all rank cycles', async () => {
    // Need ≥ 3 × 14700 = 44100 advanced coins
    // Advanced per brief: 5 + 215 + 18 + 20 = 258
    // ceil(44100/258) = 171 briefs
    const fakeId = () => new mongoose.Types.ObjectId();
    const medQs  = Array.from({ length: 10 }, fakeId);
    for (let i = 0; i < 175; i++) {
      await IntelligenceBrief.create({
        title:               `Aircraft ${i}`,
        category:            'Aircrafts',
        descriptionSections: ['Text.'],
        isPublished:         true,
        gameData:            { topSpeedKph: (i + 1) * 100 },
        quizQuestionsMedium: medQs,
      });
    }

    const res = await request(app).get(ENDPOINT).set('Cookie', cookie);
    const { advanced } = res.body.data;

    expect(advanced.completedCycles).toBe(3); // capped at totalRanks
    expect(advanced.atMaxRank).toBe(true);
    expect(advanced.finalRank.rankName).toBe('Senior Aircraftman');
    expect(advanced.shortfall).toBe(0);
  });
});
