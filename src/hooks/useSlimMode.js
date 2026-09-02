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
// The full site always has one. Slim mode — native app and web slim alike —
// governs it with the AppSettings.slimLandingEnabled flag (on by default).
// With the flag off, `/` redirects to the CBAT game selection page and the
// header logo stops being a link, so nothing routes there.
//
// The native app used to be excluded outright. It no longer is: the page is
// reachable there via the header logo, and it earns the tap — the proof wall
// (PlayerProgressWall) renders in slim mode and has no equivalent on /cbat.
// What the app does NOT do is open on it every time; that is a separate
// question, answered by useNativeLaunchRoute.
//
// Both the route gate (App.jsx) and the header logo (TopBar.jsx) read this, so
// the page and the way in can never disagree.
export function useLandingPageEnabled() {
  const { settings } = useAppSettings() ?? {}
  const slim = SLIM_APP || Boolean(settings?.slimModeEnabled)
  if (!slim) return true
  return settings?.slimLandingEnabled !== false
}
