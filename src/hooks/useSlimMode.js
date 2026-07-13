import { SLIM_APP } from '../utils/appMode'
import { useAppSettings } from '../context/AppSettingsContext'

// Effective slim ("CBAT-only") mode for the current client.
//
// - The native Android app is ALWAYS slim (SLIM_APP, evaluated synchronously
//   at module load — no flicker).
// - On the web it can additionally be turned on site-wide by an admin via the
//   AppSettings.slimModeEnabled feature flag (off by default).
//
// Admins are NOT exempt — they see the slimmed site too, so they can preview
// it. To avoid a lockout, `/admin` stays in the slim route allow-list and the
// Admin nav link stays visible in slim mode, so an admin can always reach
// Settings to turn the flag back off.
export function useSlimMode() {
  const { settings } = useAppSettings() ?? {}
  return SLIM_APP || Boolean(settings?.slimModeEnabled)
}
