import { useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { generateSelector } from '../utils/cssSelector'

// In-page overlay that activates when the URL has ?tutorialPicker=1 (typically
// when running inside the admin TutorialPickerModal iframe). Lets the admin
// hover/click any element on the page; the resulting CSS selector is posted
// back to window.parent so the modal can stamp it onto the tutorial step.
//
// Toolbar clicks are excluded so the admin can cancel without picking the
// toolbar itself. Esc cancels.
export default function TutorialPickerOverlay() {
  const [params]      = useSearchParams()
  const location      = useLocation()
  const active        = params.get('tutorialPicker') === '1'
  const [hoveredRect, setHoveredRect] = useState(null)
  const toolbarRef    = useRef(null)

  // Cancel — informs the parent (so it can close the modal) and is the right
  // exit when admin doesn't want to pick anything from this page.
  function cancel() {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'tutorial-picker:cancel' }, window.location.origin)
    }
  }

  useEffect(() => {
    if (!active) return

    function isToolbarTarget(el) {
      return toolbarRef.current && toolbarRef.current.contains(el)
    }

    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || isToolbarTarget(el)) {
        setHoveredRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      setHoveredRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }

    function onClick(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || isToolbarTarget(el)) return

      // Block the page from reacting to this click — we're just picking, not
      // exercising the UI. capture phase + stopImmediate prevents downstream
      // listeners (router links, button onClicks, etc.) from firing.
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation?.()

      const selector = generateSelector(el)
      if (!selector) {
        // eslint-disable-next-line no-alert
        alert('Could not generate a unique CSS selector for that element. Try a different element or type one in by hand.')
        return
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'tutorial-picker:select',
          selector,
          page: location.pathname + location.search.replace(/[?&]tutorialPicker=1/, '').replace(/^&/, '?'),
        }, window.location.origin)
      }
    }

    function onKey(e) { if (e.key === 'Escape') cancel() }

    // Capture so we win the race against page handlers
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click',     onClick, true)
    window.addEventListener('keydown',     onKey,   true)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click',     onClick, true)
      window.removeEventListener('keydown',     onKey,   true)
    }
  }, [active, location.pathname, location.search])

  if (!active) return null

  return (
    <>
      {/* Hover outline — fixed positioning so it tracks scroll/zoom correctly */}
      {hoveredRect && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top:    hoveredRect.top,
            left:   hoveredRect.left,
            width:  hoveredRect.width,
            height: hoveredRect.height,
            pointerEvents: 'none',
            border: '2px dashed #f59e0b',
            background: 'rgba(245, 158, 11, 0.12)',
            zIndex: 2147483646,
            borderRadius: 4,
            transition: 'all 60ms linear',
          }}
        />
      )}

      {/* Toolbar — clicks here don't pick. Stays above hover outline. */}
      <div
        ref={toolbarRef}
        style={{
          position: 'fixed',
          top: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 2147483647,
          background: '#0c1829',
          color: '#ddeaf8',
          border: '1px solid #5baaff',
          borderRadius: 12,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}
      >
        <span>🎯 Hover and click any element to highlight it</span>
        <button
          type="button"
          onClick={cancel}
          style={{
            background: '#102040',
            color: '#ddeaf8',
            border: '1px solid #1e3a5f',
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </>
  )
}
