// Chat messages on their way to the server.
//
// Pressing Send puts the message in the thread at once, the way Discord does,
// and hands it to this queue. The queue lives at module scope, not in the
// component that sent it, so leaving the page does not abandon the send: the
// POST carries on, and a failed one is tried again, until the server has it.
// Coming back to the thread shows anything still going (see `pendingFor`) and
// holds anything that has just landed (see `recentlySentFor`), so the message
// never blinks out while a refetch catches up.
//
// Retrying a POST is only safe because each message carries a `clientId` the
// server dedupes on (see the POST route in backend/routes/chat.js): a send that
// reached the server but whose answer was lost comes back as the same message,
// not a second copy.
//
// Held in memory only. It survives moving around the app, which is what it is
// for; closing the app drops anything still queued.

import { isOnline, onNetworkChange } from './net'
import { getOutboxOwner } from './outboxOwner'

// Backoff between attempts. The last step repeats.
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000]
// How long to keep trying before marking a message "Not sent" and handing it
// back to the person (Try again / Delete). Long enough to ride out a tunnel or
// a backend restart; short enough that a message never quietly lands an hour
// after the conversation has moved on.
export const GIVE_UP_AFTER_MS = 2 * 60_000
// How long a delivered message is remembered, for a thread re-opened before a
// refetch has caught up with it. Matches the threads' own hold.
export const RECENT_MS = 30_000
// One attempt that has not answered in this long is treated as lost and tried
// again. A hung request must not hold up every message queued behind it, and
// if it did land after all, the server's dedupe makes the retry harmless.
export const ATTEMPT_TIMEOUT_MS = 20_000

// conversationId -> queued items, oldest first.
const queues = new Map()
// conversationId -> [{ clientId, message, at }]
const recent = new Map()
// conversationIds with a send loop running.
const running = new Set()
const listeners = new Set()
// Bumped by clearAll, so a send loop still waiting on a request from before it
// stops rather than carrying on with a queue that has been emptied.
let generation = 0

let seq = 0
export function newClientId() {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  return `c${rand}${(++seq).toString(36)}`
}

function emit(event) {
  for (const fn of listeners) {
    try { fn(event) } catch { /* one listener must never break the others */ }
  }
}

// Subscribe to what happens to queued messages. Events:
//   { type: 'state',  conversationId, clientId, state: 'sending' | 'failed', error }
//   { type: 'sent',   conversationId, clientId, message, botReplyingName }
//   { type: 'gone',   conversationId, clientId, code, error }  — refused for
//     good and taken out of the thread (e.g. a display name is needed first)
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const queueFor = (id) => {
  const key = String(id)
  if (!queues.has(key)) queues.set(key, [])
  return queues.get(key)
}

const removeItem = (item) => {
  const q = queues.get(item.conversationId)
  if (!q) return
  const i = q.indexOf(item)
  if (i >= 0) q.splice(i, 1)
  if (!q.length) queues.delete(item.conversationId)
}

const findItem = (clientId) => {
  for (const q of queues.values()) {
    const item = q.find(i => i.clientId === clientId)
    if (item) return item
  }
  return null
}

// The local copies of everything still queued for this conversation, for a
// thread mounting while they are on their way.
export function pendingFor(conversationId) {
  const owner = getOutboxOwner()
  return (queues.get(String(conversationId)) ?? [])
    .filter(i => !owner || i.userId === owner)
    .map(i => ({ ...i.local, localState: i.state }))
}

// Messages delivered in the last RECENT_MS, as the server returned them.
export function recentlySentFor(conversationId) {
  const now = Date.now()
  const list = (recent.get(String(conversationId)) ?? []).filter(r => now - r.at <= RECENT_MS)
  if (list.length) recent.set(String(conversationId), list)
  else recent.delete(String(conversationId))
  return list.map(r => r.message)
}

// Queue a message. `local` is the copy the thread shows meanwhile (its `_id`
// and `clientId` are both the clientId); `post(body)` performs one attempt
// and resolves to the fetch Response. Returns the local copy.
export function enqueue({ conversationId, userId, body, replyToId = null, local, post }) {
  const clientId = local?.clientId ?? newClientId()
  const item = {
    clientId,
    conversationId: String(conversationId),
    userId: userId ? String(userId) : null,
    body,
    replyToId,
    local: { ...local, _id: clientId, clientId },
    post,
    state: 'sending',
    firstTriedAt: null,
    attempt: 0,
  }
  queueFor(conversationId).push(item)
  run(item.conversationId)
  return { ...item.local, localState: 'sending' }
}

export function retry(clientId) {
  const item = findItem(clientId)
  if (!item || item.state !== 'failed') return
  item.state = 'sending'
  item.firstTriedAt = null
  item.attempt = 0
  emit({ type: 'state', conversationId: item.conversationId, clientId, state: 'sending' })
  run(item.conversationId)
}

export function discard(clientId) {
  const item = findItem(clientId)
  if (item) removeItem(item)
}

// For sign-out, and for tests.
export function clearAll() {
  generation += 1
  queues.clear()
  recent.clear()
  running.clear()
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Resolves when the network is back, or after `ms`, whichever comes first.
function waitForNetwork(ms) {
  return new Promise(resolve => {
    let off = () => {}
    const t = setTimeout(() => { off(); resolve() }, ms)
    off = onNetworkChange((online) => {
      if (!online) return
      clearTimeout(t); off(); resolve()
    })
  })
}

// Worth another go: no answer at all, or the server saying "not right now".
const retryable = (status) => status === 0 || status === 408 || status === 429 || status >= 500

// Sends one conversation's queue in order, one message at a time, so two quick
// messages cannot land the wrong way round.
async function run(conversationId) {
  if (running.has(conversationId)) return
  running.add(conversationId)
  const gen = generation
  try {
    for (;;) {
      if (gen !== generation) return
      const q = queues.get(conversationId)
      const item = q?.find(i => i.state === 'sending')
      if (!item) return
      // Signed out, or someone else signed in on this device: their message
      // must not go out under the new account.
      const owner = getOutboxOwner()
      if (item.userId && owner && owner !== item.userId) {
        removeItem(item)
        emit({ type: 'gone', conversationId, clientId: item.clientId })
        continue
      }
      await attempt(item)
    }
  } finally {
    if (gen === generation) running.delete(conversationId)
  }
}

async function attempt(item) {
  const { conversationId, clientId } = item
  if (item.firstTriedAt == null) item.firstTriedAt = Date.now()

  if (!isOnline()) {
    if (Date.now() - item.firstTriedAt >= GIVE_UP_AFTER_MS) return fail(item, 'You are offline.')
    await waitForNetwork(RETRY_DELAYS_MS.at(-1))
    return
  }

  let status
  let data = null
  try {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ATTEMPT_TIMEOUT_MS)
    })
    const r = await Promise.race([
      item.post({ body: item.body, replyToId: item.replyToId, clientId }),
      timeout,
    ]).finally(() => clearTimeout(timer))
    status = r.status
    data = await r.json().catch(() => null)
    if (r.ok && data?.data?.message) {
      removeItem(item)
      const message = data.data.message
      const list = recent.get(conversationId) ?? []
      list.push({ clientId, message, at: Date.now() })
      recent.set(conversationId, list)
      emit({ type: 'sent', conversationId, clientId, message, botReplyingName: data.data.botReplyingName ?? null })
      return
    }
    if (r.ok) status = 500 // an answer with no message in it: try again
  } catch {
    status = 0
  }

  // Discarded while the request was out.
  if (!findItem(clientId)) return

  if (!retryable(status)) {
    if (data?.code === 'DISPLAY_NAME_REQUIRED') {
      removeItem(item)
      emit({ type: 'gone', conversationId, clientId, code: data.code })
      return
    }
    return fail(item, data?.message || 'Could not send that')
  }

  if (Date.now() - item.firstTriedAt >= GIVE_UP_AFTER_MS) {
    return fail(item, data?.message || 'Could not send that')
  }
  const delay = RETRY_DELAYS_MS[Math.min(item.attempt, RETRY_DELAYS_MS.length - 1)]
  item.attempt += 1
  await (isOnline() ? sleep(delay) : waitForNetwork(delay))
}

function fail(item, error) {
  item.state = 'failed'
  emit({ type: 'state', conversationId: item.conversationId, clientId: item.clientId, state: 'failed', error })
}
