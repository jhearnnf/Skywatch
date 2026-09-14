import { UI_THEMES, DEFAULT_UI_THEME, UI_THEME_LABELS, UI_THEME_TAGLINES } from '../../backend/constants/uiThemes.json'

// The site's two looks: the gamified SkyWatch theme and a "Real CBAT" theme
// styled after the actual test software (flat navy, plain white text, square
// panels, Tahoma-style type). One list, shared with the backend enum, so the
// selector can never offer a theme the account refuses to store. Each theme
// also carries a one-line tagline (what the look is for), shown under its
// name in the switch flash and as the selector's per-option tooltip.
export { UI_THEMES, DEFAULT_UI_THEME, UI_THEME_LABELS, UI_THEME_TAGLINES }

export const THEME_ATTR = 'data-theme'

// The theme an account resolves to. Anything unknown (older cached user, a
// theme retired later) falls back to the default rather than leaving the page
// in whatever look was last applied.
export function resolveUiTheme(user) {
  const t = user?.uiTheme
  return UI_THEMES.includes(t) ? t : DEFAULT_UI_THEME
}

// Stamp the theme on <html>. main.css keys every override off this attribute
// (`:root[data-theme="cbat"]`), and the default theme carries no attribute so
// the base tokens apply untouched.
export function applyUiTheme(theme, root = document.documentElement) {
  const resolved = UI_THEMES.includes(theme) ? theme : DEFAULT_UI_THEME
  if (resolved === DEFAULT_UI_THEME) root.removeAttribute(THEME_ATTR)
  else root.setAttribute(THEME_ATTR, resolved)
  return resolved
}
