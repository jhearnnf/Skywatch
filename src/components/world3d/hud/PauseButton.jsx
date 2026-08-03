import { useSyncExternalStore } from 'react'
import { pause } from '../state/pauseStore'

// Touch has no Escape key, and the hangar is full-screen with no other way out,
// so the pause menu needs a visible handle. Hidden while the menu is open — it
// has its own Resume button.

export default function PauseButton() {
  const paused = useSyncExternalStore(pause.subscribe, pause.get, () => false)
  if (paused) return null

  return (
    <button
      type="button"
      onClick={() => pause.set(true)}
      aria-label="Pause"
      className="pointer-events-auto w-10 h-10 rounded-lg bg-surface-raised/80 border border-brand-300 text-brand-700 backdrop-blur-sm flex items-center justify-center hover:bg-surface-raised transition-colors"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    </button>
  )
}
