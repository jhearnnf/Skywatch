// System Logic Test difficulty tuning.
//
// Both difficulties ask the SAME ten questions' worth, so the two boards share a
// ceiling of 10. What Easier changes is the size of the search:
//
//   • eight tabs instead of the full fifteen — less to skim, and fewer wrong
//     tabs to land on
//   • a longer reading window and a longer clock per question
//
// Hard shows FIFTEEN, which is the number the corpus gives: "a numbered index of
// 15 tabs down the right". It drew six until the guide was read back against it.
//
// Deliberately shared, and this one changed too: EVERY question is a two-tab
// join on both difficulties. The corpus states flatly that "no single tab
// answers a question", and Easier used to be single-hop — which is a different
// task, not an easier version of this one, and had players practising it as
// though it were this one. Easier is now easier by showing less, not by asking
// something else.
//
// Also shared: the question count, the scoring, the two-pane limit on how many
// tabs are readable at once, the fact that the tabs stay open while you answer
// (it is a search-and-apply task, not a memory one — the corpus is explicit
// about that), and the rule that no two consecutive questions sit on the same
// tab.
//
// Grade bands go UP on Easier — both score out of 10, so an easier run has to be
// more accurate for the same grade.

export const DEFAULT_SLT_DIFFICULTY = 'easier'

export const SLT_LAUNCH_MS = 1000

// Same on both difficulties — see above.
export const SLT_QUESTIONS = 10

export const SLT_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    gameKey: 'slt-easier',
    bars: 1,
    blurb: 'Eight tabs, longer on each question',

    tabCount: 8,
    readMs: 90000,
    perQuestionMs: 60000,

    grades: { outstanding: 10, good: 8, needsWork: 6 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'slt',
    bars: 3,
    blurb: 'The full index of fifteen tabs',

    tabCount: 15,
    readMs: 60000,
    perQuestionMs: 45000,

    grades: { outstanding: 9, good: 7, needsWork: 5 },
  },
}

export const SLT_DIFFICULTIES = [SLT_TUNING.easier, SLT_TUNING.hard]

export function sltTuning(difficulty) {
  return SLT_TUNING[difficulty] || SLT_TUNING[DEFAULT_SLT_DIFFICULTY]
}

export function sltGameKey(difficulty) {
  return sltTuning(difficulty).gameKey
}

export function computeSltGrade(correct, tuning) {
  const g = tuning.grades
  if (correct >= g.outstanding) return 'Outstanding'
  if (correct >= g.good) return 'Good'
  if (correct >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────

const SLT_DIFFICULTY_KEY = 'sw_cbat_slt_difficulty'

export function readStoredSltDifficulty() {
  try {
    const raw = localStorage.getItem(SLT_DIFFICULTY_KEY)
    if (raw && SLT_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_SLT_DIFFICULTY
}

export function storeSltDifficulty(difficulty) {
  try { localStorage.setItem(SLT_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
