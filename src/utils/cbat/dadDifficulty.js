// Directions & Distances difficulty tuning.
//
// Hard is the game as it stood before the split, value for value, on a FRESH
// board (`dad-hard`). Easier is the plain `dad` board, which keeps every score
// set before the split (ANT's way round). Both play the
// same 15 questions on the same 45s clock; what changes is how much each
// question asks you to hold in your head, on BOTH themes:
//
//   SkyWatch theme  — routes of 2–4 legs instead of 3–6, and every heading is
//                     north, south, east or west (no diagonals, no 45° turns).
//   Real CBAT theme — fewer landmarks, shorter journeys, every leg given as a
//                     heading, the plain N/E/S/W grid only, and statements in
//                     chain order (see buildRealDadEasierQuestions).

export const DEFAULT_DAD_DIFFICULTY = 'easier'

// How long the chosen difficulty button flashes after Start. Matches the other
// split games.
export const DAD_LAUNCH_MS = 1000

export const DAD_TOTAL_QUESTIONS = 15

export const DAD_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    gameKey: 'dad',
    bars: 1,
    blurb: 'Shorter routes and fewer places to keep track of',

    // SkyWatch theme: legs per question by index (Q1–5 → 2, Q6–10 → 3, Q11–15 → 4).
    legsAt: (i) => 2 + Math.floor(i / 5),
    // First question index with diagonal headings; Infinity = never.
    diagonalsFrom: Infinity,

    // Same 15-question ceiling as Hard, so an easier run has to be more
    // accurate for the same grade (Numerical Operations does the same).
    grades: { outstanding: 95, good: 80, needsWork: 60 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'dad-hard',
    bars: 3,
    blurb: 'Longer routes, diagonal headings and more places to keep track of',

    // Q1–4 → 3 legs, Q5–8 → 4, Q9–12 → 5, Q13–15 → 6.
    legsAt: (i) => 3 + Math.floor(i / 4),
    // 45° headings and turns from question 10.
    diagonalsFrom: 9,

    grades: { outstanding: 90, good: 70, needsWork: 50 },
  },
}

// Ordered for the mode row: Easier left, Hard right.
export const DAD_DIFFICULTIES = [DAD_TUNING.easier, DAD_TUNING.hard]

export function dadTuning(difficulty) {
  return DAD_TUNING[difficulty] || DAD_TUNING[DEFAULT_DAD_DIFFICULTY]
}

export function computeDadGrade(pct, tuning) {
  const g = tuning.grades
  if (pct >= g.outstanding) return 'Outstanding'
  if (pct >= g.good) return 'Good'
  if (pct >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────
const DAD_DIFFICULTY_KEY = 'sw_cbat_dad_difficulty'

export function readStoredDadDifficulty() {
  try {
    const raw = localStorage.getItem(DAD_DIFFICULTY_KEY)
    if (raw && DAD_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_DAD_DIFFICULTY
}

export function storeDadDifficulty(difficulty) {
  try { localStorage.setItem(DAD_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
