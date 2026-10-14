import { useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'

// How much room a game stage has before the page would scroll: its own width,
// and the height from its top edge down to the bottom of the viewport less
// everything that still has to sit under it (the shell's bottom padding, any
// in-flow siblings after it). A game sizes its square arena from this so the
// whole run fits on one screen, instead of guessing the chrome above it with
// calc(100vh - Npx), which broke as soon as the header changed height.
//
// Neither number depends on the stage's own height, so sizing the stage from
// them and re-measuring settles on the first pass.
//
// Returns null until measured (and while disabled), else
// { width, height, wide } where `wide` is md+ (768px), the width the games
// switch from stacked to side-by-side.

// Space under `el` to the end of the document: padding and borders of every
// ancestor, plus in-flow siblings that follow it in a column. Siblings in a
// row (flex row, grid) sit beside it, not under it, so they are skipped.
export function trailingSpace(el) {
  let total = parseFloat(getComputedStyle(el).marginBottom) || 0
  let node = el
  while (node.parentElement && node !== document.body) {
    const parent = node.parentElement
    const pcs = getComputedStyle(parent)
    const beside = pcs.display.includes('grid')
      || (pcs.display.includes('flex') && pcs.flexDirection.startsWith('row'))
    if (!beside) {
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        const s = getComputedStyle(sib)
        if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue
        total += sib.offsetHeight + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0)
      }
    }
    total += (parseFloat(pcs.paddingBottom) || 0) + (parseFloat(pcs.borderBottomWidth) || 0)
    node = parent
  }
  return total
}

export function useViewportFit(ref, enabled = true) {
  const [fit, setFit] = useState(null)

  useLayoutEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    // `sync` is for the observers below. Their callbacks run before the browser
    // paints, and flushing the new size there means a changed page is never
    // drawn with the arena still at its old size. (Not from the layout effect
    // itself: React already applies that update before paint, and flushSync
    // inside a lifecycle is an error.)
    const measure = (sync) => {
      const rect   = el.getBoundingClientRect()
      const docTop = rect.top + window.scrollY
      const height = Math.floor(window.innerHeight - docTop - trailingSpace(el))
      const width  = Math.floor(el.clientWidth)
      const wide   = window.matchMedia ? window.matchMedia('(min-width: 768px)').matches : true
      const update = () => setFit(prev => (prev && prev.width === width && prev.height === height && prev.wide === wide)
        ? prev
        : { width, height, wide })
      if (sync === true) flushSync(update)
      else update()
    }
    const measureSync = () => measure(true)

    measure()
    window.addEventListener('resize', measureSync)
    // The shell eases its padding when a game goes immersive (300ms on
    // .app-shell-main), so the first measure sees it mid-change. The shell is
    // min-h-screen, so the body does not resize as it settles and the
    // ResizeObserver never hears of it; the end of the transition does.
    document.addEventListener('transitionend', measureSync)
    // The stage's width moves with the window, and the chrome above it (the
    // header, the shell's padding) can change height after mount.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureSync) : null
    ro?.observe(el)
    ro?.observe(document.body)
    // The shell is restyled by classes on <body> and on .app-shell (a game's
    // body class, the chat dock's reserved column, immersive mode). None of
    // those has to change the body's size, so watch for them directly.
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(measureSync) : null
    mo?.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })
    const shell = document.querySelector('.app-shell')
    if (shell) mo?.observe(shell, { attributes: true, attributeFilter: ['class'] })
    return () => {
      window.removeEventListener('resize', measureSync)
      document.removeEventListener('transitionend', measureSync)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [ref, enabled])

  return enabled ? fit : null
}

export default useViewportFit
