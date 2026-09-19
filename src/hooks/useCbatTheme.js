import { useAuth } from '../context/AuthContext'
import { resolveUiTheme } from '../lib/uiTheme'
import { useGuestUiTheme } from './useGuestUiTheme'

// True while the current user or guest is on the Real CBAT theme. The games read
// this to switch on the test-software chrome (title bar, footer strip,
// practice items, select-then-Enter answering) without touching how they
// play under the default SkyWatch look. Reads the account field the same way
// useUiTheme does, so the two can never disagree.
export function useCbatTheme() {
  const { user } = useAuth() ?? {}
  const [guestTheme] = useGuestUiTheme()
  return (user ? resolveUiTheme(user) : guestTheme) === 'cbat'
}

export default useCbatTheme
