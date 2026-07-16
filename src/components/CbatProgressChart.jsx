import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis, YAxis,
  Tooltip,
} from 'recharts'

// The user's own score-over-time chart for a single CBAT game. Two variants off one component so
// the axis/PB rules can't drift between the two places they're shown:
//   'spark' — ~56px, no axes, for the post-game screen's personal panel (<CbatGameOver>)
//   'full'  — the leaderboard's "You" tab, with a date axis and tooltip
//
// SPACING vs LABELS are deliberately decoupled:
//   • Points are evenly spaced by attempt, NOT positioned on a real time scale. Twenty runs in one
//     evening followed by a quiet month would otherwise pile up into an unreadable clump. This is
//     the convention financial charts use (evenly spaced trading days, no weekend gaps).
//   • Tick LABELS are real dates, because "#7" tells nobody anything. Granularity adapts: day-level
//     for a history spanning under ~3 weeks, months beyond that. Ticks are deduped so a label only
//     appears where it changes — 8 runs on one day produce one "3 Jul", not eight.
// The tooltip carries the exact attempt number and date, so nothing is lost by the sparse axis.
//
// Y is REVERSED for lower-is-better games (Trace Practise 2D/3D, where the score is rotations) so
// that "up = better" reads identically on every game. That matters most on the sparkline, where
// nobody stops to read an axis.
//
// Kept deliberately sparse — no gridlines, no rolling-average overlay, no personal-best marker.
// The "Trend" stat beside the chart already states the direction of travel in words, and the best
// run is simply the highest point on the chart (true for lower-is-better games too, because the
// axis is reversed), so each of those was restating something already on screen.
//
// Palette mirrors the dark @theme tokens, hardcoded the same way src/components/admin/ReportChart.jsx
// does it — Recharts needs real colour values, not Tailwind classes.
const COLORS = {
  brand: '#5baaff',
  axis:  '#aec0d8',
}

const DAY_MS = 86400000
const MONTH_GRANULARITY_DAYS = 21  // beyond ~3 weeks, per-day ticks get too dense to read

const dayLabel = (at) =>
  new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const monthLabel = (at, withYear) =>
  new Date(at).toLocaleDateString('en-GB', withYear ? { month: 'short', year: '2-digit' } : { month: 'short' })

function fullDate(at) {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Chooses day- or month-level labels from how much time the run history actually covers, then
// returns one tick per distinct label (at its first occurrence) so nothing repeats along the axis.
function buildDateTicks(data) {
  if (!data.length) return { ticks: [], labelOf: () => '' }

  const firstAt = new Date(data[0].at)
  const lastAt  = new Date(data[data.length - 1].at)
  const spanDays = Math.abs(lastAt - firstAt) / DAY_MS
  const spansYears = firstAt.getFullYear() !== lastAt.getFullYear()
  const useMonths = spanDays > MONTH_GRANULARITY_DAYS

  const labelAt = (at) => (useMonths ? monthLabel(at, spansYears) : dayLabel(at))

  const ticks = []
  const labelByAttempt = new Map()
  let prev = null
  for (const point of data) {
    const label = labelAt(point.at)
    if (label !== prev) {
      ticks.push(point.attempt)
      labelByAttempt.set(point.attempt, label)
      prev = label
    }
  }
  return { ticks, labelOf: (attempt) => labelByAttempt.get(attempt) ?? '' }
}

const tooltipStyle = {
  backgroundColor: '#0c1829',
  border: '1px solid #243650',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#ddeaf8',
}

export default function CbatProgressChart({
  series = [],
  lowerIsBetter = false,
  formatScore = (s) => `${s}`,
  variant = 'spark',
  height,
}) {
  if (!series.length) return null

  const data = series.map((p, i) => ({ attempt: i + 1, score: p.score, at: p.at }))
  const isSpark = variant === 'spark'
  const chartHeight = height ?? (isSpark ? 56 : 220)

  // Pad the DRAWN domain so the line never touches the frame and a flat run still renders mid-box
  // rather than welded to an edge...
  const scores = series.map(p => p.score)
  const lo = Math.min(...scores)
  const hi = Math.max(...scores)
  const pad = Math.max(1, (hi - lo) * 0.15)
  const domain = [lo - pad, hi + pad]

  // ...but keep the LABELLED ticks inside the real range. Letting Recharts pick ticks across the
  // padded domain invents scores that can't exist, which formatScore then renders as nonsense
  // ("16/15" on a 15-question game). Ticks are whole numbers because every CBAT score is one.
  const valueTicks = [...new Set(
    (hi === lo ? [lo] : [0, 1, 2, 3].map(i => Math.round(lo + ((hi - lo) * i) / 3)))
  )]

  // The final point is the run the user just finished, so it gets a larger filled dot — it anchors
  // "this is you, today" against the trail behind it.
  const lastIndex = data.length - 1
  const runDot = ({ cx, cy, index, key }) => {
    const isLast = index === lastIndex
    return (
      <circle
        key={key}
        className="recharts-line-dot"
        cx={cx}
        cy={cy}
        r={isLast ? 3.5 : (isSpark ? 1.5 : 2.5)}
        fill={isLast ? '#ddeaf8' : COLORS.brand}
        stroke={isLast ? COLORS.brand : 'none'}
        strokeWidth={isLast ? 1.5 : 0}
      />
    )
  }

  if (isSpark) {
    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="attempt" type="category" hide />
          <YAxis domain={domain} reversed={lowerIsBetter} hide />
          <Line
            type="monotone"
            dataKey="score"
            stroke={COLORS.brand}
            strokeWidth={2}
            isAnimationActive={false}
            dot={runDot}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  const { ticks, labelOf } = buildDateTicks(data)

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      {/* Right margin leaves room for the final date tick, which is centred on the last point and
          would otherwise be clipped by the chart edge ("16 Ju"). */}
      <LineChart data={data} margin={{ top: 8, right: 28, left: 0, bottom: 4 }}>
        <XAxis
          dataKey="attempt"
          type="category"
          ticks={ticks}
          tickFormatter={labelOf}
          stroke={COLORS.axis}
          fontSize={11}
          tickLine={false}
          minTickGap={12}
        />
        <YAxis
          stroke={COLORS.axis}
          fontSize={11}
          domain={domain}
          ticks={valueTicks}
          reversed={lowerIsBetter}
          tickFormatter={(v) => formatScore(Math.round(v))}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={{ color: '#ddeaf8' }}
          labelStyle={{ color: COLORS.axis, fontWeight: 600 }}
          labelFormatter={(attempt, payload) => {
            const at = payload?.[0]?.payload?.at
            return at ? `Attempt ${attempt} · ${fullDate(at)}` : `Attempt ${attempt}`
          }}
          formatter={(val) => [formatScore(Math.round(val)), 'Score']}
        />
        <Line
          type="monotone"
          dataKey="score"
          name="Score"
          stroke={COLORS.brand}
          strokeWidth={2}
          dot={runDot}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
