/**
 * RelationshipLine
 * Renders a thin SVG line between two actor card centres on the pinboard.
 * The SVG is absolutely positioned and fills the pinboard container —
 * the parent must give its container `position: relative`.
 *
 * Props
 *   from    { x, y }  — start point in container-relative px
 *   to      { x, y }  — end point in container-relative px
 *   label?  string    — optional relationship label rendered at midpoint
 *   width   number    — SVG canvas width (match container clientWidth)
 *   height  number    — SVG canvas height (match container clientHeight)
 */

// CONTRACT-AMBIGUITY: spec says "blue/grey" for lines. Using slate-400 (#4a6282)
// at low opacity so lines recede behind cards; no new colour token needed.

const LINE_COLOR   = '#4a6282'   // slate-400
const LINE_OPACITY = 0.35

export default function RelationshipLine({ from, to, label, width = 1000, height = 600 }) {
  if (!from || !to) return null

  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2

  const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`

  return (
    <svg
      aria-hidden="true"
      data-testid="relationship-line-svg"
      width={width}
      height={height}
      style={{
        position:      'absolute',
        inset:         0,
        width,
        height,
        pointerEvents: 'none',
        overflow:      'visible',
        zIndex:        0,
      }}
    >
      {/* Main line */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={LINE_COLOR}
        strokeWidth={1.5}
        strokeOpacity={LINE_OPACITY}
        strokeLinecap="round"
      />

      {/* Label chip at midpoint */}
      {label ? (
        <foreignObject
          x={mx - 40}
          y={my - 10}
          width={80}
          height={20}
          style={{ pointerEvents: 'none' }}
        >
          <div
            data-testid="relationship-line-label"
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              width:           '80px',
              height:          '20px',
              fontSize:        '9px',
              fontWeight:      '600',
              letterSpacing:   '0.05em',
              textTransform:   'uppercase',
              color:           '#6880a0',   /* slate-500 */
              background:      'rgba(12,24,41,0.80)',  /* surface ~80% */
              borderRadius:    '9999px',
              border:          '1px solid rgba(72,98,130,0.30)',
              whiteSpace:      'nowrap',
              overflow:        'hidden',
              textOverflow:    'ellipsis',
              padding:         '0 4px',
            }}
          >
            {label}
          </div>
        </foreignObject>
      ) : null}
    </svg>
  )
}
