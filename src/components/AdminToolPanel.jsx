import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A small floating window holding the admin tools for the page it is rendered
// on. Each page passes its own tools as children and renders this only for
// admins; the window itself knows nothing about any page.
//
//   <AdminToolPanel title="Profile">…tools…</AdminToolPanel>
//
// `wide` suits a page with a lot of admin content; the body scrolls rather
// than letting the window grow past the screen. Long content reads best split
// into <AdminToolSection>s, which fold away individually.
//
// Dragged by its title bar (mouse, pen or touch); a tap on the title bar that
// did not move collapses it to just the bar. Position and collapsed state are a
// per-browser convenience, shared by every page so the window stays where the
// admin put it as they move around, and pulled back on screen if the window
// shrinks. Portalled to <body> so no page container can clip or offset it.
//
// z-[45]: above the nav (z-40) so it can sit over the mobile bottom bar, below
// modals (z-50) so it never covers a dialog the admin needs to answer.

const STORAGE_KEY = 'skywatch:adminToolPanel'
const MARGIN = 8
// Default spot: bottom right, clear of the mobile bottom nav.
const DEFAULT_RIGHT = 16
const DEFAULT_BOTTOM = 96
// Movement (px) before a press on the title bar counts as a drag, not a tap.
const DRAG_THRESHOLD = 4

function readStored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return v && typeof v === 'object' ? v : null
  } catch { return null }
}

function writeStored(v) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch { /* storage blocked */ }
}

function clamp(pos, el) {
  const w = el?.offsetWidth ?? 0
  const h = el?.offsetHeight ?? 0
  const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN)
  return {
    x: Math.min(Math.max(pos.x, MARGIN), maxX),
    y: Math.min(Math.max(pos.y, MARGIN), maxY),
  }
}

export default function AdminToolPanel({ title, wide = false, children }) {
  const ref = useRef(null)
  const drag = useRef(null)
  const stored = useRef(readStored())
  const [collapsed, setCollapsed] = useState(() => stored.current?.collapsed === true)
  // null until measured: the default spot depends on the window's own size.
  const [pos, setPos] = useState(null)
  const posRef = useRef(null)
  posRef.current = pos

  // Place on mount, and re-clamp whenever the size changes (collapse, content).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(prev => {
      const s = stored.current
      const start = prev
        ?? (Number.isFinite(s?.x) && Number.isFinite(s?.y)
          ? { x: s.x, y: s.y }
          : {
              x: window.innerWidth - el.offsetWidth - DEFAULT_RIGHT,
              y: window.innerHeight - el.offsetHeight - DEFAULT_BOTTOM,
            })
      return clamp(start, el)
    })
  }, [collapsed])

  useEffect(() => {
    const onResize = () => setPos(p => (p ? clamp(p, ref.current) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persist = useCallback((next) => {
    stored.current = { ...stored.current, ...next }
    writeStored(stored.current)
  }, [])

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    if (!pos) return
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.moved = true
    setPos(clamp({ x: d.ox + dx, y: d.oy + dy }, ref.current))
  }

  const onPointerUp = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (d.moved) {
      if (posRef.current) persist({ x: posRef.current.x, y: posRef.current.y })
    } else {
      toggleCollapsed()
    }
  }

  const toggleCollapsed = () => {
    persist({ collapsed: !collapsed })
    setCollapsed(!collapsed)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed() }
  }

  return createPortal(
    <section
      ref={ref}
      aria-label={`Admin tools: ${title}`}
      className={`fixed z-[45] ${wide ? 'w-80' : 'w-64'} max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] flex flex-col rounded-xl border border-brand-300/50 bg-surface-raised card-shadow overflow-hidden`}
      style={pos ? { left: pos.x, top: pos.y } : { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM, visibility: 'hidden' }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        title="Drag to move. Tap to show or hide."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={onKeyDown}
        className="shrink-0 flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none touch-none bg-brand-100/60"
      >
        <span aria-hidden="true" className="text-slate-500 text-xs tracking-tighter leading-none">⋮⋮</span>
        <span className="flex-1 min-w-0 truncate text-[10px] font-extrabold uppercase tracking-[0.15em] text-brand-600">
          Admin tools · {title}
        </span>
        <span aria-hidden="true" className="text-slate-500 text-xs">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3 border-t border-slate-200 space-y-2">
          {children}
        </div>
      )}
    </section>,
    document.body,
  )
}

// A titled block inside the panel that folds away on its own. Open by default;
// the choice lasts until the page is left, which is all a reference card needs.
export function AdminToolSection({ title, right, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-slate-200 first:border-t-0 pt-2 first:pt-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 text-left py-0.5"
      >
        <span className="flex-1 min-w-0 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{title}</span>
        {right}
        <span aria-hidden="true" className="text-slate-500 text-[10px]">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  )
}
