// ANT mode tuning.
//
// ANT's tile holds three boards, and they are not one game at three settings:
//
//   • Easier — the ORIGINAL board, untouched. One table with a value missing,
//     four calculations, eight rounds out of 80. Every score ever set on it
//     still stands, which is why it keeps the plain `ant` key.
//   • Hard — the rebuild off the first-hand accounts. Word problems, weather,
//     two-lookup fuel, part journeys and two aircraft, twelve rounds out of 120.
//     New key, new leaderboard from zero.
//   • Practise — the arithmetic drill. The same four calculations as plain
//     questions with the figures written out, no board to read. Its own
//     leaderboard, because stating the figures outright is a different
//     achievement from hunting for them.
//
// So there is deliberately no shared tuning table beyond the chrome. A mode does
// not turn a dial; it picks which of the three you play. The per-game numbers
// live with their own generators (src/utils/antGenerator.js and
// ./antHardGenerator.js) and nothing converts between the three boards.
//
// Easier and Hard carry `bars` because one really is harder than the other.
// Practise carries a `badge` instead — it is a different exercise, not a
// setting, and a meter claiming it is the easy end would be a wrong meter.

import { CBAT_ANT_DIFFICULTY_KEY } from '../storageKeys'
import { ANT_HARD_ROUNDS, ANT_HARD_ROUND_TIME, ANT_HARD_MAX_SCORE } from './antHardGenerator'

export const DEFAULT_ANT_DIFFICULTY = 'easier'

// How long the selected mode button flashes after Start before the game begins.
// Matches FLAG and CUT.
export const ANT_LAUNCH_MS = 1000

export const ANT_TUNING = {
  easier: {
    key: 'easier',
    label: 'Easier',
    // The original collection. Existing scores rank on unchanged.
    gameKey: 'ant',
    bars: 1,
    blurb: 'The original board — four calculations',
    rounds: 8,
    roundTime: 60,
    maxScore: 80,
  },
  hard: {
    key: 'hard',
    label: 'Hard',
    gameKey: 'ant-hard',
    bars: 3,
    blurb: 'Word problems, weather, fuel and two aircraft',
    rounds: ANT_HARD_ROUNDS,
    roundTime: ANT_HARD_ROUND_TIME,
    maxScore: ANT_HARD_MAX_SCORE,
  },
  practise: {
    key: 'practise',
    label: 'Practise',
    gameKey: 'ant-practise',
    badge: 'Drill',
    blurb: 'The four calculations as plain questions',
    rounds: 8,
    // Not a round-by-round board — all eight questions sit on one page and the
    // drill is untimed, so there is no per-round clock to advertise.
    roundTime: null,
    maxScore: 80,
  },
}

// Ordered for the intro screen: easier, hard, then the drill.
export const ANT_MODES = [ANT_TUNING.easier, ANT_TUNING.hard, ANT_TUNING.practise]

// Practise has its own admin toggle, because it is its own board rather than a
// difficulty of ANT. A disabled drill drops out of the row entirely — the same
// way a disabled Trace mode drops out of that page's selector.
export function antModes(practiseEnabled = true) {
  return practiseEnabled ? ANT_MODES : ANT_MODES.filter(m => m.key !== 'practise')
}

export function antTuning(difficulty) {
  return ANT_TUNING[difficulty] || ANT_TUNING[DEFAULT_ANT_DIFFICULTY]
}

export function antGameKey(difficulty) {
  return antTuning(difficulty).gameKey
}

// ── Persistence ──────────────────────────────────────────────────────────────
// Default 'easier', and once a user picks a mode that is what the instructions
// screen opens on next time.

export function readStoredAntDifficulty() {
  try {
    const raw = localStorage.getItem(CBAT_ANT_DIFFICULTY_KEY)
    if (raw && ANT_TUNING[raw]) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_ANT_DIFFICULTY
}

export function storeAntDifficulty(difficulty) {
  try { localStorage.setItem(CBAT_ANT_DIFFICULTY_KEY, difficulty) } catch { /* storage unavailable */ }
}
