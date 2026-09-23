// The two boards behind the Instruments tile, for the shared CbatModeRow.
//
// Reading is the original game: six dials settle and you pick the sentence
// that describes them. Orientation is the other half of the real instrument
// test, which the tile never had until 2026-09-16: an attitude indicator and a
// compass, and you pick which of four aircraft pictures matches them.
//
// They are different tests, not one test at two loads, so neither carries
// bars and the pill just says which exercise it is (the Visualisation 2D/3D
// arrangement, not the Easier/Hard one). `instruments` keeps the original
// key so every Reading score ever set still ranks; Orientation is a new key
// with its own collection, ranking from zero.

export const INSTRUMENTS_MODE_KEYS = {
  reading: 'instruments',
  orientation: 'instruments-orientation',
}

export const INSTRUMENTS_MODES = [
  { key: 'reading',     label: 'Reading',     gameKey: 'instruments',             blurb: 'Read six dials and pick the statement that matches' },
  { key: 'orientation', label: 'Orientation', gameKey: 'instruments-orientation', blurb: 'Match the attitude indicator and compass to the right aircraft picture' },
  // The drill, ANT Practise's arrangement: a third pill in the same row with a
  // Drill badge, Start launches it, and it ranks on its own board with its own
  // admin toggle.
  { key: 'practise',    label: 'Practise',    gameKey: 'instruments-practise', badge: 'Drill', blurb: 'Fly an aircraft and match the dials one at a time' },
]

export const DEFAULT_INSTRUMENTS_MODE = 'reading'
const STORAGE_KEY = 'cbat:instruments:mode'
const VALID = INSTRUMENTS_MODES.map(m => m.key)

// Modes an admin has left switched on. With one left there is nothing to pick
// and CbatModeRow renders nothing.
export function instrumentsModes(isModeEnabled) {
  return isModeEnabled ? INSTRUMENTS_MODES.filter(m => isModeEnabled(m)) : INSTRUMENTS_MODES
}

export function instrumentsMode(key) {
  return INSTRUMENTS_MODES.find(m => m.key === key) ?? INSTRUMENTS_MODES[0]
}

export function readStoredInstrumentsMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return VALID.includes(stored) ? stored : DEFAULT_INSTRUMENTS_MODE
  } catch {
    return DEFAULT_INSTRUMENTS_MODE
  }
}

export function storeInstrumentsMode(key) {
  const validated = VALID.includes(key) ? key : DEFAULT_INSTRUMENTS_MODE
  try { localStorage.setItem(STORAGE_KEY, validated) } catch { /* storage unavailable */ }
  return validated
}
