import { useAuth } from '../context/AuthContext'
import { resolveUiTheme } from '../lib/uiTheme'

// True while the signed-in account is on the Real CBAT theme. The games read
// this to switch on the test-software chrome (title bar, footer strip,
// practice items, select-then-Enter answering) without touching how they
// play under the default SkyWatch look. Reads the account field the same way
// useUiTheme does, so the two can never disagree.
export function useCbatTheme() {
  const { user } = useAuth() ?? {}
  return resolveUiTheme(user) === 'cbat'
}

export default useCbatTheme
