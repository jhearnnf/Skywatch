import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Overlay from '../ui/Overlay'
import CbatProgressChart from '../CbatProgressChart'
import { cbatTrend } from '../../utils/cbatProgress'
import { CBAT_LEADERBOARD_CONFIG, cbatTitleWithDifficulty } from '../../data/cbatGames'

// One user's CBAT score history, opened from the graph icon on the admin Users panel.
//
// Same chart component and the same trend reading the player gets on their own leaderboard
// "You" tab, so an admin answering "is this agent actually improving?" sees exactly what the
// agent sees. The backend (GET /api/admin/users/:id/cbat-progress) picks the default game —
// the first one this user ever finished — so nothing is guessed client-side.
//
// The picker lists only games with at least one finished run. A user who has never finished
// anything gets an empty state rather than a dropdown of 20 empty charts.

// The board config carries the per-game score formatting ("12/15", "84%") and the
// lower-is-better flag. Unknown keys fall back to a plain number and higher-is-better;
// the response's own `lowerIsBetter` is the authority for direction.
const boardCfg = (gameKey) => CBAT_LEADERBOARD_CONFIG[gameKey] ?? {}

// Trend window, matching the server's own reading of the score series (utils/cbatProgressSeries.js)
// so the badge over the score chart and the agent's own post-game trend can't disagree.
const TREND_WINDOW = 5
const TREND_MIN_RUNS = 6

// Averaged ends of a plotted series — one fluke run at either end can't swing the verdict.
// Returns nulls below TREND_MIN_RUNS, which is cbatTrend's signal to say nothing at all.
function windowAverages(values) {
  if (values.length < TREND_MIN_RUNS) return { firstAvg: null, lastAvg: null }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
  return { firstAvg: avg(values.slice(0, TREND_WINDOW)), lastAvg: avg(values.slice(-TREND_WINDOW)) }
}

// The headline "are they getting better?" number, sat with the chart it describes rather than in
// the stat row — with two charts on screen a single shared trend figure would be ambiguous.
//
// cbatTrend normalises the sign, so a positive percentage always means improvement whichever way
// the metric runs (more points, fewer seconds). The tooltip spells out the arithmetic, because a
// bare percentage invites the reader to assume it's first-run-vs-last-run.
function TrendBadge({ firstAvg, lastAvg, lowerIsBetter, format, noun = 'score' }) {
  const trend = cbatTrend({ firstAvg, lastAvg }, lowerIsBetter)
  if (!trend) return null

  const direction = lowerIsBetter ? 'quicker' : 'higher'
  const explain =
    `First ${TREND_WINDOW} runs on this chart averaged ${format(firstAvg)}, the last ${TREND_WINDOW} averaged ${format(lastAvg)}. ` +
    `The percentage is the change between those two averages` +
    (trend.steady ? '.' : `, counted as an improvement when the later average is ${direction}.`) +
    ` Averaged ends rather than single runs so one fluke can't swing it; hidden below ${TREND_MIN_RUNS} runs.`

  const tone = trend.steady ? 'text-slate-600' : trend.improving ? 'text-emerald-700' : 'text-red-600'

  return (
    <span title={explain} className={`text-[11px] font-semibold cursor-help decoration-dotted underline-offset-2 underline ${tone}`}>
      {trend.steady ? (
        <>No overall change in {noun}</>
      ) : (
        <>
          <span>{trend.pct > 0 ? '+' : ''}{trend.pct}%</span>
          {' '}average {trend.improving ? 'improvement' : 'decline'}
        </>
      )}
    </span>
  )
}

function StatTile({ label, value, tone = 'text-slate-800' }) {
  return (
    <div className="flex-1 bg-surface-raised/40 border border-slate-100 rounded-xl px-3 py-2 text-center">
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}

export default function UserCbatProgressModal({ user, API, apiFetch, onClose }) {
  const [gameKey, setGameKey] = useState(null)   // null = let the server choose the default
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  // Off by default: see the timePoints/bestPoints note below. Deliberately NOT reset when the
  // game changes — an admin who opened it up expects it to stay open as they flick between games.
  const [allRunTimes, setAllRunTimes] = useState(false)

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    const qs = gameKey ? `?gameKey=${encodeURIComponent(gameKey)}` : ''
    apiFetch(`${API}/api/admin/users/${user._id}/cbat-progress${qs}`, { credentials: 'include' })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message || 'Could not load scores')
        return body
      })
      .then(body => { if (!cancelled) { setData(body.data ?? null); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [API, apiFetch, user._id, gameKey])

  const games       = data?.games ?? []
  const series      = data?.series ?? []
  const cfg         = boardCfg(data?.gameKey)
  const formatScore = cfg.formatScore ?? ((s) => `${s}`)
  const lowerIsBetter = data?.lowerIsBetter ?? !!cfg.lowerIsBetter
  // Difficulty-qualified: a split game charts two boards and the picker offers
  // both, so the heading over the chart has to say which one is plotted.
  // `cfg.title` is the bare name and takes the suffix here; `data.label` is the
  // API's own label, which already carries it.
  const title       = cfg.title
    ? cbatTitleWithDifficulty(data?.gameKey, cfg.title)
    : (data?.label ?? '')
  // Scores are whole numbers, but the averaged ends aren't — 1dp keeps "12.4/15" readable.
  const formatAvgScore = (v) => formatScore(Number(v.toFixed(1)))

  // Games with a score ceiling (Symbols 15/15, Visualisation 8/8, …) are really competed on
  // time: once an agent maxes out, the score line flatlines and only the clock still shows
  // whether they're getting better. `hideTime` is the existing per-game answer to "does time
  // count here?" — the leaderboards already use it as the tie-breaker flag, so a game that
  // ranks on time gets a second chart and one that doesn't (Target, FLAG, ACT) never does.
  //
  // Plotted through the same component with time as the value: lower is always better, and the
  // reversed axis keeps "up = quicker" reading the same way as "up = better" above it.
  const timePoints = cfg.hideTime ? [] : series.filter(p => p.time != null)

  // ...but a time is only comparable against another time at the SAME score. A quick 9/15 says
  // nothing about form next to a slower 15/15 — it's a different task. So the time chart defaults
  // to the agent's best-score runs only, which is the set the leaderboard tie-breaks on, and the
  // toggle opens it up to every run for anyone who wants the raw picture.
  const bestPoints  = data?.best == null ? [] : timePoints.filter(p => p.score === data.best)
  const shownPoints = allRunTimes ? timePoints : bestPoints
  const timeSeries  = shownPoints.map(p => ({ score: p.time, at: p.at }))

  const formatTime = (s) => `${s}s`
  // Some games record fractional seconds (Symbols keeps 2dp) — one decimal is enough to separate
  // two runs without turning the tile into "12.3400000001s".
  const fmtSeconds = (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}s`
  // Describes whatever the chart is currently showing, so tile and chart never disagree.
  const quickestLabel = shownPoints.length ? fmtSeconds(Math.min(...shownPoints.map(p => p.time))) : null
  // Computed here rather than server-side: the time chart's contents depend on the toggle, so the
  // trend has to follow whichever runs are actually plotted.
  const timeEnds = windowAverages(shownPoints.map(p => p.time))

  return (
    <Overlay zIndex={50} backdrop="rgba(15,23,42,0.60)" onDismiss={onClose} className="flex items-end sm:items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">CBAT Scores</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            <span className="font-semibold text-slate-700">{user.displayName || `Agent ${user.agentNumber}`}</span>
            {user.email && <> · {user.email}</>}
          </p>
        </div>

        <div className="px-6 py-4 flex-1 min-h-0 overflow-y-auto">
          {/* Only the FIRST load blanks the body. Switching games keeps the picker on screen and
              swaps just the chart, so the control an admin is using never disappears under them. */}
          {loading && !data && <p className="text-sm text-slate-400 text-center py-12 animate-pulse">Loading scores…</p>}
          {error && <p className="text-sm text-red-600 text-center py-12">{error}</p>}

          {!loading && !error && games.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <div className="text-3xl mb-2">📈</div>
              <p className="text-sm">No finished CBAT games yet</p>
            </div>
          )}

          {!error && games.length > 0 && (
            <>
              {/* Pills, not a <select>: a native option list is drawn by the OS in its own light
                  colours, which is illegible against this theme. Same picker pattern as the
                  email composer's draft chooser.

                  A game with too few runs to draw a line stays listed but is not selectable —
                  dropping it would hide that the agent has played it at all, which is exactly
                  what an admin checking activity wants to see. */}
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Game</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {games.map(g => {
                  const active = (gameKey ?? data?.gameKey) === g.gameKey
                  const runs = `${g.attempts} finished run${g.attempts === 1 ? '' : 's'}`
                  return (
                    <button
                      key={g.gameKey}
                      onClick={() => setGameKey(g.gameKey)}
                      disabled={!g.chartable}
                      aria-pressed={active}
                      aria-label={`${g.label} — ${runs}${g.chartable ? '' : ', too few to chart'}`}
                      title={g.chartable ? runs : `${runs} — not enough to chart yet`}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                        !g.chartable
                          ? 'border-slate-100 text-slate-500/50 cursor-not-allowed'
                          : active
                            ? 'bg-brand-600 border-brand-600 text-white'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {g.label}
                      <span className={`ml-1.5 font-bold ${
                        !g.chartable ? 'text-slate-500/50' : active ? 'text-white/70' : 'text-slate-500'
                      }`}>{g.attempts}</span>
                    </button>
                  )
                })}
              </div>

              <div className={`flex gap-2 mb-4 ${loading ? 'opacity-50' : ''}`}>
                <StatTile label="Runs" value={data?.attempts ?? 0} />
                <StatTile label="Best" value={data?.best != null ? formatScore(data.best) : '—'} tone="text-amber-700" />
                {/* Quickest run over the same window `best` covers, so the two tiles never
                    describe different slices of the history. */}
                {quickestLabel && (
                  <StatTile label="Quickest" value={quickestLabel} tone="text-brand-700" />
                )}
              </div>

              {/* Two points is a line between two dots — it implies a trend that isn't there yet,
                  so the same threshold the player-facing "You" tab uses applies here. */}
              {series.length < 3 ? (
                <p className="text-sm text-slate-400 text-center py-10">
                  Only {series.length} finished run{series.length === 1 ? '' : 's'} on {title} — not enough to chart yet.
                </p>
              ) : (
                <div className={loading ? 'opacity-50' : ''}>
                  {/* Badge sits immediately after the heading, matching the Time chart below —
                      the Time row's right-hand side belongs to its toggle, so left is the only
                      place the two can line up with each other. */}
                  <div className="flex items-baseline gap-3 mb-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Score</p>
                    <TrendBadge
                      firstAvg={data.firstAvg}
                      lastAvg={data.lastAvg}
                      lowerIsBetter={lowerIsBetter}
                      format={formatAvgScore}
                    />
                  </div>
                  <CbatProgressChart
                    series={series}
                    lowerIsBetter={lowerIsBetter}
                    formatScore={formatScore}
                    variant="full"
                    height={240}
                  />
                  <p className="text-[11px] text-slate-400 text-center mt-2">
                    {lowerIsBetter
                      ? 'Each point is one finished run · higher on the chart is better (fewer rotations).'
                      : 'Each point is one finished run, oldest to most recent.'}
                  </p>

                  {timePoints.length >= 3 && (
                    <div className="mt-5 pt-4 border-t border-slate-100">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1">
                        <div className="flex items-baseline gap-3">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Time</p>
                          <TrendBadge
                            firstAvg={timeEnds.firstAvg}
                            lastAvg={timeEnds.lastAvg}
                            lowerIsBetter
                            format={fmtSeconds}
                            noun="time"
                          />
                        </div>
                        <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={allRunTimes}
                            onChange={e => setAllRunTimes(e.target.checked)}
                            className="accent-brand-600"
                          />
                          Show times for all runs
                        </label>
                      </div>

                      {timeSeries.length >= 3 ? (
                        <>
                          <CbatProgressChart
                            series={timeSeries}
                            lowerIsBetter
                            formatScore={formatTime}
                            variant="full"
                            height={200}
                          />
                          <p className="text-[11px] text-slate-400 text-center mt-2">
                            {allRunTimes
                              ? 'Seconds to finish, every run · higher on the chart is quicker.'
                              : `Seconds to finish on their best runs (${formatScore(data.best)}) · higher on the chart is quicker.`}
                          </p>
                        </>
                      ) : (
                        // Only reachable with the toggle off — timePoints already cleared 3.
                        <p className="text-sm text-slate-400 text-center py-8">
                          Only {timeSeries.length} run{timeSeries.length === 1 ? '' : 's'} at {formatScore(data.best)} so far.
                          <span className="block text-[11px] mt-1">Tick “show times for all runs” to chart every run.</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

      </motion.div>
    </Overlay>
  )
}
