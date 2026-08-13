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
// Deliberately ONE difficulty. Every other CBAT game with a split lowers the
// load and keeps the clock; here the clock IS the load, and a shorter or gentler
// Vigilance test would not be a Vigilance test.
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) to reproduce a run.
// The sim owns no timers — the page steps it — so tests drive it directly.

// 9×9, straight from the corpus. Rows and columns are held 0-indexed in here and
// LABELLED 1–9 on the page, so every coordinate is exactly two keystrokes and
// the pad is a plain 3×3 with no zero on it — which is the shape of the Stream
// Deck the real test is keyed on.
export const VIGILANCE_GRID = 9
export const VIGILANCE_DURATION_MS = 180000

// Spawn cadence eases in over the run: a slow opening that gives the player
// nothing much to do is the test working, not the test being broken.
const SPAWN_START_MS = 2600
const SPAWN_END_MS = 1300
const MAX_STARS = 14

// A priority task is a star that is worth clearing NOW. The first lands late
// enough that the routine job has become routine, which is when breaking off for
// something is hardest.
const PRIORITY_FIRST_MS = 24000
const PRIORITY_INTERVAL_MS = 28000
const PRIORITY_WINDOW_MS = 8000

export const STAR_POINTS = 10
export const PRIORITY_BASE_POINTS = 30
export const PRIORITY_BONUS_POINTS = 30
export const MISKEY_PENALTY = 5

export function createVigilanceSim({ rng = Math.random, durationMs = VIGILANCE_DURATION_MS } = {}) {
  const state = {
    elapsedMs: 0,
    durationMs,
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
    _nextPriorityAt: PRIORITY_FIRST_MS,
  }

  const key = (row, col) => `${row},${col}`

  function spawn(priority) {
    if (state.stars.size >= MAX_STARS) return
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

  function spawnIntervalAt(ms) {
    const t = Math.min(1, ms / state.durationMs)
    return SPAWN_START_MS + (SPAWN_END_MS - SPAWN_START_MS) * t
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
      state._nextPriorityAt += PRIORITY_INTERVAL_MS
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
      state.score -= MISKEY_PENALTY
      const event = { type: 'miss', row, col, delta: -MISKEY_PENALTY }
      state.lastEvent = event
      return event
    }

    state.stars.delete(k)
    let delta = STAR_POINTS
    if (star.priority) {
      // Bonus decays linearly across the window and never goes negative — a
      // priority task dealt with late is still worth more than a routine star,
      // just not much more.
      const age = state.elapsedMs - star.spawnedAt
      const remaining = Math.max(0, 1 - age / PRIORITY_WINDOW_MS)
      delta = PRIORITY_BASE_POINTS + Math.round(PRIORITY_BONUS_POINTS * remaining)
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
