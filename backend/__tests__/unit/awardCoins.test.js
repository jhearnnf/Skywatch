process.env.JWT_SECRET = 'test_secret';

const mongoose = require('mongoose');
const db       = require('../helpers/setupDb');
const User     = require('../../models/User');
const Rank     = require('../../models/Rank');
const Level    = require('../../models/Level');
const { awardCoins, getCycleThreshold } = require('../../utils/awardCoins');
const { createUser, createRank } = require('../helpers/factories');

// Seed default levels (same curve as Level.seedLevels)
async function seedLevels(overrides = []) {
  const defaults = [
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
  const levels = overrides.length ? overrides : defaults;
  await Level.insertMany(levels);
}

// Seed 3 ranks for testing
async function seedRanks(count = 3) {
  const data = [
    { rankNumber: 1, rankName: 'Aircraftman',          rankAbbreviation: 'AC',  rankType: 'enlisted_aviator' },
    { rankNumber: 2, rankName: 'Leading Aircraftman',   rankAbbreviation: 'LAC', rankType: 'enlisted_aviator' },
    { rankNumber: 3, rankName: 'Senior Aircraftman',    rankAbbreviation: 'SAC', rankType: 'enlisted_aviator' },
  ];
  const ranks = await Rank.insertMany(data.slice(0, count));
  return ranks;
}

beforeAll(async () => { await db.connect(); });
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── getCycleThreshold ─────────────────────────────────────────────────────────

describe('getCycleThreshold', () => {
  it('returns 14700 for default levels', async () => {
    await seedLevels();
    expect(await getCycleThreshold()).toBe(14700);
  });

  it('returns correct sum for custom (smaller) levels', async () => {
    await seedLevels([
      { levelNumber: 1,  aircoinsToNextLevel: 50  },
      { levelNumber: 2,  aircoinsToNextLevel: 100 },
      { levelNumber: 3,  aircoinsToNextLevel: 150 },
      { levelNumber: 4,  aircoinsToNextLevel: 200 },
      { levelNumber: 5,  aircoinsToNextLevel: null },
    ]);
    expect(await getCycleThreshold()).toBe(500);
  });

  it('falls back to 14700 when Level collection is empty', async () => {
    expect(await getCycleThreshold()).toBe(14700);
  });
});

// ── awardCoins ────────────────────────────────────────────────────────────────

describe('awardCoins', () => {
  let ranks, rank1;

  beforeEach(async () => {
    await seedLevels();
    ranks = await seedRanks();
    rank1 = ranks[0];
  });

  it('awards coins without promotion when below threshold', async () => {
    const user = await createUser({ rank: rank1._id, totalAircoins: 0, cycleAircoins: 0 });
    const result = await awardCoins(user._id, 100, 'test', 'Test');

    expect(result.totalAircoins).toBe(100);
    expect(result.cycleAircoins).toBe(100);
    expect(result.rankPromotion).toBeNull();

    const updated = await User.findById(user._id);
    expect(updated.totalAircoins).toBe(100);
    expect(updated.cycleAircoins).toBe(100);
  });

  it('promotes rank when cycleAircoins crosses threshold', async () => {
    const user = await createUser({ rank: rank1._id, totalAircoins: 14600, cycleAircoins: 14600 });
    const result = await awardCoins(user._id, 200, 'test', 'Test');

    expect(result.totalAircoins).toBe(14800);
    expect(result.cycleAircoins).toBe(100); // 14800 - 14700 = 100
    expect(result.rankPromotion).not.toBeNull();
    expect(result.rankPromotion.from.rankNumber).toBe(1);
    expect(result.rankPromotion.to.rankNumber).toBe(2);

    const updated = await User.findById(user._id).populate('rank');
    expect(updated.rank.rankNumber).toBe(2);
    expect(updated.cycleAircoins).toBe(100);
  });

  it('handles exact threshold amount (remainder = 0)', async () => {
    const user = await createUser({ rank: rank1._id, totalAircoins: 14000, cycleAircoins: 14000 });
    const result = await awardCoins(user._id, 700, 'test', 'Test');

    expect(result.cycleAircoins).toBe(0);
    expect(result.rankPromotion.to.rankNumber).toBe(2);
  });

  it('handles multiple rank promotions from a large award', async () => {
    const user = await createUser({ rank: rank1._id, totalAircoins: 0, cycleAircoins: 0 });
    const result = await awardCoins(user._id, 30000, 'test', 'Test');

    // 30000 / 14700 = 2 full cycles, remainder = 30000 - 2*14700 = 600
    expect(result.totalAircoins).toBe(30000);
    expect(result.cycleAircoins).toBe(600);
    expect(result.rankPromotion.to.rankNumber).toBe(3);

    const updated = await User.findById(user._id).populate('rank');
    expect(updated.rank.rankNumber).toBe(3);
  });

  it('stops promoting at max rank — subtracts one cycle then breaks', async () => {
    const rank3 = ranks[2];
    const user = await createUser({ rank: rank3._id, totalAircoins: 14000, cycleAircoins: 14000 });
    const result = await awardCoins(user._id, 1000, 'test', 'Test');

    // At max rank: finalCycle (15000) >= threshold → subtract once → 300, no nextRank → break
    expect(result.totalAircoins).toBe(15000);
    expect(result.cycleAircoins).toBe(300);
    expect(result.rankPromotion).toBeNull();
  });

  it('uses dynamic threshold from Level docs (key regression test)', async () => {
    // Clear default levels and seed with small thresholds summing to 500
    await Level.deleteMany({});
    await seedLevels([
      { levelNumber: 1,  aircoinsToNextLevel: 100 },
      { levelNumber: 2,  aircoinsToNextLevel: 150 },
      { levelNumber: 3,  aircoinsToNextLevel: 250 },
      { levelNumber: 4,  aircoinsToNextLevel: null },
    ]);

    const user = await createUser({ rank: rank1._id, totalAircoins: 400, cycleAircoins: 400 });
    const result = await awardCoins(user._id, 200, 'test', 'Test');

    // Threshold is now 500 (100+150+250). 600 >= 500, so promotion fires.
    // Remainder: 600 - 500 = 100
    expect(result.cycleAircoins).toBe(100);
    expect(result.rankPromotion).not.toBeNull();
    expect(result.rankPromotion.to.rankNumber).toBe(2);
  });

  it('handles large award crossing multiple cycles with custom thresholds', async () => {
    await Level.deleteMany({});
    await seedLevels([
      { levelNumber: 1,  aircoinsToNextLevel: 100 },
      { levelNumber: 2,  aircoinsToNextLevel: 100 },
      { levelNumber: 3,  aircoinsToNextLevel: null },
    ]);
    // Threshold is 200

    const user = await createUser({ rank: rank1._id, totalAircoins: 0, cycleAircoins: 0 });
    const result = await awardCoins(user._id, 550, 'test', 'Test');

    // 550 / 200 = 2 full cycles, remainder = 550 - 2*200 = 150
    expect(result.cycleAircoins).toBe(150);
    expect(result.rankPromotion.to.rankNumber).toBe(3);
  });
});
