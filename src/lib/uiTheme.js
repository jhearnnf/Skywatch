import { UI_THEMES, DEFAULT_UI_THEME, UI_THEME_LABELS, UI_THEME_TAGLINES } from '../../backend/constants/uiThemes.json'

// The site's two looks: the gamified SkyWatch theme and a "Real CBAT" theme
// styled after the actual test software (flat navy, plain white text, square
// panels, Tahoma-style type). One list, shared with the backend enum, so the
// selector can never offer a theme the account refuses to store. Each theme
// also carries a one-line tagline (what the look is for), shown under its
// name in the switch flash and as the selector's per-option tooltip.
export { UI_THEMES, DEFAULT_UI_THEME, UI_THEME_LABELS, UI_THEME_TAGLINES }

export const THEME_ATTR = 'data-theme'
export const GUEST_UI_THEME_KEY = 'skywatch.guestUiTheme'
export const GUEST_UI_THEME_EVENT = 'skywatch:guest-ui-theme'

export function readGuestUiTheme(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const theme = storage?.getItem(GUEST_UI_THEME_KEY)
    return UI_THEMES.includes(theme) ? theme : DEFAULT_UI_THEME
  } catch {
    return DEFAULT_UI_THEME
  }
}

export function hasGuestUiThemeChoice(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { return UI_THEMES.includes(storage?.getItem(GUEST_UI_THEME_KEY)) } catch { return false }
}

export function saveGuestUiTheme(theme, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const resolved = UI_THEMES.includes(theme) ? theme : DEFAULT_UI_THEME
  try { storage?.setItem(GUEST_UI_THEME_KEY, resolved) } catch { /* storage may be unavailable */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GUEST_UI_THEME_EVENT, { detail: resolved }))
  return resolved
}

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

// The theme the page is showing right now, read back off <html> so it is the
// look the player actually saw rather than whatever the account says (the two
// only differ mid-transition). Scores are stamped with it as they are
// submitted (lib/cbatOutbox.js) so every leaderboard can say which theme a
// run was played under. Outside a document (tests, SSR) it is the default.
export function currentUiTheme(root = typeof document !== 'undefined' ? document.documentElement : null) {
  const t = root?.getAttribute?.(THEME_ATTR)
  return UI_THEMES.includes(t) ? t : DEFAULT_UI_THEME
}

// A theme name a score row carries, or null for anything else — an older row
// with no field, or a value the enum no longer knows. Mirrors the backend's
// normalizeUiTheme (constants/cbatUiThemes.js).
export function normalizeUiTheme(value) {
  return UI_THEMES.includes(value) ? value : null
}
