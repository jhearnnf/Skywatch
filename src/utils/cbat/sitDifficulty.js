import { sitRoundPlan } from './sitGenerator'

// Spatial Integration Test difficulty tuning.
//
// Both difficulties ask the SAME eight questions and therefore share a ceiling
// of 8 — which is what keeps the two leaderboards comparable with every score
// already on them. Those eight questions now arrive as FOUR clips of two, from
// the corpus's "about 50 seconds of true/false questions on it, with no replay":
// several questions off one viewing, not one. A player who knows only one
// question is coming can watch for one thing and ignore the rest of the frame,
// which is precisely the habit this test punishes.
//
// What Easier changes is the load inside a clip:
//
//   • four object classes in the pool instead of six, so the last clips never
//     add aircraft and helicopters (the two that carry a heading as well as a
//     position)
//   • the clip is rotated 180° only, never 90° or 270°. A half-turn is the one
//     rotation you can read off without re-deriving which way is which — every
//     cell simply moves to the opposite corner
//   • longer on each study layer, and twice as long to look at the clip
//
// Deliberately NOT changed: the question count, the grid, the scoring, the fact
// that the study phase shows one isolated LAYER at a time, and the distractor
// rule (a class nobody asks about is wrong on every clip in both). The layers
// and the distractor rule are what the test is really about — softening either
// on Easier would teach the wrong habit, which is the opposite of what an easier
// mode is for.
//
// Grade bands go UP on Easier, the same as Numerical Operations and SAT: both
// difficulties score out of 8, so an easier run has to be more accurate to earn
// the same grade.

export const DEFAULT_SIT_DIFFICULTY = 'easier'

// Matches FLAG's, CUT's and Numerical Operations' launch flash.
export const SIT_LAUNCH_MS = 1000

// Four clips of two questions. Same on both difficulties — see the note above.
export const SIT_CLIPS = 4
export const SIT_QUESTIONS_PER_CLIP = 2
export const SIT_ROUNDS = SIT_CLIPS * SIT_QUESTIONS_PER_CLIP

export const SIT_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    gameKey: 'sit-easier',
    bars: 1,
    blurb: 'Half-turns only, fewer layers to hold',

    classPool: ['farm', 'truck', 'troops', 'trees'],
    rotations: [180],
    // Per LAYER, not per clip: the study window is the number of layers times
    // this, so it grows as the clips unlock more of them. The corpus has the
    // whole sequence running about a minute at full spread, and leaves the split
    // between layers to the candidate — "the time per tab is not equal".
    studyMsPerLayer: 14000,
    clipMs: 4000,
    answerMs: 20000,

    grades: { outstanding: 8, good: 6, needsWork: 4 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'sit',
    bars: 3,
    blurb: 'Quarter-turns, aircraft and flight paths',

    classPool: ['farm', 'truck', 'troops', 'trees', 'aircraft', 'helicopter'],
    rotations: [90, 180, 270],
    studyMsPerLayer: 10000,
    clipMs: 2500,
    answerMs: 15000,

    grades: { outstanding: 7, good: 5, needsWork: 3 },
  },
}

export const SIT_DIFFICULTIES = [SIT_TUNING.easier, SIT_TUNING.hard]

// ── How long a run actually takes ────────────────────────────────────────────
// THREE phases, not one. SIT is the only game on the roster where the answering
// is the SHORT part: studying the layers is minutes, the clips are seconds, and
// the questions are quick. Anything that reports a run length has to add all
// three or it is describing a fraction of the test — the page was submitting
// only the answering time, and the hub tile's estimate was built on the same
// mistake.
//
// The study window grows as the clips unlock more layers, so it is summed off
// `sitRoundPlan` rather than assumed flat — the unlock ramp lives there and this
// must not carry a second copy of it.
//
// Self-paced review between questions is deliberately NOT counted: how long
// someone reads the feedback for is not the test, and counting it would make the
// leaderboard's time column a measure of how long you looked at the answers.
// Numerical Operations and ANT draw the same line.
export function sitPhaseMs(tuning) {
  let study = 0
  for (let i = 0; i < SIT_CLIPS; i++) {
    const plan = sitRoundPlan(i, {
      classPool: tuning.classPool,
      rotations: tuning.rotations,
      questionsPerClip: SIT_QUESTIONS_PER_CLIP,
    })
    study += plan.classes.length * tuning.studyMsPerLayer
  }
  return {
    study,
    clips: SIT_CLIPS * tuning.clipMs,
    answers: SIT_ROUNDS * tuning.answerMs,
  }
}

// A run with every clock used in full — the longest an honest run takes. Real
// players answer well inside the per-question clock, so this is the upper end
// rather than the typical one.
export function sitRunEstimateMs(tuning) {
  const p = sitPhaseMs(tuning)
  return p.study + p.clips + p.answers
}

export function sitTuning(difficulty) {
  return SIT_TUNING[difficulty] || SIT_TUNING[DEFAULT_SIT_DIFFICULTY]
}

export function sitGameKey(difficulty) {
  return sitTuning(difficulty).gameKey
}

export function computeSitGrade(correct, tuning) {
  const g = tuning.grades
  if (correct >= g.outstanding) return 'Outstanding'
  if (correct >= g.good) return 'Good'
  if (correct >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────

const SIT_DIFFICULTY_KEY = 'sw_cbat_sit_difficulty'

export function readStoredSitDifficulty() {
  try {
    const raw = localStorage.getItem(SIT_DIFFICULTY_KEY)
    if (raw && SIT_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_SIT_DIFFICULTY
}

export function storeSitDifficulty(difficulty) {
  try { localStorage.setItem(SIT_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
