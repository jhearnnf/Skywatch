// A small pointer that walks the eye through a step with more than one part to
// it. Shared by the CUT tutorial and the DPT practice mode; the classes it
// wears live in main.css under "Tutorial / practice mode".
//
// Positioned variants hang off the element they point at, which must be
// position:relative: 'down' sits above it, 'up' below it, 'right' to its left
// and 'left' to its right. `inline` instead puts the arrow in normal flow just
// before its anchor, for a line of text or a readout.
const ARROW_CLASS = {
  down: 'cbat-tutorial-arrow',
  up: 'cbat-tutorial-arrow-up',
  right: 'cbat-tutorial-arrow-right',
  left: 'cbat-tutorial-arrow-left',
}
const ARROW_ROTATE = { down: 0, up: 180, right: -90, left: 90 }

// The opposite of an arrow: "this is right, leave it". Sits inline before the
// value it approves of.
export function GuideOk() {
  return (
    <span className="cbat-tutorial-ok" data-guide-ok aria-hidden>{'\u{1F44D}'}</span>
  )
}

export default function GuideArrow({ dir = 'down', inline = false, urgent = false }) {
  const base = inline ? 'cbat-tutorial-arrow-inline' : ARROW_CLASS[dir]
  const sideways = dir === 'right' || dir === 'left'
  const w = sideways ? (urgent ? 30 : 24) : (urgent ? 40 : 32)
  const h = sideways ? (urgent ? 30 : 24) : (urgent ? 46 : 37)
  return (
    <span
      className={`${base} cbat-tutorial-arrow-bright${urgent ? ' cbat-tutorial-arrow-urgent' : ''}`}
      style={!inline && dir === 'down' ? { left: '50%', top: 0 } : undefined}
      data-guide-arrow={dir}
      data-guide-urgent={urgent || undefined}
      aria-hidden
    >
      {/* Big, white-edged and glowing: it has to read from across the board,
          not just up close. */}
      <svg
        width={w}
        height={h}
        viewBox="0 0 24 28"
        style={{ display: 'block', transform: ARROW_ROTATE[dir] ? `rotate(${ARROW_ROTATE[dir]}deg)` : undefined }}
      >
        <path d="M12 27 L3 15 H9 V2 H15 V15 H21 Z" fill="#5baaff" stroke="#ffffff" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
