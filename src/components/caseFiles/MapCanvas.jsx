/**
 * MapCanvas — the Case Files tactical map: a war-room LED table.
 *
 * Props:
 *   bounds            { south, west, north, east } — the area the map fits
 *   hotspots          [{ id, label, lat, lng, kind, tooltip? }]
 *   axes?             [{ id, fromHotspotId, toHotspotId, color?, dashed?, animated? }]
 *   units?            [{ id, side, kind, fromHotspotId, toHotspotId, animationMs }]
 *                     — static arrival rings, one per unit, at fromHotspotId.
 *   movements?        [{ id, side, kind, fromHotspotId, toHotspotId, animationMs }]
 *                     — the same shape, but played as a looping animation from
 *                       origin to destination by MapMotionLayer.
 *   showMovementLabels? boolean, default true
 *   focusedHotspotId? string
 *   onHotspotClick?   (id) => void
 *   height?           CSS string, default '60vh'
 *   attribution?      boolean, default true — the Natural Earth credit
 *
 * It used to be a Leaflet map on Esri's grey web tiles, which read as a
 * generic web map dropped into a game. This draws its own geography instead:
 * land as a grid of lit LEDs (brighter for the countries in play), glowing
 * borders, a coordinate grid and a slow scan sweep, from Natural Earth
 * outlines baked into src/data/caseFiles/theatreGeo.json by
 * scripts/build-case-files-geo.mjs. There is no pan or zoom: like a briefing
 * table, it always shows the whole theatre the case is about.
 *
 * Layers, bottom to top: LED canvas → geography SVG (grid, borders, labels)
 * → routes, units and hotspots SVG → MapMotionLayer → HUD chrome.
 */

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import geo from '../../data/caseFiles/theatreGeo.json'
import { lookupHotspot } from '../../utils/caseFiles/mapHelpers'
import {
  fitProjection,
  ringsToPath,
  countryContains,
  MapProjectionContext,
} from '../../utils/caseFiles/mapProjection'
import MapMotionLayer from './MapMotionLayer'

// ── Palette ──────────────────────────────────────────────────────────────────

const KIND_COLOR = {
  staging:   '#5baaff',   // brand-600
  capital:   '#facc15',   // amber-400
  logistics: '#a78bfa',   // violet
  naval:     '#22d3ee',   // cyan
  border:    '#94a3b8',   // slate
}
const KIND_LABEL = {
  staging:   'Staging area',
  capital:   'Capital',
  logistics: 'Logistics hub',
  naval:     'Naval base',
  border:    'Border point',
}

const DEFAULT_HOTSPOT_COLOR = '#5baaff'
const AXIS_COLOR_DEFAULT    = '#c0392b'   // warm red
const ARROWHEAD_SIZE_PX     = 13
const LED_SPACING           = 7           // px between LEDs
const FALLBACK_SIZE         = { w: 600, h: 400 }
const RECAL_THRESHOLD_PX    = 24

// Seas are unlabelled in Natural Earth's country file; these are the ones a
// case in this theatre ever looks at.
const SEA_LABELS = [
  { name: 'Black Sea',          lng: 34.0, lat: 43.3 },
  { name: 'Sea of Azov',        lng: 36.6, lat: 46.1 },
  { name: 'Baltic Sea',         lng: 19.2, lat: 57.0 },
  { name: 'Caspian Sea',        lng: 50.8, lat: 42.0 },
  { name: 'Mediterranean Sea',  lng: 18.0, lat: 34.5 },
  { name: 'Red Sea',            lng: 38.5, lat: 20.5 },
  { name: 'Persian Gulf',       lng: 51.5, lat: 27.0 },
]

function hotspotColor(kind) {
  return KIND_COLOR[kind] ?? DEFAULT_HOTSPOT_COLOR
}

// ── Size ─────────────────────────────────────────────────────────────────────

function useBoxSize(ref) {
  const [size, setSize] = useState(FALLBACK_SIZE)

  // Measure after every render as well as on resize. A live-map question
  // docking beside the map narrows it in the same commit that re-renders it,
  // and a ResizeObserver alone was seen to miss that, leaving the map drawn
  // at its old width and clipped. getBoundingClientRect is cheap next to the
  // redraw a wrong size costs.
  const measure = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      setSize((prev) => (Math.round(prev.w) === Math.round(r.width) && Math.round(prev.h) === Math.round(r.height)
        ? prev
        : { w: r.width, h: r.height }))
    }
  }, [ref])

  useLayoutEffect(measure)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [ref, measure])
  return size
}

// ── LED land ─────────────────────────────────────────────────────────────────
// Land is rasterised once per size onto a scratch canvas (plain land in the
// red channel, the countries in play in green), then sampled on a grid to
// light one LED per cell. One getImageData call instead of thousands of
// point-in-polygon tests.

function LedLayer({ width, height, landPath, hotPath, knockouts = [] }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext?.('2d')
    if (!ctx || typeof Path2D === 'undefined') return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width  = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width  = `${width}px`
    canvas.style.height = `${height}px`

    const scratch = document.createElement('canvas')
    scratch.width  = Math.max(1, Math.round(width))
    scratch.height = Math.max(1, Math.round(height))
    const sctx = scratch.getContext('2d')
    if (!sctx) return
    sctx.fillStyle = '#ff0000'
    sctx.fill(new Path2D(landPath), 'evenodd')
    if (hotPath) {
      sctx.fillStyle = '#00ff00'
      sctx.fill(new Path2D(hotPath), 'evenodd')
    }
    const px = sctx.getImageData(0, 0, scratch.width, scratch.height).data

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const land = []
    const hot  = []
    for (let y = LED_SPACING / 2, row = 0; y < height; y += LED_SPACING, row++) {
      // Offset every other row: a hex grid reads as a panel, a square one as graph paper.
      for (let x = LED_SPACING / 2 + (row % 2 ? LED_SPACING / 2 : 0); x < width; x += LED_SPACING) {
        const i = (Math.floor(y) * scratch.width + Math.floor(x)) * 4
        // LEDs are off behind every label, like a real panel leaving a gap
        // for its legend. Lit dots behind the text made names hard to read.
        if (knockouts.some((k) => x > k.x0 && x < k.x1 && y > k.y0 && y < k.y1)) continue
        if (px[i + 1] > 128) hot.push(x, y)
        else if (px[i] > 128) land.push(x, y)
      }
    }
    const paint = (pts, r, color) => {
      ctx.fillStyle = color
      ctx.beginPath()
      for (let i = 0; i < pts.length; i += 2) {
        ctx.moveTo(pts[i] + r, pts[i + 1])
        ctx.arc(pts[i], pts[i + 1], r, 0, Math.PI * 2)
      }
      ctx.fill()
    }
    // A soft halo pass under each core so the panel glows rather than prints.
    // Kept deliberately quiet: the dots are texture under the borders and
    // names, not the thing you read. At full brightness they drowned both.
    paint(land, 2.0, 'rgba(91,170,255,0.035)')
    paint(land, 0.9, 'rgba(100,160,240,0.2)')
    paint(hot,  2.3, 'rgba(110,190,255,0.08)')
    paint(hot,  1.0, 'rgba(130,195,255,0.48)')
  }, [width, height, landPath, hotPath, knockouts])

  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 pointer-events-none" />
}

// ── Fit ──────────────────────────────────────────────────────────────────────

function hotspotBounds(hotspots) {
  if (!hotspots || hotspots.length < 2) return null
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity
  for (const hs of hotspots) {
    south = Math.min(south, hs.lat); north = Math.max(north, hs.lat)
    west  = Math.min(west,  hs.lng); east  = Math.max(east,  hs.lng)
  }
  // Pad by a fifth of the spread, but never less than 1.5°, so a tight
  // cluster still shows the country around it.
  const padLat = Math.max(1.5, (north - south) * 0.2)
  const padLng = Math.max(1.5, (east - west) * 0.2)
  return { south: south - padLat, north: north + padLat, west: west - padLng, east: east + padLng }
}

// Rough text box for collision checks: mono caps at the given size and
// letter-spacing (em).
function textBox(x, y, text, size, spacingEm, anchor) {
  const width = text.length * size * (0.62 + spacingEm)
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
  return { x0, x1: x0 + width, y0: y - size, y1: y + 3 }
}
function overlaps(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

// ── Arrowhead ────────────────────────────────────────────────────────────────

function arrowPoints(from, to, size = ARROWHEAD_SIZE_PX) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const px = -uy, py = ux
  const spread = size * 0.5
  return `${to.x},${to.y} ${to.x - ux * size + px * spread},${to.y - uy * size + py * spread} ${to.x - ux * size - px * spread},${to.y - uy * size - py * spread}`
}

// ── MapCanvas (public) ────────────────────────────────────────────────────────

export default function MapCanvas({
  bounds,
  hotspots = [],
  axes,
  units,
  movements,
  showMovementLabels = true,
  focusedHotspotId,
  onHotspotClick,
  height = '60vh',
  attribution = true,
}) {
  const boxRef = useRef(null)
  const { w, h } = useBoxSize(boxRef)
  const [hoverId, setHoverId] = useState(null)

  // The recalibrate flash replays only on a real change of size (a question
  // docking, a window resize). A few pixels (a scrollbar coming and going)
  // just redraws quietly: flashing on those read as the map reloading.
  // (React's "adjust state when a prop changes" pattern: compared during
  // render, so the remount lands in the same commit as the new size.)
  const [recal, setRecal] = useState({ key: 0, w, h })
  if (Math.abs(recal.w - w) > RECAL_THRESHOLD_PX || Math.abs(recal.h - h) > RECAL_THRESHOLD_PX) {
    setRecal({ key: recal.key + 1, w, h })
  }
  const recalKey = recal.key
  // Filter ids are document-global; keep two maps from sharing one.
  const glowId = `cf-map-glow-${useId().replace(/:/g, '')}`

  // Fit to where the action is: the hotspots plus a margin. The authored
  // bounds are often drawn wide, which bunched every marker into the middle
  // third of the table with Western Europe filling the rest.
  const fitBounds = useMemo(() => hotspotBounds(hotspots) ?? bounds, [hotspots, bounds])
  const proj = useMemo(() => fitProjection(fitBounds, w, h, 40), [fitBounds, w, h])
  const P = (lat, lng) => proj.project(lat, lng)

  // Stable projection handle for the movement overlay. Its methods read the
  // latest fit, so a resize re-aims the animation without restarting it.
  const projRef = useRef(proj)
  const sizeRef = useRef({ w, h })
  useLayoutEffect(() => {
    projRef.current = proj
    sizeRef.current = { w, h }
  }, [proj, w, h])
  const mapHandle = useMemo(() => ({
    getSize: () => ({ x: sizeRef.current.w, y: sizeRef.current.h }),
    latLngToContainerPoint: ([lat, lng]) => projRef.current.project(lat, lng),
  }), [])

  // Countries with a hotspot in them are the ones in play: lit brighter.
  const hotIds = useMemo(() => {
    const ids = new Set()
    for (const hs of hotspots) {
      const c = geo.countries.find((country) => countryContains(country, hs.lng, hs.lat))
      if (c) ids.add(c.id)
    }
    return ids
  }, [hotspots])

  const { landPath, hotPath, borders } = useMemo(() => {
    let land = ''
    let hot = ''
    const list = []
    for (const c of geo.countries) {
      const d = ringsToPath(c.polys, proj.project)
      land += d
      if (hotIds.has(c.id)) hot += d
      list.push({ id: c.id, d, hot: hotIds.has(c.id) })
    }
    return { landPath: land, hotPath: hot, borders: list }
  }, [proj, hotIds])

  // Coordinate grid: every 5° on a wide theatre, every 2° on a tight one.
  const grid = useMemo(() => {
    const tl = proj.invert(0, 0)
    const br = proj.invert(w, h)
    const span = br.lng - tl.lng
    const step = span > 30 ? 5 : 2
    const lines = []
    for (let lng = Math.ceil(tl.lng / step) * step; lng <= br.lng; lng += step) {
      const x = proj.project(0, lng).x
      lines.push({ key: `v${lng}`, x1: x, y1: 0, x2: x, y2: h, label: `${Math.abs(lng)}°${lng >= 0 ? 'E' : 'W'}`, lx: x + 3, ly: 11 })
    }
    for (let lat = Math.ceil(br.lat / step) * step; lat <= tl.lat; lat += step) {
      const y = proj.project(lat, 0).y
      lines.push({ key: `h${lat}`, x1: 0, y1: y, x2: w, y2: y, label: `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`, lx: 5, ly: y - 3 })
    }
    return lines
  }, [proj, w, h])

  // Hotspot labels go right unless a neighbour sits there, then left.
  const placed = useMemo(() => hotspots.map((hs) => {
    const p = proj.project(hs.lat, hs.lng)
    const crowdedRight = hotspots.some((o) => {
      if (o.id === hs.id) return false
      const q = proj.project(o.lat, o.lng)
      return q.x > p.x && q.x - p.x < 95 && Math.abs(q.y - p.y) < 16
    })
    // Near the right edge there is no room for a label on that side at all.
    return { hs, p, left: crowdedRight || p.x > w - 110 }
  }), [hotspots, proj, w])


  // Place names are printed only where they will not collide with a hotspot,
  // its label, or a name already placed. The countries in play go first.
  const countryLabels = useMemo(() => {
    const taken = placed.flatMap(({ hs, p, left }) => [
      { x0: p.x - 12, x1: p.x + 12, y0: p.y - 12, y1: p.y + 12 },
      textBox(left ? p.x - 14 : p.x + 14, p.y + 3.5, hs.label, 10, 0.1, left ? 'end' : 'start'),
    ])
    const out = []
    const candidates = geo.countries
      .map((c) => {
        const p = proj.project(c.label[1], c.label[0])
        const hot = hotIds.has(c.id)
        return { id: c.id, name: c.name, x: p.x, y: p.y, hot, big: c.area * proj.scale * proj.scale * 0.0003 }
      })
      .filter((l) => l.x > 30 && l.x < w - 30 && l.y > 24 && l.y < h - 24 && (l.hot || l.big > 4))
      .sort((a, b) => (b.hot - a.hot) || (b.big - a.big))
    for (const l of candidates) {
      const box = textBox(l.x, l.y, l.name, l.hot ? 11 : 9, 0.35, 'middle')
      if (box.x0 < 4 || box.x1 > w - 4) continue
      if (taken.some((t) => overlaps(t, box))) continue
      taken.push(box)
      out.push(l)
    }
    return out
  }, [placed, proj, w, h, hotIds])

  const seaLabels = useMemo(() => SEA_LABELS
    .map((s) => ({ ...s, ...proj.project(s.lat, s.lng) }))
    .filter((s) => s.x > 60 && s.x < w - 60 && s.y > 24 && s.y < h - 24),
  [proj, w, h])

  const kindsPresent = [...new Set(hotspots.map((hs) => hs.kind).filter((k) => KIND_LABEL[k]))]
  const hovered = placed.find((x) => x.hs.id === hoverId)

  // Areas the LED panel leaves dark: every marker and every printed name.
  const knockouts = useMemo(() => {
    const pad = (b, n) => ({ x0: b.x0 - n, x1: b.x1 + n, y0: b.y0 - n, y1: b.y1 + n })
    return [
      ...placed.flatMap(({ hs, p, left }) => [
        { x0: p.x - 11, x1: p.x + 11, y0: p.y - 11, y1: p.y + 11 },
        pad(textBox(left ? p.x - 14 : p.x + 14, p.y + 3.5, hs.label, 10, 0.1, left ? 'end' : 'start'), 4),
      ]),
      ...countryLabels.map((l) => pad(textBox(l.x, l.y, l.name, l.hot ? 11 : 9, 0.35, 'middle'), 3)),
      ...seaLabels.map((sl) => pad(textBox(sl.x, sl.y, sl.name, 9, 0.3, 'middle'), 2)),
    ]
  }, [placed, countryLabels, seaLabels])

  return (
    <div
      ref={boxRef}
      data-testid="map-container"
      style={{ height, position: 'relative' }}
      className="cf-tactical-map rounded-md overflow-hidden border border-brand-600/30"
    >
      {/* Everything drawn to the fitted projection, keyed on the box size.
          A resize (a live-map question docking, the window changing) remounts
          it and replays the "recalibrate" flicker in main.css, so the map
          re-drawing at its new fit reads as the table re-rendering rather than
          a snap. The same key gives the first mount its power-on. */}
      <div key={recalKey} className="absolute inset-0 cf-map-recal">
      <LedLayer width={w} height={h} landPath={landPath} hotPath={hotPath} knockouts={knockouts} />

      {/* ── Geography: grid, borders, names ─────────────────────────────── */}
      <svg className="absolute inset-0 pointer-events-none" width={w} height={h} aria-hidden="true">
        <defs>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {grid.map((g) => (
          <g key={g.key}>
            <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="rgba(91,170,255,0.09)" strokeWidth="1" />
            <text x={g.lx} y={g.ly} className="cf-map-grid-label">{g.label}</text>
          </g>
        ))}

        <g filter={`url(#${glowId})`}>
          {borders.map((b) => (
            <path
              key={b.id}
              d={b.d}
              fill={b.hot ? 'rgba(91,170,255,0.05)' : 'none'}
              stroke={b.hot ? 'rgba(150,210,255,0.85)' : 'rgba(91,170,255,0.38)'}
              strokeWidth={b.hot ? 1.1 : 0.7}
              strokeLinejoin="round"
              fillRule="evenodd"
            />
          ))}
        </g>

        {seaLabels.map((s) => (
          <text key={s.name} x={s.x} y={s.y} textAnchor="middle" className="cf-map-sea-label">{s.name}</text>
        ))}
        {countryLabels.map((l) => (
          <text
            key={l.id}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            className={l.hot ? 'cf-map-country-label cf-map-country-label--hot' : 'cf-map-country-label'}
          >
            {l.name}
          </text>
        ))}
      </svg>

      {/* ── Routes, units, hotspots ──────────────────────────────────────── */}
      <svg className="absolute inset-0" width={w} height={h} style={{ zIndex: 2 }}>
        {axes?.map((axis) => {
          const from = lookupHotspot(hotspots, axis.fromHotspotId)
          const to   = lookupHotspot(hotspots, axis.toHotspotId)
          if (!from || !to) return null
          const a = P(from.lat, from.lng)
          const b0 = P(to.lat, to.lng)
          // Stop short of the target marker so the arrowhead is not buried in it.
          const len = Math.hypot(b0.x - a.x, b0.y - a.y) || 1
          const b = { x: b0.x - ((b0.x - a.x) / len) * 11, y: b0.y - ((b0.y - a.y) / len) * 11 }
          const color = axis.color ?? AXIS_COLOR_DEFAULT
          // `animated` marches the dashes towards the target, so a drawn route
          // reads as a direction of travel rather than a pencil line.
          return (
            <g key={axis.id} data-testid={`map-axis-${axis.id}`} opacity={axis.dashed ? 0.65 : 1} filter={`url(#${glowId})`}>
              {/* A new route draws itself: a bright trace runs from origin to
                  target, then hands over to the dashed line and arrowhead. */}
              <motion.path
                d={`M${a.x} ${a.y}L${b.x} ${b.y}`}
                fill="none"
                stroke="#ffd2cc"
                strokeWidth="3"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 1 }}
                animate={{ pathLength: 1, opacity: 0 }}
                transition={{ pathLength: { duration: 0.45, ease: 'easeOut' }, opacity: { delay: 0.5, duration: 0.45 } }}
              />
              <motion.line
                data-testid="map-axis-line"
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={color}
                strokeWidth={axis.animated ? 3 : 2.5}
                strokeLinecap="round"
                strokeDasharray={axis.animated ? '10 12' : axis.dashed ? '6 5' : undefined}
                className={axis.animated ? 'cf-axis-flow' : undefined}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.35 }}
              />
              <motion.polygon
                points={arrowPoints(a, b)}
                fill={color}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.2 }}
              />
            </g>
          )
        })}

        {units?.map((unit, i) => {
          const at = lookupHotspot(hotspots, unit.fromHotspotId)
          if (!at) return null
          const p = P(at.lat, at.lng)
          const color = UNIT_SIDE_COLOR[unit.side] ?? '#94a3b8'
          return (
            // Seed content does not give units an id, and every undefined key
            // is the same key as far as React is concerned.
            <g key={unit.id ?? `${unit.side}-${unit.kind}-${unit.fromHotspotId}-${i}`} data-testid="map-unit">
              <title>{unit.kind ?? unit.id ?? 'Unit'}</title>
              <circle cx={p.x} cy={p.y} r="14" fill={color} fillOpacity="0.1" stroke={color} strokeWidth="2" />
              <circle cx={p.x} cy={p.y} r="18" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1" strokeDasharray="3 4" className="cf-map-unit-spin" />
            </g>
          )
        })}

        {placed.map(({ hs, p, left }) => {
          const color     = hotspotColor(hs.kind)
          const isFocused = hs.id === focusedHotspotId
          const clickable = !!onHotspotClick
          return (
            <g
              key={hs.id}
              data-testid={`map-hotspot-${hs.id}`}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={hs.label}
              aria-pressed={clickable ? isFocused : undefined}
              onClick={clickable ? () => onHotspotClick(hs.id) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHotspotClick(hs.id) } } : undefined}
              onMouseEnter={() => setHoverId(hs.id)}
              onMouseLeave={() => setHoverId((cur) => (cur === hs.id ? null : cur))}
              onFocus={() => setHoverId(hs.id)}
              onBlur={() => setHoverId((cur) => (cur === hs.id ? null : cur))}
              className={clickable ? 'cf-map-hotspot cf-map-hotspot--clickable' : 'cf-map-hotspot'}
            >
              {/* Generous invisible hit area: a finger is not a mouse pointer. */}
              <circle cx={p.x} cy={p.y} r="18" fill="transparent" />
              {/* Expanding halo under the picked start point: the only feedback
                  for "start point set" used to be a slightly larger dot. */}
              {isFocused && (
                <circle cx={p.x} cy={p.y} r="11" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="2" className="cf-hotspot-pulse" />
              )}
              <circle cx={p.x} cy={p.y} r={isFocused ? 11 : 8.5} fill="rgba(6,16,30,0.6)" stroke={isFocused ? '#ffffff' : color} strokeWidth={isFocused ? 2.5 : 1.5} />
              <circle cx={p.x} cy={p.y} r={isFocused ? 5 : 4} fill={color} filter={`url(#${glowId})`} />
              <text
                x={left ? p.x - 14 : p.x + 14}
                y={p.y + 3.5}
                textAnchor={left ? 'end' : 'start'}
                className={isFocused ? 'cf-map-hotspot-label cf-map-hotspot-label--focus' : 'cf-map-hotspot-label'}
              >
                {hs.label}
              </text>
            </g>
          )
        })}
      </svg>
      </div>

      {movements?.length > 0 && (
        <MapProjectionContext.Provider value={mapHandle}>
          <MapMotionLayer movements={movements} hotspots={hotspots} showLabels={showMovementLabels} />
        </MapProjectionContext.Provider>
      )}

      {/* ── HUD chrome ───────────────────────────────────────────────────── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ zIndex: 3 }}>
        <div className="absolute inset-0 cf-map-vignette" />
        <div className="absolute inset-0 cf-portrait-scanlines opacity-25" />
        <div className="absolute inset-x-0 h-16 cf-map-scan" />
        {['top-2 left-2 border-t-2 border-l-2', 'top-2 right-2 border-t-2 border-r-2', 'bottom-2 left-2 border-b-2 border-l-2', 'bottom-2 right-2 border-b-2 border-r-2'].map((pos) => (
          <span key={pos} className={`absolute w-4 h-4 border-brand-600/70 ${pos}`} />
        ))}
        {kindsPresent.length > 0 && (
          <div data-testid="map-legend" className="absolute bottom-3 left-4 flex flex-wrap gap-x-3 gap-y-1 max-w-[70%] px-2 py-1 rounded-sm bg-[#06101e]/75 border border-brand-600/20">
            {kindsPresent.map((k) => (
              <span key={k} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: KIND_COLOR[k], boxShadow: `0 0 6px ${KIND_COLOR[k]}` }} />
                {KIND_LABEL[k]}
              </span>
            ))}
          </div>
        )}
        {attribution && (
          <span className="absolute bottom-2 right-8 font-mono text-[8px] text-slate-500/80">Natural Earth</span>
        )}
      </div>

      {/* Detail card for the hotspot under the pointer. */}
      {hovered && hovered.hs.tooltip && (
        <div
          role="tooltip"
          className="absolute z-10 pointer-events-none w-56 px-2.5 py-2 rounded-sm border border-brand-600/40 bg-[#06101e]/95 shadow-[0_0_20px_rgba(91,170,255,0.2)]"
          style={{
            left: Math.min(Math.max(8, hovered.p.x - 112), w - 232),
            top:  hovered.p.y > 110 ? hovered.p.y - 16 : hovered.p.y + 20,
            transform: hovered.p.y > 110 ? 'translateY(-100%)' : undefined,
          }}
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: hotspotColor(hovered.hs.kind) }}>
            {hovered.hs.label}
          </p>
          <p className="text-[11px] leading-snug text-text-muted mt-0.5">{hovered.hs.tooltip}</p>
        </div>
      )}
    </div>
  )
}

// Units used to render as grey blobs because the colour map keyed on
// 'friendly'/'hostile' while content writes 'ru'/'ua'. Both are accepted.
const UNIT_SIDE_COLOR = {
  ru:       '#f87171',   // hostile red
  hostile:  '#f87171',
  ua:       '#4ade80',   // friendly green
  friendly: '#4ade80',
  neutral:  '#facc15',
}
