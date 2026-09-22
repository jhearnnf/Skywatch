import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { isCbatGameEnabled } from '../utils/cbat/isCbatGameEnabled'
import CbatGameDisabled from './CbatGameDisabled'
import CbatGameReportLink from './CbatGameReportLink'

// Every game route is wrapped in this, which makes it the one place a piece of
// chrome common to all the games can live — the report link rides along with
// the game whenever the game itself renders.
export default function CbatGameGuard({ gameKey, gameTitle, children }) {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  const withChrome = <>{children}<CbatGameReportLink /></>
  if (user?.isAdmin) return withChrome
  if (!settings) return null
  const enabled = isCbatGameEnabled(settings.cbatGameEnabled, gameKey)
  return enabled ? withChrome : <CbatGameDisabled gameTitle={gameTitle} />
}
