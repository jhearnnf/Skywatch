import { Capacitor } from '@capacitor/core'
import { AUTH_TOKEN_KEY } from './storageKeys'

/**
 * authFetch — fetch that carries the session on every platform.
 *
 * The web app authenticates with an httpOnly cookie, so `credentials: 'include'`
 * is all it needs. The Capacitor webview does not carry that cookie, so the
 * native app signs in and stores a JWT which has to travel as a Bearer header
 * instead (see AuthContext).
 *
 * AuthContext's `apiFetch` already handles this, but it also drives the global
 * loading overlay and the API-reachability tracking, so it is meant for
 * user-triggered calls made from inside a component. Modules that just need a
 * plain authenticated request — hooks, page loaders — used to reach for bare
 * `fetch(url, { credentials: 'include' })`, which silently sends nothing on
 * native. That is what made Case Files completely non-functional in the Android
 * app: every request landed unauthenticated, so protected routes 401'd and the
 * optionally-authed ones behaved as if a guest had made them.
 */

const isNative = (() => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
})()

function storedToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function authFetch(url, options = {}) {
  if (!isNative) {
    return fetch(url, { credentials: 'include', ...options })
  }
  const token = storedToken()
  return fetch(url, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
}

export default authFetch
