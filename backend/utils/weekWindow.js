// Weekly leaderboard window helpers.
//
// The weekly CBAT leaderboards are computed on the fly — there is no stored
// rollup or reset cron. "This week" is simply every session whose createdAt is
// at or after the most recent Monday 00:00 UTC. Because every result row already
// carries createdAt (stamped with the real playedAt even for offline-synced
// scores), a weekly board is just the all-time aggregation with one extra
// createdAt filter, and it "resets" automatically when the boundary moves.
//
// UTC is used for the boundary so the reset is consistent server-side and never
// drifts with DST. For a UK-focused product this is GMT/BST ± an hour, which is
// close enough; revisit only if users care about the exact local midnight.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Monday 00:00:00.000 UTC of the week containing `now`.
// JS getUTCDay(): Sun=0, Mon=1 … Sat=6. We want days-since-Monday, so Sunday
// maps to 6 (end of the week) rather than 0 (start).
function startOfWeekUTC(now = new Date()) {
  const d = new Date(now);
  const dow = d.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

// Next Monday 00:00 UTC — i.e. when the current week's board resets. Used for
// the "resets in Xd Yh" countdown on the post-game reveal and leaderboard.
function nextResetAt(now = new Date()) {
  return new Date(startOfWeekUTC(now).getTime() + WEEK_MS);
}

module.exports = { startOfWeekUTC, nextResetAt, WEEK_MS };
