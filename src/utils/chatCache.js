// Last-known Community state, kept for the life of the page.
//
// Opening Community used to mean two blank "Loading…" panes in series: the rail
// fetched on mount, then the thread fetched again once you clicked a channel,
// and neither had anything to show until its request came back. Nothing here is
// secret from the viewer who just fetched it, and every pane already reconciles
// itself on a poll, so the panes now render the last copy immediately and let
// the in-flight request overwrite it.
//
// Deliberately in memory rather than sessionStorage: this is a render head
// start, not persistence. A reload should genuinely re-read the server, and
// chat state written to disk would outlive the session that was allowed to see
// it.

// Enough to cover flicking between the channels in the rail without letting a
// long session accumulate every DM it ever opened.
const MAX_THREADS = 10

let ownerId  = null
let overview = null
let inFlight = null
const threads = new Map()

export function clearChatCache() {
  overview = null
  inFlight = null
  threads.clear()
}

// Drop everything if the viewer changed. Called from every entry point rather
// than hooked to logout, so there is no path — a second account on the same
// tab, a session swap — that can read a rail belonging to somebody else.
export function syncChatCacheOwner(userId) {
  const next = userId ? String(userId) : null
  if (next === ownerId) return
  ownerId = next
  clearChatCache()
}

export function getCachedOverview() {
  return overview
}

export function getCachedThread(conversationId) {
  return threads.get(String(conversationId)) ?? null
}

// Re-inserted rather than overwritten so the Map stays in recency order and the
// oldest entry is the one evicted.
export function setCachedThread(conversationId, entry) {
  const key = String(conversationId)
  threads.delete(key)
  threads.set(key, entry)
  while (threads.size > MAX_THREADS) {
    threads.delete(threads.keys().next().value)
  }
}

// The rail's one request. Lives here rather than in ChatShell so the prefetch
// below and the shell itself cannot drift into fetching different things.
export async function fetchOverview(API, apiFetch) {
  const r = await apiFetch(`${API}/api/chat/overview`, { credentials: 'include' })
  const d = await r.json().catch(() => null)
  if (!r.ok) throw new Error(d?.message || 'Could not load chat')
  overview = d?.data ?? null
  return overview
}

// Warm the rail before the user gets there, on intent — hovering or touching
// the Community nav entry — rather than on app boot. Most visits never open
// Community at all, and firing this for every one of them would cost the
// backend far more than it saves the few people who do.
//
// Silent by design: nothing is rendering this yet, so a failure just leaves the
// shell to fetch normally and show its own error.
export function prefetchOverview(API, apiFetch, userId) {
  syncChatCacheOwner(userId)
  if (overview || inFlight) return
  inFlight = fetchOverview(API, apiFetch)
    .catch(() => null)
    .finally(() => { inFlight = null })
}
