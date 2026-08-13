// Sensory Motor Apparatus Test difficulty tuning.
//
// Hard is a one-minute run; Easier is thirty seconds. Both are short on purpose:
// this is a continuous tracking task with nothing to read and nothing to decide,
// so it is the one game on the roster where a long run adds tedium rather than
// difficulty. Vigilance is the deliberate exception to that — there the clock IS
// the load — and it is worth saying plainly that SMA is not the same test.
//
// Easier keeps the control law, the rate control, the forcing function and the
// scoring formula exactly the same — what changes is how much tracking work a
// run asks for:
//
//   • 30 scored seconds instead of 60.
//   • the drift peaks at 0.19 radii/sec instead of 0.30, so the dot gets away
//     from you more slowly and a late correction still catches it.
//   • the tolerance ring is half again as wide (0.24 of the display radius
//     instead of 0.16), so a nearly-centred dot still earns.
//   • no gusts. See smaSim.js for what they are and why Hard has them.
//     On a 30-second run there is no pattern to learn anyway.
//
// The ring widening is why the two boards cannot be read against each other:
// with a wider ring the same physical tracking earns more points per second, on
// top of there being fewer of them. Separate collections, separate boards, and
// the label on both says which — the rule FLAG, CUT, RTT and the rest follow.
//
// The grade bands are estimates. Nothing has been played on real hardware and
// nobody here has flown it with a stick, so treat them as a first cut and retune
// them together with the demo boards in cbatFakeLeaderboard.js once there are
// real runs, exactly as CUT's and RTT's notes say.

import { maxSmaScore } from './smaSim'

export const DEFAULT_SMA_DIFFICULTY = 'easier'

// How long the selected difficulty button flashes after Start before the game
// begins. Matches the other split games' — the sequence should feel the same
// wherever it appears.
export const SMA_LAUNCH_MS = 1000

export const SMA_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // Backend leaderboard key — its own collection, its own board.
    gameKey: 'sma-easier',
    bars: 1,
    blurb: '30 seconds, slower drift',

    durationMs: 30000,
    driftRate: 0.19,
    ringRadius: 0.24,
    gusts: false,

    // Max is 300. A wider ring lifts the whole distribution, so the bands sit
    // at a HIGHER share of max than Hard's rather than a lower one.
    grades: { outstanding: 200, good: 140, needsWork: 80 },
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'sma',
    bars: 3,
    blurb: '60 seconds, full drift and gusts',

    durationMs: 60000,
    driftRate: 0.30,
    ringRadius: 0.16,
    gusts: true,

    // Max is 600.
    grades: { outstanding: 360, good: 250, needsWork: 135 },
  },
}

// Ordered for the intro screen: easier sits left of the title, hard sits right.
export const SMA_DIFFICULTIES = [SMA_TUNING.easier, SMA_TUNING.hard]

export function smaTuning(difficulty) {
  return SMA_TUNING[difficulty] || SMA_TUNING[DEFAULT_SMA_DIFFICULTY]
}

export function smaGameKey(difficulty) {
  return smaTuning(difficulty).gameKey
}

export function computeGrade(score, tuning) {
  const g = tuning.grades
  if (score >= g.outstanding) return 'Outstanding'
  if (score >= g.good) return 'Good'
  if (score >= g.needsWork) return 'Needs Work'
  return 'Failed'
}

export function scorePercent(score, tuning) {
  return Math.round((score / maxSmaScore(tuning)) * 100)
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The default is 'easier', but once a user picks a difficulty that choice is
// what the instructions screen opens on next time.

const SMA_DIFFICULTY_KEY = 'sw_cbat_sma_difficulty'

export function readStoredSmaDifficulty() {
  try {
    const raw = localStorage.getItem(SMA_DIFFICULTY_KEY)
    if (raw && SMA_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_SMA_DIFFICULTY
}

export function storeSmaDifficulty(difficulty) {
  try { localStorage.setItem(SMA_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}

// ── Control sensitivity ──────────────────────────────────────────────────────
// Shared by both difficulties and remembered separately from them, the same way
// RTT's slew sensitivity is — and for a stronger reason here. The corpus's whole
// message about this test is that the apparatus varies station to station, that
// candidates regularly find the pedals sticky or insensitive, and that the right
// response is to say so and get it sorted rather than fight it. A player who
// finds our control too twitchy or too dead should be able to do the equivalent,
// so this sits on the instructions card rather than in a settings menu.
//
// Multiplies CONTROL_RATE, so 1.0 is the rate smaSim documents.

export const MIN_SMA_SENSITIVITY = 0.5
export const MAX_SMA_SENSITIVITY = 1.8
export const DEFAULT_SMA_SENSITIVITY = 1.0

const SMA_SENSITIVITY_KEY = 'sw_cbat_sma_sensitivity'

export function readStoredSmaSensitivity() {
  try {
    const n = Number(localStorage.getItem(SMA_SENSITIVITY_KEY))
    if (Number.isFinite(n) && n >= MIN_SMA_SENSITIVITY && n <= MAX_SMA_SENSITIVITY) return n
  } catch { /* storage unavailable */ }
  return DEFAULT_SMA_SENSITIVITY
}

export function storeSmaSensitivity(value) {
  try { localStorage.setItem(SMA_SENSITIVITY_KEY, String(value)) } catch { /* storage unavailable */ }
}
