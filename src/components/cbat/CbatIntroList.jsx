import { useLayoutEffect, useRef, useState } from 'react'

// The instructions list on a CBAT game's intro page, as a box that scrolls on
// its own when the page would otherwise be taller than the window.
//
// Desktop (lg+) only. The whole intro page should fit one screen there, so the
// list takes whatever height is left after everything above and below it (the
// title, the mode row, the panels and Start under it) and scrolls inside that.
// On a phone the page scrolls as normal: a scroll box inside a short screen is
// worse than the page scrolling.
//
// A "Scroll for more" fade sits over the bottom of the list while there is more
// below, so nobody mistakes the cut-off for the end of the instructions.
const LG = '(min-width: 1024px)'
// Below this the list is too short to read; the page scrolls instead.
const MIN_PX = 160

// Space under `el` down to the bottom of `stop` (the page's <main>): the bottom
// padding and border of every ancestor up to and including it, plus in-flow
// siblings below it in a column. Siblings in a row or grid sit beside it, not
// under it (the joystick panels), so they are skipped.
//
// It stops at <main> on purpose. Above that are the shell and, while the page
// is changing, the outgoing page fading out beside this one. Counting that
// page (as walking to <body> did) took its whole height off the list, and
// nothing measured again once it had gone.
function spaceBelow(el, stop) {
  let total = parseFloat(getComputedStyle(el).marginBottom) || 0
  let node = el
  while (node.parentElement && node !== stop && node !== document.body) {
    const parent = node.parentElement
    const pcs = getComputedStyle(parent)
    const beside = pcs.display.includes('grid')
      || (pcs.display.includes('flex') && pcs.flexDirection.startsWith('row'))
    if (!beside) {
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        const cs = getComputedStyle(sib)
        if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue
        total += sib.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
      }
    }
    total += (parseFloat(pcs.paddingBottom) || 0) + (parseFloat(pcs.borderBottomWidth) || 0)
    node = parent
  }
  return total
}

export default function CbatIntroList({ className = '', children }) {
  const ref = useRef(null)
  const [more, setMore] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const mq = window.matchMedia?.(LG)

    const update = () => {
      const scrollable = el.scrollHeight - el.clientHeight > 1
      setMore(scrollable && el.scrollTop + el.clientHeight < el.scrollHeight - 4)
    }

    const fit = () => {
      if (!mq?.matches) {
        el.style.maxHeight = ''
        el.style.overflowY = ''
        update()
        return
      }
      // <main> is the scroller while the desktop chat is docked; else the
      // window. Either way the page's own content ends at <main>.
      const main = document.querySelector('.app-shell-main')
      const docked = document.body.classList.contains('cbat-dock-reserve')
      const rect = el.getBoundingClientRect()
      const room = docked && main
        ? main.getBoundingClientRect().bottom - (rect.top + main.scrollTop) - spaceBelow(el, main)
        : window.innerHeight - (rect.top + window.scrollY) - spaceBelow(el, main)
      el.style.maxHeight = `${Math.max(MIN_PX, Math.floor(room))}px`
      el.style.overflowY = 'auto'
      update()
    }

    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fit()) : null
    // The list's content, and the card around it (personal best loading in,
    // a mode switch changing the copy) both move the room available.
    if (ro) {
      ro.observe(el)
      if (el.firstElementChild) ro.observe(el.firstElementChild)
      if (el.parentElement) ro.observe(el.parentElement)
      // And the page as a whole: the outgoing page leaving after a route
      // change, or anything above the card changing height.
      const content = document.querySelector('.app-shell-content')
      if (content) ro.observe(content)
    }
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', fit)
    mq?.addEventListener?.('change', fit)
    return () => {
      ro?.disconnect()
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', fit)
      mq?.removeEventListener?.('change', fit)
    }
  }, [])

  return (
    <div ref={ref} className={`relative scrollbar-inset ${className}`} data-testid="cbat-intro-list">
      {children}
      <div
        aria-hidden="true"
        className={`sticky -bottom-4 lg:-bottom-6 -mx-4 lg:-mx-6 !mt-0 h-0 pointer-events-none transition-opacity duration-200 ${more ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="absolute inset-x-0 bottom-0 h-16 flex items-end justify-center pb-2 bg-gradient-to-t from-game-arena via-game-arena/90 to-transparent">
          <span className="text-[11px] font-bold uppercase tracking-wide text-brand-600">Scroll for more ↓</span>
        </div>
      </div>
    </div>
  )
}
