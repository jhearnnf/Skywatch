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

// The app shell's <main> is the scroller instead of the window on desktop CBAT
// pages while the chat dock is out (see `cbat-dock-reserve` in main.css). It
// survives every route change, so without this a new page would open wherever
// the last one was left. Tracked with its own cache alongside the window's.
const mainCache = new Map()
let latestMainScroll = 0
const shellMain = () => document.querySelector('.app-shell-main')

if (typeof window !== 'undefined') {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual'
  }
  window.addEventListener(
    'scroll',
    () => { latestScroll = window.scrollY },
    { passive: true },
  )
  // Element scrolls do not bubble, so listen in the capture phase.
  document.addEventListener(
    'scroll',
    (e) => { if (e.target instanceof Element && e.target.classList.contains('app-shell-main')) latestMainScroll = e.target.scrollTop },
    { passive: true, capture: true },
  )
}

// `pathname` is the page on screen (see AppRoutes), so the reset waits until
// the outgoing page has finished fading out instead of jumping it to the top
// mid-fade. Falls back to the URL where no page path is passed.
export default function ScrollToTop({ pathname: shownPath } = {}) {
  const { pathname: urlPath } = useLocation()
  const pathname = shownPath ?? urlPath
  const navType = useNavigationType()

  if (prevPathname !== pathname) {
    if (prevPathname !== null) {
      scrollCache.set(prevPathname, latestScroll)
      mainCache.set(prevPathname, latestMainScroll)
    }
    prevPathname = pathname

    if (typeof window !== 'undefined') {
      const main = shellMain()
      if (navType === 'POP' && !SKIP_POP_RESTORE.has(pathname)) {
        const saved = scrollCache.get(pathname)
        const target = saved != null ? saved : 0
        window.scrollTo(0, target)
        latestScroll = target
        // <main> only scrolls once the incoming page has mounted and the dock
        // has reserved its column, so the restore waits a frame for that.
        const mainTarget = mainCache.get(pathname) ?? 0
        latestMainScroll = mainTarget
        if (main) {
          main.scrollTop = 0
          if (mainTarget) requestAnimationFrame(() => { main.scrollTop = mainTarget })
        }
      } else {
        window.scrollTo(0, 0)
        latestScroll = 0
        if (main) main.scrollTop = 0
        latestMainScroll = 0
      }
    }
  }

  return null
}

// Test helper — resets module state between test cases.
export function __resetScrollToTopForTests() {
  scrollCache.clear()
  mainCache.clear()
  prevPathname = null
  latestScroll = 0
  latestMainScroll = 0
}
