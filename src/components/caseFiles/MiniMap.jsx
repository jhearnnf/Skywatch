/**
 * MiniMap
 * Bottom-right thumbnail of the corkboard for the mobile pan/zoom view.
 * Shows card positions as small dots, committed connections as red lines,
 * and the current viewport as a brand-600 rectangle.
 *
 * All coords are in BOARD space; SVG viewBox handles the scaling so we
 * don't have to pre-multiply anything.
 *
 * Props
 *   boardSize     { width, height }
 *   cardSize      { width, height }
 *   positions     Map<itemId, { x, y }>   ← top-left corner of each card
 *   connections   [{ fromItemId, toItemId }, ...]
 *   selectedItemId? string
 *   viewport      { x, y, width, height } — visible region in board coords
 *   thumbWidth?   number — rendered width in px (default 90)
 */

const COMMITTED_COLOR = '#c0392b'
const VIEWPORT_COLOR  = '#5baaff'  // brand-600

export default function MiniMap({
  boardSize,
  cardSize,
  positions,
  connections = [],
  selectedItemId,
  viewport,
  thumbWidth = 90,
}) {
  if (!boardSize?.width || !boardSize?.height || !positions) return null

  // Maintain board aspect ratio
  const aspect = boardSize.height / boardSize.width
  const thumbHeight = Math.round(thumbWidth * aspect)

  const cardW = cardSize?.width  ?? 150
  const cardH = cardSize?.height ?? 200

  return (
    <div
      data-testid="evidence-minimap"
      className="absolute bottom-3 right-3 rounded-sm border border-brand-600/40 bg-[#06101e]/85 backdrop-blur-sm shadow-lg pointer-events-none"
      style={{
        width:  thumbWidth,
        height: thumbHeight,
        zIndex: 30,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${boardSize.width} ${boardSize.height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
      >
        {/* Connection lines */}
        {connections.map(({ fromItemId, toItemId }, i) => {
          const a = positions.get(fromItemId)
          const b = positions.get(toItemId)
          if (!a || !b) return null
          const ax = a.x + cardW / 2
          const ay = a.y + cardH / 2
          const bx = b.x + cardW / 2
          const by = b.y + cardH / 2
          return (
            <line
              key={`${fromItemId}::${toItemId}::${i}`}
              x1={ax}
              y1={ay}
              x2={bx}
              y2={by}
              stroke={COMMITTED_COLOR}
              strokeWidth={Math.max(8, boardSize.width * 0.006)}
              strokeLinecap="round"
              opacity={0.85}
            />
          )
        })}

        {/* Card dots */}
        {[...positions.entries()].map(([id, { x, y }]) => {
          const cx = x + cardW / 2
          const cy = y + cardH / 2
          const isSelected = id === selectedItemId
          return (
            <circle
              key={id}
              cx={cx}
              cy={cy}
              r={Math.max(20, boardSize.width * 0.014)}
              fill={isSelected ? VIEWPORT_COLOR : '#dbe5f3'}
              opacity={isSelected ? 1 : 0.75}
            />
          )
        })}

        {/* Current viewport rectangle */}
        {viewport && (
          <rect
            x={viewport.x}
            y={viewport.y}
            width={viewport.width}
            height={viewport.height}
            fill={VIEWPORT_COLOR}
            fillOpacity={0.08}
            stroke={VIEWPORT_COLOR}
            strokeWidth={Math.max(10, boardSize.width * 0.005)}
            strokeOpacity={0.9}
          />
        )}
      </svg>
    </div>
  )
}
