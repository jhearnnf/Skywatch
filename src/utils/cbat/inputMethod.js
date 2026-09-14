// Which physical control a CBAT run was flown on.
//
// Three of the games are steered — ACT, RTT and SMA — and on those a score means
// something different on a joystick than it does on a trackpad. The board says
// which, so nobody compares a stick run against a thumb run without knowing it.
//
// Three buckets, on purpose. "Keyboard + mouse" covers mouse-only, keyboard-only
// and the two together, because they are the same desk and nobody reads the
// difference off a leaderboard; touch is a finger on a screen; joystick is a
// real stick through gamepad.js. The backend keeps the same three strings in
// backend/constants/cbatInputMethods.js and rejects anything else.
//
// A run rarely uses exactly one source — a stick player still nudges the mouse
// to click Start, a phone player might tap a key. So the input layers keep a
// tally of how much steering each source actually contributed and the run is
// labelled with whichever did most of the work.

export const INPUT_JOYSTICK = 'joystick'
export const INPUT_KEYBOARD_MOUSE = 'keyboard-mouse'
export const INPUT_TOUCH = 'touch'

export const INPUT_METHODS = [INPUT_JOYSTICK, INPUT_KEYBOARD_MOUSE, INPUT_TOUCH]

export const INPUT_METHOD_LABEL = {
  [INPUT_JOYSTICK]: 'Joystick',
  [INPUT_KEYBOARD_MOUSE]: 'Keyboard + mouse',
  [INPUT_TOUCH]: 'Touch',
}

export const INPUT_METHOD_ICON = {
  [INPUT_JOYSTICK]: '🕹️',
  [INPUT_KEYBOARD_MOUSE]: '⌨️',
  [INPUT_TOUCH]: '👆',
}

// A fresh tally: every bucket at zero.
export function createInputTally() {
  return { [INPUT_JOYSTICK]: 0, [INPUT_KEYBOARD_MOUSE]: 0, [INPUT_TOUCH]: 0 }
}

// Add `weight` of steering to one bucket. Weight is whatever unit the game
// measures input in (frames for the rate-control games, pixel-equivalents for
// ACT); only the ratio between buckets matters. Unknown methods are ignored so
// a typo cannot poison the tally.
export function addInput(tally, method, weight = 1) {
  if (!tally || !(method in tally) || !(weight > 0)) return tally
  tally[method] += weight
  return tally
}

// Merge several tallies (ACT keeps one per round).
export function mergeInputTallies(tallies) {
  const out = createInputTally()
  for (const t of tallies) {
    if (!t) continue
    for (const m of INPUT_METHODS) out[m] += Number(t[m]) || 0
  }
  return out
}

// The method that did most of the steering, or null when nothing steered at
// all (a run the player never touched). Ties go to the first in INPUT_METHODS
// order, so a genuinely even split reads as a joystick run — the rarer device,
// and the one worth surfacing.
export function dominantInput(tally) {
  if (!tally) return null
  let best = null
  let bestWeight = 0
  for (const m of INPUT_METHODS) {
    const w = Number(tally[m]) || 0
    if (w > bestWeight) { best = m; bestWeight = w }
  }
  return best
}

// Round-trips a value that came over the wire (a leaderboard row, an older
// result with nothing recorded) into one of the three, or null.
export function normalizeInputMethod(value) {
  return INPUT_METHODS.includes(value) ? value : null
}
