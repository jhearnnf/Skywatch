import { useCallback, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { resolveUiTheme } from '../lib/uiTheme'

// Choosing the account's theme, shared by the desktop selector and the
// phone's hold-to-switch control.
//
// Applied optimistically: the user's local `uiTheme` flips first so the whole
// page re-skins at once, then the PATCH makes it stick. A failed save puts the
// previous theme back rather than leaving the screen lying about what the
// account will look like next time, and calls `onRevert` so a banner that
// announced the switch can be pulled.
//
// `apply` lets the caller wrap the optimistic flip (the phone runs it inside a
// page transition); by default it just runs.
export function useUiThemeChoice({ onRevert } = {}) {
  const { user, setUser, API, apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const current = resolveUiTheme(user)

  const choose = useCallback(async (theme, { apply } = {}) => {
    if (busy || theme === current) return false
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
  }, [busy, current, setUser, apiFetch, API, onRevert])

  return { user, current, busy, choose }
}

export default useUiThemeChoice
