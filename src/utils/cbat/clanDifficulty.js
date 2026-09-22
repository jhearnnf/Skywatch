// CLAN difficulty tuning.
//
// Colours, Letters and Numbers is three tasks at once for a fixed 90 seconds.
// Both difficulties keep the same clock, the same scoring and the same three
// tasks; what a difficulty changes is how much lands on you at once and how
// long you get to deal with it:
//
//   • how fast a diamond crosses the arena and how often one is launched
//   • how long the letter code is, how long it stays up, and how long you get
//     to pick it out of the four options
//   • how many sums a run serves, how long each stays up, and which band they
//     are drawn from (Easier never serves a hard one)
//
// Anything not in the table is deliberately shared. A test pins the table's
// allowed key set so a difficulty can't quietly start changing something
// outside its stated scope.

import { CBAT_CLAN_DIFFICULTY_KEY } from '../storageKeys'

export const DEFAULT_CLAN_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the run
// actually begins. Same as FLAG's.
export const CLAN_LAUNCH_MS = 1000

// The run, in milliseconds. Fixed on both difficulties: the test is the
// juggling, and the length is part of what is being juggled.
export const CLAN_DURATION_MS = 90_000

// The three bands on the right of the arena, in the order the real screen
// draws them (red nearest the diamonds' launch edge, green furthest). A
// diamond has to be pressed while it is inside the band of its own colour.
export const CLAN_COLOURS = ['red', 'yellow', 'green']

// Every award is a multiple of 5, so a clean run's total always lands on one
// and demo boards can be built the same way. Wrong presses cost points, so a
// total can go negative.
export const CLAN_POINTS = {
  colourHit:     10,
  colourWrong:   -5,   // pressed with nothing of that colour in its band
  colourMissed:  -5,   // let through untouched
  letterCorrect: 20,
  letterWrong:   -10,
  letterTimeout: -5,
  mathCorrect:   15,
  mathWrong:     -10,
  mathTimeout:   -5,
}

export const CLAN_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'clan-easier',
    bars: 1,
    blurb: 'Slower diamonds, shorter codes, fewer sums',
    colours: {
      crossMs: 6000,        // launch edge to far edge
      spawnMs: 3000,        // between launches, before jitter
      spawnJitterMs: 700,
    },
    letters: {
      lengths: [4],         // code length, drawn per code
      showMs: 5000,         // code on screen
      holdMs: 1500,         // blank before the options appear
      answerMs: 8000,       // options on screen
      gapMs: 3000,          // rest before the next code
      firstMs: 2000,        // first code after the start
    },
    maths: {
      count: 7,             // sums per run, scheduled across the clock
      timeoutMs: 9000,
      firstMs: 3500,
      weights: { easy: 7, medium: 3, hard: 0 },
    },
    // Slower diamonds and fewer sums mean a lower achievable total, so the
    // grade bands come down with it.
    grades: { outstanding: 350, good: 220, needsWork: 80 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'clan',
    bars: 3,
    blurb: 'Faster diamonds, longer codes, harder sums',
    colours: {
      crossMs: 4200,
      spawnMs: 2000,
      spawnJitterMs: 500,
    },
    letters: {
      lengths: [5, 6],
      showMs: 4000,
      holdMs: 2000,
      answerMs: 6000,
      gapMs: 2500,
      firstMs: 2000,
    },
    maths: {
      count: 10,
      timeoutMs: 7000,
      firstMs: 3000,
      weights: { easy: 3, medium: 5, hard: 2 },
    },
    grades: { outstanding: 450, good: 300, needsWork: 120 },
  },
}

// Ordered for the mode row: Easier left, Hard right.
export const CLAN_DIFFICULTIES = [CLAN_TUNING.easier, CLAN_TUNING.hard]

export function clanTuning(difficulty) {
  return CLAN_TUNING[difficulty] || CLAN_TUNING[DEFAULT_CLAN_DIFFICULTY]
}

export function computeClanGrade(score, tuning) {
  const g = tuning.grades
  if (score >= g.outstanding) return 'Outstanding'
  if (score >= g.good) return 'Good'
  if (score >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The default is 'easier', but once a user picks a difficulty that choice is
// what the instructions screen opens on next time.

export function readStoredClanDifficulty() {
  try {
    const raw = localStorage.getItem(CBAT_CLAN_DIFFICULTY_KEY)
    if (raw && CLAN_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_CLAN_DIFFICULTY
}

export function storeClanDifficulty(difficulty) {
  try { localStorage.setItem(CBAT_CLAN_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
