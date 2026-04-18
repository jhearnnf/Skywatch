process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const mongoose = require('mongoose');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const Level      = require('../../models/Level');
const Rank       = require('../../models/Rank');
const AppSettings = require('../../models/AppSettings');
const AdminAction = require('../../models/AdminAction');
const { CYCLE_THRESHOLD } = require('../../utils/awardCoins');
const {
  createAdminUser,
  createUser,
  createSettings,
  authCookie,
} = require('../helpers/factories');

const GET_ENDPOINT    = '/api/admin/economy-viability';
const LEVELS_ENDPOINT = '/api/admin/economy/levels';
const APPLY_ENDPOINT  = '/api/admin/economy/apply';

// Seed 10 level docs matching the real curve
async function seedLevels(overrides = {}) {
  const defaults = [
    { levelNumber: 1,  airstarsToNextLevel: 100  },
    { levelNumber: 2,  airstarsToNextLevel: 250  },
    { levelNumber: 3,  airstarsToNextLevel: 500  },
    { levelNumber: 4,  airstarsToNextLevel: 850  },
    { levelNumber: 5,  airstarsToNextLevel: 1300 },
    { levelNumber: 6,  airstarsToNextLevel: 1850 },
    { levelNumber: 7,  airstarsToNextLevel: 2500 },
    { levelNumber: 8,  airstarsToNextLevel: 3250 },
    { levelNumber: 9,  airstarsToNextLevel: 4100 },
    { levelNumber: 10, airstarsToNextLevel: null  },
  ];
  const levels = defaults.map(l => ({ ...l, ...(overrides[l.levelNumber] ?? {}) }));
  await Level.insertMany(levels);
}

let admin, cookie;

beforeAll(async () => { await db.connect(); });
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

beforeEach(async () => {
  await createSettings({
    airstarsPerBriefRead:          5,
    airstarsPerWinEasy:            10,
    airstarsPerWinMedium:          20,
    airstars100Percent:            15,
    airstarsOrderOfBattleEasy:     8,
    airstarsOrderOfBattleMedium:   18,
    airstarsWhereAircraftRound1:   5,
    airstarsWhereAircraftRound2:   10,
    airstarsWhereAircraftBonus:    5,
    airstarsFlashcardPerCard:      2,
    airstarsFlashcardPerfectBonus: 5,
    airstarsFirstLogin:            5,
    airstarsStreakBonus:           2,
  });
  await seedLevels();
  admin  = await createAdminUser();
  cookie = authCookie(admin._id);
});

// ── GET auth guard ─────────────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get(GET_ENDPOINT);
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as non-admin', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);
    const res    = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});

// ── GET no content ─────────────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — no content', () => {
  it('returns zeros when no briefs or ranks exist', async () => {
    const res = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
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

// ── GET content counts ─────────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — content counts', () => {
  beforeEach(async () => {
    // 2 Aircrafts (WTA + BOO), 1 Ranks (BOO only), 1 News (neither)
    await IntelligenceBrief.insertMany([
      { title: 'Typhoon',     category: 'Aircrafts', descriptionSections: ['x'] },
      { title: 'Tornado',     category: 'Aircrafts', descriptionSections: ['x'] },
      { title: 'Flt Lt',     category: 'Ranks',     descriptionSections: ['x'] },
      { title: 'RAF News',   category: 'News',      descriptionSections: ['x'] },
    ]);
  });

  it('counts wtaBriefs as Aircrafts-only', async () => {
    const res = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
    expect(res.body.data.content.totalBriefs).toBe(4);
    expect(res.body.data.content.wtaBriefs).toBe(2);      // Aircrafts only
  });

  it('counts booEligibleBriefs by category regardless of gameData', async () => {
    const res = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
    expect(res.body.data.content.booEligibleBriefs).toBe(3); // Aircrafts + Ranks
  });

  it('returns all expected rate fields including login/streak', async () => {
    const res = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
    const { rates } = res.body.data;
    expect(rates.airstarsFirstLogin).toBe(5);
    expect(rates.airstarsStreakBonus).toBe(2);
    expect(rates.airstarsFlashcardPerCard).toBe(2);
    expect(rates.airstarsFlashcardPerfectBonus).toBe(5);
  });
});

// ── GET coin arithmetic ────────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — arithmetic', () => {
  beforeEach(async () => {
    // 3 briefs: 2 Aircrafts (WTA+BOO), 1 Ranks (BOO), 1 News (neither)
    await IntelligenceBrief.insertMany([
      { title: 'Aircraft A', category: 'Aircrafts', descriptionSections: ['x'] },
      { title: 'Aircraft B', category: 'Aircrafts', descriptionSections: ['x'] },
      { title: 'Rank A',     category: 'Ranks',     descriptionSections: ['x'] },
      { title: 'News A',     category: 'News',       descriptionSections: ['x'] },
    ]);
  });

  it('calculates correct Normal total (4 briefs, 5q each, WTA=aircraft only, BOO=3)', async () => {
    const res = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
    const { normal, content } = res.body.data;

    // reads:   4 × 5  = 20
    // quiz:    4×5×10 + 4×15 = 200 + 60 = 260
    // boo:     3 × 8  = 24
    // wta:     2 × 20 = 40   (aircraft only, WTA rate = 5+10+5)
    // total:   20 + 260 + 24 + 40 = 344
    expect(normal.reads).toBe(20);
    expect(normal.quiz).toBe(260);
    expect(normal.boo).toBe(24);
    expect(normal.wta).toBe(40);
    expect(normal.total).toBe(344);
    expect(content.wtaBriefs).toBe(2);
    expect(content.booEligibleBriefs).toBe(3);
  });

  it('calculates correct Advanced total', async () => {
    const res = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
    const { advanced } = res.body.data;

    // reads:   4 × 5   = 20
    // quiz:    4×5×20 + 4×15 = 400 + 60 = 460
    // boo:     3 × 18  = 54
    // wta:     2 × 20  = 40
    // total:   20 + 460 + 54 + 40 = 574
    expect(advanced.reads).toBe(20);
    expect(advanced.quiz).toBe(460);
    expect(advanced.boo).toBe(54);
    expect(advanced.wta).toBe(40);
    expect(advanced.total).toBe(574);
  });
});

// ── GET rank progression ───────────────────────────────────────────────────
describe('GET /api/admin/economy-viability — rank progression', () => {
  beforeEach(async () => {
    await Rank.insertMany([
      { rankNumber: 1, rankType: 'enlisted_aviator',       rankName: 'Aircraftman',        rankAbbreviation: 'AC'  },
      { rankNumber: 2, rankType: 'enlisted_aviator',       rankName: 'Leading Aircraftman', rankAbbreviation: 'LAC' },
      { rankNumber: 3, rankType: 'non_commissioned_aircrew', rankName: 'Senior Aircraftman', rankAbbreviation: 'SAC' },
    ]);
  });

  it('correctly counts rank promotions and identifies final rank + level', async () => {
    // 60 Aircrafts briefs: Advanced per brief = 5 + (5×20+15) + 18 + 20 = 5 + 115 + 18 + 20 = 158
    // 60 × 158 = 9480 → < CYCLE_THRESHOLD (14700) → 0 completed cycles
    // Use enough briefs to exceed 1 cycle: need > 14700 / 158 ≈ 93 briefs
    // 100 Aircrafts briefs: 100 × 158 = 15800 → 1 completed cycle
    const briefs = Array.from({ length: 100 }, (_, i) => ({
      title: `Aircraft ${i}`, category: 'Aircrafts', descriptionSections: ['x'],
    }));
    await IntelligenceBrief.insertMany(briefs);

    const res = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
    expect(res.status).toBe(200);

    const { advanced, totalRanks, cycleThreshold } = res.body.data;
    expect(cycleThreshold).toBe(CYCLE_THRESHOLD);
    expect(totalRanks).toBe(3);

    // 100 × (5 + 5×20+15 + 18 + 20) = 100 × 158 = 15800
    expect(advanced.total).toBe(15800);
    expect(advanced.completedCycles).toBe(1);
    expect(advanced.finalRank.rankName).toBe('Aircraftman');
    expect(advanced.atMaxRank).toBe(false);
    expect(advanced.shortfall).toBeGreaterThan(0);
  });

  it('marks atMaxRank true when coins cover all rank cycles', async () => {
    // Need ≥ 3 × 14700 = 44100 advanced coins
    // 44100 / 158 ≈ 280 briefs
    const briefs = Array.from({ length: 285 }, (_, i) => ({
      title: `Aircraft ${i}`, category: 'Aircrafts', descriptionSections: ['x'],
    }));
    await IntelligenceBrief.insertMany(briefs);

    const res = await request(app).get(GET_ENDPOINT).set('Cookie', cookie);
    const { advanced } = res.body.data;

    expect(advanced.completedCycles).toBe(3);
    expect(advanced.atMaxRank).toBe(true);
    expect(advanced.finalRank.rankName).toBe('Senior Aircraftman');
    expect(advanced.shortfall).toBe(0);
  });
});

// ── PATCH /economy/levels auth ─────────────────────────────────────────────
describe('PATCH /api/admin/economy/levels — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).patch(LEVELS_ENDPOINT)
      .send({ levels: [{ levelNumber: 1, airstarsToNextLevel: 200 }], reason: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);
    const res    = await request(app).patch(LEVELS_ENDPOINT).set('Cookie', cookie)
      .send({ levels: [{ levelNumber: 1, airstarsToNextLevel: 200 }], reason: 'test' });
    expect(res.status).toBe(403);
  });
});

// ── PATCH /economy/levels writes ──────────────────────────────────────────
describe('PATCH /api/admin/economy/levels — DB writes', () => {
  it('updates level thresholds in the Level collection', async () => {
    const res = await request(app).patch(LEVELS_ENDPOINT).set('Cookie', cookie)
      .send({
        levels: [
          { levelNumber: 1, airstarsToNextLevel: 200 },
          { levelNumber: 2, airstarsToNextLevel: 400 },
        ],
        reason: 'economy rebalance',
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const l1 = await Level.findOne({ levelNumber: 1 });
    const l2 = await Level.findOne({ levelNumber: 2 });
    expect(l1.airstarsToNextLevel).toBe(200);
    expect(l2.airstarsToNextLevel).toBe(400);
    // Other levels unchanged
    const l3 = await Level.findOne({ levelNumber: 3 });
    expect(l3.airstarsToNextLevel).toBe(500);
  });

  it('logs an AdminAction', async () => {
    await request(app).patch(LEVELS_ENDPOINT).set('Cookie', cookie)
      .send({ levels: [{ levelNumber: 1, airstarsToNextLevel: 300 }], reason: 'test rebalance' });

    const action = await AdminAction.findOne({ actionType: 'update_economy_levels' });
    expect(action).not.toBeNull();
    expect(String(action.userId)).toBe(String(admin._id));
  });

  it('rejects invalid levelNumber', async () => {
    const res = await request(app).patch(LEVELS_ENDPOINT).set('Cookie', cookie)
      .send({ levels: [{ levelNumber: 99, airstarsToNextLevel: 100 }], reason: 'test' });
    expect(res.status).toBe(400);
  });

  it('rejects negative airstarsToNextLevel', async () => {
    const res = await request(app).patch(LEVELS_ENDPOINT).set('Cookie', cookie)
      .send({ levels: [{ levelNumber: 1, airstarsToNextLevel: -50 }], reason: 'test' });
    expect(res.status).toBe(400);
  });

  it('rejects missing levels array', async () => {
    const res = await request(app).patch(LEVELS_ENDPOINT).set('Cookie', cookie)
      .send({ reason: 'test' });
    expect(res.status).toBe(400);
  });
});

// ── POST /economy/apply auth ───────────────────────────────────────────────
describe('POST /api/admin/economy/apply — auth', () => {
  const validBody = {
    rates:  { airstarsPerWinEasy: 12 },
    levels: [{ levelNumber: 1, airstarsToNextLevel: 150 }],
    reason: 'test',
  };

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post(APPLY_ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);
    const res    = await request(app).post(APPLY_ENDPOINT).set('Cookie', cookie).send(validBody);
    expect(res.status).toBe(403);
  });
});

// ── POST /economy/apply DB writes ─────────────────────────────────────────
describe('POST /api/admin/economy/apply — DB writes', () => {
  it('updates AppSettings with provided rates', async () => {
    const res = await request(app).post(APPLY_ENDPOINT).set('Cookie', cookie).send({
      rates: {
        airstarsPerWinEasy:   15,
        airstarsPerWinMedium: 25,
        airstarsFirstLogin:   8,
        airstarsStreakBonus:  3,
      },
      levels: [{ levelNumber: 1, airstarsToNextLevel: 100 }],
      reason: 'rate adjustment',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const settings = await AppSettings.getSettings();
    expect(settings.airstarsPerWinEasy).toBe(15);
    expect(settings.airstarsPerWinMedium).toBe(25);
    expect(settings.airstarsFirstLogin).toBe(8);
    expect(settings.airstarsStreakBonus).toBe(3);
    // Unmentioned field unchanged
    expect(settings.airstarsPerBriefRead).toBe(5);
  });

  it('updates Level documents', async () => {
    await request(app).post(APPLY_ENDPOINT).set('Cookie', cookie).send({
      rates:  { airstarsPerWinEasy: 10 },
      levels: [
        { levelNumber: 1, airstarsToNextLevel: 150 },
        { levelNumber: 3, airstarsToNextLevel: 600 },
      ],
      reason: 'level rebalance',
    });

    const l1 = await Level.findOne({ levelNumber: 1 });
    const l3 = await Level.findOne({ levelNumber: 3 });
    expect(l1.airstarsToNextLevel).toBe(150);
    expect(l3.airstarsToNextLevel).toBe(600);
  });

  it('logs an AdminAction', async () => {
    await request(app).post(APPLY_ENDPOINT).set('Cookie', cookie).send({
      rates:  { airstarsPerWinEasy: 10 },
      levels: [{ levelNumber: 1, airstarsToNextLevel: 100 }],
      reason: 'full economy apply',
    });

    const action = await AdminAction.findOne({ actionType: 'update_economy_apply' });
    expect(action).not.toBeNull();
    expect(String(action.userId)).toBe(String(admin._id));
  });

  it('rejects unknown rate fields', async () => {
    const res = await request(app).post(APPLY_ENDPOINT).set('Cookie', cookie).send({
      rates:  { dangerousField: 999 },
      levels: [{ levelNumber: 1, airstarsToNextLevel: 100 }],
      reason: 'test',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unknown rate field/);
  });

  it('rejects negative rate values', async () => {
    const res = await request(app).post(APPLY_ENDPOINT).set('Cookie', cookie).send({
      rates:  { airstarsPerWinEasy: -5 },
      levels: [{ levelNumber: 1, airstarsToNextLevel: 100 }],
      reason: 'test',
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing rates object', async () => {
    const res = await request(app).post(APPLY_ENDPOINT).set('Cookie', cookie)
      .send({ levels: [{ levelNumber: 1, airstarsToNextLevel: 100 }], reason: 'test' });
    expect(res.status).toBe(400);
  });

  it('rejects missing levels array', async () => {
    const res = await request(app).post(APPLY_ENDPOINT).set('Cookie', cookie)
      .send({ rates: { airstarsPerWinEasy: 10 }, reason: 'test' });
    expect(res.status).toBe(400);
  });
});
