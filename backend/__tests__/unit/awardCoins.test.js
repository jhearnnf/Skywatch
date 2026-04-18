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
      { levelNumber: 1,  airstarsToNextLevel: 50  },
      { levelNumber: 2,  airstarsToNextLevel: 100 },
      { levelNumber: 3,  airstarsToNextLevel: 150 },
      { levelNumber: 4,  airstarsToNextLevel: 200 },
      { levelNumber: 5,  airstarsToNextLevel: null },
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
    const user = await createUser({ rank: rank1._id, totalAirstars: 0, cycleAirstars: 0 });
    const result = await awardCoins(user._id, 100, 'test', 'Test');

    expect(result.totalAirstars).toBe(100);
    expect(result.cycleAirstars).toBe(100);
    expect(result.rankPromotion).toBeNull();

    const updated = await User.findById(user._id);
    expect(updated.totalAirstars).toBe(100);
    expect(updated.cycleAirstars).toBe(100);
  });

  it('promotes rank when cycleAirstars crosses threshold', async () => {
    const user = await createUser({ rank: rank1._id, totalAirstars: 14600, cycleAirstars: 14600 });
    const result = await awardCoins(user._id, 200, 'test', 'Test');

    expect(result.totalAirstars).toBe(14800);
    expect(result.cycleAirstars).toBe(100); // 14800 - 14700 = 100
    expect(result.rankPromotion).not.toBeNull();
    expect(result.rankPromotion.from.rankNumber).toBe(1);
    expect(result.rankPromotion.to.rankNumber).toBe(2);

    const updated = await User.findById(user._id).populate('rank');
    expect(updated.rank.rankNumber).toBe(2);
    expect(updated.cycleAirstars).toBe(100);
  });

  it('handles exact threshold amount (remainder = 0)', async () => {
    const user = await createUser({ rank: rank1._id, totalAirstars: 14000, cycleAirstars: 14000 });
    const result = await awardCoins(user._id, 700, 'test', 'Test');

    expect(result.cycleAirstars).toBe(0);
    expect(result.rankPromotion.to.rankNumber).toBe(2);
  });

  it('handles multiple rank promotions from a large award', async () => {
    const user = await createUser({ rank: rank1._id, totalAirstars: 0, cycleAirstars: 0 });
    const result = await awardCoins(user._id, 30000, 'test', 'Test');

    // 30000 / 14700 = 2 full cycles, remainder = 30000 - 2*14700 = 600
    expect(result.totalAirstars).toBe(30000);
    expect(result.cycleAirstars).toBe(600);
    expect(result.rankPromotion.to.rankNumber).toBe(3);

    const updated = await User.findById(user._id).populate('rank');
    expect(updated.rank.rankNumber).toBe(3);
  });

  it('stops promoting at max rank — subtracts one cycle then breaks', async () => {
    const rank3 = ranks[2];
    const user = await createUser({ rank: rank3._id, totalAirstars: 14000, cycleAirstars: 14000 });
    const result = await awardCoins(user._id, 1000, 'test', 'Test');

    // At max rank: finalCycle (15000) >= threshold → subtract once → 300, no nextRank → break
    expect(result.totalAirstars).toBe(15000);
    expect(result.cycleAirstars).toBe(300);
    expect(result.rankPromotion).toBeNull();
  });

  it('uses dynamic threshold from Level docs (key regression test)', async () => {
    // Clear default levels and seed with small thresholds summing to 500
    await Level.deleteMany({});
    await seedLevels([
      { levelNumber: 1,  airstarsToNextLevel: 100 },
      { levelNumber: 2,  airstarsToNextLevel: 150 },
      { levelNumber: 3,  airstarsToNextLevel: 250 },
      { levelNumber: 4,  airstarsToNextLevel: null },
    ]);

    const user = await createUser({ rank: rank1._id, totalAirstars: 400, cycleAirstars: 400 });
    const result = await awardCoins(user._id, 200, 'test', 'Test');

    // Threshold is now 500 (100+150+250). 600 >= 500, so promotion fires.
    // Remainder: 600 - 500 = 100
    expect(result.cycleAirstars).toBe(100);
    expect(result.rankPromotion).not.toBeNull();
    expect(result.rankPromotion.to.rankNumber).toBe(2);
  });

  // ── Concurrency: two awards racing across the cycle threshold ────────────
  //
  // The pre-fix code did:
  //   1. atomic $inc both totalAirstars and cycleAirstars
  //   2. if cycleAirstars >= threshold, compute remainder + promote
  //   3. write back the corrected cycleAirstars guarded by the OLD rank
  //
  // If two awardCoins() calls overlap and BOTH cross the threshold, the
  // second write's guard ({ rank: oldRank }) silently fails because the
  // rank already moved — leaving cycleAirstars inflated above the threshold.
  //
  // Post-fix: when the guarded write returns null we re-load the user and
  // correct cycleAirstars to its modular remainder so it can never persist
  // above the threshold. totalAirstars always reflects both increments.
  it('concurrency: two simultaneous awards crossing the threshold leave consistent state', async () => {
    const user = await createUser({ rank: rank1._id, totalAirstars: 14600, cycleAirstars: 14600 });

    // Fire two overlapping awards. Each pushes cycle past the 14700 threshold.
    const [r1, r2] = await Promise.all([
      awardCoins(user._id, 200, 'test', 'race-1'),
      awardCoins(user._id, 200, 'test', 'race-2'),
    ]);

    // Both must report a sane totalAirstars (atomic $inc accumulates both).
    expect(r1.totalAirstars + r2.totalAirstars).toBeGreaterThanOrEqual(15000);

    const updated = await User.findById(user._id).populate('rank');

    // totalAirstars must reflect BOTH awards: 14600 + 200 + 200 = 15000.
    expect(updated.totalAirstars).toBe(15000);

    // CRITICAL: cycleAirstars must NEVER persist above the threshold (14700).
    // Pre-fix this would leave it at ~14800, an inconsistent state where the
    // user sits "above max XP" without their rank reflecting it.
    expect(updated.cycleAirstars).toBeLessThan(14700);
    expect(updated.cycleAirstars).toBeGreaterThanOrEqual(0);

    // Rank should have advanced at least once (one or both calls promoted).
    expect(updated.rank.rankNumber).toBeGreaterThanOrEqual(2);
  });

  it('handles large award crossing multiple cycles with custom thresholds', async () => {
    await Level.deleteMany({});
    await seedLevels([
      { levelNumber: 1,  airstarsToNextLevel: 100 },
      { levelNumber: 2,  airstarsToNextLevel: 100 },
      { levelNumber: 3,  airstarsToNextLevel: null },
    ]);
    // Threshold is 200

    const user = await createUser({ rank: rank1._id, totalAirstars: 0, cycleAirstars: 0 });
    const result = await awardCoins(user._id, 550, 'test', 'Test');

    // 550 / 200 = 2 full cycles, remainder = 550 - 2*200 = 150
    expect(result.cycleAirstars).toBe(150);
    expect(result.rankPromotion.to.rankNumber).toBe(3);
  });
});
