/**
 * awardCoins.unlocks.test.js — verifies pathway category-unlock diff logic
 * and persistence to user.categoryUnlocks Map.
 */

process.env.JWT_SECRET = 'test_secret';

const db          = require('../helpers/setupDb');
const User        = require('../../models/User');
const Rank        = require('../../models/Rank');
const Level       = require('../../models/Level');
const AppSettings = require('../../models/AppSettings');
const { awardCoins }      = require('../../utils/awardCoins');
const { createUser, createSettings } = require('../helpers/factories');

async function seedLevels() {
  await Level.insertMany([
    { levelNumber: 1,  airstarsToNextLevel: 100  },
    { levelNumber: 2,  airstarsToNextLevel: 250  },
    { levelNumber: 3,  airstarsToNextLevel: 500  },
    { levelNumber: 4,  airstarsToNextLevel: 850  },
    { levelNumber: 5,  airstarsToNextLevel: 1300 },
    { levelNumber: 6,  airstarsToNextLevel: 1850 },
    { levelNumber: 7,  airstarsToNextLevel: 2500 },
    { levelNumber: 8,  airstarsToNextLevel: 3250 },
    { levelNumber: 9,  airstarsToNextLevel: 4100 },
    { levelNumber: 10, airstarsToNextLevel: null },
  ]);
}

async function seedRanks() {
  const ranks = await Rank.insertMany([
    { rankNumber: 1, rankName: 'AC',  rankAbbreviation: 'AC',  rankType: 'enlisted_aviator' },
    { rankNumber: 2, rankName: 'LAC', rankAbbreviation: 'LAC', rankType: 'enlisted_aviator' },
    { rankNumber: 3, rankName: 'SAC', rankAbbreviation: 'SAC', rankType: 'enlisted_aviator' },
  ]);
  return ranks;
}

beforeAll(async () => { await db.connect(); });
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

describe('awardCoins — categoryUnlocks diff', () => {
  let ranks, rank1;

  beforeEach(async () => {
    await seedLevels();
    ranks = await seedRanks();
    rank1 = ranks[0];
    // Pathway with two threshold tiers so we can cross one with a level-up.
    await createSettings({
      pathwayUnlocks: [
        { category: 'News',     levelRequired: 1, rankRequired: 1 }, // already accessible at L1/R1
        { category: 'Aircraft', levelRequired: 2, rankRequired: 1 }, // unlocks when totalAirstars ≥ 100
        { category: 'Tech',     levelRequired: 3, rankRequired: 1 }, // unlocks at L3 (totalAirstars ≥ 350)
        { category: 'Missions', levelRequired: 1, rankRequired: 2 }, // rank-gated, needs rank promotion
      ],
    });
  });

  it('returns empty unlockedCategories when no threshold is crossed', async () => {
    const user = await createUser({ rank: rank1._id, subscriptionTier: 'gold', totalAirstars: 200, cycleAirstars: 200 });
    const result = await awardCoins(user._id, 50, 'test', 'Test');
    expect(result.unlockedCategories).toEqual([]);
    expect(result.categoryUnlocksGranted).toEqual([]);
  });

  it('detects a level-only unlock and persists to user.categoryUnlocks', async () => {
    const user = await createUser({ rank: rank1._id, subscriptionTier: 'gold', totalAirstars: 50, cycleAirstars: 50 });
    const result = await awardCoins(user._id, 60, 'test', 'Test');
    // 50 + 60 = 110 → crosses level 2 threshold, unlocks Aircraft
    expect(result.unlockedCategories).toContain('Aircraft');
    expect(result.unlockedCategories).not.toContain('News');     // already accessible
    expect(result.unlockedCategories).not.toContain('Missions'); // rank-gated
    expect(result.categoryUnlocksGranted).toHaveLength(result.unlockedCategories.length);
    const persisted = await User.findById(user._id).select('categoryUnlocks');
    const entry = persisted.categoryUnlocks.get('Aircraft');
    expect(entry).toBeTruthy();
    expect(entry.badgeSeen).toBe(false);
    expect(entry.unlockedAt).toBeInstanceOf(Date);
  });

  it('detects multiple unlocks when one award crosses two level thresholds', async () => {
    const user = await createUser({ rank: rank1._id, subscriptionTier: 'gold', totalAirstars: 0, cycleAirstars: 0 });
    const result = await awardCoins(user._id, 400, 'test', 'Test');
    // 0 → 400 crosses level 2 (100) AND level 3 (350) → unlocks Aircraft AND Tech
    expect(result.unlockedCategories).toEqual(expect.arrayContaining(['Aircraft', 'Tech']));
  });

  it('detects rank-gated unlock when an award triggers rank promotion', async () => {
    const user = await createUser({ rank: rank1._id, subscriptionTier: 'gold', totalAirstars: 14600, cycleAirstars: 14600 });
    const result = await awardCoins(user._id, 200, 'test', 'Test');
    // 14600 + 200 = 14800 → crosses cycleThreshold 14700 → rank 1 → 2
    // Missions is rank-2 gated → newly unlocked.
    expect(result.rankPromotion).not.toBeNull();
    expect(result.rankPromotion.to.rankNumber).toBe(2);
    expect(result.unlockedCategories).toContain('Missions');
  });

  it('does not re-fire for categories already unlocked', async () => {
    const user = await createUser({ rank: rank1._id, subscriptionTier: 'gold', totalAirstars: 200, cycleAirstars: 200 });
    // First award persists Aircraft (was crossed before this user existed at L2).
    // Pre-seed: simulate that the user was already at L2 BEFORE the award by setting totalAirstars high.
    // Now award more coins — Aircraft was already accessible, so should NOT re-unlock.
    const result = await awardCoins(user._id, 50, 'test', 'Test');
    expect(result.unlockedCategories).not.toContain('Aircraft');
  });

  it('writes nothing to categoryUnlocks when nothing is newly unlocked', async () => {
    const user = await createUser({ rank: rank1._id, subscriptionTier: 'gold', totalAirstars: 200, cycleAirstars: 200 });
    await awardCoins(user._id, 50, 'test', 'Test');
    const persisted = await User.findById(user._id).select('categoryUnlocks');
    // Map exists but empty
    expect(persisted.categoryUnlocks?.size ?? 0).toBe(0);
  });

  it('skips category names containing dots (mongo path safety)', async () => {
    await AppSettings.findOneAndUpdate({ _singleton: true }, {
      $set: {
        pathwayUnlocks: [
          { category: 'safe',         levelRequired: 1, rankRequired: 1 },
          { category: 'has.dot.name', levelRequired: 2, rankRequired: 1 },
        ],
      },
    });
    const user = await createUser({ rank: rank1._id, subscriptionTier: 'gold', totalAirstars: 50, cycleAirstars: 50 });
    const result = await awardCoins(user._id, 60, 'test', 'Test');
    // The diff includes 'has.dot.name' but it should NOT be persisted (skipped).
    const persisted = await User.findById(user._id).select('categoryUnlocks');
    expect(persisted.categoryUnlocks.get('has.dot.name')).toBeUndefined();
    // categoryUnlocksGranted excludes the skipped one
    expect(result.categoryUnlocksGranted.find(e => e.category === 'has.dot.name')).toBeUndefined();
  });

  it('does not grant categoryUnlocks for categories the user cannot access on their current tier', async () => {
    // Silver user: freeCategories/silverCategories default to ['News','Aircrafts','Bases',
    // 'Ranks','Squadrons','Training','Threats','Allies'] (note: singular 'Aircraft' and
    // 'Tech' are NOT in that set, so they are effectively gold-only).
    const user = await createUser({ rank: rank1._id, subscriptionTier: 'silver', totalAirstars: 0, cycleAirstars: 0 });
    const result = await awardCoins(user._id, 400, 'test', 'Test');
    // Pathway would allow Aircraft + Tech at L3, but silver can't access either.
    expect(result.unlockedCategories).not.toContain('Aircraft');
    expect(result.unlockedCategories).not.toContain('Tech');
    expect(result.categoryUnlocksGranted.find(e => e.category === 'Aircraft')).toBeUndefined();
    expect(result.categoryUnlocksGranted.find(e => e.category === 'Tech')).toBeUndefined();
    const persisted = await User.findById(user._id).select('categoryUnlocks');
    expect(persisted.categoryUnlocks.get('Aircraft')).toBeUndefined();
    expect(persisted.categoryUnlocks.get('Tech')).toBeUndefined();
  });
});
