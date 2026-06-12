import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { captureLoginReturn } from '../../utils/loginRedirect'
import { useWorld3dEnabled } from './state/useWorld3dEnabled'
import World3D from './World3D'

export default function World3DRoute() {
  const { user, loading: authLoading } = useAuth() ?? {}
  const { loading: settingsLoading } = useAppSettings() ?? {}
  const enabled = useWorld3dEnabled()
  const location = useLocation()

  if (authLoading || settingsLoading) {
    return <div style={{ minHeight: '100dvh', background: '#06101e' }} />
  }

  if (!user) {
    captureLoginReturn(location)
    return <Navigate to="/login" replace />
  }

  if (!enabled) return <Navigate to="/home" replace />

  return <World3D />
}
