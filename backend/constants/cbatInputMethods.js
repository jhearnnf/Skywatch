// Which physical control a CBAT run was flown on. Mirrors
// src/utils/cbat/inputMethod.js on the frontend — the two lists must match.
//
// Recorded only by the steered games (ACT, RTT and SMA — the registry entries
// with `inputMethod: true` in cbatGames.js). Every other result model leaves the
// field off entirely.
const CBAT_INPUT_METHODS = ['joystick', 'keyboard-mouse', 'touch'];

// The one string the client sent, or null for anything else — a missing field
// (older clients, offline scores queued before this shipped), a typo, or a
// value that is not a string at all. Never rejects the submission: the input
// method is a label on the score, not a condition of it.
function normalizeInputMethod(value) {
  return CBAT_INPUT_METHODS.includes(value) ? value : null;
}

// Whether rudder pedals held the lateral axis for the run. A separate boolean
// beside `inputMethod` rather than a fourth method, because pedals only ever
// fly ONE axis while a stick, a mouse or a finger flies the other: a pedal run
// is "joystick + pedals", not "pedals". Recorded only by SMA (registry entries
// with `pedals: true`), the one test flown on pedals.
//
// Three values, on purpose: true / false are what a client that knows about
// pedals said; null is a client that never said (an older build, a score
// queued offline before this shipped). Anything that is not a real boolean is
// treated as unsaid, never as false — "no" is a claim, "?" is not.
function normalizePedals(value) {
  return value === true ? true : value === false ? false : null;
}

module.exports = { CBAT_INPUT_METHODS, normalizeInputMethod, normalizePedals };
