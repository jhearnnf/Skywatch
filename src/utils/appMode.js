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

// There used to be a NATIVE_APP export here — the same value as SLIM_APP, kept
// separate because it answered a different question ("are we in a
// store-distributed binary?") and gated Community off the app, where
// user-to-user messaging was a store-policy problem. Community now ships on
// native too: the Play declarations cover it and users can block each other
// (User.blockedUserIds). Nothing gates on the platform any more, so the export
// went with the gates rather than sitting here unused.

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
  '/donate',             // support page — see note below
  '/share',              // "share SkyWatch" QR-code page (linked from profile Help)
  '/privacy',            // store-compliance page
  '/delete-account',     // store-compliance page — the URL declared to Google Play
  '/admin',              // admins can still reach Settings to toggle slim off
  '/clipper',            // admin-only video tool — reachable for the same reason as /admin
  '/immerse',            // Hangar game — see note below
  '/chat',               // channels + DMs — see note below
  '/survey',             // emailed CBAT outcome questionnaire — see note below
]

// Note on '/survey': the questionnaire arrives by emailed link and identifies
// the respondent by token rather than by session, so it has to answer for a
// signed-out visitor on a device they have never used. Allow-listing it means
// turning slim mode on site-wide cannot silently redirect a live campaign's
// links to /cbat, which would look to the recipient like a broken email.

// Note on '/donate': the path is allow-listed so the WEBSITE keeps its donation
// page when an admin turns slim mode on site-wide, which is just a trimmed site
// and carries no store exposure. The native app is a different question — Play
// treats donations outside Play Billing as a carve-out for registered charities
// — so nothing in the app links here and the page itself refuses to render
// under SLIM_APP. Gating the route instead would have taken the page away from
// web slim too, which is not what the risk is about.

// Note on '/chat': slim mode keeps chat, on every platform. The only thing that
// takes Community away now is the chatEnabled feature flag, which the nav
// entries and the route read for themselves.

// Note on '/immerse': the Hangar is the one non-CBAT game slim mode keeps, by
// design — enabling it in Admin → Game Options is meant to surface it even on
// the native app. This list is a pure function of the pathname with no access
// to AppSettings, so the path is allow-listed unconditionally and the
// hangarGameEnabled check happens in World3DRoute, which redirects to /cbat
// when the game is off. Route-level gating stays in one place that way.

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

// Place a nav item immediately before Profile, which is the last item in both
// the full and slim lists. Community sits there rather than being appended, so
// Profile stays the end of the row — it is the "you" item and reads as the
// natural last stop in both navs.
export function insertBeforeProfile(items, item) {
  const i = items.findIndex(x => x.to === '/profile')
  if (i === -1) return [...items, item]
  return [...items.slice(0, i), item, ...items.slice(i)]
}

// Hangar game nav entry. Appended by Sidebar/BottomNav in BOTH slim and full
// mode when AppSettings.hangarGameEnabled is on — it is not part of either base
// list because its visibility is settings-driven, not mode-driven.
export const HANGAR_NAV_ITEM = { to: '/immerse', emoji: '🛩️', label: 'Hangar' }

// Which slim nav item should be highlighted for a given pathname.
export function slimNavActiveTo(pathname) {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return '/admin'
  }
  if (pathname === '/clipper' || pathname.startsWith('/clipper/')) {
    return '/clipper'
  }
  if (pathname === '/immerse' || pathname.startsWith('/immerse/')) {
    return '/immerse'
  }
  if (pathname === '/chat' || pathname.startsWith('/chat/')) {
    return '/chat'
  }
  if (
    pathname === '/profile' || pathname.startsWith('/profile/') ||
    pathname === '/airstar-history' || pathname === '/game-history'
  ) {
    return '/profile'
  }
  return '/cbat'
}
