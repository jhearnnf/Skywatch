// Offline-tolerant CBAT game-start beacons.
//
// Mirrors the score outbox (src/lib/cbatOutbox.js): when online we POST the
// start immediately; when offline (or on a network/5xx/401 failure) we queue it
// in IndexedDB and flushStartOutbox() replays it on reconnect. Without this a
// start recorded while offline was lost forever, so a game played offline would
// later show as "finished" with no matching "started" — the 1/0 the admin saw.
//
// Idempotency: every beacon carries a clientStartId. The backend dedupes on it
// (see backend/routes/games.js + GameSessionCbatStart), so a retried flush after
// a dropped response never creates a duplicate start row.

import { isOnline } from '../../lib/net'
import { makeClientId } from '../../lib/clientId'
import { startboxPut, startboxDelete, startboxAll } from '../../lib/offlineStore'

const startUrl = (API, gameKey) => `${API}/api/games/cbat/${gameKey}/start`

const postOpts = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify(body),
})

// Record that the player began `gameKey`. Never throws — it's fire-and-forget
// from useCbatTracking, so a rejection would surface as an unhandled promise.
// Falls back to the offline queue on any failure.
export async function recordCbatStart(gameKey, apiFetch, API) {
  try {
    const clientStartId = makeClientId('csi')
    const startedAt = new Date().toISOString()
    const body = { clientStartId, startedAt }
    const item = { clientStartId, gameKey, body, queuedAt: Date.now() }

    if (isOnline()) {
      try {
        const res = await apiFetch(startUrl(API, gameKey), postOpts(body))
        if (res.ok) return
        // 401 (auth expired) or 5xx (server hiccup) → keep it, retry later.
        if (res.status === 401 || res.status >= 500) await startboxPut(item)
        // Other 4xx (game disabled, bad key) → don't queue; it would loop forever.
        return
      } catch {
        await startboxPut(item)
        return
      }
    }

    await startboxPut(item)
  } catch { /* a beacon must never break game start */ }
}

let flushing = false

// Replay every queued start. Safe to call repeatedly (mount, reconnect). A
// single in-flight guard prevents overlapping drains.
export async function flushStartOutbox({ apiFetch, API }) {
  if (flushing || !isOnline()) return
  flushing = true
  try {
    const items = await startboxAll()
    for (const item of items) {
      if (!isOnline()) break
      let res
      try {
        res = await apiFetch(startUrl(API, item.gameKey), postOpts(item.body))
      } catch {
        break // network dropped mid-flush — stop, the rest stays queued
      }
      if (res.ok) {
        await startboxDelete(item.clientStartId)
      } else if (res.status === 401) {
        break // re-auth needed — keep the queue intact and stop
      } else if (res.status >= 400 && res.status < 500) {
        // Bad payload, game disabled, or already-recorded duplicate — drop it.
        await startboxDelete(item.clientStartId)
      }
      // 5xx → leave queued for the next flush
    }
  } finally {
    flushing = false
  }
}
