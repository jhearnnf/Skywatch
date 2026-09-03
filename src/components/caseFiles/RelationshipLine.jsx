/**
 * RelationshipLine
 * Renders a thin SVG line between two actor card centres on the pinboard.
 * The SVG is absolutely positioned and fills the pinboard container —
 * the parent must give its container `position: relative`.
 *
 * Props
 *   from         { x, y }  — start point in container-relative px
 *   to           { x, y }  — end point in container-relative px
 *   width        number    — SVG canvas width (match container clientWidth)
 *   height       number    — SVG canvas height (match container clientHeight)
 *   highlighted? boolean   — brighten the line for the actor being inspected
 *
 * This component draws a line and nothing else, on purpose. It used to carry
 * the relationship label in a chip pinned to the line, which is unreadable on
 * a grid pinboard: every actor in a row shares a y coordinate, so their lines
 * are horizontal and every chip lands in the same strip, on top of the cards
 * and on top of each other ("NATO ALLY" + "SUPPORT" rendering as one run of
 * text). Nudging the chips along their lines only shuffled the collision.
 * The labels now live in ActorInterrogationsStage's connections strip and in
 * the interrogation panel, where they have room and work without a mouse.
 */

// CONTRACT-AMBIGUITY: spec says "blue/grey" for lines. Using slate-400 (#4a6282)
// at low opacity; a highlighted line switches to brand-600 so the relationships
// belonging to one actor stand out from the rest of the web.

const LINE_COLOR      = '#4a6282'   // slate-400
const LINE_OPACITY    = 0.35
const ACTIVE_COLOR    = '#5baaff'   // brand-600
const ACTIVE_OPACITY  = 0.85

export default function RelationshipLine({
  from,
  to,
  width = 1000,
  height = 600,
  highlighted = false,
}) {
  if (!from || !to) return null

  const stroke  = highlighted ? ACTIVE_COLOR   : LINE_COLOR
  const opacity = highlighted ? ACTIVE_OPACITY : LINE_OPACITY

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
      }}
    >
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={stroke}
        strokeWidth={highlighted ? 2 : 1.5}
        strokeOpacity={opacity}
        strokeLinecap="round"
      />
    </svg>
  )
}
