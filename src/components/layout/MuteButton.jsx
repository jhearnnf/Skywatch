import { useEffect, useState } from 'react'
import { isMusicMuted, subscribeMusicMute, toggleMusicMuted } from '../../utils/musicMute'

// Music button in the top bar: mutes our soundtracks (menu, Community, hangar)
// but never game sounds (see utils/musicMute.js). On the very first visit it
// glows and shakes for a few seconds so a new player sees the music can be
// turned off.

const HINT_SEEN_KEY = 'skywatch.muteHintSeen'
const HINT_LIFETIME_MS = 4500

function hintSeen() {
  try { return localStorage.getItem(HINT_SEEN_KEY) === '1' } catch { return true }
}

function markHintSeen() {
  try { localStorage.setItem(HINT_SEEN_KEY, '1') } catch { /* storage unavailable */ }
}

function MusicIcon({ muted }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" fill="currentColor" fillOpacity="0.15" />
      <circle cx="17" cy="16" r="3" fill="currentColor" fillOpacity="0.15" />
      {muted && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}

export default function MuteButton() {
  const [muted, setMutedState] = useState(isMusicMuted)
  const [hint, setHint] = useState(() => !hintSeen())

  useEffect(() => subscribeMusicMute(setMutedState), [])

  useEffect(() => {
    if (!hint) return undefined
    markHintSeen()
    const timer = window.setTimeout(() => setHint(false), HINT_LIFETIME_MS)
    return () => window.clearTimeout(timer)
  }, [hint])

  const onClick = () => {
    setHint(false)
    toggleMusicMuted()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={muted ? 'Turn music on' : 'Mute music'}
      aria-pressed={muted}
      title={muted ? 'Turn music on' : 'Mute music'}
      data-testid="mute-button"
      className={`mute-button w-8 h-8 shrink-0 rounded-full flex items-center justify-center border transition-colors outline-none focus:outline-none ${
        muted
          ? 'bg-slate-100 border-slate-300 text-slate-600 hover:border-slate-400'
          : 'bg-brand-50 border-brand-200 text-brand-600 hover:border-brand-400'
      } ${hint ? 'mute-button-hint' : ''}`}
    >
      <MusicIcon muted={muted} />
    </button>
  )
}
