/**
 * CorkboardView
 * Mobile-only pan/zoom corkboard layout for EvidenceWallStage. Cards are
 * placed at deterministic positions on a virtual board larger than the
 * viewport; the user pans (drag) and zooms (pinch) to navigate.
 *
 * In-progress string mechanic (mobile-specific):
 *   When a card is selected, a thin dashed string runs from a pin on the
 *   selected card to the center of the visible viewport. As the user pans,
 *   the anchor end moves with the card while the free end stays glued to
 *   screen center — so panning visibly "pulls" the string. Tapping a second
 *   card commits the connection.
 *
 * Layering (back to front):
 *   1. Corkboard background
 *   2. Cards (inside transform)
 *   3. Committed strings + pin decorations (inside transform, after cards in DOM)
 *   4. In-progress string (outside transform — viewport coords)
 *   5. Mini-map + reset button (outside transform)
 *
 * Props
 *   items                [{ id, title, ... }]
 *   connections          [{ fromItemId, toItemId }]
 *   selectedItemId       string | null
 *   onCardClick          (itemId) => void
 *   onRemoveConnection   (fromId, toId) => void
 *   onPositionsReady?    (Map<itemId, {x,y}>) => void  — center coords; lets parent share posMap if it wants
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import EvidenceCard from './EvidenceCard.jsx'
import RedStringConnector from './RedStringConnector.jsx'
import MiniMap from './MiniMap.jsx'
import { computeCardPositions } from '../../utils/caseFiles/cardLayout.js'

// Shared corkboard background (mirrors EvidenceWallStage so themes match)
const CORKBOARD_BG = {
  backgroundColor: '#0e1c30',
  backgroundImage: [
    'radial-gradient(ellipse 2px 2px at 30% 30%, rgba(91,170,255,0.025) 0%, transparent 100%)',
    'radial-gradient(ellipse 1px 1px at 70% 60%, rgba(91,170,255,0.018) 0%, transparent 100%)',
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.5' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23n)' opacity='0.055'/%3E%3C/svg%3E\")",
  ].join(', '),
  backgroundSize: '300px 300px, 200px 200px, 250px 250px',
}

const PIN_COLOR = '#c0392b'

function makeConnectionKey(fromId, toId) {
  return [fromId, toId].sort().join('::')
}

// Tiny pushpin decoration drawn at a board-coord point
function Pin({ x, y, accent = PIN_COLOR }) {
  return (
    <svg
      aria-hidden="true"
      style={{
        position:      'absolute',
        left:          x - 8,
        top:           y - 8,
        width:         16,
        height:        16,
        pointerEvents: 'none',
        overflow:      'visible',
      }}
    >
      <circle cx={8} cy={8} r={5}   fill={accent}       stroke="#fff" strokeWidth={1.4} />
      <circle cx={6.5} cy={6.5} r={1.4} fill="rgba(255,255,255,0.7)" />
    </svg>
  )
}

export default function CorkboardView({
  items,
  connections,
  selectedItemId,
  onCardClick,
  onRemoveConnection,
  onPositionsReady,
}) {
  // ── Layout (deterministic from items) ────────────────────────────────
  const layout = useMemo(() => computeCardPositions(items), [items])
  const { positions, boardSize, cardSize } = layout

  // Card center coords (top-left + half size) — used for SVG strings
  const centerMap = useMemo(() => {
    const m = new Map()
    for (const [id, pos] of positions) {
      m.set(id, { x: pos.x + cardSize.width / 2, y: pos.y + cardSize.height / 2 })
    }
    return m
  }, [positions, cardSize])

  useEffect(() => {
    onPositionsReady?.(centerMap)
  }, [centerMap, onPositionsReady])

  // ── Container size tracking ──────────────────────────────────────────
  const containerRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setContainerSize({ width, height })
    })
    ro.observe(el)
    // Seed from current size so first render isn't blank
    const r = el.getBoundingClientRect()
    setContainerSize({ width: r.width, height: r.height })
    return () => ro.disconnect()
  }, [])

  // ── Transform state mirror ───────────────────────────────────────────
  // We mirror the wrapper's transform into local state so the overlay SVG
  // (in-progress string) and mini-map can render in sync. Crucially, this
  // must update DURING gestures (panning/zooming) — not just after — so we
  // hook the live callbacks (onPanning/onZoom/onPinching) as well as the
  // post-gesture onTransformed.
  const wrapperApiRef = useRef(null)
  const [transform, setTransform] = useState({ scale: 1, positionX: 0, positionY: 0 })

  const syncTransformFromRef = useCallback((ref) => {
    const s = ref?.state ?? ref?.instance?.transformState
    if (!s) return
    setTransform({
      scale:     s.scale,
      positionX: s.positionX,
      positionY: s.positionY,
    })
  }, [])

  // Fit-to-viewport scale (also used as minScale so user can always see whole board)
  const fitScale = useMemo(() => {
    if (!containerSize.width || !containerSize.height) return 1
    const sx = containerSize.width  / boardSize.width
    const sy = containerSize.height / boardSize.height
    return Math.max(0.1, Math.min(sx, sy) * 0.95)
  }, [containerSize.width, containerSize.height, boardSize.width, boardSize.height])

  // Apply fit-and-center on first measure / when size changes significantly
  const didInitialFitRef = useRef(false)
  useEffect(() => {
    if (didInitialFitRef.current) return
    if (!wrapperApiRef.current || !containerSize.width) return
    const cx = (containerSize.width  - boardSize.width  * fitScale) / 2
    const cy = (containerSize.height - boardSize.height * fitScale) / 2
    wrapperApiRef.current.setTransform(cx, cy, fitScale, 0)
    setTransform({ scale: fitScale, positionX: cx, positionY: cy })
    didInitialFitRef.current = true
  }, [containerSize.width, containerSize.height, fitScale, boardSize.width, boardSize.height])

  const handleResetView = useCallback(() => {
    if (!wrapperApiRef.current) return
    const cx = (containerSize.width  - boardSize.width  * fitScale) / 2
    const cy = (containerSize.height - boardSize.height * fitScale) / 2
    wrapperApiRef.current.setTransform(cx, cy, fitScale, 220)
  }, [containerSize, boardSize, fitScale])

  // ── Derived: viewport rect in board coords (for mini-map) ────────────
  const viewport = useMemo(() => {
    if (!containerSize.width || transform.scale <= 0) return null
    return {
      x:      -transform.positionX / transform.scale,
      y:      -transform.positionY / transform.scale,
      width:   containerSize.width  / transform.scale,
      height:  containerSize.height / transform.scale,
    }
  }, [transform, containerSize])

  // ── In-progress string endpoints (viewport coords, outside transform) ─
  const selectedCenter = selectedItemId ? centerMap.get(selectedItemId) : null
  const anchorVp =
    selectedCenter && transform.scale > 0
      ? {
          x: selectedCenter.x * transform.scale + transform.positionX,
          y: selectedCenter.y * transform.scale + transform.positionY,
        }
      : null
  const freeVp =
    containerSize.width > 0
      ? { x: containerSize.width / 2, y: containerSize.height / 2 }
      : null

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 overflow-hidden"
      style={{ ...CORKBOARD_BG, touchAction: 'none' }}
      data-testid="evidence-wall-board-mobile"
    >
      <TransformWrapper
        ref={wrapperApiRef}
        initialScale={1}
        // minScale = fitScale (full board visible). maxScale = 1.6× fit so the
        // zoom range is narrow and predictable on a small viewport.
        minScale={Math.max(0.25, fitScale)}
        maxScale={Math.max(1.5, fitScale * 1.8)}
        limitToBounds={true}
        centerOnInit={false}
        // CRITICAL: smooth defaults to true, which makes zoomStep = step * |deltaY|.
        // A standard mouse wheel click has deltaY≈100, so even step:0.04 becomes
        // 4.0 per click — instantly flies past the whole zoom range. Disabling
        // smooth makes each tick change scale by exactly `step`.
        smooth={false}
        wheel={{ step: 0.06 }}
        doubleClick={{ disabled: true }}
        panning={{ velocityDisabled: true }}
        pinch={{ step: 4 }}
        onInit={syncTransformFromRef}
        onPanning={syncTransformFromRef}
        onZoom={syncTransformFromRef}
        onPinching={syncTransformFromRef}
        onTransformed={syncTransformFromRef}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: boardSize.width, height: boardSize.height }}
        >
          <div
            className="relative"
            style={{ width: boardSize.width, height: boardSize.height }}
            data-testid="corkboard-content"
          >
            {/* Cards */}
            {items.map(item => {
              const pos = positions.get(item.id)
              if (!pos) return null
              return (
                <EvidenceCard
                  key={item.id}
                  item={item}
                  isSelected={selectedItemId === item.id}
                  onClick={() => onCardClick(item.id)}
                  absolutePosition={pos}
                  cardSize={cardSize}
                />
              )
            })}

            {/* Committed strings — drawn AFTER cards so they sit in front */}
            {connections.map(({ fromItemId, toItemId }) => {
              const from = centerMap.get(fromItemId)
              const to   = centerMap.get(toItemId)
              if (!from || !to) return null
              return (
                <div
                  key={makeConnectionKey(fromItemId, toItemId)}
                  style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                >
                  <RedStringConnector
                    from={from}
                    to={to}
                    committed
                    strokeWidth={1.6}
                    onClick={() => onRemoveConnection(fromItemId, toItemId)}
                    width={boardSize.width}
                    height={boardSize.height}
                  />
                  <Pin x={from.x} y={from.y} />
                  <Pin x={to.x}   y={to.y} />
                </div>
              )
            })}
          </div>
        </TransformComponent>
      </TransformWrapper>

      {/* In-progress string overlay — viewport coords, OUTSIDE transform */}
      {anchorVp && freeVp && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ width: '100%', height: '100%', zIndex: 40, overflow: 'visible' }}
        >
          <path
            d={`M ${anchorVp.x} ${anchorVp.y} L ${freeVp.x} ${freeVp.y}`}
            stroke="#e07070"
            strokeWidth={1.4}
            strokeDasharray="6 4"
            strokeLinecap="round"
            fill="none"
            opacity={0.95}
          />
          {/* Anchor pin (on the selected card) */}
          <circle cx={anchorVp.x} cy={anchorVp.y} r={5.5} fill={PIN_COLOR} stroke="#fff" strokeWidth={1.4} />
          <circle cx={anchorVp.x - 1.6} cy={anchorVp.y - 1.6} r={1.4} fill="rgba(255,255,255,0.75)" />
          {/* Free-end target — small ring at viewport center */}
          <circle cx={freeVp.x} cy={freeVp.y} r={6} fill="none" stroke="#e07070" strokeWidth={1.5} opacity={0.85} />
          <circle cx={freeVp.x} cy={freeVp.y} r={1.8} fill="#e07070" opacity={0.9} />
        </svg>
      )}

      {/* Mini-map */}
      {viewport && positions.size > 0 && (
        <MiniMap
          boardSize={boardSize}
          cardSize={cardSize}
          positions={positions}
          connections={connections}
          selectedItemId={selectedItemId}
          viewport={viewport}
        />
      )}

      {/* Reset view button */}
      <button
        type="button"
        onClick={handleResetView}
        data-testid="corkboard-reset-view"
        className="absolute top-3 right-3 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-brand-600/40 bg-[#06101e]/85 text-brand-600 backdrop-blur-sm"
        style={{ zIndex: 30 }}
        aria-label="Reset view"
      >
        Fit Board
      </button>
    </div>
  )
}
