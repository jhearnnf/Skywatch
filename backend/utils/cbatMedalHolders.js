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

const { CBAT_GAMES, cbatLabelWithDifficulty } = require('../constants/cbatGames');
const { bestPerUserTop20, paddedFakesFrom, isBetterScore } = require('./cbatBoardRank');

const CACHE_MS = 5 * 60 * 1000;
const PODIUM = 3;

let cache = { at: 0, holders: new Map() };
// The sweep currently running, if any. Chat asks for medals on every message
// fetch and each open thread polls every 5s, so without this every client whose
// poll happens to land on an expired cache would kick off its own full sweep
// against the same collections at the same moment.
let inFlight = null;

function resetMedalHoldersCache() {
  cache = { at: 0, holders: new Map() };
  inFlight = null;
}

// Top `PODIUM` rows of one game's padded board, real users only, with the place
// they hold. A demo row occupies a place exactly as it does on screen, so a
// player sitting under two fakes is 3rd here too.
async function podiumFor(gameKey, cfg) {
  // One query, used for both halves of the board. The demo rows are a pure
  // function of the real ones, so asking the database for them separately —
  // as this used to — ran the identical aggregation a second time per game.
  const real  = await bestPerUserTop20(cfg);
  const fakes = paddedFakesFrom(real, gameKey, false);

  const board = [
    ...real.map(r => ({ userId: r.userId, bestScore: r.bestScore, bestTime: r.bestTime })),
    ...fakes.map(f => ({ userId: null, bestScore: f.bestScore, bestTime: f.bestTime })),
  ].sort((a, b) => (isBetterScore(cfg, a.bestScore, a.bestTime, b.bestScore, b.bestTime) ? -1 : 1));

  return board.slice(0, PODIUM)
    .map((row, i) => ({ userId: row.userId, rank: i + 1 }))
    .filter(row => row.userId);
}

// One pass over every game. The podiums are independent, so they are gathered
// concurrently rather than one game at a time — serially this was ~25 round
// trips to Mongo stacked end to end, on the critical path of opening a channel.
// Promise.all preserves order, so a user's medals still accumulate in
// CBAT_GAMES order and the stable sort below still breaks rank ties by it.
async function sweep() {
  const results = await Promise.all(
    Object.entries(CBAT_GAMES).map(async ([gameKey, cfg]) => {
      try {
        return { gameKey, cfg, podium: await podiumFor(gameKey, cfg) };
      } catch (err) {
        // One misbehaving game must not cost every other game its medals.
        console.error(`[medals] podium for ${gameKey} failed: ${err.message}`);
        return null;
      }
    })
  );

  const holders = new Map();
  for (const result of results) {
    if (!result) continue;
    const { gameKey, cfg, podium } = result;
    for (const { userId, rank } of podium) {
      const key = String(userId);
      const list = holders.get(key) ?? [];
      // Difficulty-qualified: an avatar medal is read one tooltip at a time
      // ("Gold — FLAG"), with nothing beside it to say which board it was won
      // on. Same label the Medals channel announces.
      list.push({ gameKey, gameLabel: cbatLabelWithDifficulty(gameKey), rank });
      holders.set(key, list);
    }
  }

  // Best medal first, so a truncated display shows the most impressive.
  for (const list of holders.values()) list.sort((a, b) => a.rank - b.rank);

  cache = { at: Date.now(), holders };
  return holders;
}

// Start a sweep and publish it as the in-flight one for others to join.
function startSweep() {
  const run = sweep()
    .catch((err) => {
      // sweep() already swallows per-game failures, so this only catches
      // something broader. A background refresh has no caller waiting on it,
      // and an unhandled rejection there would take the process down.
      console.error(`[medals] sweep failed: ${err.message}`);
      return cache.holders;
    })
    .finally(() => { if (inFlight === run) inFlight = null; });
  inFlight = run;
  return run;
}

/**
 * @returns {Promise<Map<string, Array<{gameKey, gameLabel, rank}>>>}
 *   userId string -> medals held, best first
 */
async function getMedalHolders({ force = false } = {}) {
  if (!force && Date.now() - cache.at < CACHE_MS) return cache.holders;

  // A forced call always runs its own sweep rather than joining one that may
  // have started before the write it is meant to observe.
  if (force) return startSweep();

  const refresh = inFlight ?? startSweep();

  // Stale-while-revalidate. Medals only move when someone is overtaken, so
  // serving a podium a few seconds past its five-minute life costs nothing —
  // whereas making whoever opens a channel after a quiet spell wait for the
  // whole sweep is precisely the stall this cache exists to prevent. Only a
  // genuinely cold cache, with nothing to serve, waits for the answer.
  return cache.at ? cache.holders : refresh;
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
