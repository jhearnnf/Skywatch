import { useState } from 'react'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_FULL   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

// Sequential single-hue ramp (brand blue) over the dark card surface: empty cells
// recede toward the surface, busier cells brighten toward brand-600. A small alpha
// floor keeps a single start visible against the grid.
function cellStyle(count, max) {
  if (!count) return { backgroundColor: 'rgba(139,160,192,0.06)' } // faint slate = empty slot
  const t = max > 0 ? count / max : 0
  const alpha = 0.18 + 0.82 * t
  return { backgroundColor: `rgba(91,170,255,${alpha.toFixed(3)})` }
}

function fmtHour(h) {
  return `${String(h).padStart(2, '0')}:00`
}

/**
 * Day-of-week × hour-of-day heatmap of CBAT session starts.
 * data: { grid: number[7][24] (0 = Monday), max, total, timezone }
 */
export default function ReportHeatmap({ data, height = 220 }) {
  const [hover, setHover] = useState(null)
  const grid = data?.grid
  const max = data?.max ?? 0

  if (!Array.isArray(grid) || max === 0) {
    return (
      <div
        className="w-full flex items-center justify-center rounded-lg border border-slate-300 bg-slate-100/40 text-slate-600 text-xs"
        style={{ height }}
      >
        No data in this window
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Hover readout — reserves a line so the grid doesn't jump */}
      <div className="h-4 mb-2 text-[11px] text-slate-500">
        {hover ? (
          <>
            <span className="text-slate-300 font-semibold">{DAY_FULL[hover.dow]} {fmtHour(hover.hour)}</span>
            {' · '}{hover.count} {hover.count === 1 ? 'start' : 'starts'}
          </>
        ) : (
          <span className="text-slate-600">Hover a cell for the exact count</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          {grid.map((row, dow) => (
            <div key={dow} className="flex items-center gap-[2px] mb-[2px]">
              <div className="w-8 shrink-0 text-[10px] text-slate-500 tabular-nums">{DAY_LABELS[dow]}</div>
              <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
                {row.map((count, hour) => (
                  <div
                    key={hour}
                    className="rounded-[2px] h-4 cursor-default"
                    style={cellStyle(count, max)}
                    title={`${DAY_FULL[dow]} ${fmtHour(hour)} · ${count} ${count === 1 ? 'start' : 'starts'}`}
                    onMouseEnter={() => setHover({ dow, hour, count })}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Hour axis — every 3rd hour labelled */}
          <div className="flex items-center gap-[2px] mt-1">
            <div className="w-8 shrink-0" />
            <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
              {HOURS.map(h => (
                <div key={h} className="text-[9px] text-slate-500 text-center tabular-nums">
                  {h % 3 === 0 ? h : ''}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sequential legend */}
      <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-slate-500">
        <span>Less</span>
        <div className="flex gap-[2px]">
          {[0.18, 0.4, 0.6, 0.8, 1].map(a => (
            <div key={a} className="w-4 h-3 rounded-[2px]" style={{ backgroundColor: `rgba(91,170,255,${a})` }} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  )
}
