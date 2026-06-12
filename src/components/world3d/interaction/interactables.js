// Module-scope interactable registry. Each entry exposes a world position,
// activation range, label, and an onActivate handler. The character controller
// scans the registry every frame to find the closest in-range entry and pushes
// that ID into a tiny pub-sub so the HUD prompt can subscribe via
// useSyncExternalStore.

const entries = new Map()
let closestId = null
const listeners = new Set()

export function registerInteractable(id, entry) {
  entries.set(id, entry)
}

export function unregisterInteractable(id) {
  entries.delete(id)
  if (closestId === id) setClosest(null)
}

export function getEntries() {
  return entries
}

export function getEntry(id) {
  return entries.get(id) ?? null
}

export function getClosestId() {
  return closestId
}

export function getClosestEntry() {
  return closestId ? entries.get(closestId) ?? null : null
}

function setClosest(id) {
  if (id === closestId) return
  closestId = id
  for (const fn of listeners) fn()
}

export function subscribeClosest(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function scanClosest(pos) {
  let bestId = null
  let bestDist = Infinity
  for (const [id, e] of entries) {
    if (e.disabled) continue
    const dx = e.x - pos.x
    const dz = e.z - pos.z
    const d2 = dx * dx + dz * dz
    if (d2 > e.range * e.range) continue
    if (d2 < bestDist) {
      bestDist = d2
      bestId = id
    }
  }
  setClosest(bestId)
}

export function activateClosest() {
  const e = getClosestEntry()
  if (e?.onActivate) e.onActivate()
}

export function _reset() {
  entries.clear()
  setClosest(null)
}
