const User        = require('../models/User');
const Level       = require('../models/Level');
const AppSettings = require('../models/AppSettings');
const {
  buildCumulativeThresholds,
  getAccessibleCategories,
  getPathwayAccessibleCategories,
  effectiveTier,
} = require('./subscription');

/**
 * Fires categoryUnlock badges when a user's subscription tier changes and
 * newly-accessible categories overlap categories the user has already
 * pathway-unlocked (level/rank met). This is the counterpart to awardCoins's
 * pathway-diff, which fires badges when the user crosses a level/rank threshold
 * while on their current tier.
 *
 * Idempotent — skips categories that already have a categoryUnlocks entry, so
 * repeat calls (e.g. Stripe delivering the same webhook twice) don't duplicate.
 *
 * Covers trial activation too: free → trial gains silver-tier category access,
 * trial → gold gains gold-only categories, etc. Downgrades (silver → free,
 * subscription cancel) produce an empty diff and no-op.
 *
 * @param {ObjectId|string} userId
 * @param {string} oldTier  effective tier BEFORE the mutation ('free'|'trial'|'silver'|'gold')
 * @returns {Promise<string[]>} category names for which a badge was granted
 */
async function grantSubscriptionUnlocks(userId, oldTier) {
  if (!userId) return [];

  // Rank must be populated for pathway rank checks
  const user = await User.findById(userId).populate('rank');
  if (!user) return [];

  const newTier = effectiveTier(user);
  if (oldTier === newTier) return [];

  const settings   = await AppSettings.getSettings();
  const levelsList = await Level.find().sort({ levelNumber: 1 }).lean();
  const thresholds = buildCumulativeThresholds(levelsList);

  // getAccessibleCategories returns null for gold (≡ all pathway categories).
  // Resolve null to the full set so set-difference works uniformly.
  const allPathway   = (settings.pathwayUnlocks ?? []).map(p => p.category);
  const toSet        = (list) => list === null ? new Set(allPathway) : new Set(list);
  const oldAccessible = toSet(getAccessibleCategories(oldTier, settings));
  const newAccessible = toSet(getAccessibleCategories(newTier, settings));

  const gained = [...newAccessible].filter(c => !oldAccessible.has(c));
  if (gained.length === 0) return [];

  // Intersect with pathway-unlocked (user has already met level+rank)
  const pathwayUnlocked = new Set(getPathwayAccessibleCategories(user, settings, thresholds) ?? []);

  // categoryUnlocks is a Mongoose Map on live docs
  const existing = user.categoryUnlocks instanceof Map
    ? user.categoryUnlocks
    : new Map(Object.entries(user.categoryUnlocks ?? {}));

  const now     = new Date();
  const setOps  = {};
  const granted = [];
  for (const cat of gained) {
    if (!pathwayUnlocked.has(cat)) continue;
    if (cat.includes('.')) continue;       // mongo path-syntax safety
    if (existing.has(cat)) continue;        // never re-badge
    setOps[`categoryUnlocks.${cat}`] = { unlockedAt: now, badgeSeen: false };
    granted.push(cat);
  }

  if (Object.keys(setOps).length) {
    await User.findByIdAndUpdate(userId, { $set: setOps });
  }
  return granted;
}

module.exports = { grantSubscriptionUnlocks };
