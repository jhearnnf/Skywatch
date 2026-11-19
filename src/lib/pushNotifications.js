// Turning push notifications on and off for THIS device.
//
// Two kinds of device, one interface:
//   native — the Android app, through @capacitor/push-notifications (Firebase)
//   web    — a browser or installed web app, through the service worker's
//            PushManager (public/push-sw.js draws the notifications)
//
// What the account wants to hear about (DMs, replies, rooms...) is NOT here:
// that is User.pushPrefs, saved to the server and shared by every device.
// This file only answers "does this device receive them at all".

import { Capacitor } from '@capacitor/core'

const NATIVE_TOKEN_KEY = 'skywatch:pushToken'
const NATIVE_CHANNEL   = 'chat'

function readLocal(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* storage blocked: the server copy still works */ }
}

export function pushKind() {
  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'android' ? 'native' : null
  }
  if (typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null
  return 'web'
}

async function getConfig({ API, apiFetch }) {
  try {
    const res = await apiFetch(`${API}/api/push/config`, { quiet: true })
    if (!res.ok) return null
    return (await res.json())?.data ?? null
  } catch {
    return null
  }
}

// The service worker is only registered in production builds (src/main.jsx),
// so in `npm run dev` there is none and web push is simply unavailable.
async function webRegistration() {
  try { return (await navigator.serviceWorker.getRegistration()) ?? null } catch { return null }
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

const loadNative = () => import('@capacitor/push-notifications').then(m => m.PushNotifications)

/**
 * Where this device stands.
 * @returns {Promise<'on'|'off'|'blocked'|'unavailable'>}
 *   blocked     — the person (or the OS) said no; only device settings can undo it
 *   unavailable — this device or this server cannot do push at all
 */
export async function deviceStatus({ API, apiFetch }) {
  const kind = pushKind()
  if (!kind) return 'unavailable'
  const config = await getConfig({ API, apiFetch })

  if (kind === 'native') {
    if (!config?.fcm) return 'unavailable'
    try {
      const PushNotifications = await loadNative()
      const { receive } = await PushNotifications.checkPermissions()
      if (receive === 'denied') return 'blocked'
      return receive === 'granted' && readLocal(NATIVE_TOKEN_KEY) ? 'on' : 'off'
    } catch {
      return 'unavailable'
    }
  }

  if (!config?.webPublicKey) return 'unavailable'
  const reg = await webRegistration()
  if (!reg) return 'unavailable'
  if (Notification.permission === 'denied') return 'blocked'
  const sub = await reg.pushManager.getSubscription().catch(() => null)
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

async function postSubscribe({ API, apiFetch }, body) {
  const res = await apiFetch(`${API}/api/push/subscribe`, {
    quiet: true,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Could not save this device')
}

// Resolves with the FCM token from the next 'registration' event.
async function registerNative(PushNotifications) {
  await PushNotifications.createChannel({
    id: NATIVE_CHANNEL,
    name: 'Chat messages',
    description: 'Direct messages, replies, reactions and the rooms you follow',
    importance: 4,
    visibility: 1,
  }).catch(() => { /* older Android: no channels */ })

  return new Promise((resolve, reject) => {
    let handles = []
    let settled = false
    let timer = null
    const done = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      handles.forEach(h => h.remove())
      fn(value)
    }
    timer = setTimeout(() => done(reject, new Error('Registration timed out')), 20000)
    Promise.all([
      PushNotifications.addListener('registration', t => done(resolve, t.value)),
      PushNotifications.addListener('registrationError', e => done(reject, new Error(e?.error || 'Registration failed'))),
    ]).then(hs => {
      handles = hs
      if (settled) { hs.forEach(h => h.remove()); return }
      PushNotifications.register().catch(err => done(reject, err))
    }, err => done(reject, err))
  })
}

/**
 * Ask permission (if needed) and sign this device up.
 * @returns {Promise<'on'|'blocked'|'unavailable'>}
 */
export async function enableOnDevice({ API, apiFetch }) {
  const kind = pushKind()
  const config = await getConfig({ API, apiFetch })

  if (kind === 'native') {
    if (!config?.fcm) return 'unavailable'
    const PushNotifications = await loadNative()
    let { receive } = await PushNotifications.checkPermissions()
    if (receive !== 'granted') ({ receive } = await PushNotifications.requestPermissions())
    if (receive !== 'granted') return 'blocked'
    const token = await registerNative(PushNotifications)
    await postSubscribe({ API, apiFetch }, { kind: 'fcm', token, platform: 'android' })
    writeLocal(NATIVE_TOKEN_KEY, token)
    return 'on'
  }

  if (kind !== 'web' || !config?.webPublicKey) return 'unavailable'
  const reg = await webRegistration()
  if (!reg) return 'unavailable'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.webPublicKey),
    })
  }
  await postSubscribe({ API, apiFetch }, { kind: 'web', subscription: sub.toJSON(), platform: 'web' })
  return 'on'
}

/**
 * Stop this device receiving notifications for the signed-in account. Also
 * run on sign out, so a shared phone or laptop stops showing the last
 * person's messages. Never throws.
 */
export async function disableOnDevice({ API, apiFetch }) {
  const kind = pushKind()
  let endpoint = null
  try {
    if (kind === 'native') {
      endpoint = readLocal(NATIVE_TOKEN_KEY)
      writeLocal(NATIVE_TOKEN_KEY, null)
      if (endpoint) {
        const PushNotifications = await loadNative()
        await PushNotifications.unregister().catch(() => {})
      }
    } else if (kind === 'web') {
      const reg = await webRegistration()
      const sub = await reg?.pushManager.getSubscription().catch(() => null)
      if (sub) {
        endpoint = sub.endpoint
        await sub.unsubscribe().catch(() => {})
      }
    }
    if (endpoint) {
      await apiFetch(`${API}/api/push/unsubscribe`, {
        quiet: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
    }
  } catch { /* best effort */ }
}

/**
 * On app start with someone signed in: if this device is already on, send its
 * address again. FCM tokens rotate, and a device signed in to a different
 * account since needs moving to this one. Quiet if anything is off.
 */
export async function refreshDevice({ API, apiFetch }) {
  try {
    const kind = pushKind()
    if (kind === 'native') {
      if (!readLocal(NATIVE_TOKEN_KEY)) return
      const PushNotifications = await loadNative()
      const { receive } = await PushNotifications.checkPermissions()
      if (receive !== 'granted') return
      const token = await registerNative(PushNotifications)
      await postSubscribe({ API, apiFetch }, { kind: 'fcm', token, platform: 'android' })
      writeLocal(NATIVE_TOKEN_KEY, token)
      return
    }
    if (kind === 'web') {
      if (Notification.permission !== 'granted') return
      const reg = await webRegistration()
      const sub = await reg?.pushManager.getSubscription().catch(() => null)
      if (sub) await postSubscribe({ API, apiFetch }, { kind: 'web', subscription: sub.toJSON(), platform: 'web' })
    }
  } catch { /* next start tries again */ }
}

/**
 * Notifications that arrive while the app is open and in front. The system
 * does not draw these (Android never does for a foreground app, and the
 * service worker hands them to the page instead), so the app shows its own
 * banner. Handler gets { title, body, url, tag, kind }. Returns a cleanup.
 */
export function listenForForeground(handler) {
  const kind = pushKind()

  if (kind === 'native') {
    let handle = null
    let stopped = false
    loadNative().then(PushNotifications =>
      PushNotifications.addListener('pushNotificationReceived', (n) => {
        handler({
          title: n?.title ?? '',
          body:  n?.body ?? '',
          url:   n?.data?.url ?? null,
          tag:   n?.data?.tag ?? null,
          kind:  n?.data?.kind ?? null,
        })
      }),
    ).then(h => { if (stopped) h.remove(); else handle = h }).catch(() => {})
    return () => { stopped = true; handle?.remove() }
  }

  if (kind === 'web') {
    const onMessage = (event) => {
      if (event.data?.type === 'skywatch-push' && event.data.payload) handler(event.data.payload)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }

  return () => {}
}

/**
 * Open the right page when a notification is tapped. Returns a cleanup.
 * @param {(url: string) => void} go
 */
export function listenForTaps(go) {
  const kind = pushKind()
  const isAppUrl = (url) => typeof url === 'string' && url.startsWith('/')

  if (kind === 'native') {
    let handle = null
    let stopped = false
    loadNative().then(PushNotifications =>
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action?.notification?.data?.url
        if (isAppUrl(url)) go(url)
      }),
    ).then(h => { if (stopped) h.remove(); else handle = h }).catch(() => {})
    return () => { stopped = true; handle?.remove() }
  }

  if (kind === 'web') {
    const onMessage = (event) => {
      if (event.data?.type === 'skywatch-push-open' && isAppUrl(event.data.url)) go(event.data.url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }

  return () => {}
}
