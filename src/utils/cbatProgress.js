// Shared reading of a CBAT progress trend, used by the post-game sparkline panel
// (src/components/CbatGameOver.jsx) and the leaderboard's "You" tab (src/pages/CbatLeaderboard.jsx).
//
// It lives here because of the sign rule: Trace Practise scores rotations, where FEWER is better,
// so a falling average is an improving player. Both screens have to say "better" in that case, and
// two copies of that inversion would eventually disagree.
//
// Takes the firstAvg/lastAvg the backend computes over the returned window (null below 6 attempts,
// where the delta is noise). Returns null when there's nothing trustworthy to say, otherwise:
//   pct       — percent change, ALWAYS positive-means-improving whichever way the game scores
//   improving — pct >= 1
//   steady    — |pct| < 1, i.e. no real movement either way
export function cbatTrend({ firstAvg, lastAvg }, lowerIsBetter) {
  if (firstAvg == null || lastAvg == null) return null
  if (firstAvg === 0) return null   // no meaningful baseline to measure change against

  const gain = lowerIsBetter ? firstAvg - lastAvg : lastAvg - firstAvg
  const pct = Math.round((gain / Math.abs(firstAvg)) * 100)

  return { pct, improving: pct >= 1, steady: Math.abs(pct) < 1 }
}

// Is run `a` strictly better than run `b` by leaderboard ordering — score first, then time as
// the tiebreaker (lower time wins). On a hideTime game, or when either time is missing, equal
// scores are NOT strictly better: there's no meaningful tiebreak, so a tie is just a tie.
function beatsRun(a, b, { hideTime, lowerIsBetter }) {
  if (a.score !== b.score) return lowerIsBetter ? a.score < b.score : a.score > b.score
  if (hideTime || a.time == null || b.time == null) return false
  return a.time < b.time
}

// Whether the most-recent run in a progress `series` is a genuine NEW personal best — used by the
// post-game reveal so it only celebrates a run that actually improved on the record.
//
// The naive "did this run tie the top score?" check over-fires on games with a score ceiling: once
// you've maxed out, every later max shows "personal best" even when it was slower. A run is only a
// PB if it *holds the all-time record* (top score, and — when time breaks ties — the best time among
// top-score runs) AND strictly beats every prior run in the window (so re-hitting the max, or an
// exact score+time tie, is not re-awarded).
//
//   series      — chronological [{ score, time }]; the LAST element is the run just played.
//   allTimeBest — { bestScore, bestTime } from the personal-best endpoint. It is authoritative for
//                 the whole history (the series is capped at the recent window), so it guards against
//                 an older record sitting beyond the window.
//   opts        — { hideTime, lowerIsBetter } from the game's leaderboard config.
//
// Returns true/false, or null when there isn't enough data to decide (caller should fall back).
export function isCbatNewBest(series, allTimeBest, { hideTime, lowerIsBetter } = {}) {
  if (!Array.isArray(series) || series.length === 0 || !allTimeBest) return null

  const current = series[series.length - 1]
  const prior = series.slice(0, -1)

  // Must hold the all-time record: top score, plus the best time among top-score runs when time is
  // the tiebreaker. Tying the top score with a worse time is exactly the case we must NOT celebrate.
  const holdsTopScore = current.score === allTimeBest.bestScore
  const holdsRecord = holdsTopScore &&
    (hideTime || allTimeBest.bestTime == null || current.time === allTimeBest.bestTime)
  if (!holdsRecord) return false

  // First run to hold the record has nothing to beat. Otherwise it must strictly beat every prior
  // run, so re-hitting the exact record (same score, same time) doesn't re-award the badge.
  if (prior.length === 0) return true
  return prior.every(r => beatsRun(current, r, { hideTime, lowerIsBetter }))
}
