/**
 * subscriptionUnlocks.test.js — verifies grantSubscriptionUnlocks fires
 * categoryUnlock badges for pathways the user has already unlocked (level/rank)
 * but previously couldn't access because of their subscription tier.
 */

process.env.JWT_SECRET = 'test_secret';

const db          = require('../helpers/setupDb');
const User        = require('../../models/User');
const Rank        = require('../../models/Rank');
const Level       = require('../../models/Level');
const AppSettings = require('../../models/AppSettings');
const { grantSubscriptionUnlocks } = require('../../utils/subscriptionUnlocks');
const { createUser, createSettings } = require('../helpers/factories');

async function seedLevels() {
  await Level.insertMany([
    { levelNumber: 1,  airstarsToNextLevel: 100  },
    { levelNumber: 2,  airstarsToNextLevel: 250  },
    { levelNumber: 3,  airstarsToNextLevel: 500  },
    { levelNumber: 4,  airstarsToNextLevel: 850  },
    { levelNumber: 5,  airstarsToNextLevel: null },
  ]);
}

async function seedRank1() {
  const r = await Rank.insertMany([
    { rankNumber: 1, rankName: 'AC', rankAbbreviation: 'AC', rankType: 'enlisted_aviator' },
  ]);
  return r[0];
}

beforeAll(async () => { await db.connect(); });
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

describe('grantSubscriptionUnlocks', () => {
  let rank1;

  beforeEach(async () => {
    await seedLevels();
    rank1 = await seedRank1();
    // Use createSettings() to create the doc, then overwrite pathwayUnlocks directly.
    // AppSettings.getSettings() auto-migrates any missing REQUIRED_PATHWAYS back in,
    // so we must provide the full set explicitly (with custom levels) here.
    await createSettings({
      freeCategories:   ['News'],
      silverCategories: ['News', 'Aircrafts'],
    });
    await AppSettings.findOneAndUpdate({ _singleton: true }, {
      $set: {
        pathwayUnlocks: [
          { category: 'News',        levelRequired: 1, rankRequired: 1 },
          { category: 'Aircrafts',   levelRequired: 2, rankRequired: 1 },
          { category: 'Tech',        levelRequired: 3, rankRequired: 1 },
          { category: 'Missions',    levelRequired: 5, rankRequired: 1 },
          // The rest are pinned to very high thresholds so they never pathway-unlock in test
          { category: 'Bases',       levelRequired: 99, rankRequired: 99 },
          { category: 'Terminology', levelRequired: 99, rankRequired: 99 },
          { category: 'Heritage',    levelRequired: 99, rankRequired: 99 },
          { category: 'Ranks',       levelRequired: 99, rankRequired: 99 },
          { category: 'Squadrons',   levelRequired: 99, rankRequired: 99 },
          { category: 'Allies',      levelRequired: 99, rankRequired: 99 },
          { category: 'Training',    levelRequired: 99, rankRequired: 99 },
          { category: 'AOR',         levelRequired: 99, rankRequired: 99 },
          { category: 'Roles',       levelRequired: 99, rankRequired: 99 },
          { category: 'Threats',     levelRequired: 99, rankRequired: 99 },
          { category: 'Treaties',    levelRequired: 99, rankRequired: 99 },
        ],
      },
    });
  });

  it('fires a badge when silver → gold reveals a gold-only pathway the user already qualifies for', async () => {
    // L3 → pathway-unlocked for News, Aircrafts, Tech. Tech is gold-only, so while
    // silver the awardCoins diff would have filtered it out. On upgrade, we surface it.
    const user = await createUser({
      rank: rank1._id,
      subscriptionTier: 'gold',          // new tier — matches effective state at call time
      totalAirstars: 400, cycleAirstars: 400,
    });
    const granted = await grantSubscriptionUnlocks(user._id, 'silver');
    expect(granted).toEqual(['Tech']);
    const persisted = await User.findById(user._id).select('categoryUnlocks');
    expect(persisted.categoryUnlocks.get('Tech')).toMatchObject({ badgeSeen: false });
  });

  it('fires badges when free → trial grants silver-tier access to already-unlocked categories', async () => {
    // Trial users get silver effective tier. If the user is at L2+, Aircrafts is
    // pathway-unlocked but was previously inaccessible on free.
    const user = await createUser({
      rank: rank1._id,
      subscriptionTier: 'trial',
      trialStartDate: new Date(),
      trialDurationDays: 5,
      totalAirstars: 150, cycleAirstars: 150,
    });
    const granted = await grantSubscriptionUnlocks(user._id, 'free');
    expect(granted).toEqual(['Aircrafts']);
  });

  it('does nothing on downgrade (gold → silver)', async () => {
    const user = await createUser({
      rank: rank1._id,
      subscriptionTier: 'silver',
      totalAirstars: 400, cycleAirstars: 400,
    });
    const granted = await grantSubscriptionUnlocks(user._id, 'gold');
    expect(granted).toEqual([]);
    const persisted = await User.findById(user._id).select('categoryUnlocks');
    expect(persisted.categoryUnlocks?.size ?? 0).toBe(0);
  });

  it('does nothing when no pathway is yet unlocked (fresh user on trial start)', async () => {
    const user = await createUser({
      rank: rank1._id,
      subscriptionTier: 'trial',
      trialStartDate: new Date(),
      trialDurationDays: 5,
      totalAirstars: 0, cycleAirstars: 0,
    });
    const granted = await grantSubscriptionUnlocks(user._id, 'free');
    // At L1, only News is pathway-unlocked — and News is already in freeCategories,
    // so there's no gain from the free → trial transition.
    expect(granted).toEqual([]);
  });

  it('is idempotent — re-running with existing categoryUnlocks does not re-badge', async () => {
    const user = await createUser({
      rank: rank1._id,
      subscriptionTier: 'gold',
      totalAirstars: 400, cycleAirstars: 400,
    });
    const first  = await grantSubscriptionUnlocks(user._id, 'silver');
    expect(first).toEqual(['Tech']);
    const second = await grantSubscriptionUnlocks(user._id, 'silver');
    expect(second).toEqual([]);
  });

  it('returns [] when oldTier === newTier', async () => {
    const user = await createUser({
      rank: rank1._id,
      subscriptionTier: 'silver',
      totalAirstars: 400, cycleAirstars: 400,
    });
    const granted = await grantSubscriptionUnlocks(user._id, 'silver');
    expect(granted).toEqual([]);
  });

  it('does not fire badges for categories the user has not yet pathway-unlocked', async () => {
    // L2 → Aircrafts OK, Tech NOT (needs L3), Missions NOT (needs L5).
    // Upgrading to gold reveals Tech + Missions as tier-accessible, but user
    // hasn't earned them via pathway yet, so no badge.
    const user = await createUser({
      rank: rank1._id,
      subscriptionTier: 'gold',
      totalAirstars: 150, cycleAirstars: 150,
    });
    const granted = await grantSubscriptionUnlocks(user._id, 'silver');
    expect(granted).not.toContain('Tech');
    expect(granted).not.toContain('Missions');
  });

  it('fires multiple badges when free → gold and several pathways are already met', async () => {
    const user = await createUser({
      rank: rank1._id,
      subscriptionTier: 'gold',
      totalAirstars: 400, cycleAirstars: 400,
    });
    const granted = await grantSubscriptionUnlocks(user._id, 'free');
    // Gained categories from free → gold: Aircrafts, Tech, Missions (silver+gold).
    // Of these the user has pathway-unlocked Aircrafts (L2) and Tech (L3). Not Missions (L5).
    expect(granted.sort()).toEqual(['Aircrafts', 'Tech']);
  });
});
