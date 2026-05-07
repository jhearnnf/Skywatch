import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import CbatGameDisabled from './CbatGameDisabled'

export default function CbatGameGuard({ gameKey, gameTitle, children }) {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  if (user?.isAdmin) return children
  if (!settings) return null
  const enabled = settings.cbatGameEnabled?.[gameKey] !== false
  return enabled ? children : <CbatGameDisabled gameTitle={gameTitle} />
}
