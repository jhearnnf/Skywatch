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

// Returns true if the user can access this category
function canAccessCategory(category, tier, settings) {
  const accessible = getAccessibleCategories(tier, settings);
  return accessible === null || accessible.includes(category);
}

module.exports = { effectiveTier, getAccessibleCategories, canAccessCategory };
