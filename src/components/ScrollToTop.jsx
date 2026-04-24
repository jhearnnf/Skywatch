import { useLocation, useNavigationType } from 'react-router-dom'

// Manual scroll management keyed on `pathname`. On PUSH/REPLACE we reset to 0;
// on POP (browser back/forward) we restore the scroll we had on that pathname.
//
// Keyed on pathname (not location.key) so that same-page URL mutations — e.g.
// a pathway swipe that rewrites `?category=…` via `replace: true` — do not
// fire a scroll reset. The user's scroll stays put during in-page updates.
//
// The scroll mutation runs as a *render-time* side effect (not a layout
// effect) because child pages use Framer's `useScroll()`, which samples
// `window.scrollY` during render — a post-commit reset would produce a one-
// frame flash where scroll-driven transforms reflect the stale scroll.

// Pages that own their own scroll-on-arrival behaviour. On POP to these, we
// skip restoring the cached scroll so the page's own auto-scroll (e.g.
// LearnPriority's "next-to-read" targeting) runs cleanly from 0.
const SKIP_POP_RESTORE = new Set(['/learn-priority'])

const scrollCache = new Map()
let prevPathname = null
let latestScroll = 0

if (typeof window !== 'undefined') {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual'
  }
  window.addEventListener(
    'scroll',
    () => { latestScroll = window.scrollY },
    { passive: true },
  )
}

export default function ScrollToTop() {
  const { pathname } = useLocation()
  const navType = useNavigationType()

  if (prevPathname !== pathname) {
    if (prevPathname !== null) {
      scrollCache.set(prevPathname, latestScroll)
    }
    prevPathname = pathname

    if (typeof window !== 'undefined') {
      if (navType === 'POP' && !SKIP_POP_RESTORE.has(pathname)) {
        const saved = scrollCache.get(pathname)
        const target = saved != null ? saved : 0
        window.scrollTo(0, target)
        latestScroll = target
      } else {
        window.scrollTo(0, 0)
        latestScroll = 0
      }
    }
  }

  return null
}

// Test helper — resets module state between test cases.
export function __resetScrollToTopForTests() {
  scrollCache.clear()
  prevPathname = null
  latestScroll = 0
}
