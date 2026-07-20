import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

// Identifies the build this client is running, reported on every heartbeat so
// Admin › Users can show what someone was last on.
//
// The two platforms answer the question differently:
//   web     — the bundle stamps itself at build time (vite `define`). The semver
//             comes from package.json, the build from the commit sha. The sha is
//             the part that matters: a PWA service worker can pin a device to an
//             old bundle long after a deploy, and that is invisible otherwise.
//   android — the OS is the source of truth. App.getInfo() returns the gradle
//             versionName/versionCode, i.e. exactly the store release, which the
//             JS bundle cannot know (the same bundle ships in every app build).
//
// Web therefore resolves synchronously, native needs a bridge round-trip. Both
// are memoised — the heartbeat fires every 30s and must not pay for it twice.
//
// Deliberately NO fallback from native to the web stamp: reporting the bundle's
// commit sha as if it were an Android build would file a bogus release into the
// server's "what is the latest version" registry and make every real app user
// look outdated. Unknown is reported as unknown.

const WEB_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
const WEB_BUILD   = typeof __APP_BUILD__   !== 'undefined' ? __APP_BUILD__   : 'dev'

const webInfo = () => ({ platform: 'web', version: WEB_VERSION, build: WEB_BUILD })

let cached  = Capacitor.getPlatform() === 'web' ? webInfo() : null
let inflight = null

// Synchronous read for callers that must not await (the heartbeat's send loop).
// Returns null on native until the bridge has answered — one heartbeat may go
// out without a version, and the next one 30s later carries it.
export function peekClientInfo() {
  return cached
}

export async function getClientInfo() {
  if (cached) return cached
  inflight ??= (async () => {
    const platform = Capacitor.getPlatform()
    if (platform === 'web') return webInfo()
    try {
      const info    = await App.getInfo()
      const version = String(info?.version ?? '').trim()
      const build   = String(info?.build   ?? '').trim()
      return version ? { platform, version, build: build || null } : null
    } catch {
      return null // bridge unavailable — stay silent rather than guess
    }
  })()

  const resolved = await inflight
  inflight = null
  if (resolved) cached = resolved
  return resolved
}

// Test seam only — lets a suite re-resolve after changing the mocked platform.
export function __resetClientInfoCache() {
  cached   = Capacitor.getPlatform() === 'web' ? webInfo() : null
  inflight = null
}
