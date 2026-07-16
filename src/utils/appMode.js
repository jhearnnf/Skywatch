import { Capacitor } from '@capacitor/core'

// ── Slim "CBAT-only" app mode ────────────────────────────────────────────────
// The native Android app ships a deliberately slimmed-down experience: just
// login/register, profile and the CBAT games. Web/desktop always runs the full
// app. Everything is gated off this single flag so re-enabling the full app in
// future is a one-line change (or removing the flag entirely).
//
// Wrapped in try/catch so it can't throw during SSR/tests where the Capacitor
// web bridge may be absent — it simply resolves to false (full app) there.
export const SLIM_APP = (() => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
})()

// Path prefixes reachable in slim mode. Anything else redirects to /cbat.
// A prefix matches the pathname exactly OR when the pathname starts with
// `prefix + '/'` — so '/cbat' covers every game and leaderboard, '/profile'
// covers '/profile/badge', etc. We deliberately do NOT use a bare startsWith,
// so '/cbat-game-history' does not get swallowed by the '/cbat' prefix (it is
// allow-listed separately below).
const SLIM_ALLOWED_PREFIXES = [
  '/',                   // slimmed CBAT-focused landing page (Landing.jsx)
  '/login',              // register + sign in
  '/cbat',               // games home + all games + leaderboards
  '/profile',            // profile + badge picker
  '/cbat-game-history',  // CBAT score history
  '/airstar-history',    // airstars earned in CBAT
  '/report',             // "report a problem" (linked from CBAT + profile)
  '/share',              // "share SkyWatch" QR-code page (linked from profile Help)
  '/privacy',            // store-compliance page
  '/delete-account',     // store-compliance page — the URL declared to Google Play
  '/admin',              // admins can still reach Settings to toggle slim off
]

export function isSlimAllowed(pathname) {
  return SLIM_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}

// Nav items shown in slim mode (both Sidebar and BottomNav).
export const SLIM_NAV_ITEMS = [
  { to: '/cbat',    emoji: '🎮', label: 'CBAT'    },
  { to: '/profile', emoji: '👤', label: 'Profile' },
]

// Which slim nav item should be highlighted for a given pathname.
export function slimNavActiveTo(pathname) {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return '/admin'
  }
  if (
    pathname === '/profile' || pathname.startsWith('/profile/') ||
    pathname === '/airstar-history' || pathname === '/game-history'
  ) {
    return '/profile'
  }
  return '/cbat'
}
