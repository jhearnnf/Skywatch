// Returns the effective subscription tier for a user.
// An expired trial is treated as 'free' — subscriptionTier stays 'trial' in the DB
// but isTrialActive (a Mongoose virtual) will be false once the window has passed.
function _isTrialActive(user) {
  if (!user.trialStartDate) return false;
  const trialEnd = new Date(user.trialStartDate);
  trialEnd.setDate(trialEnd.getDate() + (user.trialDurationDays || 5));
  return new Date() < trialEnd;
}

// Logged-out callers return 'guest' — they have no subscription tier.
// 'free' means a logged-in user on the free plan; guest is a separate state
// with its own gating (typically blocked or steered to a sign-in upsell).
function effectiveTier(user) {
  if (!user) return 'guest';
  if (user.subscriptionTier === 'trial') {
    // isTrialActive is a Mongoose virtual — not present on .lean() objects, so compute it
    const active = user.isTrialActive ?? _isTrialActive(user);
    return active ? 'trial' : 'free';
  }
  return user.subscriptionTier ?? 'free';
}

// Returns null (all categories) or string[] of accessible category names.
// Tier arrays are inclusive — silverCategories contains everything silver can see
// (guest + free + silver categories); freeCategories contains guest + free, etc.
function getAccessibleCategories(tier, settings) {
  if (tier === 'gold') return null;
  if (tier === 'silver' || tier === 'trial') return settings.silverCategories ?? [];
  if (tier === 'free') return settings.freeCategories ?? [];
  return settings.guestCategories ?? [];
}

// Returns true if the user can access this category (subscription tier check only)
function canAccessCategory(category, tier, settings) {
  const accessible = getAccessibleCategories(tier, settings);
  return accessible === null || accessible.includes(category);
}

// Builds the cumulative-coins-per-level array from Level documents.
// Accepts either DB format { airstarsToNextLevel } or API format { cumulativeAirstars }.
// Returns e.g. [0, 100, 350, 850, ...] — index i is the cumulative coins to reach level i+1.
function buildCumulativeThresholds(levels) {
  if (!levels?.length) return [0];
  if (levels[0].cumulativeAirstars !== undefined) {
    return levels.map(l => l.cumulativeAirstars);
  }
  const result = [];
  let cumulative = 0;
  for (const lv of levels) {
    result.push(cumulative);
    if (lv.airstarsToNextLevel) cumulative += lv.airstarsToNextLevel;
  }
  return result;
}

// Returns the user's current level (1–10) from cycle airstars and live thresholds.
// Pathway gating uses cycleAirstars so the gate matches the level the user sees in
// the UI. Cycle resets only happen alongside total resets (rank promotion clears
// cycle but past unlocks stay sticky via the userRank > rankRequired bypass below).
// levelThresholds: cumulative array built by buildCumulativeThresholds()
function getUserLevel(cycleAirstars, levelThresholds) {
  const coins      = cycleAirstars ?? 0;
  const thresholds = levelThresholds;
  let level = 1;
  for (let i = 1; i < thresholds.length; i++) {
    if (coins >= thresholds[i]) level = i + 1;
    else break;
  }
  return level;
}

// Returns true if the user meets the pathway (level + rank) requirements for a category.
// Guests always pass — pathway gating only applies to authenticated users.
// If no entry exists in pathwayUnlocks for the category, access is granted.
// Rule: if userRank > rankRequired, the level check is bypassed (they've already surpassed
// the rank at which this category first unlocks, so cycle-level resets are irrelevant
// and prior unlocks stay sticky across rank promotions).
// If userRank === rankRequired, both level and rank must be met.
function isPathwayUnlocked(category, user, settings, levelThresholds) {
  if (!user) return true;
  const unlock = (settings.pathwayUnlocks ?? []).find(p => p.category === category);
  if (!unlock) return true;
  const userLevel = getUserLevel(user.cycleAirstars, levelThresholds);
  const userRank  = user.rank?.rankNumber ?? 1;
  return userRank > unlock.rankRequired || (userRank >= unlock.rankRequired && userLevel >= unlock.levelRequired);
}

// Returns an array of categories accessible to the user based on pathway requirements.
// Returns null if the user is a guest (no pathway restriction applies to guests).
// Useful for building DB query $in filters.
function getPathwayAccessibleCategories(user, settings, levelThresholds) {
  if (!user) return null;
  const userLevel = getUserLevel(user.cycleAirstars, levelThresholds);
  const userRank  = user.rank?.rankNumber ?? 1;
  return (settings.pathwayUnlocks ?? [])
    .filter(p => userRank > p.rankRequired || (userRank >= p.rankRequired && userLevel >= p.levelRequired))
    .map(p => p.category);
}

module.exports = {
  effectiveTier,
  getAccessibleCategories,
  canAccessCategory,
  buildCumulativeThresholds,
  getUserLevel,
  isPathwayUnlocked,
  getPathwayAccessibleCategories,
};
