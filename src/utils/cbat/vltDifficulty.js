// Verbal Logic Test difficulty tuning.
//
// Both difficulties ask eight questions, so the two boards share a ceiling of 8.
// What Easier changes:
//
//   • five tabs instead of eight. The five are the pack's declared `easierTabs`,
//     picked so the subset is self-sufficient — every question the run can ask
//     is answerable from what is on screen
//
// That is now the ONLY lever, because both of this test's clocks are numbers a
// candidate reported first-hand and neither is ours to tune. Deliberately
// shared: the three-minute reading window, the three minutes per question, the
// question count, the scoring, the two-pane limit on how many tabs are readable
// at once, and the fact that every question needs two sections joined. Easier
// does NOT hand out any single-tab questions — a VLT question you can answer
// from one paragraph is not a VLT question, it is a reading-comprehension
// question.
//
// The per-question clock ran at 60 seconds on Hard and 90 on Easier until the
// guide was read back against it: "roughly three minutes per question, and it
// moves on by itself". Both were HARDER than the real test rather than easier,
// which is the wrong way to be wrong — a player pacing themselves against our
// clock would arrive over-hurried. Slack in the clock costs nothing, since the
// question advances the moment you answer.
//
// Grade bands go UP on Easier — both score out of 8.

export const DEFAULT_VLT_DIFFICULTY = 'easier'

export const VLT_LAUNCH_MS = 1000

export const VLT_QUESTIONS = 8

// The reading window before the questions start. Three minutes on both
// difficulties, from the first-hand account in the guide corpus.
export const VLT_READ_MS = 180000

// And three minutes per question, from the same account: "roughly three minutes
// per question, and it moves on by itself when the time is up".
export const VLT_PER_QUESTION_MS = 180000

export const VLT_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    gameKey: 'vlt-easier',
    bars: 1,
    blurb: 'Five tabs to search instead of eight',

    tabCount: 5,
    readMs: VLT_READ_MS,
    perQuestionMs: VLT_PER_QUESTION_MS,

    grades: { outstanding: 8, good: 6, needsWork: 4 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'vlt',
    bars: 3,
    blurb: 'The full set of eight tabs',

    tabCount: 8,
    readMs: VLT_READ_MS,
    perQuestionMs: VLT_PER_QUESTION_MS,

    grades: { outstanding: 7, good: 5, needsWork: 3 },
  },
}

export const VLT_DIFFICULTIES = [VLT_TUNING.easier, VLT_TUNING.hard]

export function vltTuning(difficulty) {
  return VLT_TUNING[difficulty] || VLT_TUNING[DEFAULT_VLT_DIFFICULTY]
}

export function vltGameKey(difficulty) {
  return vltTuning(difficulty).gameKey
}

export function computeVltGrade(correct, tuning) {
  const g = tuning.grades
  if (correct >= g.outstanding) return 'Outstanding'
  if (correct >= g.good) return 'Good'
  if (correct >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────

const VLT_DIFFICULTY_KEY = 'sw_cbat_vlt_difficulty'

export function readStoredVltDifficulty() {
  try {
    const raw = localStorage.getItem(VLT_DIFFICULTY_KEY)
    if (raw && VLT_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_VLT_DIFFICULTY
}

export function storeVltDifficulty(difficulty) {
  try { localStorage.setItem(VLT_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
