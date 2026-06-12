// Online/offline status — unified across web and Capacitor (Android).
//
// Web uses navigator.onLine + the online/offline window events. Those events
// are unreliable on some platforms (notably Android WebView), so on native we
// prefer the @capacitor/network plugin, falling back to navigator.onLine.

import { Capacitor } from '@capacitor/core'

const isNative = Capacitor.isNativePlatform()

let nativeOnline = true          // last value reported by the Network plugin
let nativeReady  = false         // becomes true once the plugin has answered
const listeners  = new Set()     // (online: boolean) => void

function emit(online) {
  for (const cb of listeners) {
    try { cb(online) } catch { /* listener must never break the emitter */ }
  }
}

// Lazily wire the Capacitor Network plugin. Done dynamically so the web bundle
// never imports native-only code paths it can't use.
if (isNative) {
  import('@capacitor/network')
    .then(({ Network }) => {
      Network.getStatus()
        .then((s) => { nativeOnline = s.connected; nativeReady = true })
        .catch(() => { nativeReady = true })
      Network.addListener('networkStatusChange', (s) => {
        const next = s.connected
        if (next === nativeOnline && nativeReady) return
        nativeOnline = next
        nativeReady = true
        emit(next)
      })
    })
    .catch(() => { /* plugin missing — fall back to navigator.onLine */ })
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => emit(true))
  window.addEventListener('offline', () => emit(false))
}

// Best-effort current status. Synchronous so callers can gate without awaiting.
export function isOnline() {
  if (isNative && nativeReady) return nativeOnline
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) return navigator.onLine
  return true // assume online when we genuinely can't tell
}

// Subscribe to transitions. Returns an unsubscribe function.
export function onNetworkChange(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
