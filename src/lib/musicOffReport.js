// Tells the server, once per account, that this player has turned our music
// off: either with the top bar's music button or by dragging Profile › Sound
// to 0. Feeds the "Music Off" tile on Admin › Stats.
//
// A guest can do either before they have an account, so the fact is kept on
// the device (PENDING_KEY) until someone signs in, and the current state is
// checked too, so a player who muted before this report existed still counts.
// The server stamps the first report and ignores the rest.

import { isMusicMuted, subscribeMusicMute } from '../utils/musicMute'
import { getMasterVolume } from '../utils/sound'

const PENDING_KEY = 'skywatch.musicOffPending'
const listeners = new Set()
const sentFor = new Set()   // account ids already reported this session

function readPending() {
  try { return localStorage.getItem(PENDING_KEY) } catch { return null }
}

/** Record that music was turned off. `via` is 'mute' or 'volume'. */
export function noteMusicOff(via) {
  try { if (!readPending()) localStorage.setItem(PENDING_KEY, via) } catch { /* storage unavailable */ }
  listeners.forEach(fn => { try { fn() } catch { /* listener error */ } })
}

subscribeMusicMute(m => { if (m) noteMusicOff('mute') })

export function onMusicOff(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function currentVia() {
  const pending = readPending()
  if (pending) return pending
  if (isMusicMuted()) return 'mute'
  try { if (getMasterVolume() === 0) return 'volume' } catch { /* storage unavailable */ }
  return null
}

export async function reportMusicOff({ apiFetch, API, user }) {
  if (!user?._id || user.musicOffAt || sentFor.has(user._id)) return
  const via = currentVia()
  if (!via) return
  sentFor.add(user._id)
  try {
    const res = await apiFetch(`${API}/api/users/me/music-off`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ via }),
    })
    if (!res.ok) sentFor.delete(user._id)
  } catch {
    sentFor.delete(user._id)
  }
}

/** Tests only. */
export function _resetMusicOffReport() { sentFor.clear() }
