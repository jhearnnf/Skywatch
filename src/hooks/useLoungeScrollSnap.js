import { useCallback, useEffect, useRef, useState } from 'react'
import { revealProgress, snapTarget } from '../utils/cbat/loungeReveal'

// Moving from the first frame and settling softly onto the resting state. An
// ease-in-out was tried and read as a pause: it barely moves for its first
// tenth of a second, just after the wheel notch that asked for the glide.
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

// The phone hub's two resting states, the game menu and the CBAT chat lounge
// under it, and the scroll between them (the reveal in LoungeReveal.jsx plays
// off how far through it the page is).
//
// The page heads for one end or the other and never rests in between, but how
// it gets there depends on the input:
//
//  - Wheel (and keys, and the scrollbar): the first notch towards the lounge or
//    back towards the menu takes the page the whole way there in one glide.
//    A notch the other way mid-glide turns it round.
//  - Touch: the page follows the finger, so holding still mid-swipe holds the
//    animation where it is, and swiping back plays it backwards. Only once the
//    finger lifts, and any fling has spent itself, does the page finish the
//    trip in whichever direction it was last moving.
//
// The window scrolls this page below lg, which is the only place it runs.

// A tiny external store for the progress, so the reveal's pieces can re-render
// off it without the whole hub re-rendering on every scroll frame.
function createProgressStore() {
  let value = 0
  const listeners = new Set()
  return {
    get: () => value,
    set(v) {
      if (v === value) return
      value = v
      listeners.forEach(fn => fn())
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

const isTyping = (el) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

// Whether something between the pointer and the page would take this wheel
// notch itself: the chat's message list, scrolled part-way. Then it is the
// list's scroll, not the page's, and the snap stays out of it.
function innerCanScroll(target, dy) {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body && el !== document.documentElement) {
    const { overflowY } = getComputedStyle(el)
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true
    }
    el = el.parentElement
  }
  return false
}

// The top edge of the phone's BottomNav, in viewport px: the bottom of the
// space the page can actually be seen in. The window's bottom edge where there
// is no BottomNav (it is hidden from md up).
export function bottomNavTop() {
  const nav = document.querySelector('.app-bottomnav')
  const r = nav?.getBoundingClientRect()
  return r && r.height > 0 ? r.top : window.innerHeight
}

export function useLoungeScrollSnap({ enabled, panelRef, landmarkRef }) {
  const [store] = useState(createProgressStore)
  const ctl = useRef({ anim: null, holding: false, lastY: 0, dir: 1, settle: null, bounds: undefined })

  // Where the reveal starts and ends in window scroll: from the panel's top
  // edge entering the bottom of the screen, to the bottom of the page. Read
  // fresh at the start of every gesture, because the chat panel is sized in
  // dvh, which moves with the phone's toolbars; the scroll handler reads the
  // cached copy so that a scroll frame never forces a layout.
  //
  // The start is the menu's resting point: the landmark (heading, eyebrow and
  // chevron) sitting whole just above the BottomNav. Starting where the panel
  // first showed instead put the start with the landmark still behind the nav,
  // so on a screen whose grid is taller than the window the landmark was never
  // seen: one more scroll and the page was gone to the lounge.
  const bounds = useCallback(() => {
    const panel = panelRef.current
    if (!panel) return null
    const y = window.scrollY
    const landmark = landmarkRef?.current
    const start = landmark
      ? Math.max(0, landmark.getBoundingClientRect().bottom + y - bottomNavTop())
      : Math.max(0, panel.getBoundingClientRect().top + y - window.innerHeight)
    const end = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const b = end - start > 40 ? { start, end } : null
    ctl.current.bounds = b
    return b
  }, [panelRef, landmarkRef])

  const stop = useCallback(() => {
    const c = ctl.current
    if (c.anim) cancelAnimationFrame(c.anim.raf)
    c.anim = null
  }, [])

  const glideTo = useCallback((target) => {
    stop()
    const from = window.scrollY
    const dist = target - from
    if (Math.abs(dist) < 1) return
    const duration = Math.min(700, Math.max(420, 340 + Math.abs(dist) * 0.6))
    const t0 = performance.now()
    const c = ctl.current
    const anim = { target, dir: Math.sign(dist), raf: 0 }
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration)
      // `instant`, or the page's `scroll-behavior: smooth` turns every frame
      // into its own competing smooth scroll.
      window.scrollTo({ top: from + dist * easeOutCubic(t), behavior: 'instant' })
      if (t < 1) anim.raf = requestAnimationFrame(frame)
      else if (c.anim === anim) c.anim = null
    }
    c.anim = anim
    anim.raf = requestAnimationFrame(frame)
  }, [stop])

  const goToLounge = useCallback(() => {
    const b = bounds()
    if (b) glideTo(b.end)
    else panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [bounds, glideTo, panelRef])

  useEffect(() => {
    if (!enabled) { store.set(0); return }
    const c = ctl.current
    c.lastY = window.scrollY

    const publish = () => {
      if (c.bounds === undefined) bounds()
      store.set(revealProgress(window.scrollY, c.bounds))
    }
    const remeasure = () => { bounds(); publish() }

    const snap = () => {
      c.settle = null
      if (c.anim || c.holding) return
      const panel = panelRef.current
      const active = document.activeElement
      if (panel && panel.contains(active) && isTyping(active)) return
      const target = snapTarget(window.scrollY, bounds(), c.dir)
      if (target != null) glideTo(target)
    }
    const scheduleSnap = (ms) => {
      clearTimeout(c.settle)
      c.settle = setTimeout(snap, ms)
    }

    const onScroll = () => {
      const y = window.scrollY
      if (y !== c.lastY) { c.dir = y > c.lastY ? 1 : -1; c.lastY = y }
      publish()
      // Our own glide, a finger on the glass, or a fling still running: leave
      // it be. Otherwise (keys, scrollbar, a fling that just ran out) settle
      // once the page has gone quiet.
      if (c.anim || c.holding) return
      scheduleSnap(90)
    }

    const onWheel = (e) => {
      if (e.ctrlKey) return // pinch-zoom on a trackpad
      const dy = e.deltaY
      if (!dy || Math.abs(dy) < Math.abs(e.deltaX)) return
      if (c.anim) {
        // Mid-glide the wheel steers, it does not scroll: a notch the same
        // way is swallowed, a notch the other way turns the glide round.
        e.preventDefault()
        if (Math.sign(dy) !== c.anim.dir) {
          const b = bounds()
          if (b) glideTo(dy > 0 ? b.end : b.start)
        }
        return
      }
      if (innerCanScroll(e.target, dy)) return
      const b = bounds()
      if (!b) return
      const y = window.scrollY
      if (dy > 0 && y < b.end - 1 && y + dy > b.start) {
        // Coming down the grid, a notch that would carry past the menu's
        // resting point stops on it, so the landmark is seen before the next
        // notch takes the page to the lounge.
        e.preventDefault()
        glideTo(y < b.start - 1 ? b.start : b.end)
      } else if (dy < 0 && y > b.start + 1) {
        e.preventDefault()
        glideTo(b.start)
      }
    }

    // A finger on the glass grabs the page, including out of a glide already
    // under way, so the reveal can be caught and held at any point.
    const onTouchStart = () => {
      bounds()
      c.holding = true
      clearTimeout(c.settle)
      stop()
    }
    const onTouchEnd = (e) => {
      if (e.touches && e.touches.length) return
      c.holding = false
      // Longer than the scroll handler's wait: a fling's first frame can lag
      // the lift by a frame or two, and snapping before it would fight it.
      scheduleSnap(140)
    }
    // Dragging the scrollbar is a held scroll too. Its mousedown lands on the
    // root element, which nothing else on the page can be the target of.
    const onMouseDown = (e) => {
      if (e.target === document.documentElement) { c.holding = true; stop() }
    }
    const onMouseUp = () => {
      if (!c.holding) return
      c.holding = false
      scheduleSnap(90)
    }

    publish()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', remeasure)
    // The page's height changes under it too (the grid above settling, the
    // chat filling in), which a resize event never reports.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure)
    ro?.observe(document.body)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      clearTimeout(c.settle)
      stop()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', remeasure)
    ro?.disconnect()
    c.bounds = undefined
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [enabled, store, bounds, glideTo, stop, panelRef])

  return { progress: store, goToLounge }
}
