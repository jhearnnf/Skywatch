// CBAT "Vigilance Test" simulation — the star grid.
//
// From the guide corpus: "Mechanically the simplest test on the battery, which
// is exactly the point — it measures whether you can hold attention on something
// dull, not whether you can do it." Stars appear on a labelled grid and you
// clear each one by keying its coordinate pair. Yellow priority tasks appear
// mid-test and carry bonus points if you deal with them quickly.
//
// Three pieces of corpus strategy are built in as REAL properties of the game,
// not as instructions-screen decoration:
//
//   1. "Work along a row or column in sequence — 2,1 then 2,2 then 2,3 — rather
//      than jumping around the grid." That worked example only reads as a walk
//      along a row because the corpus states the entry order plainly: "row
//      number first, then column, so a star at 2,7 is entered as those two
//      digits". So `submitCoord` takes ROW FIRST. It took column first until the
//      guide was read back against it, which would have drilled the reverse of
//      the keystroke order the real test wants — the one habit on this test that
//      is worth anything, learned backwards.
//   2. "Edge squares can be entered without checking the grid labels at all, so
//      they're quicker than anything in the middle" — the page draws labels on
//      ALL FOUR edges, which is what makes that true. It is a layout decision,
//      but it belongs in this comment because it is the reason the technique
//      works and a later layout change could silently remove it.
//   3. "The bottleneck is the keying, not the finding" — hence the miskey
//      penalty below. Without a cost for a wrong coordinate the whole test
//      collapses: a player could cycle through every coordinate on a loop and
//      clear the board without ever looking at it.
//
// Two difficulties (see vigilanceDifficulty.js for the table and the
// reasoning). Hard is the full three minutes at the original points with stars
// appearing far more often; Easier is one minute at the original pace with
// every clear paying triple. A star, on either board, stays exactly where it
// is until its coordinate is keyed correctly — nothing times out, nothing
// moves, nothing is taken off the board for you.
//
// The load is passed in — clock, cadence and points all live in it — and the
// defaults below are the ORIGINAL board's values, so a sim built with no load
// is the game as it first shipped.
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) to reproduce a run.
// The sim owns no timers — the page steps it — so tests drive it directly.

// 9×9, straight from the corpus. Rows and columns are held 0-indexed in here and
// LABELLED 1–9 on the page, so every coordinate is exactly two keystrokes and
// the pad is a plain 3×3 with no zero on it — which is the shape of the Stream
// Deck the real test is keyed on.
export const VIGILANCE_GRID = 9
// The original clock, and Hard's. Easier runs shorter — see its load.
export const VIGILANCE_DURATION_MS = 180000

// The original board's load, and the sim's defaults. Kept here rather than
// only in the difficulty table so the sim stands on its own in tests.
//
// Spawn cadence eases in over the run: a slow opening that gives the player
// nothing much to do is the test working, not the test being broken.
//
// A priority task is a star that is worth clearing NOW. The first lands late
// enough that the routine job has become routine, which is when breaking off for
// something is hardest.
//
// `spawnRampMs` is the stretch the cadence eases over, and it is deliberately
// NOT the clock: a board with a shorter clock plays the FIRST part of the
// original ramp, not a compressed copy of the whole of it, so "the original
// pace" stays literally true however long the run is.
export const STAR_POINTS = 10
export const PRIORITY_BASE_POINTS = 30
export const PRIORITY_BONUS_POINTS = 30
export const MISKEY_PENALTY = 5

export const VIGILANCE_BASE_LOAD = Object.freeze({
  durationMs: VIGILANCE_DURATION_MS,
  spawnStartMs: 2600,
  spawnEndMs: 1300,
  spawnRampMs: VIGILANCE_DURATION_MS,
  maxStars: 14,
  priorityFirstMs: 24000,
  priorityIntervalMs: 28000,
  priorityWindowMs: 8000,
  starPoints: STAR_POINTS,
  priorityBasePoints: PRIORITY_BASE_POINTS,
  priorityBonusPoints: PRIORITY_BONUS_POINTS,
  // Stars already on the board when the clock starts. Zero on both boards —
  // an empty opening is part of the test. The Practise drill floods the grid
  // from the first frame instead, so the whole run is keying.
  initialStars: 0,
  miskeyPenalty: MISKEY_PENALTY,
})

// `durationMs` as its own option still wins over the load's, for the tests
// that run a short clock against the default board.
export function createVigilanceSim({ rng = Math.random, durationMs, load = {} } = {}) {
  const {
    spawnStartMs, spawnEndMs, spawnRampMs, maxStars,
    priorityFirstMs, priorityIntervalMs, priorityWindowMs,
    starPoints, priorityBasePoints, priorityBonusPoints,
    initialStars, miskeyPenalty,
    durationMs: loadDurationMs,
  } = { ...VIGILANCE_BASE_LOAD, ...load }

  const state = {
    elapsedMs: 0,
    durationMs: durationMs ?? loadDurationMs,
    // Map of "row,col" → { row, col, priority, spawnedAt }. Keyed row-first for
    // the same reason the input is: one reading order throughout.
    stars: new Map(),
    score: 0,
    starsCleared: 0,
    prioritiesCleared: 0,
    misKeyed: 0,
    finished: false,
    // Set by submitCoord so the page can flash the right feedback without
    // re-deriving it. Consumed and cleared by the page each frame.
    lastEvent: null,
    _nextSpawnAt: 900,
    _nextPriorityAt: priorityFirstMs,
  }

  const key = (row, col) => `${row},${col}`

  function spawn(priority) {
    if (state.stars.size >= maxStars) return
    // Try a handful of cells rather than scanning the whole grid — at the sizes
    // involved a free cell is found immediately, and a bounded loop cannot hang
    // if the board is nearly full.
    for (let attempt = 0; attempt < 40; attempt++) {
      const row = Math.floor(rng() * VIGILANCE_GRID)
      const col = Math.floor(rng() * VIGILANCE_GRID)
      const k = key(row, col)
      if (state.stars.has(k)) continue
      state.stars.set(k, { row, col, priority: !!priority, spawnedAt: state.elapsedMs })
      return
    }
  }

  for (let i = 0; i < initialStars; i++) spawn(false)

  function spawnIntervalAt(ms) {
    const t = Math.min(1, ms / spawnRampMs)
    return spawnStartMs + (spawnEndMs - spawnStartMs) * t
  }

  function step(dtMs) {
    if (state.finished) return
    state.elapsedMs = Math.min(state.durationMs, state.elapsedMs + dtMs)

    while (state.elapsedMs >= state._nextSpawnAt && !state.finished) {
      spawn(false)
      state._nextSpawnAt += spawnIntervalAt(state._nextSpawnAt)
    }

    while (state.elapsedMs >= state._nextPriorityAt) {
      spawn(true)
      state._nextPriorityAt += priorityIntervalMs
    }

    if (state.elapsedMs >= state.durationMs) state.finished = true
  }

  // Returns the outcome so the page can flash it. ROW FIRST, then column — the
  // order the corpus states and the order the page keys in. Both are 0-indexed
  // here; the page draws them as the 1–9 labels around the grid.
  function submitCoord(row, col) {
    if (state.finished) return { type: 'ignored' }
    const k = key(row, col)
    const star = state.stars.get(k)

    if (!star) {
      state.misKeyed += 1
      state.score -= miskeyPenalty
      const event = { type: 'miss', row, col, delta: -miskeyPenalty }
      state.lastEvent = event
      return event
    }

    state.stars.delete(k)
    let delta = starPoints
    if (star.priority) {
      // Bonus decays linearly across the window and never goes negative — a
      // priority task dealt with late is still worth more than a routine star,
      // just not much more.
      const age = state.elapsedMs - star.spawnedAt
      const remaining = Math.max(0, 1 - age / priorityWindowMs)
      delta = priorityBasePoints + Math.round(priorityBonusPoints * remaining)
      state.prioritiesCleared += 1
    }
    state.starsCleared += 1
    state.score += delta
    const event = { type: star.priority ? 'priority' : 'star', row, col, delta }
    state.lastEvent = event
    return event
  }

  // A plain object the render tree can read. Rebuilt each frame rather than
  // exposing the live Map, so React never renders off a mutating structure.
  function snapshot() {
    return {
      elapsedMs: state.elapsedMs,
      remainingMs: Math.max(0, state.durationMs - state.elapsedMs),
      stars: [...state.stars.values()].map(s => ({ ...s })),
      score: state.score,
      starsCleared: state.starsCleared,
      prioritiesCleared: state.prioritiesCleared,
      misKeyed: state.misKeyed,
      finished: state.finished,
    }
  }

  // Leaderboard score. Clamped at zero so a run spent guessing coordinates
  // cannot put a negative row on the board; the raw figure stays on `state` for
  // the results screen, which is where being told you keyed badly is useful.
  function finalScore() {
    return Math.max(0, state.score)
  }

  return { step, submitCoord, snapshot, finalScore, state }
}
