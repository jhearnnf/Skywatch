// Music mute, driven by the music button in the top bar (and the landing
// page header). It silences our soundtracks only: the CBAT menu music, the
// Community track and the hangar lobby track, all of which play through
// createLoopingMusic (utils/loopingMusic.js). Game sounds are never touched,
// so a muted player still hears everything a test needs.
//
// The choice persists per device in localStorage and is kept in step across
// open tabs.

const STORAGE_KEY = 'skywatch.musicMuted'

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

let muted = readStored()
const listeners = new Set()

export function isMusicMuted() { return muted }

export function subscribeMusicMute(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setMusicMuted(next) {
  muted = Boolean(next)
  try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0') } catch { /* storage unavailable */ }
  listeners.forEach(fn => { try { fn(muted) } catch { /* listener error */ } })
}

export function toggleMusicMuted() { setMusicMuted(!muted) }

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && (e.newValue === '1') !== muted) setMusicMuted(e.newValue === '1')
  })
}
