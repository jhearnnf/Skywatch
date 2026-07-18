// Tracks whether the API is actually reachable, and whether we're still signed in.
//
// The bug this exists for: when a request fails at the network or CORS layer the
// browser hands JavaScript an opaque rejection with no status code. That is
// indistinguishable from being offline — so the app carried on, kept the user
// signed in from the localStorage cache, queued everything, and said nothing.
// A user played for five weeks and not one score was recorded.
//
// Three states, deliberately distinguished by *how* the request failed:
//
//   ok          — last request got a response (any status). Nothing to show.
//   unreachable — fetch rejected outright while the browser claims to be online.
//                 Our fault or the network's; the user can't fix it. Their scores
//                 are queued and safe, and they should be told that much.
//   signedOut   — the server answered 401. It's alive and it doesn't know us.
//                 The only state the user can actually resolve, by signing in.
//
// Only 401 counts as signedOut. 403 is used for tier gating and suspended
// accounts, and treating those as a dead session would sign people out of a
// perfectly good login the moment they touched a feature above their plan.

const FAILURES_BEFORE_ALARM = 2

let status = 'ok'
let consecutiveFailures = 0
let failingSince = null
let lastError = ''

const listeners = new Set()

function notify() {
  for (const cb of listeners) {
    try { cb(getApiHealth()) } catch { /* a bad listener must not break the rest */ }
  }
}

export function onApiHealthChange(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getApiHealth() {
  return {
    status,
    failingSince,
    failingForMs: failingSince ? Date.now() - failingSince : 0,
    lastError,
  }
}

// A request came back with a response — the API is alive, whatever it said.
export function noteApiReachable() {
  lastError = ''
  consecutiveFailures = 0
  failingSince = null
  if (status !== 'ok') { status = 'ok'; notify() }
}

// The server answered 401: reachable, but this session is dead.
export function noteApiUnauthorized() {
  consecutiveFailures = 0
  failingSince = null
  if (status !== 'signedOut') { status = 'signedOut'; notify() }
}

// fetch() rejected. Only raise the alarm after a couple in a row so a single
// blip on a train doesn't throw a banner up mid-session.
export function noteApiUnreachable(err) {
  lastError = String(err?.message ?? err ?? '').slice(0, 300)
  consecutiveFailures += 1
  if (consecutiveFailures < FAILURES_BEFORE_ALARM) return
  if (!failingSince) failingSince = Date.now()
  if (status !== 'unreachable') { status = 'unreachable'; notify() }
}

// Test seam — resets module state between cases.
export function __resetApiHealth() {
  status = 'ok'
  consecutiveFailures = 0
  failingSince = null
  lastError = ''
  listeners.clear()
}
