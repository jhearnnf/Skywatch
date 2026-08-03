// Situational Awareness Test difficulty tuning.
//
// Hard is the original test — every value here is what the game shipped with.
// Easier keeps every clock identical (28s to observe each situation, 22s per
// recall question, the 5s aircraft-panel cadence); what changes is how much
// there is to hold in that time:
//
//   • 2–3 units on the grid instead of 3–5. The grid reveals one contact at a
//     time and splits the observe window evenly between them, so fewer contacts
//     means longer on each — ~9–14s rather than ~5.6–9s — without moving a timer.
//   • always 2 controller aircraft instead of 2–3. Two is the floor, not one:
//     with a single aircraft on screen "which aircraft was told to X?" answers
//     itself and the radio stops testing anything.
//   • each aircraft shows 2 fields instead of 4 — altitude and comms channel
//     only. Those two can't be confused with each other (a flight level and a
//     phonetic word), and dropping the waypoint takes its grid reference off the
//     panel so nothing there competes with the unit refs on the map. Together
//     with the aircraft count that's 4 facts from the panel instead of 8–12.
//   • the cross-modal support call — the only fact that needs the audio AND the
//     map together — comes up in about a third of situations instead of half.
//   • 2 situations of 5 questions instead of 3 of 6, so a run is ~2 minutes
//     rather than ~4.
//
// Everything else is deliberately shared — the panels, the generator, the
// scoring, the tutorial — so the two difficulties stay the same test at
// different loads (the same rule FLAG, CUT and Numerical Operations follow).

export const DEFAULT_SAT_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the game
// actually begins. Matches the other split games' — the sequence should feel
// the same wherever it appears.
export const SAT_LAUNCH_MS = 1000

export const SAT_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'sat-easier',
    bars: 1,
    blurb: 'Fewer contacts, shorter run',

    situations: 2,
    questionsPerSituation: 5,
    unitRange: [2, 3],
    aircraftRange: [2, 2],
    aircraftFields: ['altitude', 'channel'],
    supportChance: 0.35,

    // Score is a count out of the run's own question total, so both difficulties
    // top out at 100% of what they ask. The bands therefore move the other way
    // from FLAG's and CUT's: an easier run has to be more accurate to earn the
    // same grade. At 10 questions "Outstanding" means a clean sweep.
    grades: { outstanding: 95, good: 80, needsWork: 60 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'sat',
    bars: 3,
    blurb: 'The full tactical picture',

    situations: 3,
    questionsPerSituation: 6,
    unitRange: [3, 5],
    aircraftRange: [2, 3],
    aircraftFields: ['waypoint', 'waypointAt', 'altitude', 'channel'],
    supportChance: 0.5,

    grades: { outstanding: 90, good: 70, needsWork: 50 },
  },
}

// Ordered for the intro screen: easier sits left of the title, hard sits right.
export const SAT_DIFFICULTIES = [SAT_TUNING.easier, SAT_TUNING.hard]

export function satTuning(difficulty) {
  return SAT_TUNING[difficulty] || SAT_TUNING[DEFAULT_SAT_DIFFICULTY]
}

export function satGameKey(difficulty) {
  return satTuning(difficulty).gameKey
}

// Easier asks 10, Hard asks 18. Derived rather than stored so the two can never
// disagree with the situation/question counts above.
export function satTotalQuestions(tuning) {
  return tuning.situations * tuning.questionsPerSituation
}

export function computeGrade(pct, tuning) {
  const g = tuning.grades
  if (pct >= g.outstanding) return 'Outstanding'
  if (pct >= g.good) return 'Good'
  if (pct >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The default is 'easier', but once a user picks a difficulty that choice is
// what the instructions screen opens on next time.

const SAT_DIFFICULTY_KEY = 'sw_cbat_sat_difficulty'

export function readStoredSatDifficulty() {
  try {
    const raw = localStorage.getItem(SAT_DIFFICULTY_KEY)
    if (raw && SAT_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_SAT_DIFFICULTY
}

export function storeSatDifficulty(difficulty) {
  try { localStorage.setItem(SAT_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
