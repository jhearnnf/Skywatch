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

module.exports = { CBAT_INPUT_METHODS, normalizeInputMethod };
