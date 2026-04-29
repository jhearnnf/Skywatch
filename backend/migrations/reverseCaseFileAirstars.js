'use strict';

/**
 * One-shot reversal of airstars previously awarded for Case File completions.
 *
 * Case Files were inadvertently awarding airstars/level-XP via awardCoins on
 * /complete. That award has now been removed at the route level — this
 * migration deducts the historical awards from each affected user's totals
 * and marks the session so it is never reversed twice.
 *
 * Idempotent: each run only touches sessions where
 *   scoring.airstarsAwarded > 0  AND  scoring.airstarsReversed !== true.
 *
 * NOTE: rank promotions that may have been triggered by the original award
 * are NOT rolled back. Case File awards are small (≤ ~75 per chapter) and
 * far below the cycle threshold, so this is unlikely to have promoted
 * anyone. cycleAirstars is clamped to 0 to avoid going negative.
 */

const GameSessionCaseFileResult = require('../models/GameSessionCaseFileResult');
const User = require('../models/User');

async function reverseCaseFileAirstars({ logger = console } = {}) {
  const sessions = await GameSessionCaseFileResult.find({
    completedAt:               { $ne: null },
    'scoring.airstarsAwarded': { $gt: 0 },
    $or: [
      { 'scoring.airstarsReversed': { $exists: false } },
      { 'scoring.airstarsReversed': false },
    ],
  }).select({ _id: 1, userId: 1, scoring: 1, caseSlug: 1, chapterSlug: 1 }).lean();

  if (!sessions.length) {
    return { sessionsReversed: 0, totalAirstarsDeducted: 0, usersTouched: 0 };
  }

  // Aggregate per-user so we issue one update per user, not one per session.
  const perUser = new Map();
  for (const s of sessions) {
    const amount = s.scoring?.airstarsAwarded ?? 0;
    if (amount <= 0) continue;
    const key = String(s.userId);
    perUser.set(key, (perUser.get(key) ?? 0) + amount);
  }

  let totalDeducted = 0;
  for (const [userId, amount] of perUser.entries()) {
    const user = await User.findById(userId).select({ totalAirstars: 1, cycleAirstars: 1 });
    if (!user) continue;

    const newTotal = Math.max(0, (user.totalAirstars ?? 0) - amount);
    const newCycle = Math.max(0, (user.cycleAirstars ?? 0) - amount);
    await User.updateOne(
      { _id: userId },
      { $set: { totalAirstars: newTotal, cycleAirstars: newCycle } },
    );
    totalDeducted += amount;
  }

  // Mark every visited session as reversed so a future run is a no-op.
  const ids = sessions.map(s => s._id);
  await GameSessionCaseFileResult.updateMany(
    { _id: { $in: ids } },
    { $set: { 'scoring.airstarsReversed': true } },
  );

  if (logger?.log) {
    logger.log(
      `[migration] reverseCaseFileAirstars: reversed ${sessions.length} session(s), ` +
      `${totalDeducted} airstars across ${perUser.size} user(s)`
    );
  }

  return {
    sessionsReversed:      sessions.length,
    totalAirstarsDeducted: totalDeducted,
    usersTouched:          perUser.size,
  };
}

module.exports = reverseCaseFileAirstars;
