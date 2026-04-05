// Returns the effective subscription tier for a user.
// An expired trial is treated as 'free' — subscriptionTier stays 'trial' in the DB
// but isTrialActive (a Mongoose virtual) will be false once the window has passed.
function _isTrialActive(user) {
  if (!user.trialStartDate) return false;
  const trialEnd = new Date(user.trialStartDate);
  trialEnd.setDate(trialEnd.getDate() + (user.trialDurationDays || 5));
  return new Date() < trialEnd;
}

function effectiveTier(user) {
  if (!user) return 'free';
  if (user.subscriptionTier === 'trial') {
    // isTrialActive is a Mongoose virtual — not present on .lean() objects, so compute it
    const active = user.isTrialActive ?? _isTrialActive(user);
    return active ? 'trial' : 'free';
  }
  return user.subscriptionTier ?? 'free';
}

// Returns null (all categories) or string[] of accessible category names
function getAccessibleCategories(tier, settings) {
  if (tier === 'gold') return null;
  if (tier === 'silver' || tier === 'trial') return settings.silverCategories ?? [];
  if (tier === 'guest') return settings.guestCategories ?? ['News'];
  return settings.freeCategories ?? [];
}

// Returns true if the user can access this category (subscription tier check only)
function canAccessCategory(category, tier, settings) {
  const accessible = getAccessibleCategories(tier, settings);
  return accessible === null || accessible.includes(category);
}

// Cumulative totalAircoins needed to reach each level (index 0 = level 1 start)
const LEVEL_THRESHOLDS = [0, 100, 350, 850, 1700, 3000, 4850, 7350, 10600, 14700];

// Returns the user's current level (1–10) based on total aircoins
function getUserLevel(totalAircoins) {
  const coins = totalAircoins ?? 0;
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (coins >= LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

// Returns true if the user meets the pathway (level + rank) requirements for a category.
// Guests always pass — pathway gating only applies to authenticated users.
// If no entry exists in pathwayUnlocks for the category, access is granted.
// Rule: if userRank > rankRequired, the level check is bypassed (they've already surpassed
// the rank at which this category first unlocks, so level resets are irrelevant).
// If userRank === rankRequired, both level and rank must be met.
function isPathwayUnlocked(category, user, settings) {
  if (!user) return true;
  const unlock = (settings.pathwayUnlocks ?? []).find(p => p.category === category);
  if (!unlock) return true;
  const userLevel = getUserLevel(user.totalAircoins);
  const userRank  = user.rank?.rankNumber ?? 1;
  return userRank > unlock.rankRequired || (userRank >= unlock.rankRequired && userLevel >= unlock.levelRequired);
}

// Returns an array of categories accessible to the user based on pathway requirements.
// Returns null if the user is a guest (no pathway restriction applies to guests).
// Useful for building DB query $in filters.
function getPathwayAccessibleCategories(user, settings) {
  if (!user) return null;
  const userLevel = getUserLevel(user.totalAircoins);
  const userRank  = user.rank?.rankNumber ?? 1;
  return (settings.pathwayUnlocks ?? [])
    .filter(p => userRank > p.rankRequired || (userRank >= p.rankRequired && userLevel >= p.levelRequired))
    .map(p => p.category);
}

module.exports = {
  effectiveTier,
  getAccessibleCategories,
  canAccessCategory,
  getUserLevel,
  isPathwayUnlocked,
  getPathwayAccessibleCategories,
};
