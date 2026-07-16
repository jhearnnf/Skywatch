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
