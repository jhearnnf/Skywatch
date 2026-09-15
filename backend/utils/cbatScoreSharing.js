'use strict';

/**
 * Score Sharing — the opt-out that takes a player's scores off every shared
 * surface.
 *
 * One switch under Profile › Settings (`User.hideFromShowcase`) covers all of
 * them: the homepage progress wall, the public player profile, the all-time
 * and weekly leaderboards, the Recent Scores feed, the post-game chase window
 * and the podium medals (on the avatar, in the Medals channel, on the profile).
 * A player who has opted out still sees their OWN standing wherever the page
 * has a "you" row — that is private to them — but never appears in anyone
 * else's view, and never holds a medal, because a medal is a place on a board
 * they are not on.
 *
 * Every board pipeline starts with `userId: { $nin: hidden }`, applied before
 * the $group, so an opted-out player is not merely dropped from the visible
 * rows but from the ranking as well — nobody sits "5th" behind someone the
 * board does not show. The id list is one indexed query on a small, rarely
 * changing set, cached briefly and cleared the moment the switch is flipped.
 */

const User = require('../models/User');

const CACHE_MS = 60 * 1000;
let cache = { at: 0, ids: null };
let inFlight = null;

async function hiddenScoreUserIds() {
  if (cache.ids && Date.now() - cache.at < CACHE_MS) return cache.ids;
  if (!inFlight) {
    inFlight = User.find({ hideFromShowcase: true }).select('_id').lean()
      .then(rows => {
        cache = { at: Date.now(), ids: rows.map(r => r._id) };
        return cache.ids;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

// Mongo match fragment for a score collection: every session except those of
// opted-out players. `exceptUserId` keeps one player in (the viewer, on a
// "you" row) even if they have opted out themselves.
async function scoreSharingMatch(exceptUserId = null) {
  let ids = await hiddenScoreUserIds();
  if (exceptUserId) ids = ids.filter(id => String(id) !== String(exceptUserId));
  return ids.length ? { userId: { $nin: ids } } : {};
}

async function isScoreHidden(userId) {
  const ids = await hiddenScoreUserIds();
  return ids.some(id => String(id) === String(userId));
}

function clearScoreSharingCache() {
  cache = { at: 0, ids: null };
  inFlight = null;
}

module.exports = { hiddenScoreUserIds, scoreSharingMatch, isScoreHidden, clearScoreSharingCache };
