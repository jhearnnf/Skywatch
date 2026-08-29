// Situational Awareness Test difficulty tuning.
//
// Both difficulties present the picture SERIALLY — one fact on screen at a time,
// it vanishes, the next appears (see satCards.js for why). What separates them
// is how many facts there are and how long each one holds:
//
//   • Easier is the intro. 2–3 contacts, 2 controller aircraft showing two
//     fields each (altitude and comms channel — a flight level and a phonetic
//     word can't be confused with each other), the cross-modal support call in
//     about a third of situations, and 4s on every card. Roughly 9 facts to
//     hold over a ~36s window, at a pace you can rehearse at. Each one fills the screen on
//     its own (`layout: 'card'`) — there is nothing to search, only to remember.
//
//   • Hard is the real test's shape, a notch tighter. 3–4 contacts, 2–3 aircraft
//     showing all four fields, a support call every other situation, and 3.5s a
//     fact. 13–20 facts, ~60s an observe window, with enough time on each fact
//     to actually find and read it before it goes. The
//     whole console stays on screen (`layout: 'panels'`) with only the panel
//     holding the current fact live, so finding where the information landed is
//     part of the job — which is what the real console does.
//
//     The dwell is deliberately not tight. On the panel layout a fact has to be
//     found before it can be memorised, and 2.5s spent both scanning and
//     encoding was measuring reaction speed more than recall.
//
// Hard is deliberately NOT an overload drill. Being far harder than the thing
// you are practising for tells a candidate nothing useful and reads as a broken
// game — the previous all-at-once presentation had someone who passed the real
// SAT scoring a stanine 2 here.
//
// Everything else is shared — the generator, the panels, the 22s question
// clock, the scoring, the tutorial — so the two stay the same test at different
// loads (the same rule FLAG, CUT and Numerical Operations follow).

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
    blurb: 'One fact at a time, slower',

    situations: 2,
    questionsPerSituation: 5,
    unitRange: [2, 3],
    aircraftRange: [2, 2],
    aircraftFields: ['altitude', 'channel'],
    supportChance: 0.35,
    // Seconds each fact holds before it vanishes. The only clock a difficulty
    // owns: the 22s question timer and everything else stay shared.
    cardMs: 4000,
    layout: 'card',

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
    blurb: 'Full console, faster facts',

    situations: 3,
    questionsPerSituation: 6,
    unitRange: [3, 4],
    aircraftRange: [2, 3],
    aircraftFields: ['waypoint', 'waypointAt', 'altitude', 'channel'],
    supportChance: 0.5,
    cardMs: 3500,
    layout: 'panels',

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
