import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { isCbatGameEnabled } from '../utils/cbat/isCbatGameEnabled'
import CbatGameDisabled from './CbatGameDisabled'

export default function CbatGameGuard({ gameKey, gameTitle, children }) {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  if (user?.isAdmin) return children
  if (!settings) return null
  const enabled = isCbatGameEnabled(settings.cbatGameEnabled, gameKey)
  return enabled ? children : <CbatGameDisabled gameTitle={gameTitle} />
}
