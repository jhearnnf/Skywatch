// Reports "I couldn't reach the API" back to the server — necessarily late.
//
// A client with no route to the API cannot tell the API about it. So we record
// the outage locally and post it on the next successful, authenticated request.
// The report therefore always describes a window that has already closed, and
// only ever arrives from users who came back at all. Anyone who concludes the
// app is broken and never returns stays invisible, which is exactly how the
// original breakage went unnoticed for five weeks — the server-side
// cors_origin_rejected log exists to cover that gap in real time.

import { cacheGet, cacheSet, outboxCount } from './offlineStore'
import { getApiHealth } from './apiHealth'

const PENDING_KEY = 'pending_unreachable_report'

// Don't report trivial blips — a couple of failed requests in a tunnel isn't
// worth a log row. Two minutes of sustained failure is.
const MIN_REPORTABLE_MS = 2 * 60 * 1000

// Remember an ongoing outage so it survives a reload or the app being killed.
// Called while the API is unreachable, so it can only write locally.
export async function stashUnreachable() {
  try {
    const { failingSince, failingForMs, lastError } = getApiHealth()
    if (!failingSince || failingForMs < MIN_REPORTABLE_MS) return
    const existing = await cacheGet(PENDING_KEY)
    await cacheSet(PENDING_KEY, {
      origin: typeof location !== 'undefined' ? location.origin : '',
      // Keep the earliest start we've seen — reloads shouldn't reset the clock.
      failingSince: existing?.failingSince ?? failingSince,
      failingForMs,
      lastError,
    })
  } catch { /* diagnostics must never break the app */ }
}

// Post any stashed outage. Safe to call on every successful sign-in; a no-op
// when there's nothing to report.
export async function reportApiUnreachable({ apiFetch, API }) {
  try {
    const pending = await cacheGet(PENDING_KEY)
    if (!pending) return
    const queuedCount = await outboxCount().catch(() => 0)
    const res = await apiFetch(`${API}/api/users/diagnostics/unreachable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin:       pending.origin,
        failingForMs: Math.max(pending.failingForMs ?? 0, Date.now() - (pending.failingSince ?? Date.now())),
        queuedCount,
        lastError:    pending.lastError,
      }),
    })
    // Only clear once it's actually landed, so a failed report isn't lost.
    if (res.ok) await cacheSet(PENDING_KEY, null)
  } catch { /* still unreachable — try again next time */ }
}
