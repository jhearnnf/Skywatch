import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { UI_THEMES, UI_THEME_LABELS, resolveUiTheme } from '../../lib/uiTheme'

// Top-bar theme selector: SkyWatch (default) or Real CBAT. Desktop only for
// now (the caller hides it below md); the setting itself is account-wide, so
// a phone signed in to the same account still wears whatever was picked here.
//
// Applied optimistically: the user's local `uiTheme` flips first so the whole
// page re-skins on the click, then the PATCH makes it stick. A failed save
// puts the previous theme back rather than leaving the screen lying about
// what the account will look like next time.
export default function ThemeSelector() {
  const { user, setUser, API, apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const current = resolveUiTheme(user)

  const choose = async (theme) => {
    if (busy || theme === current) return
    const previous = current
    setBusy(true)
    setUser(prev => (prev ? { ...prev, uiTheme: theme } : prev))
    try {
      const res = await apiFetch(`${API}/api/users/me/theme`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.data?.user) setUser(data.data.user)
      else setUser(prev => (prev ? { ...prev, uiTheme: previous } : prev))
    } catch {
      setUser(prev => (prev ? { ...prev, uiTheme: previous } : prev))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      title="Choose how every page looks: the SkyWatch theme, or a look styled after the CBAT test software"
      className="theme-selector flex items-center gap-1.5"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint select-none">Theme</span>
      <div className="flex items-center rounded-full border border-slate-300 bg-slate-100 p-0.5">
        {UI_THEMES.map(theme => {
          const active = theme === current
          return (
            <button
              key={theme}
              type="button"
              onClick={() => choose(theme)}
              disabled={busy}
              aria-pressed={active}
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
    </div>
  )
}
