import { useUiTheme } from '../../hooks/useUiTheme'

// Renders nothing; exists so the theme is applied once, at the app root, from
// wherever the user happens to be — bare pages like / and /login included.
export default function UiThemeSync() {
  useUiTheme()
  return null
}
