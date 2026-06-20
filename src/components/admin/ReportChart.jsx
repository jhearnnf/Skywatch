import {
  ResponsiveContainer,
  ComposedChart,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

const DIM_OPACITY = 0.05
const DIM_LABEL_OPACITY = 0.3

// Token-aligned palette. Inverted scales on this dark theme — use the lighter end (600+) for primary marks.
const COLORS = {
  brand:   '#5baaff',
  brand2:  '#82c4ff',
  amber:   '#f59e0b',
  emerald: '#34d399',
  red:     '#f87171',
  slate:   '#8ba0c0',
  grid:    '#243650', // slate-300 (mid)
  axis:    '#aec0d8', // slate-700
}

// Distinct colors for stacked CBAT games (10).
const SERIES_PALETTE = [
  '#5baaff', '#82c4ff', '#34d399', '#f59e0b', '#f87171',
  '#a78bfa', '#fbbf24', '#22d3ee', '#fb7185', '#84cc16',
]

const tooltipStyle = {
  backgroundColor: '#0c1829',     // surface
  border: '1px solid #243650',    // slate-300
  borderRadius: '8px',
  fontSize: '12px',
  color: '#ddeaf8',
}
const tooltipItemStyle = { color: '#ddeaf8' }
const tooltipLabelStyle = { color: '#aec0d8', fontWeight: 600 }

function shortDate(d) {
  // 'YYYY-MM-DD' → 'MMM D'
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function isAllZero(data, keys) {
  if (!Array.isArray(data) || data.length === 0) return true
  return data.every(d => keys.every(k => !d[k]))
}

function EmptyState({ height = 200 }) {
  return (
    <div
      className="w-full flex items-center justify-center rounded-lg border border-slate-300 bg-slate-100/40 text-slate-600 text-xs"
      style={{ height }}
    >
      No data in this window
    </div>
  )
}

export function ChartSkeleton({ height = 220 }) {
  return (
    <div
      className="w-full rounded-lg border border-slate-200 bg-slate-100/30 animate-pulse flex items-end gap-2 p-4"
      style={{ height }}
      aria-busy="true"
      aria-label="Loading chart"
    >
      {[55, 30, 70, 45, 80, 60, 35, 65, 50, 75].map((h, i) => (
        <div key={i} className="flex-1 bg-slate-200/60 rounded-t" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

/**
 * type: 'line' | 'bar' | 'stackedBar' | 'horizontalBar' | 'donut'
 * data: array of objects
 * xKey: x-axis field (default 'date')
 * keys: array of value-field names to plot
 * colors: optional array, same length as keys
 * labels: optional map { key: humanLabel } for legends/tooltips
 * height: pixel height (default 220)
 * formatX / formatY: optional formatters
 * dimX: array of xKey values whose bars + tick labels render at reduced opacity (bar charts only)
 * dimLabels: array of series/category LABELS to render greyed — legend entries
 *            (line/bar/stacked) and category-axis ticks (horizontalBar). Used to
 *            mark tutorial/practice games on the Reports page.
 * compareKey: optional data field plotted as a dashed "previous period" overlay
 *             line on top of line/bar/stackedBar charts (prior-period comparison).
 * compareLabel: legend/tooltip name for the compare line (default 'Prev period').
 */
export default function ReportChart({
  type = 'line',
  data = [],
  xKey = 'date',
  keys = ['count'],
  colors,
  labels,
  height = 220,
  formatX,
  formatY,
  showLegend = false,
  dimX,
  dimLabels,
  compareKey,
  compareLabel = 'Prev period',
}) {
  // When comparing, a period that's empty now but had prior activity should still
  // render (so the dashed baseline shows), so fold compareKey into the zero check.
  const zeroKeys = compareKey ? [...keys, compareKey] : keys
  if (isAllZero(data, zeroKeys)) return <EmptyState height={height} />

  const seriesColors = colors ?? keys.map((_, i) => SERIES_PALETTE[i % SERIES_PALETTE.length])
  const xFmt = formatX ?? (xKey === 'date' ? shortDate : (v => v))
  const yFmt = formatY ?? (v => v)
  const dimSet = dimX && dimX.length ? new Set(dimX.map(String)) : null
  const isDimRow = row => !!dimSet && dimSet.has(String(row?.[xKey]))
  const dimTick = ({ x, y, payload }) => {
    const dim = !!dimSet && dimSet.has(String(payload?.value))
    return (
      <text x={x} y={y + 12} fill={COLORS.axis} fontSize={11} textAnchor="middle" opacity={dim ? DIM_LABEL_OPACITY : 1}>
        {xFmt(payload?.value)}
      </text>
    )
  }

  // Greying of practice/tutorial game names (by their human label).
  const dimLabelSet = dimLabels && dimLabels.length ? new Set(dimLabels.map(String)) : null
  // Category-axis tick for horizontalBar — greys the label when it's a practice game.
  const dimCategoryTick = ({ x, y, payload }) => {
    const dim = !!dimLabelSet && dimLabelSet.has(String(payload?.value))
    return (
      <text x={x} y={y} dy={4} fill={COLORS.axis} fontSize={11} textAnchor="end" opacity={dim ? DIM_LABEL_OPACITY : 1}>
        {payload?.value}
      </text>
    )
  }
  // Legend entry formatter — greys practice game series names.
  const legendFormatter = dimLabelSet
    ? (value) => (
        <span style={{ color: COLORS.axis, opacity: dimLabelSet.has(String(value)) ? DIM_LABEL_OPACITY : 1 }}>{value}</span>
      )
    : undefined

  if (type === 'donut') {
    const palette = colors ?? [COLORS.brand, COLORS.amber, COLORS.emerald, COLORS.red, COLORS.slate]
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey={keys[0]} nameKey={xKey} innerRadius="55%" outerRadius="85%" paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 12, color: COLORS.axis }} />}
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'horizontalBar') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" stroke={COLORS.axis} fontSize={11} tickFormatter={yFmt} />
          <YAxis type="category" dataKey={xKey} stroke={COLORS.axis} fontSize={11} width={120} tick={dimLabelSet ? dimCategoryTick : undefined} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={seriesColors[i]} name={labels?.[k] ?? k} radius={[0, 4, 4, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // Dashed prior-period overlay line, shared by bar/stacked/line when compareKey set.
  const compareLine = compareKey ? (
    <Line
      type="monotone"
      dataKey={compareKey}
      stroke={COLORS.slate}
      strokeWidth={1.5}
      strokeDasharray="4 3"
      dot={false}
      activeDot={{ r: 3 }}
      name={compareLabel}
      legendType="line"
    />
  ) : null

  if (type === 'bar' || type === 'stackedBar') {
    // ComposedChart so the comparison Line can sit over the Bars; it renders the
    // bars identically to BarChart, so non-compare charts are visually unchanged.
    const Chart = compareKey ? ComposedChart : BarChart
    return (
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            stroke={COLORS.axis}
            fontSize={11}
            tickFormatter={xFmt}
            tick={dimSet ? dimTick : undefined}
          />
          <YAxis stroke={COLORS.axis} fontSize={11} tickFormatter={yFmt} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} labelFormatter={xFmt} />
          {(showLegend || compareKey) && <Legend wrapperStyle={{ fontSize: 11, color: COLORS.axis }} formatter={legendFormatter} />}
          {keys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              fill={seriesColors[i]}
              name={labels?.[k] ?? k}
              stackId={type === 'stackedBar' ? 'a' : undefined}
              radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0}
            >
              {dimSet
                ? data.map((row, idx) => (
                    <Cell key={idx} fill={seriesColors[i]} fillOpacity={isDimRow(row) ? DIM_OPACITY : 1} />
                  ))
                : null}
            </Bar>
          ))}
          {compareLine}
        </Chart>
      </ResponsiveContainer>
    )
  }

  // Default: line
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} stroke={COLORS.axis} fontSize={11} tickFormatter={xFmt} />
        <YAxis stroke={COLORS.axis} fontSize={11} tickFormatter={yFmt} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} labelFormatter={xFmt} />
        {(showLegend || compareKey) && <Legend wrapperStyle={{ fontSize: 11, color: COLORS.axis }} />}
        {keys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={seriesColors[i]}
            strokeWidth={2}
            dot={{ r: 2.5, fill: seriesColors[i] }}
            activeDot={{ r: 4 }}
            name={labels?.[k] ?? k}
          />
        ))}
        {compareLine}
      </LineChart>
    </ResponsiveContainer>
  )
}
