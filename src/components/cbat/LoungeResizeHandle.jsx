import { useRef, useState } from 'react'

// Neither card is ever dragged smaller than this.
const MIN_PX = 120
// Arrow-key step, as a share of the column.
const KEY_STEP = 0.05

// The chat's flex weight against Recent Scores' 1 on arrival: an even
// split. Not remembered: every visit to the page starts here.
export const DEFAULT_LOUNGE_GROW = 1

// The gap between Recent Scores and the lounge chat in the CBAT side column,
// made draggable. Sits between the two cards in the column's flex flow with no
// height of its own: the hit area hangs into the lounge's top margin, so the
// layout is identical with or without it.
//
// The split is a flex weight (`grow`, the chat's weight against Recent Scores'
// 1) rather than a pixel height, so it survives the window being resized.
export default function LoungeResizeHandle({ onChange, onDragChange }) {
  const ref = useRef(null)
  const dragRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  // The two cards either side, and the height they share.
  const cards = () => {
    const scores = ref.current?.previousElementSibling
    const chat   = ref.current?.nextElementSibling
    if (!scores || !chat) return null
    return { chat, total: scores.offsetHeight + chat.offsetHeight }
  }

  const growFor = (chatPx, total) => {
    const clamped = Math.min(Math.max(chatPx, MIN_PX), total - MIN_PX)
    return clamped / (total - clamped)
  }

  const onPointerDown = (e) => {
    const c = cards()
    if (!c) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startChat: c.chat.offsetHeight, total: c.total }
    setDragging(true)
    onDragChange?.(true)
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    // Dragging up makes the chat taller.
    onChange(growFor(d.startChat + (d.startY - e.clientY), d.total))
  }

  const endDrag = () => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    onDragChange?.(false)
  }

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const c = cards()
    if (!c) return
    e.preventDefault()
    const step = c.total * KEY_STEP * (e.key === 'ArrowUp' ? 1 : -1)
    onChange(growFor(c.chat.offsetHeight + step, c.total))
  }

  return (
    <div ref={ref} className="relative h-0 shrink-0 z-10">
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize Recent Scores and the chat"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="group absolute inset-x-0 top-0 h-3 cursor-row-resize touch-none outline-none flex items-center justify-center"
      >
        <span
          aria-hidden="true"
          className={`h-1 rounded-full transition-all duration-200 ${dragging
            ? 'w-16 bg-brand-500'
            : 'w-10 bg-slate-300 group-hover:w-16 group-hover:bg-brand-500 group-focus-visible:w-16 group-focus-visible:bg-brand-500'}`}
        />
        {!dragging && (
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full mb-1 whitespace-nowrap rounded-md border border-game-line bg-surface-raised px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-300 group-focus-visible:opacity-100"
          >
            Drag to resize
          </span>
        )}
      </div>
    </div>
  )
}
