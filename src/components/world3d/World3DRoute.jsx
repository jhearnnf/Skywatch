import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { captureLoginReturn } from '../../utils/loginRedirect'
import { useSlimMode } from '../../hooks/useSlimMode'
import { useWorld3dEnabled } from './state/useWorld3dEnabled'
import World3D from './World3D'

export default function World3DRoute() {
  const { user, loading: authLoading } = useAuth() ?? {}
  const { loading: settingsLoading } = useAppSettings() ?? {}
  const enabled = useWorld3dEnabled()
  const slim = useSlimMode()
  const location = useLocation()

  if (authLoading || settingsLoading) {
    return <div style={{ minHeight: '100dvh', background: '#06101e' }} />
  }

  if (!user) {
    captureLoginReturn(location)
    return <Navigate to="/login" replace />
  }

  // Bounce to whichever home the current mode actually has. `/immerse` is
  // allow-listed in slim mode (see appMode.js), so a slim client can reach this
  // component with the game off — sending it to /home would only bounce again.
  if (!enabled) return <Navigate to={slim ? '/cbat' : '/home'} replace />

  return <World3D />
}
