// Where the in-app chat notification banner may appear.
//
// A HARD RULE, the same one OfflineStatus follows: nothing transient may draw
// over a CBAT game. They are timed, reaction-scored tasks, and a banner over
// the play area spoils the run. So this is an ALLOWLIST: hidden by default,
// shown only on the screens named here, so a newly added game route can never
// start getting banners by accident. `immersive` (the app's own mid-play
// flag) vetoes everything regardless.
//
// Off-list screens do not lose the notification: the banner waits and shows
// on the next allowed screen.

const ALLOWED_EXACT = new Set([
  '/',
  '/home',
  '/cbat',
  '/cbat/report',
  '/cbat-game-history',
  '/chat',
  '/profile',
  '/profile/badge',
  '/rankings',
  '/play',
  '/learn-priority',
  '/case-files',
  '/game-history',
  '/airstar-history',
  '/intel-brief-history',
  '/subscribe',
  '/donate',
  '/admin',
])

const ALLOWED_PATTERNS = [
  /^\/chat\/[^/]+$/,               // another conversation (the same one is filtered separately)
  /^\/agent\/[^/]+$/,              // a player's profile
  /^\/cbat\/[^/]+\/leaderboard$/,  // a game's board, not the game
  /^\/brief\/[^/]+$/,              // reading a brief, not a timed task
]

export function canShowInAppNotice(pathname, { immersive } = {}) {
  if (immersive) return false
  if (ALLOWED_EXACT.has(pathname)) return true
  return ALLOWED_PATTERNS.some(re => re.test(pathname))
}

// The notification is about the page they are already on: say nothing.
export function isAlreadyLookingAt(pathname, url) {
  return typeof url === 'string' && pathname === url
}

// ── The queue of held banners ──

const MAX_HELD = 20

// The lounge has its own new-message dot on the CBAT pages.
function isLoungeHere(item, pathname) {
  return item.kind === 'lounge' && pathname.startsWith('/cbat')
}

export function dropSeen(queue, pathname) {
  return queue.filter(item => !isAlreadyLookingAt(pathname, item.url) && !isLoungeHere(item, pathname))
}

// A newer message in the same chat replaces the older one in the queue.
export function enqueue(queue, item) {
  const rest = item.tag ? queue.filter(q => q.tag !== item.tag) : queue
  return [...rest, item].slice(-MAX_HELD)
}
