// Hands out remount slots to the live game wall, one at a time.
//
// Each card recycles its game every ~26s. Left to their own timers the nine
// cards drift into each other, and two games mounting in the same frame is a
// visible lurch: a full page mount, plus (for ACT) ~10ms of TubeGeometry for
// that round's tunnel. The perf sweep caught one 115ms frame this way.
//
// So remounts queue: at most one per RECYCLE_GAP_MS, and each waits for an idle
// moment before it fires. A card that unmounts while queued drops out.

export const RECYCLE_GAP_MS = 700

// Slots are handed out from module scope because the whole point is to
// coordinate cards that know nothing about each other.
let lastGrantAt = 0

const idle = (cb) => (
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(cb, { timeout: 400 })
    : setTimeout(cb, 0)
)
const cancelIdle = (handle) => {
  if (handle == null) return
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
  else clearTimeout(handle)
}

/**
 * Ask for the next free remount slot.
 *
 * @param {Function} run   called once the slot opens
 * @returns {Function} cancel — safe to call after the slot has already fired
 */
export function requestRemountSlot(run) {
  const now = Date.now()
  const grantAt = Math.max(now, lastGrantAt + RECYCLE_GAP_MS)
  lastGrantAt = grantAt

  let idleHandle = null
  let cancelled = false
  const timer = setTimeout(() => {
    if (cancelled) return
    idleHandle = idle(() => { if (!cancelled) run() })
  }, grantAt - now)

  return () => {
    cancelled = true
    clearTimeout(timer)
    cancelIdle(idleHandle)
  }
}

// Test seam — the module-level cursor would otherwise leak between suites.
export function __resetRemountScheduler() {
  lastGrantAt = 0
}
