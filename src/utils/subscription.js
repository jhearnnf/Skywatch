// Mirrors backend/utils/subscription.js for client-side gating

/**
 * Returns a human-readable tier label for display.
 * Active trial → 'Trial (Silver)', expired trial → 'Trial (expired)',
 * otherwise capitalised tier name.
 */
export function displayTier(user) {
  if (!user) return 'Guest'
  const tier = user.subscriptionTier ?? 'free'
  if (tier === 'trial') {
    return user.isTrialActive ? 'Trial (Silver)' : 'Trial (expired)'
  }
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

export function getAccessibleCategories(user, settings) {
  if (!settings) return []                   // not loaded yet — show nothing locked (fail open)
  if (!user) return settings.guestCategories ?? ['News']
  const sub = user.subscriptionTier ?? 'free'
  // Active trial gets silver perks; expired trial drops back to free
  const tier = sub === 'trial' ? (user.isTrialActive ? 'trial' : 'free') : sub
  if (tier === 'gold') return null            // null = all categories accessible
  if (tier === 'silver' || tier === 'trial') return settings.silverCategories ?? []
  return settings.freeCategories ?? []
}

// Returns 'silver' or 'gold' — the minimum tier needed to access a category
export function requiredTier(category, settings) {
  const silver = settings?.silverCategories ?? []
  return silver.includes(category) ? 'silver' : 'gold'
}

// Returns 'free', 'silver', or 'gold' — the tier required to unlock a pathway.
// Derived from freeCategories/silverCategories so it stays in sync with category access.
export function pathwayTierRequired(category, settings) {
  if (!settings) return 'free'  // fail open — show nothing as requiring upgrade
  const free   = settings.freeCategories   ?? []
  const silver = settings.silverCategories ?? []
  if (free.includes(category))   return 'free'
  if (silver.includes(category)) return 'silver'
  return 'gold'
}

// True only for logged-in users on the free plan (or expired trial).
// Guests are NOT free users — they need to sign in, not upgrade.
export function isFreeUser(user) {
  if (!user) return false
  const tier = user.subscriptionTier ?? 'free'
  if (tier === 'trial') return !user.isTrialActive
  return tier === 'free'
}

// Fallback cumulative thresholds — used when live levels haven't loaded yet.
const LEVEL_THRESHOLDS_FALLBACK = [0, 100, 350, 850, 1700, 3000, 4850, 7350, 10600, 14700]

// Converts a levels array (cumulativeAirstars format from /api/users/levels) to a threshold array.
export function buildCumulativeThresholds(levels) {
  if (!levels?.length) return LEVEL_THRESHOLDS_FALLBACK
  if (levels[0].cumulativeAirstars !== undefined) {
    return levels.map(l => l.cumulativeAirstars)
  }
  const result = []
  let cumulative = 0
  for (const lv of levels) {
    result.push(cumulative)
    if (lv.airstarsToNextLevel) cumulative += lv.airstarsToNextLevel
  }
  return result
}

// Pathway gating uses cycleAirstars so the gate matches the level the user sees in the UI.
export function getUserLevel(cycleAirstars, levelThresholds) {
  const coins = cycleAirstars ?? 0
  const thresholds = levelThresholds ?? LEVEL_THRESHOLDS_FALLBACK
  let level = 1
  for (let i = 1; i < thresholds.length; i++) {
    if (coins >= thresholds[i]) level = i + 1
    else break
  }
  return level
}

// Returns true if the user meets the pathway (level + rank) requirements for a category.
// Guests always pass. If userRank > rankRequired, the level check is bypassed —
// having surpassed the unlock rank means cycle-level resets from prior cycles are irrelevant
// and prior unlocks stay sticky across rank promotions.
export function isPathwayUnlocked(category, user, settings, levelThresholds) {
  if (!user) return true
  if (!settings?.pathwayUnlocks) return true
  const unlock = settings.pathwayUnlocks.find(p => p.category === category)
  if (!unlock) return true
  const userLevel = getUserLevel(user.cycleAirstars, levelThresholds)
  const userRank  = user.rank?.rankNumber ?? 1
  return userRank > unlock.rankRequired || (userRank >= unlock.rankRequired && userLevel >= unlock.levelRequired)
}

// Returns the pathway unlock requirements for a category, or null if none.
export function getPathwayRequirements(category, settings) {
  if (!settings?.pathwayUnlocks) return null
  return settings.pathwayUnlocks.find(p => p.category === category) ?? null
}

export function isCategoryLocked(category, user, settings, levelThresholds) {
  const accessible = getAccessibleCategories(user, settings)
  if (accessible === null) {
    // Gold subscription — only pathway can lock it
    return !isPathwayUnlocked(category, user, settings, levelThresholds)
  }
  if (accessible.length === 0) return false  // settings not loaded — fail open
  if (!accessible.includes(category)) return true
  return !isPathwayUnlocked(category, user, settings, levelThresholds)
}

// Returns why a category is locked:
//   'signin'  — guest (not logged in)
//   'upgrade' — subscription tier too low
//   'pathway' — level or rank requirement not met
//   null      — accessible
export function lockReason(category, user, settings, levelThresholds) {
  const accessible = getAccessibleCategories(user, settings)
  if (accessible === null) {
    // Gold subscription — only pathway can lock it
    return isPathwayUnlocked(category, user, settings, levelThresholds) ? null : 'pathway'
  }
  if (accessible.length === 0) return null  // settings not loaded — fail open
  if (!accessible.includes(category)) return user ? 'upgrade' : 'signin'
  // Subscription OK — check pathway
  return isPathwayUnlocked(category, user, settings, levelThresholds) ? null : 'pathway'
}
