/**
 * RafBasesMap — shared RAF bases map used in WTA game and intel brief pages.
 *
 * mode="view"  — read-only; highlights specified base names, greys out others
 * mode="game"  — interactive WTA game map with selection/submission state
 */
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { RAF_BASES } from '../data/rafBases'

// ── View mode ─────────────────────────────────────────────────────────────
function ViewMap({ highlightedBaseNames, height }) {
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
export default function RafBasesMap({ mode = 'view', height = 300, ...props }) {
  if (mode === 'game') {
    return <GameMap height={height} {...props} />
  }
  return <ViewMap height={height} {...props} />
}
