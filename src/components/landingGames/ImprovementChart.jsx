import { ResponsiveContainer, LineChart, Line, XAxis, YAxis } from 'recharts'

// The shape of one player's improvement, for the public landing wall.
//
// Deliberately NOT src/components/CbatProgressChart.jsx, which is the tool a
// signed-in player reads their own history with: exact score ticks, real dates,
// a tooltip, a personal-best highlight. Every one of those is right there and
// wrong here. A visitor who has never played Target cannot read "803" — the
// number is noise, and four of them are four pieces of noise. What they can read
// is a line going up.
//
// So this draws the trend and nothing else: no ticks, no dots, no tooltip. The
// axes keep their frame and a word each ("Score", "Plays") to say what is being
// measured; the exact figures live in the card footer underneath, where they can
// be read as text instead of squinted at on an axis.
//
// The line is a centred rolling average, not the raw runs. Raw runs on a card
// this size are unreadable — a 56-run FLAG history rendered as a picket fence of
// spikes. Averaging shows the direction of travel, which is the actual claim.
// Because that IS a transformation of the data, the wall says so in a caption
// under the grid; smoothing silently would let a clean curve imply something the
// runs never did.

const COLORS = {
  line: '#5baaff',
  axis: '#4a6282',
  label: '#aec0d8',
  game: '#5baaff',
}

// The window never drops below the five runs the improvement percentage is
// itself measured over (backend/utils/cbatShowcase.js, TREND_WINDOW). That floor
// is not cosmetic: with a 2-run window the drawn line ended on whatever the
// player's final run happened to be, so a card could badge "+52%" above a line
// visibly falling off the right edge. Anchoring both ends to the same five-run
// average the badge and footer quote makes picture and claim agree by
// construction.
const EDGE_WINDOW = 5
const windowFor = (n) => Math.max(EDGE_WINDOW, Math.round(n / 5))

// Moving average over a window that SLIDES INWARD at the ends rather than
// shrinking. A shrinking window leaves the first and last drawn values averaging
// one or two runs — the noisiest points on the chart, at the two positions the
// eye reads hardest. Sliding keeps every point an average of the same number of
// runs, so on a typical history the line literally starts at the first-five
// average and ends at the last-five average printed in the footer beneath it.
export function rollingAverage(values, window = windowFor(values.length)) {
  const n = values.length
  const width = Math.min(window, n)
  const half = Math.floor(width / 2)

  return values.map((_, i) => {
    const from = Math.min(Math.max(0, i - half), n - width)
    const slice = values.slice(from, from + width)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

const axisLabel = (value, extra) => ({
  value,
  fill: COLORS.label,
  fontSize: 10,
  letterSpacing: '0.08em',
  ...extra,
})

// "TARGET PLAYS →" — the x-axis names the game as well as the unit, which is the
// only place the card says which game it is. Two-tone rather than one flat
// string so the game reads as a name and not as part of the axis wording: brand
// blue and bold for the game, the axis grey for "PLAYS".
//
// Drawn as a custom label element rather than HTML underneath so it centres on
// the PLOT area — Recharts passes the plotted box as `viewBox`, and HTML beneath
// the chart would centre on the card instead, sitting a few pixels off from the
// line it belongs to.
function PlaysAxisLabel({ viewBox, game }) {
  const { x = 0, y = 0, width = 0 } = viewBox ?? {}
  return (
    <text x={x + width / 2} y={y + 18} textAnchor="middle" fontSize={10}>
      <tspan fill={COLORS.game} fontWeight="700" letterSpacing="0.12em">{game.toUpperCase()}</tspan>
      <tspan fill={COLORS.label} letterSpacing="0.08em">{' PLAYS →'}</tspan>
    </text>
  )
}

export default function ImprovementChart({ series = [], game = '', lowerIsBetter = false, height = 150 }) {
  if (series.length < 2) return null

  const smoothed = rollingAverage(series.map(p => p.score))
  const data = smoothed.map((value, i) => ({ play: i + 1, value }))

  // Pad the domain so the line sits inside the frame rather than welded to it.
  const lo = Math.min(...smoothed)
  const hi = Math.max(...smoothed)
  const pad = Math.max(1, (hi - lo) * 0.18)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <XAxis
          dataKey="play"
          type="category"
          tick={false}
          tickLine={false}
          stroke={COLORS.axis}
          height={26}
          label={<PlaysAxisLabel game={game} />}
        />
        <YAxis
          tick={false}
          tickLine={false}
          stroke={COLORS.axis}
          width={26}
          domain={[lo - pad, hi + pad]}
          reversed={lowerIsBetter}
          label={axisLabel('SCORE', { angle: -90, position: 'insideLeft', offset: 14 })}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={COLORS.line}
          strokeWidth={2.5}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
