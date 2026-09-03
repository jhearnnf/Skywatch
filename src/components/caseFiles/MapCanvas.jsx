/**
 * MapCanvas — shared dark-theme Leaflet map for Case Files stages.
 *
 * Props:
 *   bounds            { south, west, north, east } — initial fit
 *   hotspots          [{ id, label, lat, lng, kind }]
 *   axes?             [{ id, fromHotspotId, toHotspotId, color?, dashed?, animated? }]
 *   units?            [{ id, side, kind, fromHotspotId, toHotspotId, animationMs }]
 *                     — V1 stub: rendered as CircleMarker at start position.
 *                       Animation to be wired by agent D5 (MapLiveStage).
 *   focusedHotspotId? string
 *   onHotspotClick?   (id) => void
 *   onMapClick?       (latlng) => void
 *   height?           CSS string, default '60vh'
 *   attribution?      boolean, default true
 *
 * Axes implementation: react-leaflet <Polyline> (simple, V1-appropriate).
 * Arrowheads are computed as a separate <Polyline> via SingleAxis (a dedicated
 * child component per axis), so the map-projection hook is called at component
 * top-level — never inside a loop.
 * CONTRACT-AMBIGUITY: spec allowed Pane+SVG or Polyline; Polyline chosen for
 * simplicity. D5 may upgrade to Pane+SVG if animation fidelity requires it.
 * CONTRACT-AMBIGUITY: arrowhead computation uses hook form (screen-space
 * projection via map.latLngToContainerPoint) rather than pure lat/lng math,
 * for accuracy across zoom levels. Documented in mapHelpers.js.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Polyline,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { boundsCentre, lookupHotspot } from '../../utils/caseFiles/mapHelpers'

// ── Constants ────────────────────────────────────────────────────────────────

// Basemap. CARTO's dark_all tiles used to be keyless; they now stamp
// "API KEY REQUIRED" diagonally across every tile, which made the two map
// stages look broken. Esri's dark canvas needs no key and matches the dark
// theme. It ships geometry and labels as separate services, so both go on —
// place names are load-bearing here (players pick out Kyiv, Belarus, Donbas).
const TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const LABEL_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
const TILE_MAX_ZOOM = 16
const ATTRIBUTION =
  'Tiles © <a href="https://www.esri.com/">Esri</a>, DeLorme, NAVTEQ'

const KIND_COLOR = {
  staging:   '#5baaff',   // brand-600
  capital:   '#facc15',   // amber-400
  logistics: '#a78bfa',   // violet
  naval:     '#22d3ee',   // cyan
  border:    '#94a3b8',   // slate
}

const DEFAULT_HOTSPOT_COLOR = '#5baaff'
const AXIS_COLOR_DEFAULT    = '#c0392b'   // warm red
const ARROWHEAD_SIZE_PX     = 14          // screen pixels for arrowhead arms

function hotspotColor(kind) {
  return KIND_COLOR[kind] ?? DEFAULT_HOTSPOT_COLOR
}

// ── FitBounds — fits map to bounds on mount ──────────────────────────────────

function FitBounds({ bounds }) {
  const map = useMap()
  useEffect(() => {
    if (!bounds) return
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [24, 24] }
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// ── MapClickHandler ──────────────────────────────────────────────────────────

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) onMapClick(e.latlng)
    },
  })
  return null
}

// ── computeArrowhead — pixel-space arrowhead computation ─────────────────────
// Returns three [lat, lng] pairs forming the "V" arms at toLatLng.

function computeArrowhead(map, fromLatLng, toLatLng) {
  if (!map || !fromLatLng || !toLatLng) return null
  try {
    const from = map.latLngToContainerPoint(fromLatLng)
    const to   = map.latLngToContainerPoint(toLatLng)

    const dx  = to.x - from.x
    const dy  = to.y - from.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1

    const ux = dx / len
    const uy = dy / len
    // perpendicular (rotate 90°)
    const px = -uy
    const py =  ux

    const sz     = ARROWHEAD_SIZE_PX
    const spread = sz * 0.45

    const leftPx  = { x: to.x - ux * sz + px * spread, y: to.y - uy * sz + py * spread }
    const rightPx = { x: to.x - ux * sz - px * spread, y: to.y - uy * sz - py * spread }

    const left  = map.containerPointToLatLng([leftPx.x,  leftPx.y])
    const right = map.containerPointToLatLng([rightPx.x, rightPx.y])

    return [
      [left.lat,    left.lng],
      [toLatLng[0], toLatLng[1]],
      [right.lat,   right.lng],
    ]
  } catch {
    return null
  }
}

// ── SingleAxis — renders one axis line + arrowhead ───────────────────────────
// Separated into its own component so the map-projection hook is called at
// component top-level, not inside a loop (hooks-rules compliant).

function SingleAxis({ axis, hotspots }) {
  const map = useMap()
  const [, setTick] = useState(0)

  // Re-render when map pans/zooms so arrowhead position stays accurate.
  useMapEvents({
    moveend:  () => setTick(t => t + 1),
    zoomend:  () => setTick(t => t + 1),
  })

  const from = lookupHotspot(hotspots, axis.fromHotspotId)
  const to   = lookupHotspot(hotspots, axis.toHotspotId)
  if (!from || !to) return null

  const fromLatLng = [from.lat, from.lng]
  const toLatLng   = [to.lat,   to.lng]
  const color      = axis.color ?? AXIS_COLOR_DEFAULT

  const pathOptions = {
    color,
    weight:    2.5,
    opacity:   axis.dashed ? 0.65 : 0.9,
    dashArray: axis.dashed ? '6 5' : undefined,
  }

  const arrowPts = computeArrowhead(map, fromLatLng, toLatLng)

  return (
    <>
      <Polyline positions={[fromLatLng, toLatLng]} pathOptions={pathOptions} />
      {arrowPts && (
        <Polyline
          positions={arrowPts}
          pathOptions={{ color, weight: 2.5, opacity: pathOptions.opacity }}
        />
      )}
    </>
  )
}

// ── UnitsLayer — a ring around the hotspot a unit has reached ────────────────
// CONTRACT-AMBIGUITY: animation logic deferred to agent D5 (MapLiveStage).
//
// Units used to be a radius-5 filled dot drawn on top of a radius-8 hotspot,
// in a colour keyed on 'friendly'/'hostile'/'neutral' — while the content
// writes side as 'ru'/'ua'. So every unit fell through to the default slate
// and rendered as a grey blob hidden inside the marker it had just reached,
// which is why the live map looked like nothing was happening. They are now
// an unfilled ring drawn OUTSIDE the hotspot, coloured by side.

const UNIT_SIDE_COLOR = {
  ru:       '#f87171',   // hostile red
  hostile:  '#f87171',
  ua:       '#4ade80',   // friendly green
  friendly: '#4ade80',
  neutral:  '#facc15',
}

function UnitsLayer({ units, hotspots }) {
  if (!units?.length) return null

  return units.map((unit, i) => {
    const from = lookupHotspot(hotspots, unit.fromHotspotId)
    if (!from) return null
    const color = UNIT_SIDE_COLOR[unit.side] ?? '#94a3b8'
    return (
      <CircleMarker
        // Seed content does not give units an id, and every undefined key is
        // the same key as far as React is concerned.
        key={unit.id ?? `${unit.side}-${unit.kind}-${unit.fromHotspotId}-${i}`}
        center={[from.lat, from.lng]}
        radius={12}
        pathOptions={{ color, fillColor: color, fillOpacity: 0.12, weight: 2.5 }}
      >
        <Tooltip className="cf-map-tooltip" direction="top" offset={[0, -12]} opacity={1}>
          <span className="text-xs text-text">{unit.kind ?? unit.id ?? 'Unit'}</span>
        </Tooltip>
      </CircleMarker>
    )
  })
}

// ── HotspotsLayer ────────────────────────────────────────────────────────────

function HotspotsLayer({ hotspots, focusedHotspotId, onHotspotClick }) {
  return hotspots.map(hs => {
    const color     = hotspotColor(hs.kind)
    const isFocused = hs.id === focusedHotspotId

    return (
      <CircleMarker
        key={hs.id}
        center={[hs.lat, hs.lng]}
        radius={isFocused ? 11 : 8}
        pathOptions={{
          color:       isFocused ? '#ffffff' : color,
          fillColor:   color,
          fillOpacity: isFocused ? 0.95 : 0.75,
          weight:      isFocused ? 3 : 1.5,
        }}
        eventHandlers={
          onHotspotClick ? { click: () => onHotspotClick(hs.id) } : undefined
        }
      >
        <Tooltip className="cf-map-tooltip" direction="top" offset={[0, -8]} opacity={1}>
          {/* Leaflet tooltips are white-space:nowrap by default, so the longer
              `tooltip` sentence ran straight out of the box. Fix the width and
              let it wrap. */}
          <div className="flex flex-col" style={{ width: 220, whiteSpace: 'normal' }}>
            <span className="text-xs font-semibold text-text">{hs.label}</span>
            {hs.tooltip && (
              <span className="text-[11px] font-normal leading-snug mt-0.5 text-text-muted">
                {hs.tooltip}
              </span>
            )}
          </div>
        </Tooltip>
      </CircleMarker>
    )
  })
}

// ── MapCanvas (public) ────────────────────────────────────────────────────────

export default function MapCanvas({
  bounds,
  hotspots = [],
  axes,
  units,
  focusedHotspotId,
  onHotspotClick,
  onMapClick,
  height = '60vh',
  attribution = true,
}) {
  const centre = bounds ? boundsCentre(bounds) : [30, 30]

  return (
    <div
      style={{ height, position: 'relative' }}
      className="rounded-xl overflow-hidden border border-slate-300"
    >
      <MapContainer
        center={centre}
        zoom={5}
        style={{ height: '100%', width: '100%', background: '#06101e' }}
        scrollWheelZoom={false}
        zoomControl={true}
        attributionControl={attribution}
      >
        {bounds && <FitBounds bounds={bounds} />}
        {onMapClick && <MapClickHandler onMapClick={onMapClick} />}

        <TileLayer
          url={TILE_URL}
          attribution={attribution ? ATTRIBUTION : ''}
          maxZoom={TILE_MAX_ZOOM}
        />
        <TileLayer url={LABEL_TILE_URL} maxZoom={TILE_MAX_ZOOM} />

        <HotspotsLayer
          hotspots={hotspots}
          focusedHotspotId={focusedHotspotId}
          onHotspotClick={onHotspotClick}
        />

        {axes?.length > 0 && axes.map(axis => (
          <SingleAxis key={axis.id} axis={axis} hotspots={hotspots} />
        ))}

        {units?.length > 0 && (
          <UnitsLayer units={units} hotspots={hotspots} />
        )}
      </MapContainer>
    </div>
  )
}
