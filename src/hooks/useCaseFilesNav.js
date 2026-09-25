import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { authFetch } from '../utils/authFetch'

// Whether the signed-in player gets the Case Files navbar tab.
//
// Two halves. The admin switches (caseFilesEnabled + caseFilesNavEnabled) come
// straight from AppSettings, so flipping one off pulls the tab at once. The
// "finished more than N CBAT games" half needs a count across every CBAT
// result collection, so the server answers it at GET /api/case-files/nav.
//
// Sidebar and BottomNav both call this, so the answer is shared per user and
// a fetch already in flight is reused. Once a player has earned the tab it
// stays for the session; until then it is re-asked at most once a minute as
// they move around, so it turns up soon after the game that crosses the line.

const RECHECK_MS = 60_000
const cache    = new Map()   // userId -> { visible, at }
const inflight = new Map()   // userId -> Promise<boolean>

function askServer(API, uid) {
  if (inflight.has(uid)) return inflight.get(uid)
  const p = authFetch(`${API}/api/case-files/nav`)
    .then((r) => (r.ok ? r.json() : { visible: false }))
    .then((d) => {
      const visible = !!d?.visible
      cache.set(uid, { visible, at: Date.now() })
      return visible
    })
    .catch(() => cache.get(uid)?.visible ?? false)
    .finally(() => inflight.delete(uid))
  inflight.set(uid, p)
  return p
}

export function useCaseFilesNavVisible() {
  const { user, API } = useAuth() ?? {}
  const { settings } = useAppSettings() ?? {}
  const { pathname } = useLocation()
  const uid = user?._id ?? null
  const flagsOn = !!settings?.caseFilesEnabled && settings?.caseFilesNavEnabled !== false

  const [answer, setAnswer] = useState(null) // { uid, visible }

  useEffect(() => {
    if (!uid || !flagsOn) return undefined
    const hit = cache.get(uid)
    if (hit && (hit.visible || Date.now() - hit.at < RECHECK_MS)) return undefined
    let cancelled = false
    askServer(API, uid).then((visible) => {
      if (!cancelled) setAnswer({ uid, visible })
    })
    return () => { cancelled = true }
  }, [uid, flagsOn, API, pathname])

  if (!uid || !flagsOn) return false
  const cached = cache.get(uid)?.visible
  const fromState = answer?.uid === uid ? answer.visible : undefined
  return !!(cached ?? fromState)
}

// Test seam: module-level cache survives between tests otherwise.
export function __resetCaseFilesNavCache() {
  cache.clear()
  inflight.clear()
}

// Red "new" dot on the tab until the player first opens Case Files.
const seenKey = (uid) => `cfNavSeen:${uid}`
function readSeen(uid) {
  try { return localStorage.getItem(seenKey(uid)) === '1' } catch { return false }
}

export function useCaseFilesNavUnseen() {
  const { user } = useAuth() ?? {}
  const { pathname } = useLocation()
  const uid = user?._id ?? null
  const onCaseFiles = pathname === '/case-files' || pathname.startsWith('/case-files/')
  const [seenNow, setSeenNow] = useState(false)

  useEffect(() => {
    if (!uid || !onCaseFiles) return
    try { localStorage.setItem(seenKey(uid), '1') } catch { /* private mode: dot just returns next visit */ }
    // Deferred so it lands outside the effect body.
    const t = setTimeout(() => setSeenNow(true), 0)
    return () => clearTimeout(t)
  }, [uid, onCaseFiles])

  if (!uid) return false
  return !(seenNow || onCaseFiles || readSeen(uid))
}
