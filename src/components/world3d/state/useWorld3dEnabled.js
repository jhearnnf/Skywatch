import { useAppSettings } from '../../../context/AppSettingsContext'
import { useAuth } from '../../../context/AuthContext'

export function useWorld3dEnabled() {
  const { settings } = useAppSettings() ?? {}
  const { user } = useAuth() ?? {}
  const mode = settings?.featureFlags?.world3d ?? 'off'
  if (mode === 'everyone') return !!user
  if (mode === 'admin') return !!user?.isAdmin
  return false
}
