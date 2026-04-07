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
  const user = await User.findById(userId).populate('rank');
  if (!user) throw new Error('User not found');

  const newTotal = (user.totalAircoins ?? 0) + amount;
  let   finalCycle = (user.cycleAircoins ?? 0) + amount;

  let rankPromotion  = null;
  let newRankId      = user.rank?._id ?? user.rank ?? null;
  let currentRankNum = (user.rank && typeof user.rank === 'object' ? user.rank.rankNumber : null) ?? 0;

  const cycleThreshold = await getCycleThreshold();

  if (finalCycle >= cycleThreshold) {
    const allRanks = await Rank.find().sort({ rankNumber: 1 });

    while (finalCycle >= cycleThreshold) {
      finalCycle -= cycleThreshold;

      const nextRank = allRanks.find(r => r.rankNumber > currentRankNum);
      if (nextRank) {
        rankPromotion  = { from: rankPromotion?.to ?? (user.rank && typeof user.rank === 'object' ? user.rank : null), to: nextRank };
        newRankId      = nextRank._id;
        currentRankNum = nextRank.rankNumber;
      } else {
        // Already at max rank — stop cycling, keep remaining coins in current cycle
        break;
      }
    }
  }

  await User.findByIdAndUpdate(userId, {
    totalAircoins: newTotal,
    cycleAircoins: finalCycle,
    ...(rankPromotion ? { rank: newRankId } : {}),
  });

  AircoinLog.create({ userId, amount, reason, label, briefId }).catch(() => {});

  return { totalAircoins: newTotal, cycleAircoins: finalCycle, rankPromotion };
}

module.exports = { awardCoins, getCycleThreshold, CYCLE_THRESHOLD };
