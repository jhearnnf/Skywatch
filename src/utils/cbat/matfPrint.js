// Table Reading Test — printed reference sheets.
//
// The real test is worked against a pre-printed laminated sheet beside the
// screen, and the corpus is explicit that managing the sheet AND the screen at
// once is a large part of what the test costs you. One display cannot reproduce
// that; two surfaces can, and everybody practising at home already has a
// printer. So a run can hand you its own reference tables on paper.
//
// A run is rebuilt from `{ seed, difficulty }` — see buildMatfRun in
// matfGenerator.js — and that pair is what this module stores. The tables
// themselves are never written to storage: they are several thousand numbers,
// and a seed is six characters.
//
// WHY WE KEEP THE LAST FEW. Every run generates fresh numbers on purpose, so a
// player drills the lookup rather than memorising one grid. That is right for
// the test and wasteful of paper — a sheet is good for exactly one run. Keeping
// the last three lets a player replay a sheet they already have in front of
// them. Those replays are NOT submitted: the player has seen the numbers
// before, and the real test's numbers are ones you have never seen. The page
// says so before the run starts and again on the results screen.

import { matfTuning, MATF_TUNING } from './matfDifficulty'

export const MATF_PRINTOUT_LIMIT = 3

const MATF_PRINTOUTS_KEY = 'sw_cbat_matf_printouts'

// A full 32-bit seed. Narrower and two runs in a session could collide, which
// would quietly hand a player the same grid twice.
export function matfRunSeed(rand = Math.random) {
  return Math.floor(rand() * 0x100000000) >>> 0
}

// What gets printed in the corner of the sheet and shown in the saved-sheets
// rail, so a player can tell which piece of paper is which. Display only —
// nothing is ever looked up by it.
export function matfSheetCode(seed) {
  return (seed >>> 0).toString(16).toUpperCase().padStart(6, '0').slice(-6)
}

function isPrintout(e) {
  return !!e
    && Number.isInteger(e.seed) && e.seed >= 0 && e.seed <= 0xFFFFFFFF
    && typeof e.difficulty === 'string' && !!MATF_TUNING[e.difficulty]
    && Number.isFinite(e.printedAt)
}

export function readMatfPrintouts() {
  try {
    const raw = JSON.parse(localStorage.getItem(MATF_PRINTOUTS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    // Anything malformed is dropped rather than repaired. A half-valid entry
    // rebuilds a run that is not the one on the player's sheet, which is worse
    // than not offering the replay at all.
    return raw.filter(isPrintout).slice(0, MATF_PRINTOUT_LIMIT)
  } catch { return [] }
}

// Newest first, deduped by seed: printing the same sheet twice moves it back to
// the top rather than filling the rail with copies of itself.
export function recordMatfPrintout({ seed, difficulty }, now = Date.now()) {
  const entry = { seed: seed >>> 0, difficulty, printedAt: now }
  if (!isPrintout(entry)) return readMatfPrintouts()
  const next = [entry, ...readMatfPrintouts().filter(e => e.seed !== entry.seed)]
    .slice(0, MATF_PRINTOUT_LIMIT)
  try { localStorage.setItem(MATF_PRINTOUTS_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  return next
}

export function clearMatfPrintouts() {
  try { localStorage.removeItem(MATF_PRINTOUTS_KEY) } catch { /* storage unavailable */ }
}

// "Hard, plus or minus 17 grid, 5 tables" — the shape of the sheet, so a player
// holding two printouts can tell which board each one was for.
export function matfPrintoutShape(difficulty) {
  const t = matfTuning(difficulty)
  return `${t.label} · ±${t.gridExtent} grid · ${t.tableCount} tables`
}

export function matfPrintoutDate(printedAt) {
  try {
    return new Date(printedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  } catch { return '' }
}
