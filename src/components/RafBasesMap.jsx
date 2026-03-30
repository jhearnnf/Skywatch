/**
 * RafBasesMap — shared RAF bases map used in WTA game and intel brief pages.
 *
 * mode="view"  — read-only; highlights specified base names, greys out others
 * mode="game"  — interactive WTA game map with selection/submission state
 */
import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { RAF_BASES } from '../data/rafBases'

// Flies/fits the map to highlighted bases on mount (skipped if centreOn is already set)
function FlyToHighlighted({ highlightedBaseNames, centreOn }) {
  const map = useMap()
  useEffect(() => {
    if (centreOn) return // FlyToCentre will handle initial positioning
    const targets = RAF_BASES.filter(b =>
      (highlightedBaseNames ?? []).some(n => n.toLowerCase() === b.name.toLowerCase())
    )
    if (targets.length === 0) return
    if (targets.length === 1) {
      map.flyTo([targets[0].lat, targets[0].lng], 9, { duration: 0.8 })
    } else {
      map.flyToBounds(targets.map(b => [b.lat, b.lng]), { padding: [50, 50], duration: 0.8 })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// Flies to a specific base whenever centreOn changes
function FlyToCentre({ centreOn }) {
  const map = useMap()
  useEffect(() => {
    if (!centreOn) return
    const target = RAF_BASES.find(b => b.name.toLowerCase() === centreOn.toLowerCase())
    if (!target) return
    map.flyTo([target.lat, target.lng], 10, { duration: 0.8 })
  }, [centreOn]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// ── View mode ─────────────────────────────────────────────────────────────
function ViewMap({ highlightedBaseNames, height, centreOn }) {
  const highlighted = new Set((highlightedBaseNames ?? []).map(n => n.toLowerCase()))

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200" style={{ height }}>
      <MapContainer
        center={[54.5, -3.5]}
        zoom={5}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        attributionControl={false}
      >
        <FlyToHighlighted highlightedBaseNames={highlightedBaseNames} centreOn={centreOn} />
        <FlyToCentre centreOn={centreOn} />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        {RAF_BASES.map(base => {
          const isHighlighted = highlighted.has(base.name.toLowerCase())
          const color = isHighlighted ? '#1d4ed8' : '#94a3b8'

          return (
            <CircleMarker
              key={base.name}
              center={[base.lat, base.lng]}
              radius={isHighlighted ? 10 : 7}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: isHighlighted ? 0.85 : 0.5,
                weight: isHighlighted ? 3 : 1.5,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <span className="text-xs font-semibold">{base.name}</span>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}

// ── Game mode ─────────────────────────────────────────────────────────────
function GameMap({ bases, selected, submitted, onToggle, height }) {
  const baseMap = {}
  for (const b of bases) {
    baseMap[b.title.toLowerCase()] = b
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200" style={{ height }}>
      <MapContainer
        center={[54.5, -3.5]}
        zoom={5}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        {RAF_BASES.map(base => {
          const dbBase = baseMap[base.name.toLowerCase()]
          if (!dbBase) return null

          const isSelected = selected.has(String(dbBase._id))
          const isCorrect  = submitted && dbBase.isCorrect
          const isWrong    = submitted && isSelected && !dbBase.isCorrect
          const isRead     = dbBase.isRead

          let color = isRead ? '#1d4ed8' : '#94a3b8'
          if (submitted) {
            if (isCorrect)    color = '#16a34a'
            else if (isWrong) color = '#dc2626'
          } else if (isSelected) {
            color = '#f59e0b'
          }

          const isHighlighted = isSelected || (submitted && isCorrect)

          return (
            <CircleMarker
              key={base.name}
              center={[base.lat, base.lng]}
              radius={isHighlighted ? 10 : 7}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: isHighlighted ? 0.85 : 0.5,
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{ click: () => onToggle(dbBase) }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <span className="text-xs font-semibold">{base.name}</span>
                {!isRead && <span className="text-slate-400 text-xs"> · not read</span>}
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}

// ── Public component ───────────────────────────────────────────────────────
export default function RafBasesMap({ mode = 'view', height = 300, centreOn, ...props }) {
  if (mode === 'game') {
    return <GameMap height={height} {...props} />
  }
  return <ViewMap height={height} centreOn={centreOn} {...props} />
}
