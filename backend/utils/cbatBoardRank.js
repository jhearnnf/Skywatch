// Where a single CBAT score sits on a game's all-time leaderboard.
//
// The visible board has two properties that a naive countDocuments() misses,
// and both change the answer:
//
//   • It is best-per-USER. Ten sessions from one strong player occupy one row,
//     not ten. Counting documents would push everyone below them down nine
//     places.
//   • It is demo-PADDED. padLeaderboard injects synthetic agents into games
//     with thin real data, and those rows are visible to players, so a score
//     sitting under three demos really is 4th as far as anyone can see.
//
// Announcing "you're 2nd" when the board shows 5th is worse than not
// announcing at all, so the medal broadcaster ranks through here.

const { padLeaderboard } = require('./cbatFakeLeaderboard');

// The visible all-time board's own pipeline: one row per user, their best,
// top 20. Mirrors cbatLeaderboard's real-board query so padLeaderboard's
// short-circuit / gap-fill logic matches whatever the player is actually shown.
//
// Exported separately from cbatPaddedFakes because a caller that wants BOTH the
// real podium and the demo rows padded around it needs the same rows twice, and
// deriving them twice is a second full aggregation over the score collection for
// an answer already in hand.
async function bestPerUserTop20(cfg) {
  const modeFilter = cfg.modeFilter ?? null;
  return cfg.Model.aggregate([
    ...(modeFilter ? [{ $match: modeFilter }] : []),
    { $sort: { [cfg.primaryField]: cfg.sortDir, totalTime: 1 } },
    {
      $group: {
        _id: '$userId',
        userId: { $first: '$userId' },
        [cfg.primaryField]: { $first: `$${cfg.primaryField}` },
        totalTime: { $first: '$totalTime' },
      },
    },
    { $sort: { [cfg.primaryField]: cfg.sortDir, totalTime: 1 } },
    { $limit: 20 },
    { $project: { _id: 0, userId: 1, bestScore: `$${cfg.primaryField}`, bestTime: '$totalTime' } },
  ]);
}

// The demo rows the board would inject around real rows you already have.
// Games where real entries already fill the board get none.
function paddedFakesFrom(real, gameKey, isAdmin) {
  return padLeaderboard(real, gameKey, { limit: 20, isAdmin }).filter(e => e.isFake);
}

// Rebuild the demo (fake) rows the all-time board would inject for one game, so a
// score can be ranked against the SAME padded board a player sees — not just the
// real sessions.
async function cbatPaddedFakes(gameKey, cfg, isAdmin) {
  return paddedFakesFrom(await bestPerUserTop20(cfg), gameKey, isAdmin);
}

// The board's comparator, as a plain predicate: is `score`/`time` strictly better
// than `otherScore`/`otherTime`? Ties on the primary field always break on lower
// totalTime, whichever direction the primary field sorts.
function isBetterScore(cfg, score, time, otherScore, otherTime) {
  if (score !== otherScore) {
    return cfg.sortDir === 1 ? score < otherScore : score > otherScore;
  }
  return (time ?? Infinity) < (otherTime ?? Infinity);
}

// Mongo match fragment for "this user's best beats the given score", used after a
// $group that has reduced each user to { bestScore, bestTime }.
function betterThanMatch(cfg, score, time) {
  return cfg.sortDir === 1
    ? { $or: [{ bestScore: { $lt: score } }, { bestScore: score, bestTime: { $lt: time } }] }
    : { $or: [{ bestScore: { $gt: score } }, { bestScore: score, bestTime: { $lt: time } }] };
}

// Board position (1-based) this score would occupy on `gameKey`'s all-time board.
//
// `excludeUserId` drops that user's own sessions from the count — pass the scorer
// so their previous attempts don't outrank the row we are placing for them. The
// board only ever shows one row per user, so ranking a player's new best against
// their own old bests would count a row that isn't on the board.
async function rankOnPaddedBoard(gameKey, cfg, { score, time, excludeUserId = null, isAdmin = false }) {
  const modeFilter = cfg.modeFilter ?? {};

  const [realBetter, fakes] = await Promise.all([
    cfg.Model.aggregate([
      {
        $match: {
          ...modeFilter,
          ...(excludeUserId ? { userId: { $ne: excludeUserId } } : {}),
        },
      },
      { $sort: { [cfg.primaryField]: cfg.sortDir, totalTime: 1 } },
      {
        $group: {
          _id: '$userId',
          bestScore: { $first: `$${cfg.primaryField}` },
          bestTime: { $first: '$totalTime' },
        },
      },
      { $match: betterThanMatch(cfg, score, time) },
      { $count: 'n' },
    ]),
    cbatPaddedFakes(gameKey, cfg, isAdmin),
  ]);

  const fakesBetter = fakes.reduce(
    (acc, f) => acc + (isBetterScore(cfg, f.bestScore, f.bestTime, score, time) ? 1 : 0),
    0
  );

  return (realBetter[0]?.n ?? 0) + fakesBetter + 1;
}

module.exports = {
  cbatPaddedFakes, bestPerUserTop20, paddedFakesFrom, rankOnPaddedBoard, isBetterScore,
};
