/**
 * GET /api/briefs/:id/reward-preview
 * Lets the client pre-fetch the pending reward so the airstars notification
 * can fire the instant the user swipes past the final section.
 * Must mirror the award math in POST /:id/complete without committing anything.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const User    = require('../../models/User');
const Rank    = require('../../models/Rank');
const Level   = require('../../models/Level');
const AppSettings = require('../../models/AppSettings');
const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');
const { createUser, createBrief, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings({ airstarsPerBriefRead: 5, airstarsFirstLogin: 5, airstarsStreakBonus: 2 }); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

async function seedLevels() {
  await Level.insertMany([
    { levelNumber: 1,  airstarsToNextLevel: 100  },
    { levelNumber: 2,  airstarsToNextLevel: 250  },
    { levelNumber: 3,  airstarsToNextLevel: 500  },
    { levelNumber: 4,  airstarsToNextLevel: 850  },
    { levelNumber: 5,  airstarsToNextLevel: null },
  ]);
}

async function setLastStreakDate(userId, daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  await User.findByIdAndUpdate(userId, { lastStreakDate: d });
}

describe('GET /api/briefs/:id/reward-preview', () => {
  it('returns the brief-read amount plus the daily base on a fresh day', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reward-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.airstarsEarned).toBe(5);
    expect(res.body.data.dailyCoinsEarned).toBe(5); // base, no streak bonus (streak becomes 1)
  });

  it('includes the streak bonus when the user read a brief yesterday', async () => {
    const user   = await createUser({ loginStreak: 3 });
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);
    await setLastStreakDate(user._id, 1);

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reward-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.dailyCoinsEarned).toBe(7); // 5 base + 2 streak bonus
  });

  it('omits the daily reward when the user already completed a brief today', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);
    await User.findByIdAndUpdate(user._id, { lastStreakDate: new Date() });

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reward-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.airstarsEarned).toBe(5);
    expect(res.body.data.dailyCoinsEarned).toBe(0);
  });

  it('returns zero coins once coins have already been awarded for this brief', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // Seed the completed read record
    await IntelligenceBriefRead.create({
      userId:       user._id,
      intelBriefId: brief._id,
      coinsAwarded: true,
      completed:    true,
    });

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reward-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.airstarsEarned).toBe(0);
    expect(res.body.data.dailyCoinsEarned).toBe(0);
  });

  it('does not commit any state — follow-up commit still awards the full reward', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    const preview = await request(app)
      .get(`/api/briefs/${brief._id}/reward-preview`)
      .set('Cookie', cookie);

    expect(preview.status).toBe(200);
    const expectedTotal = preview.body.data.airstarsEarned + preview.body.data.dailyCoinsEarned;

    const commit = await request(app)
      .post(`/api/briefs/${brief._id}/complete`)
      .set('Cookie', cookie);

    expect(commit.status).toBe(200);
    const commitTotal = commit.body.data.airstarsEarned + commit.body.data.dailyCoinsEarned;
    expect(commitTotal).toBe(expectedTotal);
  });

  it('returns 404 for a missing brief', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/briefs/507f1f77bcf86cd799439011/reward-preview')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  it('returns 400 for a stub brief', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ status: 'stub', descriptionSections: [] });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get(`/api/briefs/${brief._id}/reward-preview`)
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const brief = await createBrief({ category: 'News' });

    const res = await request(app).get(`/api/briefs/${brief._id}/reward-preview`);

    expect(res.status).toBe(401);
  });

  // ── Projected pathway-category unlocks ──────────────────────────────────────
  // The preview must return the same unlockedCategories the subsequent /complete
  // would. The client fires the pathway notification optimistically based on this
  // field, so drift from awardCoins's real diff would cause missed or duplicate notifs.
  describe('unlockedCategories projection', () => {
    let rank1;

    beforeEach(async () => {
      await seedLevels();
      const ranks = await Rank.insertMany([
        { rankNumber: 1, rankName: 'AC',  rankAbbreviation: 'AC',  rankType: 'enlisted_aviator' },
        { rankNumber: 2, rankName: 'LAC', rankAbbreviation: 'LAC', rankType: 'enlisted_aviator' },
      ]);
      rank1 = ranks[0];
      // Use the full REQUIRED_PATHWAYS set so AppSettings.getSettings()'s auto-migration
      // (which re-adds any missing pathway categories) doesn't silently reintroduce
      // entries the test intended to omit.
      await AppSettings.findOneAndUpdate({ _singleton: true }, {
        $set: {
          pathwayUnlocks: [
            { category: 'News',        levelRequired: 1, rankRequired: 1 },
            { category: 'Bases',       levelRequired: 1, rankRequired: 1 },
            { category: 'Terminology', levelRequired: 1, rankRequired: 1 },
            { category: 'Aircrafts',   levelRequired: 2, rankRequired: 1 },
            { category: 'Heritage',    levelRequired: 2, rankRequired: 1 },
            { category: 'Ranks',       levelRequired: 2, rankRequired: 1 },
            { category: 'Squadrons',   levelRequired: 3, rankRequired: 2 },
            { category: 'Allies',      levelRequired: 3, rankRequired: 2 },
            { category: 'Training',    levelRequired: 4, rankRequired: 2 },
            { category: 'AOR',         levelRequired: 4, rankRequired: 2 },
            { category: 'Roles',       levelRequired: 5, rankRequired: 3 },
            { category: 'Tech',        levelRequired: 5, rankRequired: 3 },
            { category: 'Threats',     levelRequired: 6, rankRequired: 3 },
            { category: 'Missions',    levelRequired: 7, rankRequired: 4 },
            { category: 'Treaties',    levelRequired: 8, rankRequired: 4 },
          ],
        },
      });
    });

    it('returns empty unlockedCategories when the projected award crosses no threshold', async () => {
      const user   = await createUser({ rank: rank1._id, totalAirstars: 0, cycleAirstars: 0 });
      const brief  = await createBrief({ category: 'News' });
      const cookie = authCookie(user._id);

      const res = await request(app).get(`/api/briefs/${brief._id}/reward-preview`).set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.unlockedCategories).toEqual([]);
    });

    it('predicts the pathways that will unlock when the combined reward crosses a level threshold', async () => {
      // 95 + (5 brief + 5 daily) = 105 → crosses level-2 threshold (100)
      // Rank-1 L2 pathways: Aircrafts, Heritage, Ranks
      const user   = await createUser({ rank: rank1._id, totalAirstars: 95, cycleAirstars: 95 });
      const brief  = await createBrief({ category: 'News' });
      const cookie = authCookie(user._id);

      const res = await request(app).get(`/api/briefs/${brief._id}/reward-preview`).set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.unlockedCategories.sort()).toEqual(['Aircrafts', 'Heritage', 'Ranks'].sort());
    });

    it('does not predict an unlock for categories the user already has access to', async () => {
      // User is already at L2 (totalAirstars ≥ 100). Aircrafts/Heritage/Ranks already accessible.
      // Small award keeps them at L2 — nothing new unlocks at rank 1.
      const user   = await createUser({ rank: rank1._id, totalAirstars: 150, cycleAirstars: 150 });
      const brief  = await createBrief({ category: 'News' });
      const cookie = authCookie(user._id);

      const res = await request(app).get(`/api/briefs/${brief._id}/reward-preview`).set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.unlockedCategories).toEqual([]);
    });

    it('returns empty unlockedCategories for an already-rewarded brief', async () => {
      const user   = await createUser({ rank: rank1._id, totalAirstars: 95, cycleAirstars: 95 });
      const brief  = await createBrief({ category: 'News' });
      const cookie = authCookie(user._id);
      await IntelligenceBriefRead.create({
        userId:       user._id,
        intelBriefId: brief._id,
        coinsAwarded: true,
        completed:    true,
      });

      const res = await request(app).get(`/api/briefs/${brief._id}/reward-preview`).set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.unlockedCategories).toEqual([]);
    });

    it('stays in sync with awardCoins: POST /complete unlocks the same categories the preview predicted', async () => {
      const user   = await createUser({ rank: rank1._id, totalAirstars: 95, cycleAirstars: 95 });
      const brief  = await createBrief({ category: 'News' });
      const cookie = authCookie(user._id);

      const preview = await request(app).get(`/api/briefs/${brief._id}/reward-preview`).set('Cookie', cookie);
      expect(preview.status).toBe(200);

      const commit = await request(app).post(`/api/briefs/${brief._id}/complete`).set('Cookie', cookie);
      expect(commit.status).toBe(200);

      expect(commit.body.data.unlockedCategories.sort()).toEqual(preview.body.data.unlockedCategories.sort());
    });
  });
});
