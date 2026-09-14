import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { UI_THEME_LABELS, UI_THEME_TAGLINES } from '../../lib/uiTheme'

// The one-beat flash that follows a theme switch, on every screen size: the
// whole page pulses once with the theme's name across the middle and its
// one-line tagline beneath, then it is gone. It sits over the page but never in the way (no pointer events), and
// unmounts itself when the animation has played (main.css "theme-flash").
// Long enough to read the tagline: a quick fade in, a hold of about a second
// and a half, then a fade out. Keep in step with the keyframes in main.css.
export const FLASH_MS = 2200

export default function ThemeFlash({ theme, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, FLASH_MS)
    return () => clearTimeout(t)
  }, [onDone])

  return createPortal(
    <div className="theme-flash" aria-live="polite" data-testid="theme-flash">
      <div className="theme-flash-card">
        <p className="theme-flash-name">{UI_THEME_LABELS[theme]}</p>
        <p className="theme-flash-tagline">{UI_THEME_TAGLINES[theme]}</p>
      </div>
    </div>,
    document.body,
  )
}
