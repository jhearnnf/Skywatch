// Which site theme a CBAT run was played under. The themes themselves live in
// uiThemes.json, shared with the frontend, so the score can never carry a
// theme the account selector cannot offer.
//
// Recorded on every game's result rows (utils/cbatResult.js adds the path to
// each model and stamps it from the request body) and shown per row on every
// leaderboard, so a SkyWatch score and a Real CBAT score can be told apart at
// a glance. It started as a Symbols-only field, when that game's theme
// variant became the real Visual Search screen rather than a recolour.
const { UI_THEMES } = require('./uiThemes.json');

// The one string the client sent, or null for anything else — a missing field
// (older clients, offline scores queued before this shipped), a typo, or a
// value that is not a string at all. Never rejects the submission: the theme
// is a label on the score, not a condition of it.
function normalizeUiTheme(value) {
  return UI_THEMES.includes(value) ? value : null;
}

module.exports = { UI_THEMES, normalizeUiTheme };
