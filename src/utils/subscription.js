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

export function isCategoryLocked(category, user, settings) {
  const accessible = getAccessibleCategories(user, settings)
  if (accessible === null) return false      // gold
  if (accessible.length === 0) return false  // settings not loaded — fail open
  return !accessible.includes(category)
}
