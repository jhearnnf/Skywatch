'use strict';

/**
 * "How busy is SkyWatch" — the two numbers shown on the CBAT lounge.
 *
 * Both are counted, not estimated, and both come from GameSessionCbatStart, the
 * same collection the admin activity heatmap reads. A start is logged whether or
 * not the run is finished, so this measures people playing rather than people
 * scoring well — which is the honest reading of "is anyone here".
 *
 * WHY CUMULATIVE AND NOT CONCURRENT. A live "N online" is the obvious thing to
 * put here and the wrong one: it is the smallest true number the site can quote
 * about itself, it swings to zero at 4am, and it needs presence plumbing to
 * boot. A rolling window answers the same question a visitor is actually asking
 * — "do other people use this?" — with a number an order of magnitude larger and
 * no less true. Nothing here is padded; if the site is quiet the numbers are
 * small, and the widget hides itself rather than showing a lonely "3 games".
 *
 * DAYS ARE UK DAYS. "Today" is bucketed in ACTIVITY_TZ, matching the heatmap and
 * the app-open log, so a 23:30 BST run counts toward the day the player
 * experienced rather than tomorrow.
 *
 * CACHED, because /cbat is the busiest signed-in page and these are two
 * collection-wide aggregations. A minute of staleness is invisible on a weekly
 * counter and saves the scan on every hub load and every 30s refresh.
 */

const GameSessionCbatStart = require('../models/GameSessionCbatStart');
const { ACTIVITY_TZ } = require('../constants/activity');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60 * 1000;

// Below this the widget is not worth drawing: a handful of runs reads as "nobody
// is here" more loudly than showing nothing does. The client decides what to do
// with `quiet`; the counts are always returned truthfully either way.
const QUIET_BELOW_PLAYS = 10;

let cache = null; // { at, value }

// Midnight tonight-just-gone in ACTIVITY_TZ, as a UTC instant. Derived from the
// zone's own formatted parts rather than an offset guess, so it stays correct
// across the BST/GMT switch.
function startOfDayInTz(now = new Date(), tz = ACTIVITY_TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = Number(p.value);
    return acc;
  }, {});
  // Hour 24 is how en-GB/hour12:false spells midnight; it means 0 elapsed hours.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const elapsedMs = ((hour * 60 + parts.minute) * 60 + parts.second) * 1000;
  return new Date(now.getTime() - elapsedMs - now.getMilliseconds());
}

/**
 * @returns {Promise<{plays7d:number, agentsToday:number, quiet:boolean}>}
 */
async function buildCbatActivityStats({ now = new Date() } = {}) {
  if (cache && now.getTime() - cache.at < CACHE_TTL_MS) return cache.value;

  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const dayStart = startOfDayInTz(now);

  const [plays7d, agentsToday] = await Promise.all([
    GameSessionCbatStart.countDocuments({ startedAt: { $gte: weekAgo } }),
    // distinct() rather than a $group + $count: the day's start set is small and
    // this reads as what it is.
    GameSessionCbatStart.distinct('userId', { startedAt: { $gte: dayStart } })
      .then(ids => ids.length),
  ]);

  const value = { plays7d, agentsToday, quiet: plays7d < QUIET_BELOW_PLAYS };
  cache = { at: now.getTime(), value };
  return value;
}

// Tests need a clean slate between cases.
function clearActivityStatsCache() {
  cache = null;
}

module.exports = {
  buildCbatActivityStats,
  clearActivityStatsCache,
  startOfDayInTz,
  QUIET_BELOW_PLAYS,
  CACHE_TTL_MS,
};
