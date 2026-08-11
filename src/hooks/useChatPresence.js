import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'

// Matches ChatShell's overview poll. Presence moves on the same timescale the
// heartbeat writes it (every 30s), so a faster poll would only re-fetch the same
// answer, and a slower one would leave the rail claiming someone is around for
// minutes after they closed the tab.
const POLL_MS = 30_000

// One shared object, so the disabled case returns a stable identity and does not
// rebuild `onlineIds` on every render of every non-admin's rail.
const EMPTY = { online: [], count: 0 }

// Who is online, for the community rail. Admin only — see GET /api/chat/presence
// for why.
//
// `enabled` is the caller's admin check rather than something read from context
// here, so a non-admin never issues the request at all: the endpoint would 403,
// and a poll that 403s twice a minute is noise in the network tab and the server
// logs both. It also means the hook is honest about doing nothing — everything
// it returns is empty, so callers can render unconditionally.
export default function useChatPresence(enabled) {
  const { API, apiFetch } = useAuth()
  const [fetched, setFetched] = useState(EMPTY)

  // Read through `enabled` rather than cleared in the effect below. Same result
  // with one fewer render, and it cannot go wrong: a viewer who stops being an
  // admin mid-session has no way to keep a stale list on screen, because the
  // list was never what was being rendered.
  const { online, count } = enabled ? fetched : EMPTY

  const load = useCallback(async () => {
    const r = await apiFetch(`${API}/api/chat/presence`, { credentials: 'include' })
    if (!r.ok) throw new Error('presence unavailable')
    const d = await r.json()
    return { online: d?.data?.online ?? [], count: d?.data?.count ?? 0 }
  }, [API, apiFetch])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const tick = () => {
      // A backgrounded tab is not watching the rail, and its own heartbeat has
      // already stopped — polling from one would be asking who is online on
      // behalf of someone who isn't.
      if (document.hidden) return
      load()
        .then(next => { if (!cancelled) setFetched(next) })
        // A failed poll keeps the last answer on screen. Presence is ambient:
        // blanking the strip on one dropped request would read as "everyone just
        // left", which is a louder claim than the failure justifies.
        .catch(() => {})
    }

    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [enabled, load])

  // Set of ids for the callers that only ask "is this one person online" —
  // the DM rows and the message avatars, both of which would otherwise scan the
  // whole list per row.
  const onlineIds = useMemo(
    () => new Set(online.map(u => String(u._id))),
    [online],
  )

  return { online, count, onlineIds, enabled: Boolean(enabled) }
}
