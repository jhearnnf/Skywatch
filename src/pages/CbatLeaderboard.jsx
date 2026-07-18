import { useState, useEffect, useRef } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import PlaneTurnModeToggle from '../components/PlaneTurnModeToggle'
import LeaderboardRow, { rowCols, rowPad } from '../components/LeaderboardRow'
import { CBAT_LEADERBOARD_CONFIG } from '../data/cbatGames'
import LeaderboardIntro, { INTRO_PILL_LAYOUT_ID } from '../components/LeaderboardIntro'
import CbatProgressChart from '../components/CbatProgressChart'
import { cbatTrend } from '../utils/cbatProgress'
import { cbatLastRankKey } from '../utils/storageKeys'

// 'you' is the odd one out: it's the user's own score history rather than a board of other
// people, and it reads from /progress instead of /leaderboard. It lives here anyway because
// "how am I doing" is the same question the boards answer, and the tabstrip is already the
// place users look for it.
const TABS = [
  { key: 'weekly',   label: 'This Week' },
  { key: 'all-time', label: 'All Time' },
  { key: 'you',      label: 'You' },
]

function fmtCountdown(resetsAt) {
  if (!resetsAt) return null
  const ms = new Date(resetsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.floor(ms / 60000)
  const d = Math.floor(mins / (60 * 24))
  const h = Math.floor((mins % (60 * 24)) / 60)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${mins % 60}m`
}

// The trend stat tile. The HEADING carries the verdict and the value carries the magnitude, so it
// reads "Improved +15%" — a user shouldn't have to decode a minus sign to learn whether their own
// number is good news. The heading has to move with the sign: a tile labelled "Improved" showing
// −12% is simply a lie, and one that's caught once poisons the whole panel.
//
// Sign handling (including the lower-is-better inversion, where a FALLING score is an improving
// player) comes from the shared cbatTrend, so this can't drift from the post-game screen's wording.
function trendTile(board, lowerIsBetter) {
  const trend = cbatTrend(board, lowerIsBetter)
  if (!trend) return null
  if (trend.steady) return { heading: 'Trend', value: 'Steady', tone: 'text-slate-400' }
  if (trend.improving) return { heading: 'Improved', value: `+${trend.pct}%`, tone: 'text-emerald-300' }
  // Muted rather than red — a dip is information, not a telling-off.
  return { heading: 'Declined', value: `${trend.pct}%`, tone: 'text-slate-400' }
}

function StatTile({ label, value, tone = 'text-[#ddeaf8]' }) {
  return (
    <div className="flex-1 bg-[#060e1a] border border-[#1a3a5c] rounded-lg px-3 py-2 text-center">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-base font-mono font-bold ${tone}`}>{value}</p>
    </div>
  )
}

// Where the user's recent form sits against everyone else's — one sentence, no gauge.
//
// A progress bar used to sit here and was removed: it encoded the share you're AHEAD of (92%)
// right beside a headline reading "top 8%" — the same fact as two different numbers on opposing
// scales, which is unreadable rather than merely redundant. The sentence says it better alone.
//
// Phrased as "top X%", not "ahead of Y%" — and never "top Xth percentile", which strictly means the
// opposite (the 60th percentile has 60% BELOW it). Beyond reading better, "top X%" absorbs ties
// without having to explain them: most CBAT games have a scoring ceiling, so a chunk of the field
// shares a perfect recent-form average, and "ahead of 65%" on a flawless 15/15 reads as broken
// until you're told the other 35% are level rather than above.
//
// Two ends a raw percentage can't carry:
//
// Nobody above you → celebrate (a ceiling'd tie, or an outright lead).
//
// Bottom quartile → "outside the top 75%". topPct is 100 − (share you're ahead of), so the foot of
// the field computes to "top 100%", which is a punchline; and clamping that to a flattering-looking
// 99% would just be a lie. Note this is NOT the same as "the bottom 75%" — someone at topPct 80 is
// in the bottom 20%, so naming a bottom-% from this number would misstate it. "Outside the top 75%"
// is exactly true for everyone in this branch, keeps the same vocabulary as the good case, and
// invents no number.
const OUTSIDE_TOP_PCT = 75

function FormPercentile({ form, cfg }) {
  // `window` deliberately renamed — destructuring it here would shadow the global.
  const { percentile, window: runsWindow, form: value, formTime, tiedWith, betterThanMe } = form
  const atTop = betterThanMe === 0
  const topPct = Math.max(1, 100 - percentile)
  const outsideTop = topPct > OUTSIDE_TOP_PCT
  const scoreLabel = cfg.formatScore ? cfg.formatScore(Math.round(value)) : value
  // Ranking always breaks score ties on time, but only games with a meaningful clock show it —
  // Target and FLAG run a fixed duration, so their time is a constant, not an achievement.
  const showTime = !cfg.hideTime && formTime != null

  return (
    <div className="mt-4 pt-3 border-t border-[#1a3a5c]">
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-[11px] text-slate-500 uppercase tracking-wide">Current Form</p>
        {/* Shows the exact basis of the ranking, so "top 8%" on a perfect score is self-explaining:
            the score is maxed and speed is what's separating you from the other perfect agents. */}
        <p className="text-[10px] text-slate-500">
          last {runsWindow} runs avg {scoreLabel}{showTime && ` · ${formTime}s`}
        </p>
      </div>
      {/* The verdict is the whole point of this block, so it carries the weight; the avg/time
          basis stays in the small print above. */}
      {atTop ? (
        <p className="text-sm font-bold text-amber-300 mt-2">
          {tiedWith === 0 ? '🥇 Best form of any agent' : '🥇 Joint best form'}
          {tiedWith > 0 && (
            <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
              level with {tiedWith} other agent{tiedWith === 1 ? '' : 's'}
            </span>
          )}
        </p>
      ) : outsideTop ? (
        <p className="text-sm font-bold text-[#ddeaf8] mt-2">
          You're outside the top{' '}
          <span className="text-xl font-mono font-extrabold text-slate-700">{OUTSIDE_TOP_PCT}%</span>
          <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
            Keep practising to improve your score!
          </span>
        </p>
      ) : (
        <p className="text-sm font-bold text-[#ddeaf8] mt-2">
          You're in the top{' '}
          <span className="text-xl font-mono font-extrabold text-brand-300">{topPct}%</span>
          {' '}of agents!
        </p>
      )}
    </div>
  )
}

// The "You" tab body — the user's own score history rather than a board of other agents.
function ProgressPanel({ board, cfg }) {
  const { series = [], attempts = 0, best = null, form = null } = board || {}
  const formatScore = cfg.formatScore || ((s) => `${s}`)

  // Neither empty state carries its own play button: the page already renders a persistent
  // "Play {game}" action directly below this panel, so one here would just repeat it.
  if (attempts === 0) {
    return (
      <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
        <p className="text-4xl mb-3">📈</p>
        <p className="font-bold text-white mb-1">No runs yet</p>
        <p className="text-sm text-slate-400">Finish a game and your progress starts charting here.</p>
      </div>
    )
  }

  // Two points is a line between two dots — it implies a trend that isn't there yet.
  if (series.length < 3) {
    return (
      <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
        <p className="text-4xl mb-3">📈</p>
        <p className="font-bold text-white mb-1">{attempts} run{attempts === 1 ? '' : 's'} logged</p>
        <p className="text-sm text-slate-400">
          Play {3 - series.length} more and your trend line appears here.
        </p>
      </div>
    )
  }

  const verdict = trendTile(board, !!cfg.lowerIsBetter)

  return (
    <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-4">
      <div className="flex gap-2 mb-4">
        <StatTile label="Attempts" value={attempts} />
        <StatTile label="Best" value={best != null ? formatScore(best) : '—'} tone="text-amber-300" />
        {verdict && <StatTile label={verdict.heading} value={verdict.value} tone={verdict.tone} />}
      </div>

      <CbatProgressChart
        series={series}
        lowerIsBetter={!!cfg.lowerIsBetter}
        formatScore={formatScore}
        variant="full"
      />

      <p className="text-[11px] text-slate-500 text-center mt-2">
        {cfg.lowerIsBetter ? 'Higher on the chart is better (fewer rotations).' : 'Each point is one finished run.'}
      </p>

      {form && <FormPercentile form={form} cfg={cfg} />}
    </div>
  )
}

export default function CbatLeaderboard() {
  const { gameKey } = useParams()
  const navigate = useNavigate()
  const { user, apiFetch, API } = useAuth()

  const [tab, setTab] = useState('weekly')           // 'weekly' (default) | 'all-time'
  const [boards, setBoards] = useState({})           // { weekly: {...}, 'all-time': {...} }
  const [loading, setLoading] = useState({})         // per-period in-flight flag

  const cfg = CBAT_LEADERBOARD_CONFIG[gameKey]
  const planeTurnMode = cfg?.planeTurnMode ?? null

  // Arrival animation: the "This Week" card floats up into this tab on every
  // mount, then (only when arriving straight from a game) the user's row slides
  // to its new position.
  const location = useLocation()
  const fromGame = !!location.state?.fromGame
  const [introDone, setIntroDone] = useState(false)
  const [slideRows, setSlideRows] = useState(null)      // reordered weekly entries during the FLIP, or null
  const [slideDelta, setSlideDelta] = useState(null)    // +climbed / −dropped, shown on the user's row
  const slideFiredRef = useRef(false)
  const slideTimersRef = useRef({ raf: null, clear: null })

  // Reset cached boards whenever the game changes.
  useEffect(() => { setBoards({}); setLoading({}); setTab('weekly') }, [gameKey])

  // Lazily fetch the active tab's data (weekly on mount, the others on first switch).
  useEffect(() => {
    if (!user || !cfg) return
    if (boards[tab] || loading[tab]) return
    const isProgress = tab === 'you'
    // percentile=1 is opt-in — it aggregates the whole collection, and only this tab shows it.
    const url = isProgress
      ? `${API}/api/games/cbat/${gameKey}/progress?percentile=1`
      : `${API}/api/games/cbat/${gameKey}/leaderboard?period=${tab}`
    const empty = isProgress
      ? { series: [], attempts: 0, best: null }
      : { leaderboard: [], myBest: null }
    setLoading(l => ({ ...l, [tab]: true }))
    apiFetch(url)
      .then(r => r.json())
      .then(d => setBoards(b => ({ ...b, [tab]: d.data || empty })))
      .catch(() => setBoards(b => ({ ...b, [tab]: empty })))
      .finally(() => setLoading(l => ({ ...l, [tab]: false })))
  }, [user, gameKey, tab])  // eslint-disable-line react-hooks/exhaustive-deps

  // Once the intro has docked and the weekly board is loaded, decide whether to
  // play the "your rank moved" slide. Fires at most once per mount, and always
  // remembers the user's current rank so the next visit has a "before" to
  // compare against.
  useEffect(() => {
    if (tab !== 'weekly' || slideFiredRef.current) return
    const b = boards.weekly
    const newRank = b?.myBest?.rank
    if (!b?.leaderboard || newRank == null) return
    if (!introDone) return   // wait for the intro to dock before moving rows

    slideFiredRef.current = true
    const key = cbatLastRankKey(gameKey)
    let prevRank = null
    try {
      const raw = localStorage.getItem(key)
      if (raw != null && raw !== '') prevRank = Number(raw)
    } catch { /* storage unavailable */ }
    try { localStorage.setItem(key, String(newRank)) } catch { /* storage unavailable */ }

    const trueOrder = b.leaderboard
    const meIdx = trueOrder.findIndex(e => e.userId === b.myBest.userId)
    const eligible = fromGame && meIdx >= 0 &&
      prevRank != null && Number.isFinite(prevRank) && prevRank !== newRank
    if (!eligible) return

    // Rebuild the pre-play order — pull the user's row out and reinsert it at its
    // old slot. framer's layout FLIP then slides every affected row to the true
    // order on the next frame.
    const me = trueOrder[meIdx]
    const rest = trueOrder.filter((_, i) => i !== meIdx)
    const oldIdx = Math.max(0, Math.min(rest.length, prevRank - 1))
    const oldOrder = [...rest.slice(0, oldIdx), me, ...rest.slice(oldIdx)]

    setSlideDelta(prevRank - newRank)   // positive = climbed
    setSlideRows(oldOrder)
    slideTimersRef.current.raf = requestAnimationFrame(() => {
      slideTimersRef.current.raf = requestAnimationFrame(() => setSlideRows(trueOrder))
    })
    slideTimersRef.current.clear = setTimeout(() => {
      setSlideRows(null)
      setSlideDelta(null)
    }, 2400)
  }, [boards.weekly, tab, introDone, fromGame, gameKey])  // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel any in-flight slide timers on unmount.
  useEffect(() => () => {
    if (slideTimersRef.current.raf) cancelAnimationFrame(slideTimersRef.current.raf)
    if (slideTimersRef.current.clear) clearTimeout(slideTimersRef.current.clear)
  }, [])

  const handlePlaneTurnModeChange = (nextMode) => navigate(`/cbat/plane-turn-${nextMode}/leaderboard`)

  // Swipe between tabs on touch (segmented control remains the source of truth). Steps one tab
  // along TABS rather than naming them, so the strip can grow without this drifting out of sync.
  const onDragEnd = (_e, info) => {
    const i = TABS.findIndex(t => t.key === tab)
    if (info.offset.x < -60 && i < TABS.length - 1) setTab(TABS[i + 1].key)
    else if (info.offset.x > 60 && i > 0) setTab(TABS[i - 1].key)
  }

  if (!cfg) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-3">❓</p>
        <p className="font-bold text-slate-800">Unknown game</p>
        <Link to="/cbat" className="text-sm text-brand-300 hover:text-brand-200 mt-2 inline-block">Back to CBAT</Link>
      </div>
    )
  }

  const board = boards[tab]
  const isLoading = loading[tab] || !board
  const isWeekly = tab === 'weekly'
  const isProgress = tab === 'you'
  const countdown = isWeekly ? fmtCountdown(board?.resetsAt) : null

  const cols = rowCols(tab, cfg)
  const mode3d = planeTurnMode === '3d'

  const myBest = board?.myBest
  const myBestOutsideTop = myBest && !(board?.leaderboard || []).find(e => e.userId === myBest.userId)

  // During the post-game slide the weekly rows render in a controlled order.
  const sliding = isWeekly && slideRows !== null
  const rowsToRender = sliding ? slideRows : (board?.leaderboard || [])

  return (
    <div className="cbat-leaderboard-page">
      <SEO title={`${cfg.title} Leaderboard — CBAT`} description={`Top scores for ${cfg.title}`} />

      {!introDone && <LeaderboardIntro onDone={() => setIntroDone(true)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Link to={cfg.backPath} className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; Instructions</Link>
          <h1 className="text-sm font-extrabold text-slate-900">{cfg.emoji} {cfg.title} Leaderboard</h1>
        </div>
        {planeTurnMode && <PlaneTurnModeToggle value={planeTurnMode} onChange={handlePlaneTurnModeChange} />}
      </div>

      {/* Weekly / All-Time segmented control (source of truth; swipe is an accelerator) */}
      <div className="w-full max-w-lg mx-auto mb-3">
        <div className="flex bg-[#060e1a] border border-[#1a3a5c] rounded-lg p-0.5" role="tablist">
          {TABS.map(t => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`relative flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                  active ? 'text-white' : 'text-slate-400 hover:text-[#ddeaf8]'
                }`}
              >
                {/* Active-pill background. Shares INTRO_PILL_LAYOUT_ID with the
                    intro card, so on first arrival the card morphs into it; once
                    docked it also slides between tabs on switch. Held back until
                    the intro finishes so only one element owns the layoutId. */}
                {active && introDone && (
                  <motion.div
                    layoutId={INTRO_PILL_LAYOUT_ID}
                    className="absolute inset-0 bg-brand-600"
                    style={{ borderRadius: 6 }}
                    transition={{ layout: { duration: 0.55, ease: [0.4, 0, 0.2, 1] } }}
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5 text-center">
          {isWeekly
            ? <>Points add up across every run this week{countdown ? ` · resets in ${countdown}` : ''}</>
            : isProgress
              ? 'Every run you\'ve finished, oldest to newest'
              : planeTurnMode
                ? `All-time best ${planeTurnMode === '3d' ? '3D' : '2D'} scores · fewest rotations through 5 levels`
                : 'All-time best scores'}
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-slate-400">Loading leaderboard...</p>
        </div>
      ) : (
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragEnd={onDragEnd}
          className="w-full max-w-lg mx-auto"
        >
          {isProgress ? (
            <ProgressPanel board={board} cfg={cfg} />
          ) : (board.leaderboard || []).length === 0 ? (
            <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-8 text-center">
              <p className="text-4xl mb-3">🏆</p>
              <p className="font-bold text-white mb-1">{isWeekly ? 'No scores yet this week' : 'No scores yet'}</p>
              <p className="text-sm text-slate-400 mb-4">Be the first to set a score!</p>
              <Link to={cfg.backPath} className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-sm transition-colors no-underline">
                Play Now
              </Link>
            </div>
          ) : (
            <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl overflow-hidden">
              {/* Table header */}
              <div className={`grid ${cols} ${rowPad()} py-2.5 bg-[#060e1a] border-b border-[#1a3a5c] text-[10px] text-slate-500 uppercase tracking-wide font-bold`}>
                <span>Rank</span>
                <span>Agent</span>
                {isWeekly ? (
                  <>
                    <span className="text-right">Points</span>
                    <span className="text-right">Plays</span>
                  </>
                ) : (
                  <>
                    <span className="text-right">{cfg.scoreLabel}</span>
                    {!cfg.hideTime && <span className="text-right">Time</span>}
                  </>
                )}
              </div>

              {/* Rows */}
              <div className="divide-y divide-[#1a3a5c]/50">
                {rowsToRender.map(entry => {
                  const isMe = !!(user && entry.userId === user._id)
                  return (
                    <LeaderboardRow
                      key={entry._id}
                      entry={entry}
                      variant={tab}
                      cfg={cfg}
                      isMe={isMe}
                      mode3d={mode3d}
                      layout={sliding}
                      delta={isMe && sliding ? slideDelta : null}
                    />
                  )
                })}
              </div>

              {/* Current user outside the visible top 20 */}
              {myBestOutsideTop && (
                <>
                  <div className="px-4 py-1 text-center text-[10px] text-slate-500">···</div>
                  <LeaderboardRow entry={myBest} variant={tab} cfg={cfg} isMe divider mode3d={mode3d} />
                </>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 justify-center mt-5">
            <Link to={cfg.backPath} className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors no-underline">
              Play {cfg.title}
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  )
}
