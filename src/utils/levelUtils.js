/**
 * Single source of truth for level calculations.
 * Every component that needs level info imports from here.
 *
 * @param {number}      coins  – user.cycleAirstars (resets each rank cycle)
 * @param {Array|null}  levels – live levels from useAppSettings().levels
 * @returns {object|null} null when levels haven't loaded yet
 */
export function getLevelInfo(coins, levels) {
  if (!levels?.length) return null

  let current = levels[0]
  for (const lvl of levels) {
    if (coins >= lvl.cumulativeAirstars) current = lvl
    else break
  }

  const coinsInLevel = coins - current.cumulativeAirstars
  const coinsNeeded  = current.airstarsToNextLevel
  const progress     = coinsNeeded
    ? Math.min(100, Math.round((coinsInLevel / coinsNeeded) * 100))
    : 100

  return {
    level:       current.levelNumber,
    levelObj:    current,
    progress,
    coinsInLevel,
    coinsNeeded,
  }
}

/**
 * Lightweight helper — returns just the level number.
 * Used by AuthContext for level-up detection.
 */
export function getLevelNumber(coins, levels) {
  if (!levels?.length) return 1
  let level = 1
  for (const lvl of levels) {
    if (coins >= lvl.cumulativeAirstars) level = lvl.levelNumber
  }
  return level
}
