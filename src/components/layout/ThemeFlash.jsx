import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { UI_THEME_LABELS } from '../../lib/uiTheme'

// The one-beat flash that follows a theme switch, on every screen size: the
// whole page pulses once with the theme's name across the middle, then it is
// gone. It sits over the page but never in the way (no pointer events), and
// unmounts itself when the animation has played (main.css "theme-flash").
export const FLASH_MS = 1100

export default function ThemeFlash({ theme, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, FLASH_MS)
    return () => clearTimeout(t)
  }, [onDone])

  return createPortal(
    <div className="theme-flash" aria-live="polite" data-testid="theme-flash">
      <p className="theme-flash-name">{UI_THEME_LABELS[theme]}</p>
    </div>,
    document.body,
  )
}
