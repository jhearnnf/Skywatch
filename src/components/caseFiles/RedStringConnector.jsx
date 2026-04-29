/**
 * RedStringConnector
 * Renders a single SVG <path> between two absolute corkboard positions.
 * The SVG is absolutely positioned and sized to fill the corkboard container —
 * the caller is responsible for giving the parent `position: relative`.
 *
 * Props
 *   from         {x, y}   — start point in corkboard-relative px
 *   to           {x, y}   — end point in corkboard-relative px
 *   committed    boolean  — true = solid warm red; false = lighter dashed (in-progress)
 *   onClick?     () => void — fires on path click (e.g. to delete the connection)
 *   width        number   — SVG canvas width in px (matches corkboard clientWidth)
 *   height       number   — SVG canvas height in px (matches corkboard clientHeight)
 *   strokeWidth? number   — override default stroke width (mobile uses thinner so card text isn't obscured)
 *   className?   string   — extra classes on the SVG element (e.g. for z-index/positioning)
 *   style?       object   — extra inline style on the SVG element
 */

import { bezierPath } from '../../utils/caseFiles/connectionGeometry.js'

// CONTRACT-AMBIGUITY: spec says "SVG should sit absolutely positioned over
// the corkboard" but doesn't specify whether one SVG covers all strings or
// each string gets its own SVG. Chose one SVG per connection so each can be
// independently clicked / animated without a shared layer managing z-index.

const COMMITTED_COLOR   = '#c0392b'
const UNCOMMITTED_COLOR = '#e07070'

export default function RedStringConnector({
  from,
  to,
  committed = true,
  onClick,
  width  = 1000,
  height = 600,
  strokeWidth: strokeWidthOverride,
  className,
  style: styleOverride,
}) {
  if (!from || !to) return null

  const d = bezierPath(from, to)

  // Stroke widths & style
  const strokeWidth    = strokeWidthOverride ?? (committed ? 2.2 : 1.6)
  const strokeColor    = committed ? COMMITTED_COLOR : UNCOMMITTED_COLOR
  const strokeDasharray = committed ? undefined : '6 4'

  // Shadow/glow for committed strings — a slightly thicker, blurred duplicate
  const hasGlow = committed

  return (
    <svg
      aria-hidden="true"
      className={className}
      style={{
        position:      'absolute',
        inset:         0,
        width,
        height,
        pointerEvents: 'none',
        overflow:      'visible',
        ...styleOverride,
      }}
    >
      {/* Glow layer (committed only) */}
      {hasGlow && (
        <path
          d={d}
          fill="none"
          stroke="rgba(192, 57, 43, 0.28)"
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Main string path — pointer-events on stroke so thin lines are clickable */}
      <path
        d={d}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={strokeDasharray}
        onClick={committed && onClick ? onClick : undefined}
        style={{
          pointerEvents: committed && onClick ? 'stroke' : 'none',
          cursor:        committed && onClick ? 'pointer' : 'default',
        }}
      />

      {/* Invisible wide hit area for easier clicking on committed strings */}
      {committed && onClick && (
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          strokeLinecap="round"
          onClick={onClick}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        />
      )}
    </svg>
  )
}
