// CBAT medal detection.
//
// When a player takes 1st, 2nd or 3rd on a CBAT game's all-time leaderboard, we
// announce it in the in-app Medals channel. Only medals — ordinary scores stay
// on the site's Recent Scores feed, so the channel is worth reading.
//
// This module decides *whether* a result earned a medal; chatMedals.js decides
// what the announcement looks like and where it lands. They were split when
// there were two sinks: medals used to be mirrored to a Discord webhook as well.
// That was removed on 2026-08-07 — nothing about a player's scores leaves
// SkyWatch now — but the split is still worth keeping, since detection is the
// expensive half and runs on the hot path of every score submission.
//
// Two things this must never do:
//   • Break a score submission. Every entry point is fire-and-forget and
//     swallows its own errors; the announcement is not the player's problem.
//   • Leak an email address. Agents are named exactly as the leaderboard names
//     them — display name, else agent number.
//
// Off unless the Medals channel exists and has a bot assigned. With it missing
// this module does nothing and costs nothing — the enable check runs before any
// ranking work.

const User = require('../models/User');
const { CBAT_GAMES, cbatLabelWithDifficulty } = require('../constants/cbatGames');
const { rankOnPaddedBoard, isBetterScore } = require('./cbatBoardRank');

const MEDALS = {
  1: { emoji: '🥇', word: 'Gold' },
  2: { emoji: '🥈', word: 'Silver' },
  3: { emoji: '🥉', word: 'Bronze' },
};

// A replayed offline score can arrive days after it was set (the outbox stamps
// playedAt and cbatResult.js backdates createdAt). Celebrating it as news would
// be wrong, and the site's own Recent Scores feed uses the same 24h horizon.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Exactly what the leaderboard shows: display name, else agent number. Never email.
//
// Returns the name RAW — the Medals channel renders plain text, so escaping here
// would print the backslashes. A name like SkyWatch_Dev reached chat as
// "SkyWatch\_Dev" back when this escaped markdown for the Discord sink's benefit.
// Escaping is a property of where the name is going, not of the name itself.
function agentLabel(user) {
  if (user?.displayName) return user.displayName.replace(/\s+/g, ' ').trim();
  if (user?.agentNumber) return `Agent ${String(user.agentNumber).replace(/\s+/g, ' ').trim()}`;
  return 'An agent';
}

// Resolve a result document back to its CBAT_GAMES key. Several games share one
// Model (plane-turn 2d/3d), so the registry's modeFilter is matched against the
// document's own fields rather than against anything the caller passes in.
function gameKeyForResult(Model, doc) {
  for (const [gameKey, cfg] of Object.entries(CBAT_GAMES)) {
    if (cfg.Model !== Model) continue;
    const filter = cfg.modeFilter ?? {};
    if (Object.entries(filter).every(([k, v]) => doc[k] === v)) return [gameKey, cfg];
  }
  return [null, null];
}

// Decide whether a freshly saved CBAT result earned a NEW medal.
//
// "New" is three conditions, all required:
//   1. the result is the player's new personal best on that game — the board is
//      best-per-user, so a run that doesn't beat their own best changes nothing;
//   2. its board position is top 3;
//   3. that position is better than the one their previous best held — otherwise
//      a player who already owns 1st would be re-announced every time they beat
//      their own score.
//
// Never throws: the caller is a score submission.
/**
 * @returns {Promise<Object|null>} medal detail, or null if this is not a medal
 */
async function detectCbatMedal(Model, doc) {
  try {
    const [gameKey, cfg] = gameKeyForResult(Model, doc);
    if (!cfg) return null;

    const achievedAt = doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now();
    if (Date.now() - achievedAt > MAX_AGE_MS) return null;

    const score = doc[cfg.primaryField];
    const time = doc.totalTime;
    if (score === null || score === undefined) return null;

    const modeFilter = cfg.modeFilter ?? {};

    // The player's best BEFORE this run. Excluding by _id rather than by date
    // keeps backdated offline replays honest — an old score syncing in is
    // compared against everything else the player has, not just earlier rows.
    const [previousBest] = await Model.find({
      ...modeFilter,
      userId: doc.userId,
      _id: { $ne: doc._id },
    })
      .sort({ [cfg.primaryField]: cfg.sortDir, totalTime: 1 })
      .limit(1)
      .lean();

    if (previousBest && !isBetterScore(cfg, score, time, previousBest[cfg.primaryField], previousBest.totalTime)) {
      return null; // not a personal best — their board row is unchanged
    }

    const rank = await rankOnPaddedBoard(gameKey, cfg, { score, time, excludeUserId: doc.userId });
    const medal = MEDALS[rank];
    if (!medal) return null;

    let previousRank = null;
    if (previousBest) {
      previousRank = await rankOnPaddedBoard(gameKey, cfg, {
        score: previousBest[cfg.primaryField],
        time: previousBest.totalTime,
        excludeUserId: doc.userId,
      });
      if (previousRank <= rank) return null; // already held this medal or better
    }

    const user = await User.findById(doc.userId).select('displayName agentNumber').lean();

    return {
      medal, gameKey,
      // Difficulty spelled out, not the bare registry label: the split games
      // keep a separate board per difficulty, so a score means nothing without
      // knowing which one it was set on.
      gameLabel: cbatLabelWithDifficulty(gameKey),
      primaryField: cfg.primaryField,
      agent: agentLabel(user), userId: doc.userId, score, time, previousRank,
    };
  } catch (err) {
    console.error(`[medals] detection failed: ${err.message}`);
    return null;
  }
}

/**
 * Announce a medal, if this result earned one.
 *
 * Returns the medal detail it announced, or null. Never throws and never
 * rejects: the caller is a score submission.
 */
async function announceCbatMedal(Model, doc) {
  try {
    const { chatMedalsEnabled, postMedalToChannel } = require('./chatMedals');
    // Nothing listening — skip the ranking work entirely.
    if (!await chatMedalsEnabled()) return null;

    const detail = await detectCbatMedal(Model, doc);
    if (!detail) return null;

    await postMedalToChannel(detail);
    return detail;
  } catch (err) {
    console.error(`[medals] announcement failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  announceCbatMedal,
  detectCbatMedal,
  agentLabel,
  gameKeyForResult,
  MEDALS,
};
