// Which site theme a CBAT run was played under. The themes themselves live in
// uiThemes.json, shared with the frontend, so the score can never carry a
// theme the account selector cannot offer.
//
// Recorded only by games the Real CBAT theme changes materially — Symbols was
// the first, when its theme variant became the real Visual Search screen
// (numbered tiles, typed answers, a different glyph pool) rather than a
// recolour. Those registry entries carry `uiTheme: true` in cbatGames.js;
// every other result model leaves the field off entirely.
const { UI_THEMES } = require('./uiThemes.json');

// The one string the client sent, or null for anything else — a missing field
// (older clients, offline scores queued before this shipped), a typo, or a
// value that is not a string at all. Never rejects the submission: the theme
// is a label on the score, not a condition of it.
function normalizeUiTheme(value) {
  return UI_THEMES.includes(value) ? value : null;
}

module.exports = { UI_THEMES, normalizeUiTheme };
