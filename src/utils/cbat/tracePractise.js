// Trace Practise (2D + 3D) run length and pacing.
//
// The run used to be 5 levels of 5 packages. Real sessions took ~90s in 2D and
// ~3min in 3D and most players quit part-way, so it is now 3 levels of 3.
//
// The speed ramp was re-spaced rather than truncated: with the bigger step, the
// last level runs at the same 340ms interval level 5 used to, so the run still
// finishes at full pace — it just gets there in three levels instead of five.
export const PACKAGES_PER_LEVEL = 3
export const MAX_LEVEL          = 3

const BASE_INTERVAL = 500 // ms per move at level 1
const SPEED_STEP    = 80  // ms faster each level (500 → 420 → 340)
const MIN_INTERVAL  = 150 // floor, so a future level count can't stall the loop

// Milliseconds between moves at a given 1-indexed level.
export function practiseInterval(level) {
  return Math.max(MIN_INTERVAL, BASE_INTERVAL - (level - 1) * SPEED_STEP)
}
