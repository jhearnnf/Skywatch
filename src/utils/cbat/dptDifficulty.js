// Dynamic Projection Test difficulty tuning.
//
// DPT is the one split where the two difficulties are literally halves of the
// game that already existed. It shipped as an eight-round ladder that ramps
// from "one aircraft, two gates" to "three aircraft, six gates, three enemies
// and three danger zones", and the ramp was doing the job of a difficulty
// selector all on its own — a beginner had to sit through four rounds of
// nothing much before the test started, and an experienced player had to do
// the same before reaching anything worth their time.
//
// So the ladder is cut in half:
//
//   • Easier plays rounds 1–4 — CA-A alone on lettered gates, CA-N and the
//     numbered gates joining at the end. No enemies, no danger zones.
//   • Hard   plays rounds 5–8 — opens where Easier stops, with CA-N already
//     up, danger zones live, and the Fighter and enemy squadron arriving at
//     round 6 and growing to three by round 8.
//
// Nothing about a round changes. `startRound(n)` builds round n exactly as it
// always has; a difficulty only says which four of the eight to serve. That is
// deliberate and it is what makes the legacy scores salvageable — see below.
//
// ── Why the round NUMBERS stay 5–8 on Hard ──────────────────────────────────
//
// The round-completion bonus is 50 × the round number, so rounds 5–8 are worth
// 1,300 of bonus where rounds 1–4 are worth 500. Hard keeps counting its rounds
// 5, 6, 7, 8 internally and only *displays* them as 1/4 … 4/4. Renumbering them
// would drop the bonus to 500 and silently rescale the board.
//
// That matters because the 161 runs recorded before the split were copied onto
// the new Hard board with what rounds 1–4 could have contributed taken off:
//
//     12 gates × 100  +  50 × (1+2+3+4)  =  1200 + 500  =  1700
//
// — which is also exactly a perfect Easier score. That subtraction is only
// correct while a Hard round keeps paying what it paid before, so treat the
// ladder numbering as load-bearing (see backend/utils/dptLegacyNormalise.js).
//
// The per-round data needed to split those runs exactly was never recorded — no
// round index on a gate hit, no counter for the CA-A/CA-N-into-enemy penalty,
// and danger-zone seconds are charged per second while only entries are stored
// — so the copy assumes a run cleared rounds 1–4. That holds where it matters:
// every run near the top of the board hit 33+ of the 36 gates.
//
// ── Three boards ────────────────────────────────────────────────────────────
//
// The originals were COPIED, not moved. `dpt` is still the eight-round board,
// still ranking eight-round runs, because clients predating the split are still
// out there playing that game and reading that board with hardcoded URLs — a
// native build only changes with a store release. It goes quiet on its own as
// they update. `dpt-hard` and `dpt-easier` are new keys no old build can reach.

export const DEFAULT_DPT_DIFFICULTY = 'easier'

export const DPT_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'dpt-easier',
    bars: 1,
    blurb: 'Rounds 1-4: no enemies, no danger zones',

    // Which rungs of the eight-round ladder this difficulty serves, in order.
    rounds: [1, 2, 3, 4],

    // What the instructions card says about the shape of a run. Written out
    // rather than derived so each card reads like prose instead of a table.
    lengthBlurb: '4 rounds · 105s / 105s / 105s / 120s',
    joinsBlurb: 'CA-N joins the final round — numbered gates (1→2→3)',

    // 12 gates × 100 + 50 × (1+2+3+4) of round bonus. No intercepts to earn
    // and no danger zones to lose points to, so this is a hard ceiling.
    maxScore: 1700,
    grades: { outstanding: 1450, good: 1100, needsWork: 700 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    // NOT 'dpt'. That key is the original eight-round board, which clients
    // predating the split still play and read with hardcoded URLs — a native
    // build only changes with a store release. Ranking their eight-round totals
    // against four-round runs would put them permanently on top of it, so the
    // split lives on two new keys no old build can address, and `dpt` stays the
    // eight-round board until it goes quiet on its own.
    gameKey: 'dpt-hard',
    bars: 3,
    blurb: 'Rounds 5-8: enemies, danger zones, three aircraft',

    rounds: [5, 6, 7, 8],

    lengthBlurb: '4 rounds · 120s / 180s / 180s / 180s',
    joinsBlurb: 'Fighter joins round 2 — intercept enemy contacts',

    // 24 gates × 100 + 50 × (5+6+7+8) of round bonus + 6 intercepts × 250.
    maxScore: 5200,
    grades: { outstanding: 4200, good: 3000, needsWork: 1800 },
  },
}

// Ordered for the intro screen: easier sits left of the title, hard sits right.
export const DPT_DIFFICULTIES = [DPT_TUNING.easier, DPT_TUNING.hard]

export function dptTuning(difficulty) {
  return DPT_TUNING[difficulty] || DPT_TUNING[DEFAULT_DPT_DIFFICULTY]
}

export function dptGameKey(difficulty) {
  return dptTuning(difficulty).gameKey
}

// The ladder round a run of this difficulty opens on (1 for Easier, 5 for Hard).
export function firstRound(tuning) {
  return tuning.rounds[0]
}

// The ladder round after which the run finishes (4 for Easier, 8 for Hard).
export function lastRound(tuning) {
  return tuning.rounds[tuning.rounds.length - 1]
}

// Ladder round → the 1-based position shown on the HUD. Hard plays rounds
// 5–8 but reads "RND 1/4" through "RND 4/4"; a player is running four rounds
// and the ladder number is an implementation detail of the scoring.
//
// Clamped because the admin round-jump cheats (111…888 on the numpad, and
// ?round=N) address ladder rounds absolutely, so a debug run can sit outside
// the difficulty's own slice.
export function displayRound(round, tuning) {
  const n = round - firstRound(tuning) + 1
  return Math.min(Math.max(n, 1), tuning.rounds.length)
}

export function computeGrade(score, tuning) {
  const g = tuning.grades
  if (score >= g.outstanding) return 'Outstanding'
  if (score >= g.good) return 'Good'
  if (score >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The default is 'easier', but once a user picks a difficulty that choice is
// what the instructions screen opens on next time.

const DPT_DIFFICULTY_KEY = 'sw_cbat_dpt_difficulty'

export function readStoredDptDifficulty() {
  try {
    const raw = localStorage.getItem(DPT_DIFFICULTY_KEY)
    if (raw && DPT_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_DPT_DIFFICULTY
}

export function storeDptDifficulty(difficulty) {
  try { localStorage.setItem(DPT_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
