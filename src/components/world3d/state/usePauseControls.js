import { useEffect } from 'react'
import { pause } from './pauseStore'

// Escape opens the hangar pause menu.
//
// Which event actually carries the press depends on the pointer:
//  • Pointer locked — the browser swallows Escape to release the lock, so the
//    keydown may never reach us. Losing the lock IS the signal.
//  • Pointer free — no lock to release, so the keydown is the signal, and a
//    second press closes the menu again.
//
// Both can fire for the same physical press (engines differ on whether the
// keydown is delivered), so a press is ignored for a moment after a lock change
// — otherwise the release opens the menu and the keydown immediately closes it.
const LOCK_CHANGE_GRACE_MS = 300

export function usePauseControls() {
  useEffect(() => {
    let wasLocked = document.pointerLockElement != null
    let lastLockChange = 0

    const onKeyDown = (e) => {
      if (e.code !== 'Escape') return
      if (document.pointerLockElement) return
      if (performance.now() - lastLockChange < LOCK_CHANGE_GRACE_MS) return
      pause.toggle()
    }

    const onLockChange = () => {
      const locked = document.pointerLockElement != null
      lastLockChange = performance.now()
      if (wasLocked && !locked) pause.set(true)
      wasLocked = locked
    }

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerlockchange', onLockChange)
      // Leaving the hangar always leaves it unpaused for the next visit.
      pause.set(false)
    }
  }, [])
}
