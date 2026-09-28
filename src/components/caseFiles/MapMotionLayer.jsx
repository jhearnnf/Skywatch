/**
 * MapMotionLayer — the moving part of the Case Files map.
 *
 * The live map used to state what happened by putting a dot at the end of a
 * journey. "Russia fired missiles from Crimea at Kherson" arrived as two rings
 * with no relationship between them, and a player had to already know the
 * story to read it. This layer plays the journey instead: the missile leaves
 * Crimea, arcs across, and detonates on Kherson, on a loop, so the event is
 * legible without a caption.
 *
 * Props
 *   movements  [{ id, side, kind, fromHotspotId, toHotspotId, animationMs }]
 *   hotspots   [{ id, label, lat, lng }]
 *   showLabels boolean — draw the plain-English kind label beside each route
 *
 * How it renders
 *   An absolutely positioned <svg> laid over MapCanvas, which provides the
 *   projection through MapProjectionContext with the same two methods Leaflet's
 *   map object had (getSize, latLngToContainerPoint), so screen-space container
 *   points are SVG user units with no extra transform.
 *
 *   One requestAnimationFrame loop mutates SVG attributes directly through refs
 *   and never calls setState. That matters twice over: it keeps a 60fps
 *   animation out of React's render path, and because the loop re-projects
 *   lat/lng every frame, the artwork stays glued to the map through pans and
 *   zooms without subscribing to a single map event.
 */

import React, { useEffect, useMemo, useRef, useId } from 'react'
import { useMapProjection } from '../../utils/caseFiles/mapProjection'
import { lookupHotspot } from '../../utils/caseFiles/mapHelpers'
import {
  kindStyle,
  sideColor,
  controlPoint,
  bezierPoint,
  bezierHeading,
  bezierLength,
  bezierLengthTo,
  bezierPath,
  cyclePhase,
  trailDash,
  staggerDelay,
  labelAnchor,
} from '../../utils/caseFiles/motionGeometry'

// Blast ring grows from the impact point to this radius over the hold.
const BLAST_MAX_R  = 34
// Paratroop dots fall this far below the drop point.
const DROP_FALL_PX = 22
const DROP_COUNT   = 3

// ── Head glyphs ──────────────────────────────────────────────────────────────
// Drawn nose-right at the origin; the loop rotates each one to its heading.

function HeadGlyph({ kind, color }) {
  if (kind === 'missile') {
    // A missile you can actually see: pale body, coloured nose and fins, and
    // a flickering exhaust. The old 12px dart vanished under its own trail.
    return (
      <g transform="scale(1.25)">
        <path className="cf-missile-flame" d="M -9 0 L -15 -2.6 L -21 0 L -15 2.6 Z" fill="#ffb347" />
        <path className="cf-missile-flame" d="M -9 0 L -13 -1.3 L -16 0 L -13 1.3 Z" fill="#fff4d6" />
        <path d="M -9 -1.7 L -12.5 -5.2 L -6.5 -1.7 Z M -9 1.7 L -12.5 5.2 L -6.5 1.7 Z" fill={color} stroke="#ffffff" strokeWidth="0.4" strokeLinejoin="round" />
        <rect x="-9.5" y="-1.8" width="15" height="3.6" rx="1.2" fill="#e8eef7" stroke={color} strokeWidth="0.6" />
        <path d="M 5.5 -1.8 Q 10.5 -0.6 11.5 0 Q 10.5 0.6 5.5 1.8 Z" fill={color} stroke="#ffffff" strokeWidth="0.4" />
      </g>
    )
  }
  if (kind === 'air') {
    // A dart: long nose, swept fins.
    return (
      <path
        d="M 9 0 L -3 3.2 L -1 0 L -3 -3.2 Z"
        fill={color}
        stroke="#ffffff"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    )
  }
  if (kind === 'airborne') {
    // A swept-wing aircraft silhouette.
    return (
      <path
        d="M 10 0 L 2 2 L -2 2 L -5 6 L -7 6 L -5 1.6 L -8 1.6 L -9.5 3 L -10.5 3 L -10 0 L -10.5 -3 L -9.5 -3 L -8 -1.6 L -5 -1.6 L -7 -6 L -5 -6 L -2 -2 L 2 -2 Z"
        fill={color}
        stroke="#ffffff"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    )
  }
  if (kind === 'naval') {
    return (
      <path
        d="M 9 0 L 3 3 L -8 3 L -6 -3 L 3 -3 Z"
        fill={color}
        stroke="#ffffff"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    )
  }
  // convoy / armour / anything unknown: a marching double chevron.
  return (
    <g fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M -5 -4 L 1 0 L -5 4" />
      <path d="M 1 -4 L 7 0 L 1 4" />
    </g>
  )
}

// ── One movement's artwork ───────────────────────────────────────────────────
// Every element the animation loop touches is handed back through `register`
// so the loop can address them without a React re-render.

function Movement({ movement, index, color, style, register, showLabel }) {
  const refs   = useRef({})
  // Filter ids are document-global; two maps on one page would otherwise share
  // (and fight over) the same glow definition.
  const glowId = useId()

  useEffect(() => {
    register(index, refs.current)
    return () => register(index, null)
  }, [index, register])

  const glow = `cf-glow-${glowId.replace(/:/g, '')}-${index}`

  return (
    <g data-testid={`map-motion-${movement.id ?? index}`}>
      <defs>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* The route, faint, so the whole journey is visible before the head
          reaches the far end. */}
      <path
        ref={(el) => { refs.current.track = el }}
        fill="none"
        stroke={color}
        strokeWidth="1.1"
        strokeOpacity="0.28"
        strokeDasharray="3 7"
        strokeLinecap="round"
      />

      {/* Comet tail: the same path, lit only for the stretch behind the head. */}
      <path
        ref={(el) => { refs.current.trail = el }}
        fill="none"
        stroke={color}
        strokeWidth={style.width}
        strokeLinecap="round"
        filter={`url(#${glow})`}
      />

      {/* Blast / arrival ring at the destination. */}
      <circle
        ref={(el) => { refs.current.blast = el }}
        fill="none"
        stroke={color}
        strokeWidth="2"
        r="0"
        opacity="0"
      />

      {/* Paratroop dots — only ever shown for an airborne drop. */}
      {style.impact === 'drop' && (
        <g ref={(el) => { refs.current.drop = el }} opacity="0">
          {Array.from({ length: DROP_COUNT }).map((_, i) => (
            <circle
              key={i}
              ref={(el) => { refs.current[`drop${i}`] = el }}
              r="2.2"
              fill={color}
              stroke="#ffffff"
              strokeWidth="0.5"
            />
          ))}
        </g>
      )}

      {/* The moving piece itself. */}
      {movement.behavior === 'stall' && (
        <g data-testid="stalled-convoy" opacity="0" ref={el => { refs.current.convoy = el }}>
          {Array.from({ length: 5 }, (_, i) => (
            <g key={i} ref={el => { refs.current[`truck${i}`] = el }}>
              <rect x="-5" y="-3" width="8" height="6" rx="1" fill={color} stroke="#fff" strokeWidth="0.7" />
              <rect x="3" y="-2.5" width="3" height="5" rx="0.8" fill="#e2e8f0" />
              <path d="M -3 -4 H 0 M -3 4 H 0" stroke="#06101e" strokeWidth="2" />
            </g>
          ))}
          <g ref={el => { refs.current.stallBadge = el }} opacity="0">
            <rect x="-48" y="-12" width="96" height="24" rx="5" fill="#06101e" stroke="#fbbf24" />
            <path d="M -37 -5 V 5 M -32 -5 V 5" stroke="#fbbf24" strokeWidth="3" />
            <text x="8" y="4" textAnchor="middle" fill="#fbbf24" fontSize="10" fontFamily="monospace" fontWeight="bold">STALLED</text>
          </g>
        </g>
      )}
      <g ref={(el) => { refs.current.head = el }} filter={`url(#${glow})`} opacity="0">
        <HeadGlyph kind={movement.kind} color={color} />
      </g>

      {/* Plain-English label beside the route. Drawn twice: a dark stroked copy
          underneath so it survives light coastline tiles. Both are parked
          off-canvas until the first frame places them, otherwise they flash in
          the top-left corner on mount. */}
      {showLabel && (
        <g ref={(el) => { refs.current.label = el }} opacity="0.9">
          <text
            ref={(el) => { refs.current.labelBg = el }}
            x="-9999"
            y="-9999"
            textAnchor="middle"
            className="cf-motion-label"
            stroke="#06101e"
            strokeWidth="3.5"
            strokeLinejoin="round"
            fill="#06101e"
          >
            {style.label}
          </text>
          <text
            ref={(el) => { refs.current.labelFg = el }}
            x="-9999"
            y="-9999"
            textAnchor="middle"
            className="cf-motion-label"
            fill={color}
          >
            {style.label}
          </text>
        </g>
      )}
    </g>
  )
}

// ── MapMotionLayer ───────────────────────────────────────────────────────────

export default function MapMotionLayer({ movements = [], hotspots = [], showLabels = true }) {
  const map      = useMapProjection()
  const svgRef   = useRef(null)
  const nodeRefs = useRef([])
  const frameRef = useRef(null)

  // A movement whose hotspots are not on this map is dropped rather than
  // drawn from nowhere to nowhere.
  const plans = useMemo(
    () =>
      movements
        .map((movement, index) => {
          const from = lookupHotspot(hotspots, movement.fromHotspotId)
          const to   = lookupHotspot(hotspots, movement.toHotspotId)
          if (!from || !to) return null
          const style = kindStyle(movement.kind)
          return {
            index,
            from,
            to,
            style,
            stalled: movement.behavior === 'stall',
            travelMs: movement.animationMs ?? style.travelMs,
            delayMs:  staggerDelay(index),
          }
        })
        .filter(Boolean),
    [movements, hotspots]
  )

  // The loop reads plans through a ref so a content change never restarts the
  // animation mid-flight — a re-render must not send everything back to its
  // launch point.
  const plansRef = useRef(plans)
  useEffect(() => {
    plansRef.current = plans
  }, [plans])

  const register = React.useCallback((index, node) => {
    nodeRefs.current[index] = node
  }, [])

  useEffect(() => {
    if (!map) return undefined

    const started = performance.now()

    function frame(now) {
      const elapsed = now - started
      const svg = svgRef.current

      if (svg) {
        // getSize is the map's own container measurement, so the overlay tracks
        // a resized map (sidebar opening, orientation change) for free.
        const size = map.getSize?.() ?? { x: 0, y: 0 }
        svg.setAttribute('width', String(size.x))
        svg.setAttribute('height', String(size.y))
        svg.setAttribute('viewBox', `0 0 ${size.x} ${size.y}`)
      }

      for (const plan of plansRef.current) {
        const nodes = nodeRefs.current[plan.index]
        if (!nodes) continue

        let p0
        let p1
        try {
          p0 = map.latLngToContainerPoint([plan.from.lat, plan.from.lng])
          p1 = map.latLngToContainerPoint([plan.to.lat,   plan.to.lng])
        } catch {
          continue
        }

        const c   = controlPoint(p0, p1, plan.style.bend)
        const len = bezierLength(p0, c, p1)
        const d   = bezierPath(p0, c, p1)

        nodes.track?.setAttribute('d', d)
        nodes.trail?.setAttribute('d', d)

        if (plan.stalled && nodes.convoy) {
          // Play once: brake short of the destination, then remain queued.
          // Each following vehicle brakes later, compressing the column.
          nodes.started ??= now
          const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          const age = reduced ? 10000 : now - nodes.started
          nodes.convoy.setAttribute('opacity', '1')
          nodes.head?.setAttribute('opacity', '0')
          nodes.trail?.setAttribute('stroke-opacity', '0')
          nodes.blast?.setAttribute('opacity', '0')
          for (let i = 0; i < 5; i++) {
            const progress = Math.min(1, Math.max(0, (age - i * 220) / 3400))
            const end = 0.70 - i * 0.115
            const t = end * (1 - (1 - progress) ** 3)
            const pt = bezierPoint(p0, c, p1, t)
            nodes[`truck${i}`]?.setAttribute('transform', `translate(${pt.x} ${pt.y}) rotate(${bezierHeading(p0, c, p1, t)})`)
            nodes[`truck${i}`]?.setAttribute('opacity', String(Math.min(1, progress * 8)))
          }
          const stop = bezierPoint(p0, c, p1, 0.70)
          const size = map.getSize()
          const badgeX = Math.max(52, Math.min(size.x - 52, stop.x + 62))
          nodes.stallBadge?.setAttribute('transform', `translate(${badgeX} ${Math.max(16, stop.y - 24)})`)
          nodes.stallBadge?.setAttribute('opacity', String(Math.min(1, Math.max(0, (age - 2800) / 600))))
          continue
        }

        const { t, phase, impactT } = cyclePhase({
          elapsedMs: elapsed,
          travelMs:  plan.travelMs,
          holdMs:    plan.style.holdMs,
          delayMs:   plan.delayMs,
        })

        // ── Comet tail ────────────────────────────────────────────────────
        const travelled = bezierLengthTo(p0, c, p1, t)
        const dash      = trailDash(len, travelled, plan.style.trailPx)
        if (nodes.trail) {
          nodes.trail.setAttribute('stroke-dasharray',  dash.dashArray)
          nodes.trail.setAttribute('stroke-dashoffset', String(dash.dashOffset))
          // Fade the tail out through the hold rather than cutting it, so the
          // loop restart does not read as a glitch.
          nodes.trail.setAttribute(
            'stroke-opacity',
            phase === 'impact' ? String(Math.max(0, 1 - impactT * 1.6)) : '0.95'
          )
        }

        // ── Head ──────────────────────────────────────────────────────────
        if (nodes.head) {
          const pt      = bezierPoint(p0, c, p1, t)
          const heading = bezierHeading(p0, c, p1, Math.min(t, 0.999))
          nodes.head.setAttribute('transform', `translate(${pt.x} ${pt.y}) rotate(${heading})`)
          nodes.head.setAttribute(
            'opacity',
            phase === 'waiting' ? '0' : phase === 'impact' ? String(Math.max(0, 1 - impactT * 2.5)) : '1'
          )
        }

        // ── Impact ────────────────────────────────────────────────────────
        if (nodes.blast) {
          if (phase === 'impact') {
            nodes.blast.setAttribute('cx', String(p1.x))
            nodes.blast.setAttribute('cy', String(p1.y))
            nodes.blast.setAttribute('r',  String(6 + impactT * BLAST_MAX_R))
            nodes.blast.setAttribute('opacity', String(Math.max(0, 0.85 - impactT)))
            nodes.blast.setAttribute('stroke-width', String(3 - impactT * 2))
          } else {
            nodes.blast.setAttribute('opacity', '0')
          }
        }

        // ── Paradrop ──────────────────────────────────────────────────────
        if (nodes.drop) {
          if (phase === 'impact') {
            nodes.drop.setAttribute('opacity', String(Math.max(0, 1 - impactT)))
            for (let i = 0; i < DROP_COUNT; i += 1) {
              const dot = nodes[`drop${i}`]
              if (!dot) continue
              // Stagger the three canopies so they do not fall as one block.
              const local = Math.max(0, Math.min(1, impactT * 1.5 - i * 0.18))
              dot.setAttribute('cx', String(p1.x + (i - 1) * 9))
              dot.setAttribute('cy', String(p1.y + local * DROP_FALL_PX))
            }
          } else {
            nodes.drop.setAttribute('opacity', '0')
          }
        }

        // ── Label ─────────────────────────────────────────────────────────
        if (nodes.labelFg && nodes.labelBg) {
          // Outside the bow rather than on the line between the two places,
          // which is where the hotspots' own name labels live.
          const anchor = labelAnchor(p0, p1)
          const lx = String(anchor.x)
          const ly = String(anchor.y)
          for (const el of [nodes.labelBg, nodes.labelFg]) {
            el.setAttribute('x', lx)
            el.setAttribute('y', ly)
          }
        }
      }

      frameRef.current = requestAnimationFrame(frame)
    }

    frameRef.current = requestAnimationFrame(frame)
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    }
  }, [map])

  if (plans.length === 0) return null

  return (
    <svg
      ref={svgRef}
      data-testid="map-motion-layer"
      className="cf-motion-layer"
      aria-hidden="true"
    >
      {plans.map((plan) => (
        <Movement
          key={movements[plan.index].id ?? `${plan.index}-${plan.from.id}-${plan.to.id}`}
          movement={movements[plan.index]}
          index={plan.index}
          color={sideColor(movements[plan.index].side)}
          style={plan.style}
          register={register}
          showLabel={showLabels}
        />
      ))}
    </svg>
  )
}
