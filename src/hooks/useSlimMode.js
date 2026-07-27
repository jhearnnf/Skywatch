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

// Whether the landing / welcome page is reachable at all.
//
// The full site always has one. Slim mode is where it's optional:
//   • native app  — never; it opens straight to /cbat, and a landing page in
//     front of that is just a tap in the way on every launch.
//   • web slim    — governed by the AppSettings.slimLandingEnabled flag (on by
//     default). With it off, `/` redirects to the CBAT game selection page and
//     the header logo stops being a link, so nothing routes there.
//
// Both the route gate (App.jsx) and the header logo (TopBar.jsx) read this, so
// the page and the way in can never disagree.
export function useLandingPageEnabled() {
  const { settings } = useAppSettings() ?? {}
  const slim = SLIM_APP || Boolean(settings?.slimModeEnabled)
  if (!slim) return true
  if (SLIM_APP) return false
  return settings?.slimLandingEnabled !== false
}
