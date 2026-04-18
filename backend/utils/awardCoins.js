const User       = require('../models/User');
const AircoinLog = require('../models/AircoinLog');
const Rank       = require('../models/Rank');
const Level      = require('../models/Level');

// Deprecated — use getCycleThreshold() for the live value from Level docs.
const CYCLE_THRESHOLD = 14700;

/**
 * Compute the cycle threshold dynamically from Level documents.
 * This is the sum of all aircoinsToNextLevel values (levels 1–9).
 * Falls back to the hardcoded CYCLE_THRESHOLD if no levels are seeded.
 */
async function getCycleThreshold() {
  const levels = await Level.find().sort({ levelNumber: 1 }).lean();
  let total = 0;
  for (const lv of levels) {
    if (lv.aircoinsToNextLevel != null) total += lv.aircoinsToNextLevel;
  }
  return total || CYCLE_THRESHOLD;
}

/**
 * Award aircoins to a user, handling:
 *   - totalAircoins (always grows — used for leaderboard)
 *   - cycleAircoins (resets on rank promotion, drives level display)
 *   - rank promotion each time cycleAircoins crosses CYCLE_THRESHOLD
 *   - handles large awards that cross the threshold multiple times
 *
 * Returns { totalAircoins, cycleAircoins, rankPromotion }
 *   rankPromotion: null | { from: RankDoc|null, to: RankDoc } (the final promotion)
 */
async function awardCoins(userId, amount, reason, label, briefId = null) {
  // Atomic increment first — this cannot be lost to a concurrent awardCoins call.
  const incremented = await User.findByIdAndUpdate(
    userId,
    { $inc: { totalAircoins: amount, cycleAircoins: amount } },
    { new: true },
  ).populate('rank');
  if (!incremented) throw new Error('User not found');

  const newTotal = incremented.totalAircoins;
  let   finalCycle      = incremented.cycleAircoins;
  let   rankPromotion   = null;
  let   newRankId       = incremented.rank?._id ?? incremented.rank ?? null;
  let   currentRankNum  = incremented.rank?.rankNumber ?? 0;
  const startingRankDoc = (incremented.rank && typeof incremented.rank === 'object') ? incremented.rank : null;

  const cycleThreshold = await getCycleThreshold();

  if (finalCycle >= cycleThreshold) {
    const allRanks = await Rank.find().sort({ rankNumber: 1 });

    while (finalCycle >= cycleThreshold) {
      finalCycle -= cycleThreshold;

      const nextRank = allRanks.find(r => r.rankNumber > currentRankNum);
      if (nextRank) {
        rankPromotion  = { from: rankPromotion?.to ?? startingRankDoc, to: nextRank };
        newRankId      = nextRank._id;
        currentRankNum = nextRank.rankNumber;
      } else {
        // Already at max rank — stop cycling, keep remainder as current cycle
        break;
      }
    }

    // Apply the cycle correction + rank change in one write. Guarded by the rank id
    // we observed so a concurrent promotion can't silently overwrite our update.
    const cycleAdjustment = finalCycle - incremented.cycleAircoins;
    const guarded = await User.findOneAndUpdate(
      { _id: userId, rank: incremented.rank?._id ?? null },
      {
        $inc: { cycleAircoins: cycleAdjustment },
        ...(rankPromotion ? { $set: { rank: newRankId } } : {}),
      },
      { new: true },
    );
    // If the guard failed (concurrent award promoted the user out from under
    // us), the cycle correction is now wrong relative to the current state. We
    // must NOT silently leave cycleAircoins inconsistent. Reload, recompute the
    // correction against the new state, and retry without the rank guard so we
    // converge on a consistent total. Only correct the cycle — the other writer
    // will handle their own rank promotion.
    if (!guarded) {
      const reloaded = await User.findById(userId).populate('rank');
      if (reloaded) {
        // The other writer applied amount via $inc too, so cycleAircoins now
        // includes BOTH increments. Our `finalCycle` (post-promotion remainder)
        // is still the correct end-state contribution from THIS award. The
        // simplest safe correction is to write back the modular remainder:
        // cycleAircoins should always be in [0, threshold). Take the existing
        // cycle, modulo threshold, and persist it. Rank changes are owned by
        // whichever writer crossed the threshold first; we don't fight them.
        const currentCycle = reloaded.cycleAircoins ?? 0;
        const correctedCycle = currentCycle % cycleThreshold;
        if (correctedCycle !== currentCycle) {
          await User.findByIdAndUpdate(userId, { $set: { cycleAircoins: correctedCycle } });
        }
      }
    }
  }

  AircoinLog.create({ userId, amount, reason, label, briefId }).catch(() => {});

  return { totalAircoins: newTotal, cycleAircoins: finalCycle, rankPromotion };
}

module.exports = { awardCoins, getCycleThreshold, CYCLE_THRESHOLD };
