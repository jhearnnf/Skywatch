// Copy and constants for the CBAT progress-award milestone screen.
//
// The tiers mirror AWARD_TIERS in backend/utils/cbatProgressAward.js, which is the
// authority — the server decides which tier is awarded and the client only renders
// what it is handed. They are duplicated here so the admin preview can generate a
// plausible award without a round trip, and so the wording lives beside them.

export const AWARD_TIERS = [15, 30, 50]

// Plain descriptions of the size of the jump, not invented rank names. The screen
// is reporting a measured fact about the player's scores, and dressing that up as
// a made-up accolade would make it read as decoration rather than data.
const AWARD_TITLES = {
  15: "You're improving",
  30: 'Big improvement',
  50: 'Huge improvement',
}

export function awardTitle(tier) {
  return AWARD_TITLES[tier] ?? "You're improving"
}

// The one-line statement of what was measured.
//
// Worded as last-5 vs first-5 to match the trend line already on the results screen
// (cbatTrendPhrase in src/utils/cbatProgress.js). Two figures describing the same
// runs must be worded the same way, and "since your first ever run" would be a
// stronger claim than the numbers support — the series behind them is capped at the
// most recent 50 attempts, so for a heavy player "first 5" means the first 5 of that
// window rather than the first 5 they ever played.
//
// It also stays a claim about SCORES, never about aptitude. "Your spatial reasoning
// improved 34%" is not something these games can measure.
export function awardSummary(pct, gameTitle) {
  return `Your last 5 runs at ${gameTitle} are ${pct}% better than your first 5.`
}
