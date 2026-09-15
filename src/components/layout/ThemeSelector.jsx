import { useCallback, useState } from 'react'
import { UI_THEMES, UI_THEME_LABELS, UI_THEME_TAGLINES } from '../../lib/uiTheme'
import { animateThemeSwitch } from '../../lib/themeTransition'
import { useUiThemeChoice } from '../../hooks/useUiThemeChoice'
import ThemeHoldSwitch from './ThemeHoldSwitch'
import ThemeFlash from './ThemeFlash'

// Top-bar theme selector: SkyWatch (default) or Real CBAT. On desktop it is
// the two-option control on the right of the bar: a click sweeps the new
// theme across the page from the clicked key (lib/themeTransition.js) and
// the page flashes once with the theme's name. On a phone (`compact`) it
// hands over to ThemeHoldSwitch, which does the same on a press-and-hold.
// The setting itself is account-wide, so every device wears whatever was
// picked here; the optimistic flip and the save live in
// hooks/useUiThemeChoice.js. While a CBAT test is being played the control
// is locked: the top bar stays on screen on desktop, and a switch mid-test
// would reskin the test under the player.
export const LOCKED_TITLE = 'Theme is locked while a test is running. Finish or quit the test to change it.'

export default function ThemeSelector({ compact = false }) {
  const [flash, setFlash] = useState(null)
  const clearFlash = useCallback(() => setFlash(null), [])
  const { user, current, busy, locked, choose } = useUiThemeChoice({ onRevert: clearFlash })
  if (!user) return null
  if (compact) return <ThemeHoldSwitch />

  const pick = (theme, e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    // The flash is part of the committed state, so it is in the new page the
    // sweep reveals rather than a beat behind it.
    choose(theme, { apply: (commit) => animateThemeSwitch(() => { commit(); setFlash(theme) }, at, theme) })
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      title={locked ? LOCKED_TITLE : 'Choose how every page looks: the SkyWatch theme, or a look styled after the CBAT test software'}
      aria-disabled={locked || undefined}
      className={`theme-selector flex items-center gap-1.5${locked ? ' opacity-50' : ''}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint select-none">Theme</span>
      <div className="flex items-center rounded-full border border-slate-300 bg-slate-100 p-0.5">
        {UI_THEMES.map(theme => {
          const active = theme === current
          return (
            <button
              key={theme}
              type="button"
              onClick={(e) => pick(theme, e)}
              disabled={busy || locked}
              aria-pressed={active}
              title={locked ? LOCKED_TITLE : UI_THEME_TAGLINES[theme]}
              className={`theme-selector-option px-2.5 py-0.5 text-xs font-semibold rounded-full transition-colors outline-none focus:outline-none ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:text-slate-800 hover:bg-slate-200'
              }`}
            >
              {UI_THEME_LABELS[theme]}
            </button>
          )
        })}
      </div>
      {flash && <ThemeFlash theme={flash} onDone={clearFlash} />}
    </div>
  )
}
