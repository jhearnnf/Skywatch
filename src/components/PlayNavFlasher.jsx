import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNewGameUnlock } from '../context/NewGameUnlockContext'
import { useGameChrome } from '../context/GameChromeContext'

const FLASH_DURATION_MS = 1200
// Covers BOTH the notif exit-animation tail and BottomNav's 300ms slide-in
// (when chrome just returned from immersive). Slightly longer than the slide
// so the flash never starts mid-transition.
const BUFFER_MS         = 320

// Both Sidebar (desktop) and BottomNav (mobile) tag a play button with
// data-nav="play"; pick whichever the user can actually see.
function getPlayNavElement() {
  const els = document.querySelectorAll('[data-nav="play"]')
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

// Translated-off-screen elements (BottomNav during immersive) keep their
// dimensions, so verify the rect actually overlaps the viewport.
function elementIsOnScreen(el) {
  const r = el.getBoundingClientRect()
  return r.bottom > 0 && r.top < window.innerHeight
}

// Layout-agnostic consumer for NewGameUnlockContext.pendingPlayNavFlash.
// Mounted once near the app root so it can find whichever nav (Sidebar/
// BottomNav) is currently visible. Waits for the global notifQueue to drain
// so the flash fires AFTER any unlock notif chain has played.
//
// Distinct from BottomNav's existing consumer of GameChromeContext.
// pendingPlayNavFlash, which handles the deferred-during-immersive flash for
// the flashcard-collect fly-out animation only.
export default function PlayNavFlasher() {
  const { notifQueue } = useAuth()
  const { pendingPlayNavFlash, consumePlayNavFlash } = useNewGameUnlock()
  const { immersive, flashcardCollectActive } = useGameChrome()
  const notifsBusy = (notifQueue?.length ?? 0) > 0

  useEffect(() => {
    // Defer while: nothing pending / unlock notifs still draining / FDN's own
    // flashcard-collect animation (and its trailing play-nav-flash) is still
    // in progress — overlapping pulses would read as one long flash.
    if (!pendingPlayNavFlash || notifsBusy || flashcardCollectActive) return
    const timer = setTimeout(() => {
      const el = getPlayNavElement()
      if (el && elementIsOnScreen(el)) {
        el.classList.add('play-nav-flash')
        setTimeout(() => el.classList.remove('play-nav-flash'), FLASH_DURATION_MS)
        consumePlayNavFlash()
      }
      // Element exists but is off-screen (BottomNav translated during immersive
      // gameplay): leave the flag set — when `immersive` flips false this
      // effect re-runs and flashes once chrome is back.
    }, BUFFER_MS)
    return () => clearTimeout(timer)
  }, [pendingPlayNavFlash, notifsBusy, immersive, flashcardCollectActive, consumePlayNavFlash])

  return null
}
