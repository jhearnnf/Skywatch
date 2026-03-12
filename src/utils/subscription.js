// Mirrors backend/utils/subscription.js for client-side gating

export function getAccessibleCategories(user, settings) {
  if (!user || !settings) return []          // not loaded yet — show nothing locked (fail open)
  const tier = user.isTrialActive ? 'trial' : (user.subscriptionTier ?? 'free')
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
