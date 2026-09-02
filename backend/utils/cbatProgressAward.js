// CBAT progress awards — deciding when a player has improved enough to be told so,
// and whether the donation footnote may ride along with it.
//
// Lives on the server rather than in the component because the decision has to be
// made against state only the server holds (which tiers this user has already been
// shown) and has to be atomic with recording it — two tabs finishing a run at once
// must not both award the same milestone.
//
// The improvement figure itself is NOT recomputed here from raw runs. It comes from
// buildCbatProgress (utils/cbatProgressSeries.js), the same numbers that draw the
// sparkline the award appears above. That is deliberate: a headline percentage that
// disagreed with the chart directly beneath it would be worse than no headline. It
// also means "sustained, not a spike" comes for free — firstAvg/lastAvg are already
// means of five runs at each end, so one fluke run cannot earn a milestone.

// Improvement thresholds, ascending. Crossing one awards it ONCE, ever, per game.
// They are deliberately far apart: tiers close together would fire in consecutive
// sessions and turn the screen into noise.
const AWARD_TIERS = [15, 30, 50];

// Below this many lifetime attempts we say nothing, whatever the percentage.
// Early runs at any CBAT game are dominated by learning the interface, so a big
// early delta is mostly familiarity rather than progress — and 6 attempts is only
// just enough for a trend to exist at all (PROGRESS_MIN_FOR_TREND).
const AWARD_MIN_ATTEMPTS = 8;

// Donation-ask frequency caps. Both are global across every game.
const DONATION_COOLDOWN_DAYS = 30;
const DONATION_MAX_DISMISSALS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

// Percent improvement in recent form over early form, ALWAYS signed so that
// positive means "better" whichever direction the game scores in. Mirrors
// cbatTrend in src/utils/cbatProgress.js — the frontend reads the same delta for
// its trend line, and the two must not disagree about what "better" means.
//
// Returns null when there is no trustworthy baseline: no trend window yet
// (buildCbatProgress nulls both ends below 6 attempts), or a zero baseline, which
// no percentage can be expressed against.
function improvementPct({ firstAvg, lastAvg }, lowerIsBetter) {
  if (firstAvg == null || lastAvg == null) return null;
  if (firstAvg === 0) return null;

  const gain = lowerIsBetter ? firstAvg - lastAvg : lastAvg - firstAvg;
  return Math.round((gain / Math.abs(firstAvg)) * 100);
}

// The highest tier this percentage has reached, or null below the first one.
function highestTierReached(pct) {
  if (pct == null) return null;
  let reached = null;
  for (const tier of AWARD_TIERS) {
    if (pct >= tier) reached = tier;
  }
  return reached;
}

// The tier to award now: the highest one reached that this user has not already
// been shown for this game, or null if there is nothing new.
//
// Awarding only the HIGHEST unseen tier matters for a player who improves fast or
// who plays their first eight runs in one sitting — they cross +15, +30 and +50
// together, and should get one "Huge improvement", not three screens back to back.
// The skipped tiers are still recorded as seen by the caller so they can never fire
// later on a smaller delta.
function tierToAward({ attempts, firstAvg, lastAvg }, { lowerIsBetter, seenTiers = [] } = {}) {
  if (!Number.isFinite(attempts) || attempts < AWARD_MIN_ATTEMPTS) return null;

  const pct = improvementPct({ firstAvg, lastAvg }, lowerIsBetter);
  const reached = highestTierReached(pct);
  if (reached == null) return null;

  const seen = new Set(seenTiers);
  const unseen = AWARD_TIERS.filter(t => t <= reached && !seen.has(t));
  if (unseen.length === 0) return null;

  return { tier: unseen[unseen.length - 1], pct, claimed: unseen };
}

// Whether the donation footnote may accompany an award right now.
//
// Every one of these is a hard gate rather than a weighting — an ask that slips
// through any of them is worse than no ask at all:
//   - the feature flags are off, or
//   - they have already donated, or
//   - they have dismissed it enough times to have answered the question, or
//   - it was shown too recently.
//
// The "already donated" gate is permanent and has no cooldown, deliberately.
// Asking again is the one outcome that turns a supporter into someone who
// regrets supporting, and a donor who wants to give a second time knows where
// /donate is. It can only ever be set for a donor who was signed in when they
// paid — an anonymous donation is unobservable, and those fall back to the
// dismissal cap like everyone else.
function donationPromptDue(donationPrompt, settings, now = new Date()) {
  if (!settings?.progressAwardDonateEnabled) return false;

  const state = donationPrompt || {};
  if (state.donatedAt) return false;
  if ((state.dismissCount ?? 0) >= DONATION_MAX_DISMISSALS) return false;

  if (state.lastShownAt) {
    const since = now.getTime() - new Date(state.lastShownAt).getTime();
    if (since < DONATION_COOLDOWN_DAYS * DAY_MS) return false;
  }

  return true;
}

module.exports = {
  AWARD_TIERS,
  AWARD_MIN_ATTEMPTS,
  DONATION_COOLDOWN_DAYS,
  DONATION_MAX_DISMISSALS,
  improvementPct,
  highestTierReached,
  tierToAward,
  donationPromptDue,
};
