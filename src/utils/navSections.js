// Section -> list of pathname prefixes that should highlight that section's
// nav button. First match wins; checked in array order.
//
// Each prefix matches the pathname exactly OR the pathname starts with
// `prefix + '/'`. We don't use a bare `startsWith(prefix)` because that
// would let `/cbat-game-history` match `/cbat`, `/learn-priority` match
// `/learn`, etc.
const SECTION_PREFIXES = [
  ['/admin',           ['/admin']],
  ['/clipper',         ['/clipper']],
  ['/chat',            ['/chat']],
  ['/immerse',         ['/immerse']],
  ['/play',            ['/play', '/cbat', '/cbat-game-history', '/case-files']],
  ['/learn-priority',  ['/learn-priority', '/brief', '/quiz', '/battle-of-order',
                        '/wheres-that-aircraft', '/aptitude-sync', '/intel-brief-history']],
  ['/profile',         ['/profile', '/airstar-history', '/game-history']],
  ['/rankings',        ['/rankings']],
  ['/home',            ['/home']],
]

// Page-transition identity, used as the AnimatePresence key in App.jsx.
//
// Two URLs that share a key are treated as the SAME page: React keeps the
// subtree mounted, there is no exit/enter animation, and component state and
// in-flight data survive the navigation.
//
// Chat is why this exists. Its URL carries which conversation is open
// (/chat/:conversationId), so keying on the raw pathname tore the entire
// two-pane layout down and refetched everything on every channel click — it
// read as a full page reload. Everything else still keys on the pathname, so
// ordinary page-to-page transitions are unchanged.
//
// Note /chat/admin shares this key but renders a different component, so it
// still swaps cleanly — the key controls the animation, not the routing.
const SAME_PAGE_PREFIXES = ['/chat']

export function transitionKeyFor(pathname) {
  const prefix = SAME_PAGE_PREFIXES.find(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
  return prefix ?? pathname
}

export function getActiveNavTo(pathname) {
  for (const [to, prefixes] of SECTION_PREFIXES) {
    for (const p of prefixes) {
      if (pathname === p || pathname.startsWith(p + '/')) return to
    }
  }
  return null
}
