import { SLIM_APP } from '../utils/appMode'
import { useAppSettings } from '../context/AppSettingsContext'
import { useAuth } from '../context/AuthContext'

// Effective slim ("CBAT-only") mode for the current client.
//
// - The native Android app is ALWAYS slim (SLIM_APP, evaluated synchronously
//   at module load — no flicker).
// - On the web it can additionally be turned on site-wide by an admin via the
//   AppSettings.slimModeEnabled feature flag (off by default).
//
// Admins are deliberately exempt from the settings-driven slim so that enabling
// it can never lock an admin out of /admin (which the slim router guard would
// otherwise redirect to /cbat). The native flag still applies to everyone.
export function useSlimMode() {
  const { settings } = useAppSettings() ?? {}
  const { user } = useAuth() ?? {}
  return SLIM_APP || (Boolean(settings?.slimModeEnabled) && !user?.isAdmin)
}
