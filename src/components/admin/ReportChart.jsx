import { useState } from 'react'
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
  ReferenceLine,
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

// Weekend shading on daily line charts (see `shadeWeekends`).
const WEEKEND_KEY = '__weekend'
const WEEKEND_COLOR = COLORS.slate
const WEEKEND_OPACITY = 0.1

// 'YYYY-MM-DD' is a UTC day key, so read the weekday in UTC too.
function isWeekend(d) {
  const day = new Date(d).getUTCDay()
  return day === 0 || day === 6
}

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

// Legend rendered *outside* the chart, for bar charts with many series.
//
// Recharts' own <Legend> lives inside the ResponsiveContainer and its height
// is taken out of the plot. With ~30 series (every game plus tutorials, as on
// Daily CBAT Sessions) that legend wraps to ten-plus rows on a phone and the
// bars are squeezed to nothing. Drawing it here, below the container, leaves
// the plot at its full height at every width; the card simply grows.
function SeriesLegend({ items }) {
  if (!items.length) return null
  return (
    <ul
      className="flex flex-wrap justify-center gap-x-2.5 gap-y-1 mt-1 px-1 list-none m-0 p-0"
      style={{ fontSize: 11, color: COLORS.axis }}
    >
      {items.map(it => (
        <li key={it.label} className="inline-flex items-center gap-1" style={{ opacity: it.dim ? DIM_LABEL_OPACITY : 1 }}>
          {it.line
            ? <span aria-hidden className="inline-block w-3.5 border-t border-dashed" style={{ borderColor: it.color }} />
            : <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: it.color }} />}
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  )
}

// Clickable legend for line charts with `toggleable` — each entry shows or
// hides its series. Drawn as plain buttons beneath the chart (like
// SeriesLegend) so it is keyboard-reachable and testable without a canvas.
function ToggleLegend({ items, onToggle }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-1 gap-y-1 mt-1 px-1" style={{ fontSize: 11 }}>
      {items.map(it => (
        <button
          key={it.key}
          type="button"
          aria-pressed={!it.hidden}
          onClick={() => onToggle(it.key)}
          title={it.hidden ? `Show ${it.label}` : `Hide ${it.label}`}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 cursor-pointer hover:bg-slate-200/40"
          style={{ color: it.color, opacity: it.hidden ? DIM_LABEL_OPACITY : 1, textDecoration: it.hidden ? 'line-through' : 'none' }}
        >
          {it.band
            ? <span aria-hidden className="inline-block w-3 h-3 rounded-[2px]" style={{ background: it.color, opacity: 0.35 }} />
            : it.marker
              ? <span aria-hidden className="inline-block w-3.5 border-t border-dashed" style={{ borderColor: it.color }} />
              : <span aria-hidden className="inline-block w-3.5 border-t-2" style={{ borderColor: it.color }} />}
          <span>{it.label}</span>
        </button>
      ))}
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
 * markerKeys: subset of `keys` drawn as events rather than a line (line charts
 *             only) — a full-height dashed vertical marker on every x where the
 *             value is above zero, labelled with the value. For a sparse, small
 *             count (e.g. CBAT dates, 1–2 a day) that a line would flatten onto
 *             the axis beneath a series in the hundreds.
 * shadeWeekends: line charts with a 'YYYY-MM-DD' xKey only — Saturdays and
 *             Sundays get a faint full-height band behind the lines. With
 *             `toggleable` the bands get their own legend switch.
 * toggleable: line charts only — the legend becomes a row of buttons that show
 *             or hide each series. A hidden series also leaves the y-axis
 *             domain, so hiding a big series rescales the small ones.
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
  formatXSub,
  formatY,
  showLegend = false,
  dimX,
  dimLabels,
  slantX = false,
  compareKey,
  compareLabel = 'Prev period',
  markerKeys,
  toggleable = false,
  shadeWeekends = false,
}) {
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set())
  const toggleKey = k => setHiddenKeys(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })
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
  // Two-line x tick: primary label (formatX) with a secondary line (formatXSub)
  // stacked beneath — e.g. a date with its day-of-week below it.
  const twoLineTick = ({ x, y, payload }) => (
    <text x={x} y={y + 12} fill={COLORS.axis} fontSize={11} textAnchor="middle">
      <tspan x={x}>{xFmt(payload?.value)}</tspan>
      <tspan x={x} dy={13} fillOpacity={0.65}>{formatXSub(payload?.value)}</tspan>
    </text>
  )
  // Angled x tick — for categorical bars whose labels are too wide to sit flat
  // side by side (e.g. OS names). Rotated ~35° and right-anchored at the tick.
  const slantTick = ({ x, y, payload }) => (
    <text x={x} y={y + 10} fill={COLORS.axis} fontSize={11} textAnchor="end" transform={`rotate(-35 ${x} ${y + 10})`}>
      {xFmt(payload?.value)}
    </text>
  )
  const xTick = dimSet ? dimTick : (formatXSub ? twoLineTick : (slantX ? slantTick : undefined))
  const xAxisHeight = formatXSub ? 40 : (slantX ? 56 : undefined)

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
    // Series legend drawn beneath the chart (see SeriesLegend); the compare
    // line joins it so there is one legend, not two.
    const legendItems = showLegend
      ? [
          ...keys.map((k, i) => {
            const label = labels?.[k] ?? k
            return { label, color: seriesColors[i], dim: !!dimLabelSet && dimLabelSet.has(String(label)) }
          }),
          ...(compareKey ? [{ label: compareLabel, color: COLORS.slate, line: true }] : []),
        ]
      : []
    return (
      <>
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            stroke={COLORS.axis}
            fontSize={11}
            tickFormatter={xFmt}
            tick={xTick}
            height={xAxisHeight}
            interval={slantX ? 0 : undefined}
          />
          <YAxis stroke={COLORS.axis} fontSize={11} tickFormatter={yFmt} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} labelFormatter={xFmt} />
          {!showLegend && compareKey && <Legend wrapperStyle={{ fontSize: 11, color: COLORS.axis }} />}
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
      <SeriesLegend items={legendItems} />
      </>
    )
  }

  // Default: line
  // Per-point dots stop helping once a series is long — at 90 or 365 daily points
  // they merge into a thick band and bury the line itself, so they're dropped and
  // the hover dot does the work instead.
  const showDots = data.length <= 60
  const markerSet = new Set(markerKeys ?? [])
  const isHidden = k => toggleable && hiddenKeys.has(k)
  // Weekend bands are a Bar on a hidden 0–1 axis rather than ReferenceAreas: on
  // a category axis a ReferenceArea runs centre-to-centre, so it would only
  // shade half of each weekend day. A gap-free bar fills the whole day's band.
  // Switched off, the bar stays mounted at zero height: removing it would turn
  // the x-axis back into a point scale and every line would shift sideways.
  const showWeekends = !isHidden(WEEKEND_KEY)
  const chartData = shadeWeekends
    ? data.map(row => ({ ...row, [WEEKEND_KEY]: showWeekends && isWeekend(row[xKey]) ? 1 : 0 }))
    : data
  const LineChartish = shadeWeekends ? ComposedChart : LineChart
  return (
    <>
    <ResponsiveContainer width="100%" height={height}>
      {/* Markers' counts sit in a strip above the plot, where no line can cross them. */}
      <LineChartish data={chartData} barCategoryGap={shadeWeekends ? 0 : undefined} margin={{ top: markerSet.size ? 16 : 4, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
        {shadeWeekends && <YAxis yAxisId={WEEKEND_KEY} domain={[0, 1]} hide />}
        {shadeWeekends && (
          <Bar
            yAxisId={WEEKEND_KEY}
            dataKey={WEEKEND_KEY}
            fill={WEEKEND_COLOR}
            fillOpacity={WEEKEND_OPACITY}
            isAnimationActive={false}
            activeBar={false}
            tooltipType="none"
            legendType="none"
          />
        )}
        <XAxis dataKey={xKey} stroke={COLORS.axis} fontSize={11} tickFormatter={xFmt} />
        <YAxis stroke={COLORS.axis} fontSize={11} tickFormatter={yFmt} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} labelFormatter={xFmt} />
        {!toggleable && (showLegend || compareKey) && <Legend wrapperStyle={{ fontSize: 11, color: COLORS.axis }} />}
        {/* Markers first so the real lines draw over them. */}
        {keys.map((k, i) => markerSet.has(k) && !isHidden(k) && data.filter(row => row[k] > 0).map(row => (
          <ReferenceLine
            key={`${k}-${row[xKey]}`}
            x={row[xKey]}
            stroke={seriesColors[i]}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            label={{ value: row[k], position: 'top', fill: seriesColors[i], fontSize: 10, fontWeight: 600 }}
          />
        )))}
        {keys.map((k, i) => markerSet.has(k) ? (
          // Invisible line: keeps the value in the tooltip and a dashed key in
          // the legend, while the ReferenceLines above do the drawing.
          <Line
            key={k}
            dataKey={k}
            stroke={seriesColors[i]}
            strokeWidth={0}
            strokeDasharray="4 3"
            dot={false}
            activeDot={false}
            legendType="plainline"
            name={labels?.[k] ?? k}
            hide={isHidden(k)}
          />
        ) : (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={seriesColors[i]}
            strokeWidth={2}
            dot={showDots ? { r: 2.5, fill: seriesColors[i] } : false}
            activeDot={{ r: 4 }}
            name={labels?.[k] ?? k}
            hide={isHidden(k)}
          />
        ))}
        {compareLine}
      </LineChartish>
    </ResponsiveContainer>
    {toggleable && (
      <ToggleLegend
        items={[
          ...keys.map((k, i) => ({
            key: k,
            label: labels?.[k] ?? k,
            color: seriesColors[i],
            marker: markerSet.has(k),
            hidden: hiddenKeys.has(k),
          })),
          ...(shadeWeekends ? [{
            key: WEEKEND_KEY,
            label: 'Weekends',
            color: WEEKEND_COLOR,
            band: true,
            hidden: hiddenKeys.has(WEEKEND_KEY),
          }] : []),
        ]}
        onToggle={toggleKey}
      />
    )}
    </>
  )
}
