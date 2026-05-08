// Section -> list of pathname prefixes that should highlight that section's
// nav button. First match wins; checked in array order.
//
// Each prefix matches the pathname exactly OR the pathname starts with
// `prefix + '/'`. We don't use a bare `startsWith(prefix)` because that
// would let `/cbat-game-history` match `/cbat`, `/learn-priority` match
// `/learn`, etc.
const SECTION_PREFIXES = [
  ['/admin',           ['/admin']],
  ['/chat',            ['/chat']],
  ['/play',            ['/play', '/cbat', '/cbat-game-history', '/case-files']],
  ['/learn-priority',  ['/learn-priority', '/brief', '/quiz', '/battle-of-order',
                        '/wheres-that-aircraft', '/aptitude-sync', '/intel-brief-history']],
  ['/profile',         ['/profile', '/airstar-history', '/game-history']],
  ['/rankings',        ['/rankings']],
  ['/home',            ['/home']],
]

export function getActiveNavTo(pathname) {
  for (const [to, prefixes] of SECTION_PREFIXES) {
    for (const p of prefixes) {
      if (pathname === p || pathname.startsWith(p + '/')) return to
    }
  }
  return null
}
