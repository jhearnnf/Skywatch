// Thin IndexedDB layer for offline CBAT support, built on idb-keyval.
//
// Two logical stores in one database:
//   • outbox — queued score submissions awaiting sync (key = clientResultId)
//   • cache  — durable snapshots that survive reloads (aircraft roster,
//              entitlement). localStorage would also work for the cache, but
//              keeping everything in IndexedDB avoids a second code path and
//              handles larger payloads.
//
// Every call is wrapped so a storage failure (private mode, quota, no IDB)
// degrades to a no-op rather than throwing into game/UI code.

import { get, set, del, keys, createStore } from 'idb-keyval'

const outboxStore = createStore('skywatch-offline', 'outbox')
const cacheStore  = createStore('skywatch-offline', 'cache')

// ── Outbox ──────────────────────────────────────────────────────────────────

export async function outboxPut(item) {
  try { await set(item.clientResultId, item, outboxStore) } catch { /* ignore */ }
}

export async function outboxAll() {
  try {
    const ids = await keys(outboxStore)
    const items = await Promise.all(ids.map((id) => get(id, outboxStore)))
    return items
      .filter(Boolean)
      .sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0)) // oldest first
  } catch {
    return []
  }
}

export async function outboxDelete(clientResultId) {
  try { await del(clientResultId, outboxStore) } catch { /* ignore */ }
}

export async function outboxCount() {
  try { return (await keys(outboxStore)).length } catch { return 0 }
}

// ── Cache ───────────────────────────────────────────────────────────────────

export async function cacheGet(key) {
  try { return (await get(key, cacheStore)) ?? null } catch { return null }
}

export async function cacheSet(key, value) {
  try { await set(key, value, cacheStore) } catch { /* ignore */ }
}
