import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { applyUiTheme, resolveUiTheme } from '../lib/uiTheme'
import { useGuestUiTheme } from './useGuestUiTheme'
import { useActiveMock } from '../lib/cbatMockSession'

// Keep the active theme stamped on <html>. Accounts use their server-backed
// choice across devices; guests use the durable choice for this browser.
//
// A Mock Assessment in progress overrides both with Real CBAT for as long as it runs. Nothing is
// written to the account: the player's own theme comes back the moment the mock ends.
export function useUiTheme() {
  const { user } = useAuth() ?? {}
  const [guestTheme] = useGuestUiTheme()
  const inMock = useActiveMock() != null
  const theme = inMock ? 'cbat' : user ? resolveUiTheme(user) : guestTheme
  useEffect(() => { applyUiTheme(theme) }, [theme])
  return theme
}

export default useUiTheme
