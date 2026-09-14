import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { applyUiTheme, resolveUiTheme } from '../lib/uiTheme'

// The signed-in user's theme, kept stamped on <html> for as long as they are
// signed in. Reads the account field rather than local storage so the look
// follows the user between devices; the cached user AuthContext restores on
// launch means the saved theme is already known at first render, so a reload
// never flashes the default look first.
//
// Signing out removes the attribute: the theme is an account setting, and a
// visitor on the login page should see the site as it is by default.
export function useUiTheme() {
  const { user } = useAuth() ?? {}
  const theme = resolveUiTheme(user)
  useEffect(() => { applyUiTheme(theme) }, [theme])
  return theme
}

export default useUiTheme
