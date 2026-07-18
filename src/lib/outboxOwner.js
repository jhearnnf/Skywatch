// Who the offline queues currently belong to.
//
// Queued scores and start beacons used to carry no identity at all, so
// flushOutbox() posted whatever was on the device to whoever happened to be
// signed in. On a shared phone — or after any forced re-login — that quietly
// donated one person's scores to someone else's account and leaderboard.
//
// AuthContext keeps this in step with the signed-in user. It's a module-level
// value rather than a parameter threaded through submitCbatResult() because
// every CBAT game calls that helper, and none of them should have to care.

let ownerId = null

export function setOutboxOwner(id) {
  ownerId = id ? String(id) : null
}

export function getOutboxOwner() {
  return ownerId
}

// Should this queued item be sent as the current user?
//   • no owner signed in     → no, nothing can be flushed anyway
//   • item has no userId     → yes; queued before ownership existed, and it's
//                              overwhelmingly likely to be this user's own play
//   • item matches the owner → yes
//   • item belongs elsewhere → no; leave it queued so it syncs when that user
//                              next signs in on this device. Never dropped.
export function ownsQueuedItem(item, owner = ownerId) {
  if (!owner) return false
  if (!item?.userId) return true
  return String(item.userId) === String(owner)
}
