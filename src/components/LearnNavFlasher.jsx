import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNewCategoryUnlock } from '../context/NewCategoryUnlockContext'
import { useGameChrome } from '../context/GameChromeContext'

const FLASH_DURATION_MS = 1200
// Covers BOTH the notif exit-animation tail and BottomNav's 300ms slide-in
// (when chrome just returned from immersive). Slightly longer than the slide
// so the flash never starts mid-transition.
const BUFFER_MS         = 320

// Mirror of FlashcardDeckNotification.getPlayNavElement — both Sidebar (desktop)
// and BottomNav (mobile) tag a learn button with data-nav="learn"; pick the one
// the user can actually see. display:none elements have width/height = 0.
function getLearnNavElement() {
  const els = document.querySelectorAll('[data-nav="learn"]')
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

// Translated-off-screen elements (BottomNav during immersive mode) keep their
// dimensions, so the rect width/height check above isn't enough — verify the
// element actually overlaps the viewport before flashing it.
function elementIsOnScreen(el) {
  const r = el.getBoundingClientRect()
  return r.bottom > 0 && r.top < window.innerHeight
}

// Layout-agnostic consumer for pendingLearnNavFlash. Mounted once near the
// app root so it can find whichever nav (Sidebar/BottomNav) is currently
// visible. Waits for the global notifQueue to drain so the flash fires AFTER
// any airstar/levelup/rankpromotion/categoryUnlock notifs have played.
export default function LearnNavFlasher() {
  const { notifQueue } = useAuth()
  const { pendingLearnNavFlash, consumeLearnNavFlash } = useNewCategoryUnlock()
  const { immersive } = useGameChrome()
  const notifsBusy = (notifQueue?.length ?? 0) > 0

  useEffect(() => {
    if (!pendingLearnNavFlash || notifsBusy) return
    const timer = setTimeout(() => {
      const el = getLearnNavElement()
      if (el && elementIsOnScreen(el)) {
        el.classList.add('learn-nav-flash')
        setTimeout(() => el.classList.remove('learn-nav-flash'), FLASH_DURATION_MS)
        consumeLearnNavFlash()
      }
      // Element exists but is off-screen (BottomNav translated during immersive
      // gameplay): leave the flag set — when `immersive` flips false this effect
      // re-runs and flashes once chrome is back.
    }, BUFFER_MS)
    return () => clearTimeout(timer)
  }, [pendingLearnNavFlash, notifsBusy, immersive, consumeLearnNavFlash])

  return null
}
