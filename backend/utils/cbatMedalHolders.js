'use strict';

/**
 * Who currently holds a podium place on each CBAT all-time leaderboard.
 *
 * Chat hangs a user's medals off their avatar, so this answers "which medals
 * does this agent hold right now" for a whole thread at once.
 *
 * Ranked against the SAME padded board a player sees (best-per-user, plus the
 * demo rows padLeaderboard injects into thin games) — see cbatBoardRank.js.
 * Showing someone a gold medal for a position the leaderboard does not show
 * them in would be worse than showing nothing.
 *
 * Computed for every game at once and cached, rather than per user on demand:
 * a chat thread can hold twenty distinct senders, and ranking each of them
 * against each of ~20 boards would be hundreds of aggregations per page load.
 * One sweep is ~20 aggregations and answers for everybody.
 *
 * Medals move when someone is overtaken, so this is derived on read rather than
 * stored on the User — a stored medal would need invalidating on every score
 * anyone ever set.
 */

const { CBAT_GAMES } = require('../constants/cbatGames');
const { cbatPaddedFakes, isBetterScore } = require('./cbatBoardRank');

const CACHE_MS = 5 * 60 * 1000;
const PODIUM = 3;

let cache = { at: 0, holders: new Map() };

function resetMedalHoldersCache() {
  cache = { at: 0, holders: new Map() };
}

// Top `PODIUM` rows of one game's padded board, real users only, with the place
// they hold. A demo row occupies a place exactly as it does on screen, so a
// player sitting under two fakes is 3rd here too.
async function podiumFor(gameKey, cfg) {
  const modeFilter = cfg.modeFilter ?? null;

  const real = await cfg.Model.aggregate([
    ...(modeFilter ? [{ $match: modeFilter }] : []),
    { $sort: { [cfg.primaryField]: cfg.sortDir, totalTime: 1 } },
    {
      $group: {
        _id: '$userId',
        bestScore: { $first: `$${cfg.primaryField}` },
        bestTime:  { $first: '$totalTime' },
      },
    },
    { $sort: { bestScore: cfg.sortDir, bestTime: 1 } },
    { $limit: 20 },
    { $project: { _id: 0, userId: '$_id', bestScore: 1, bestTime: 1 } },
  ]);

  const fakes = await cbatPaddedFakes(gameKey, cfg, false);

  const board = [
    ...real.map(r => ({ userId: r.userId, bestScore: r.bestScore, bestTime: r.bestTime })),
    ...fakes.map(f => ({ userId: null, bestScore: f.bestScore, bestTime: f.bestTime })),
  ].sort((a, b) => (isBetterScore(cfg, a.bestScore, a.bestTime, b.bestScore, b.bestTime) ? -1 : 1));

  return board.slice(0, PODIUM)
    .map((row, i) => ({ userId: row.userId, rank: i + 1 }))
    .filter(row => row.userId);
}

/**
 * @returns {Promise<Map<string, Array<{gameKey, gameLabel, rank}>>>}
 *   userId string -> medals held, best first
 */
async function getMedalHolders({ force = false } = {}) {
  if (!force && Date.now() - cache.at < CACHE_MS) return cache.holders;

  const holders = new Map();
  for (const [gameKey, cfg] of Object.entries(CBAT_GAMES)) {
    let podium;
    try {
      podium = await podiumFor(gameKey, cfg);
    } catch (err) {
      // One misbehaving game must not cost every other game its medals.
      console.error(`[medals] podium for ${gameKey} failed: ${err.message}`);
      continue;
    }
    for (const { userId, rank } of podium) {
      const key = String(userId);
      const list = holders.get(key) ?? [];
      list.push({ gameKey, gameLabel: cfg.label, rank });
      holders.set(key, list);
    }
  }

  // Best medal first, so a truncated display shows the most impressive.
  for (const list of holders.values()) list.sort((a, b) => a.rank - b.rank);

  cache = { at: Date.now(), holders };
  return holders;
}

/** Medals for a set of users, as a plain object keyed by id. */
async function medalsForUsers(userIds = []) {
  if (!userIds.length) return {};
  const holders = await getMedalHolders();
  const out = {};
  for (const id of userIds) {
    const list = holders.get(String(id));
    if (list?.length) out[String(id)] = list;
  }
  return out;
}

module.exports = {
  getMedalHolders,
  medalsForUsers,
  resetMedalHoldersCache,
  PODIUM,
  CACHE_MS,
};
