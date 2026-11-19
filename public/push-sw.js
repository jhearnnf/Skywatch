/* Push notifications for the web app and installed web app.
 *
 * Pulled into the generated Workbox service worker with importScripts (see
 * vite.config.js), so it runs in the one service worker the site already has.
 * The server sends { title, body, url, tag, kind } (backend/utils/pushNotify.js).
 */

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }

  event.waitUntil((async () => {
    // Someone using SkyWatch right now gets the in-app banner instead
    // (InAppPushNotice), which knows what they are looking at: it stays quiet
    // on the chat the message is in, and holds itself back during a game.
    // The Android app does the same in the foreground.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const inFront = windows.filter(w => w.focused && w.visibilityState === 'visible')
    if (inFront.length) {
      inFront.forEach(w => w.postMessage({ type: 'skywatch-push', payload: data }))
      return
    }

    await self.registration.showNotification(data.title || 'SkyWatch', {
      body:     data.body || '',
      tag:      data.tag || undefined,
      // A newer line in the same chat replaces the older notification, but
      // should still buzz rather than swap silently.
      renotify: Boolean(data.tag),
      icon:     '/icon-192.png',
      badge:    '/icon-192.png',
      data:     { url: data.url || '/chat' },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/chat'

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find(w => new URL(w.url).origin === self.location.origin)
    if (open) {
      // Route inside the running app (PushNotificationBridge listens) rather
      // than reloading it, so an in-progress page keeps its state.
      await open.focus()
      open.postMessage({ type: 'skywatch-push-open', url })
      return
    }
    await self.clients.openWindow(url)
  })())
})
