import { useCallback, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { resolveUiTheme } from '../lib/uiTheme'
import { useCbatGameInProgress } from './useCbatGameInProgress'
import { useGuestUiTheme } from './useGuestUiTheme'

// Choosing a theme, shared by the desktop selector and phone hold control.
// Accounts save to the API; guests save locally on their current device.
//
// Applied optimistically: the user's local `uiTheme` flips first so the whole
// page re-skins at once, then the PATCH makes it stick. A failed save puts the
// previous theme back rather than leaving the screen lying about what the
// account will look like next time, and calls `onRevert` so a banner that
// announced the switch can be pulled.
//
// `apply` lets the caller wrap the optimistic flip (the phone runs it inside a
// page transition); by default it just runs.
//
// `locked` is true while a CBAT test is being played. Switching then would
// reskin the test mid-run (the chrome, key caps and colours all follow the
// theme), so `choose` refuses and the controls show why.
export function useUiThemeChoice({ onRevert } = {}) {
  const { user, setUser, API, apiFetch } = useAuth()
  const [guestTheme, setGuestTheme] = useGuestUiTheme()
  const [busy, setBusy] = useState(false)
  const current = user ? resolveUiTheme(user) : guestTheme
  const locked = useCbatGameInProgress()

  const choose = useCallback(async (theme, { apply } = {}) => {
    if (busy || locked || theme === current) return false
    if (!user) {
      const commit = () => setGuestTheme(theme)
      if (apply) await apply(commit)
      else commit()
      return true
    }
    const previous = current
    setBusy(true)
    const commit = () => setUser(prev => (prev ? { ...prev, uiTheme: theme } : prev))
    const revert = () => {
      setUser(prev => (prev ? { ...prev, uiTheme: previous } : prev))
      onRevert?.()
    }
    if (apply) await apply(commit)
    else commit()
    try {
      const res = await apiFetch(`${API}/api/users/me/theme`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.data?.user) { setUser(data.data.user); return true }
      revert()
      return false
    } catch {
      revert()
      return false
    } finally {
      setBusy(false)
    }
  }, [busy, locked, current, user, setGuestTheme, setUser, apiFetch, API, onRevert])

  return { user, current, busy, locked, choose }
}

export default useUiThemeChoice
