import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { applyUiTheme, resolveUiTheme } from '../lib/uiTheme'
import { useGuestUiTheme } from './useGuestUiTheme'

// Keep the active theme stamped on <html>. Accounts use their server-backed
// choice across devices; guests use the durable choice for this browser.
export function useUiTheme() {
  const { user } = useAuth() ?? {}
  const [guestTheme] = useGuestUiTheme()
  const theme = user ? resolveUiTheme(user) : guestTheme
  useEffect(() => { applyUiTheme(theme) }, [theme])
  return theme
}

export default useUiTheme
