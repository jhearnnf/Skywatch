// Naming the author of a message.
//
// Two names are available for any message: the LIVE one on the sender's
// account, delivered in the thread's `senders` map, and the send-time snapshot
// stored on the message itself. Display it live — someone who renames expects
// the channel to call them by the new name, on old messages as much as new
// ones, exactly as it already does for their avatar and badge.
//
// The snapshot stays as the fallback rather than being replaced: it is what
// names an author whose account has since been deleted (the cascade nulls
// senderUserId and keeps the name), and it is the only name a bot posting
// under a label has. It also remains the moderation record on the server,
// which is why the rename is not written back over the message.

/**
 * @param {string|null} userId    the message's senderUserId (or replyTo.userId)
 * @param {object}      senders   live profiles keyed by user id
 * @param {string|null} snapshot  the name captured on the message at send time
 * @returns {string|null} the name to render, or null if there is none
 */
export function senderName(userId, senders, snapshot) {
  return (userId && senders?.[String(userId)]?.displayName) || snapshot || null
}
