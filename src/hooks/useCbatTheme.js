import { useAuth } from '../context/AuthContext'
import { resolveUiTheme } from '../lib/uiTheme'
import { useGuestUiTheme } from './useGuestUiTheme'
import { useActiveMock } from '../lib/cbatMockSession'

// True while the current user or guest is on the Real CBAT theme. The games read
// this to switch on the test-software chrome (title bar, footer strip,
// practice items, select-then-Enter answering) without touching how they
// play under the default SkyWatch look. Reads the account field the same way
// useUiTheme does, so the two can never disagree.
// A Mock Assessment in progress forces it on, exactly as useUiTheme does.
export function useCbatTheme() {
  const { user } = useAuth() ?? {}
  const [guestTheme] = useGuestUiTheme()
  const inMock = useActiveMock() != null
  return inMock || (user ? resolveUiTheme(user) : guestTheme) === 'cbat'
}

export default useCbatTheme
