import { POST_LOGIN_DEST_KEY } from './storageKeys'

const NO_RETURN_PATHS = new Set(['/', '/login'])

export function captureLoginReturn(location) {
  if (!location?.pathname) return
  if (NO_RETURN_PATHS.has(location.pathname)) return
  const url = location.pathname + (location.search || '')
  try { sessionStorage.setItem(POST_LOGIN_DEST_KEY, url) } catch {}
}

export function resolveLoginDest(briefId) {
  if (briefId) return `/brief/${briefId}`
  let stored = null
  try { stored = sessionStorage.getItem(POST_LOGIN_DEST_KEY) } catch {}
  if (!stored) return '/home'
  const path = stored.split('?')[0]
  return NO_RETURN_PATHS.has(path) ? '/home' : stored
}
