'use strict';

/**
 * Server-sent events for chat.
 *
 * The rest of the app polls: the thread every 5s, the rail every 30s. That is
 * fine for a page you went to on purpose, and wrong for the lounge on the CBAT
 * hub, which is meant to feel like people are in the room with you. So the
 * lounge holds one long-lived connection and the server pushes.
 *
 * ── Why SSE and not websockets ──────────────────────────────────────────────
 *
 * Everything here is one-directional: the server pushes messages, the client
 * still SENDS them over the ordinary POST. That is exactly the shape SSE has,
 * and it costs no dependency, no handshake auth of its own (the cookie rides
 * the normal request), and no reconnect logic (EventSource reconnects itself).
 *
 * ── In-process, like the rate limiters ──────────────────────────────────────
 *
 * The subscriber map lives in this process. On a single-instance backend that
 * is the whole picture; if this is ever scaled horizontally a user on instance
 * A would stop seeing messages posted through instance B, and this map would
 * need a Redis pub/sub behind it. The same caveat the send rate limiter and the
 * bot budget carry, in the same place.
 *
 * Callers never touch the map directly — publish() is called from
 * appendMessage(), so every path that writes a message (a user, the guide bot,
 * the medal feed) pushes without having to remember to.
 */

// conversationId -> Set<client>
const channels = new Map();

// Ceilings. A dead browser tab can leave a socket open until TCP notices, so
// these are about a slow leak rather than an attack: without them a user who
// leaves twenty tabs open holds twenty connections for as long as the process
// lives.
const MAX_PER_USER   = 4;
const MAX_TOTAL      = 400;

let total = 0;

/**
 * Register a listener on one conversation.
 *
 * @param {string|ObjectId} conversationId
 * @param {Object} client
 * @param {string} client.userId  whose connection this is, for the per-user cap
 * @param {Function} client.send  (event, data) => void
 * @param {Function} client.close called when this connection is evicted
 * @returns {Function|null} unsubscribe, or null when the connection was refused
 */
function subscribe(conversationId, client) {
  if (total >= MAX_TOTAL) return null;

  const key = String(conversationId);
  if (!channels.has(key)) channels.set(key, new Set());
  const set = channels.get(key);

  // Oldest first: a Set iterates in insertion order, so the connection evicted
  // is the tab you opened first and are least likely to be looking at.
  const mine = [...set].filter(c => String(c.userId) === String(client.userId));
  while (mine.length >= MAX_PER_USER) {
    const oldest = mine.shift();
    set.delete(oldest);
    total -= 1;
    try { oldest.close(); } catch { /* already gone */ }
  }

  set.add(client);
  total += 1;

  return function unsubscribe() {
    const live = channels.get(key);
    if (!live || !live.has(client)) return;
    live.delete(client);
    total -= 1;
    if (!live.size) channels.delete(key);
  };
}

/**
 * Push an event to everyone listening to one conversation. Never throws: a
 * broken socket must not take down the request that wrote the message.
 */
function publish(conversationId, event, data) {
  const set = channels.get(String(conversationId));
  if (!set || !set.size) return 0;

  let delivered = 0;
  for (const client of [...set]) {
    try {
      client.send(event, data);
      delivered += 1;
    } catch {
      // A socket that cannot be written to is gone. Drop it here rather than
      // waiting for its 'close' handler, which may never fire.
      set.delete(client);
      total -= 1;
    }
  }
  if (!set.size) channels.delete(String(conversationId));
  return delivered;
}

const subscriberCount = (conversationId) =>
  channels.get(String(conversationId))?.size ?? 0;

const connectionCount = () => total;

// Tests only: a module-level map outlives a test file's cases.
function _reset() {
  channels.clear();
  total = 0;
}

module.exports = {
  subscribe,
  publish,
  subscriberCount,
  connectionCount,
  MAX_PER_USER,
  MAX_TOTAL,
  _reset,
};
