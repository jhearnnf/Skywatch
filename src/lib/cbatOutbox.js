// Offline-tolerant CBAT score submission.
//
// All CBAT games submit their final score through submitCbatResult() instead of
// calling apiFetch(.../result) directly. When online it POSTs immediately; when
// offline (or on a network failure) it queues the score in IndexedDB and
// flushOutbox() replays it on reconnect.
//
// Idempotency: every submission carries a clientResultId. The backend dedupes
// on it (see backend/utils/cbatResult.js), so a retried flush after a dropped
// response never creates a duplicate score.

import { isOnline } from './net'
import { outboxPut, outboxDelete, outboxAll, outboxCount } from './offlineStore'

function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `cri_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

const resultUrl = (API, gameKey) => `${API}/api/games/cbat/${gameKey}/result`

const postOpts = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// ── Pending-count change notifications (for the offline badge) ───────────────

const changeListeners = new Set()
function notifyChange() {
  for (const cb of changeListeners) {
    try { cb() } catch { /* ignore */ }
  }
}
export function onOutboxChange(cb) {
  changeListeners.add(cb)
  return () => changeListeners.delete(cb)
}
export function pendingCount() {
  return outboxCount()
}

// ── Submit ───────────────────────────────────────────────────────────────────

// Submit a finished CBAT game's score.
//   gameKey — the URL segment, e.g. 'target', 'act', 'plane-turn-2d', 'trace-1'
//   payload — the game-specific result body (the same object you used to POST)
//   ctx     — { apiFetch, API } from useAuth()
// Returns { synced, queued, res }.
export async function submitCbatResult(gameKey, payload, { apiFetch, API }) {
  const clientResultId = makeId()
  const playedAt = new Date().toISOString()
  const body = { ...payload, clientResultId, playedAt }
  const item = { clientResultId, gameKey, body, queuedAt: Date.now() }

  if (isOnline()) {
    try {
      const res = await apiFetch(resultUrl(API, gameKey), postOpts(body))
      if (res.ok) return { synced: true, res }
      // 401 (auth expired) or 5xx (server hiccup) → keep the score, retry later.
      if (res.status === 401 || res.status >= 500) {
        await outboxPut(item); notifyChange()
        return { queued: true, res }
      }
      // Other 4xx → the payload is bad; queueing would loop forever. Drop it.
      return { synced: false, res }
    } catch {
      await outboxPut(item); notifyChange()
      return { queued: true }
    }
  }

  await outboxPut(item); notifyChange()
  return { queued: true }
}

// ── Flush ─────────────────────────────────────────────────────────────────────

let flushing = false

// Replay every queued score. Safe to call repeatedly (mount, reconnect, after a
// successful submit). A single in-flight guard prevents overlapping drains.
export async function flushOutbox({ apiFetch, API }) {
  if (flushing || !isOnline()) return
  flushing = true
  let changed = false
  try {
    const items = await outboxAll()
    for (const item of items) {
      if (!isOnline()) break
      let res
      try {
        res = await apiFetch(resultUrl(API, item.gameKey), postOpts(item.body))
      } catch {
        break // network dropped mid-flush — stop, the rest stays queued
      }
      if (res.ok) {
        await outboxDelete(item.clientResultId); changed = true
      } else if (res.status === 401) {
        break // re-auth needed — keep the queue intact and stop
      } else if (res.status >= 400 && res.status < 500) {
        // Bad payload or already-recorded duplicate — drop so it can't loop.
        await outboxDelete(item.clientResultId); changed = true
      }
      // 5xx → leave queued for the next flush
    }
  } finally {
    flushing = false
    if (changed) notifyChange()
  }
}
