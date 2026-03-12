// Returns the effective subscription tier for a user.
// An expired trial is treated as 'free' — subscriptionTier stays 'trial' in the DB
// but isTrialActive (a Mongoose virtual) will be false once the window has passed.
function effectiveTier(user) {
  if (!user) return 'free';
  if (user.subscriptionTier === 'trial') {
    return user.isTrialActive ? 'trial' : 'free';
  }
  return user.subscriptionTier ?? 'free';
}

// Returns null (all categories) or string[] of accessible category names
function getAccessibleCategories(tier, settings) {
  if (tier === 'gold') return null;
  if (tier === 'silver' || tier === 'trial') return settings.silverCategories ?? [];
  return settings.freeCategories ?? [];
}

// Returns true if the user can access this category
function canAccessCategory(category, tier, settings) {
  const accessible = getAccessibleCategories(tier, settings);
  return accessible === null || accessible.includes(category);
}

module.exports = { effectiveTier, getAccessibleCategories, canAccessCategory };
