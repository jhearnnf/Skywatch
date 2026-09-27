// Whether a user's subscription includes CBAT at all. Shared by the game routes and the Mock
// Assessment routes so the two can never disagree about who may play.
const { effectiveTier } = require('./subscription');

function canAccessCbat(user, settings) {
  if (user?.isAdmin) return true;
  const tier = effectiveTier(user);
  const checkTier = tier === 'trial' ? 'silver' : tier;
  const tiers = Array.isArray(settings?.cbatTiers) ? settings.cbatTiers : [];
  return tiers.includes(checkTier);
}

module.exports = { canAccessCbat };
