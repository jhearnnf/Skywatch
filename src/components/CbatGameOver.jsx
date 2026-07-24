import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useGameChrome } from '../context/GameChromeContext'
import { CBAT_LEADERBOARD_CONFIG } from '../data/cbatGames'
import LeaderboardRow from './LeaderboardRow'
import CbatProgressChart from './CbatProgressChart'
import { cbatTrend, isCbatNewBest } from '../utils/cbatProgress'

// Shared CBAT game-completion screen. Every CBAT game renders this at
// phase === 'results', passing its results breakdown as `children` (with its
// own buttons/score-saved line suppressed via the breakdown's `embedded` prop).
//
// It is ONE screen, top to bottom: a personal beat (score + PB/delta), the
// user's weekly leaderboard position (a chase window that previews the full
// board), the game-specific breakdown, then a single unified action row. There
// is no separate "View Results" step — the breakdown is always visible inline.
//
// Offline (queued): the score is saved locally but not yet ranked, so we skip
// the weekly fetch and tell the user their rank updates on reconnect.
//
// Props:
//   gameKey      — leaderboard key (e.g. 'target', 'plane-turn-2d')
//   score        — this run's primary score (already in display units)
//   scoreSaved   — true once the online submit succeeded
//   queued       — true when the submit was queued offline
//   personalBest — { bestScore, attempts } or null (may include this run)
//   onPlayAgain  — restart handler (primary action)
//   extraActions — optional [{ label, onClick }] | [{ label, to }] tertiary
//                  buttons (e.g. Change Aircraft, Back to Modes) — same slot
//                  and styling on every game for consistency
//   children     — the game-specific results breakdown (embedded, no buttons)

function fmtCountdown(resetsAt) {
  const ms = new Date(resetsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const totalMins = Math.floor(ms / 60000)
  const d = Math.floor(totalMins / (60 * 24))
  const h = Math.floor((totalMins % (60 * 24)) / 60)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${totalMins % 60}m`
}

function WeeklyChase({ weekly }) {
  const me = weekly.neighbors.find(n => n.isMe)
  const above = me ? weekly.neighbors.find(n => n.rank === me.rank - 1) : null
  const toPass = above ? Math.max(1, above.weekTotal - me.weekTotal) : null
  const countdown = fmtCountdown(weekly.resetsAt)

  return (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-2 mb-4 text-left">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide">This Week</p>
        {countdown && <p className="text-[10px] text-slate-500">resets in {countdown}</p>}
      </div>
      <div className="divide-y divide-[#1a3a5c]/50">
        {weekly.neighbors.map(n => (
          <LeaderboardRow key={`${n.rank}-${n.name}`} entry={n} variant="weekly" isMe={n.isMe} compact />
        ))}
      </div>
      <p className="text-xs text-brand-300 mt-2.5 text-center">
        {toPass != null
          ? <>{toPass} pts to pass <span className="font-bold">{above.name}</span></>
          : me?.rank === 1
            ? <>🥇 You lead the week — {weekly.weekTotal} pts</>
            : <>{weekly.weekTotal} pts this week</>}
      </p>
    </div>
  )
}

// Fewer than this and a trend line is just noise, so we show the "keep playing" hook instead.
const MIN_ATTEMPTS_FOR_CHART = 3

// The weekly-standing and progress fetches wait for the score save to confirm
// (see the effects below). If it never confirms — the rare bad-payload drop path
// where neither `scoreSaved` nor `queued` ever flips — we query anyway after this
// long rather than leaving the panels spinning forever.
const SAVE_WAIT_FALLBACK_MS = 5000

// The personal trend: a sparkline of recent attempts plus one plain-English verdict. Sits with
// the score/PB lines because it's part of the same personal beat — the competitive beat
// (<WeeklyChase>) comes after it.
function ProgressTrend({ progress, cfg }) {
  const { series, firstAvg, lastAvg, attempts } = progress
  const formatScore = cfg.formatScore || ((s) => `${s}`)

  // Too early to chart — say how much further it is rather than going silent, which doubles as a
  // nudge toward the Play Again button below.
  if (series.length < MIN_ATTEMPTS_FOR_CHART) {
    const remaining = MIN_ATTEMPTS_FOR_CHART - series.length
    return (
      <p className="text-[11px] text-slate-500 mb-4">
        {remaining} more run{remaining === 1 ? '' : 's'} and your progress chart appears here.
      </p>
    )
  }

  // Sign handling lives in cbatTrend — positive always means "getting better", whichever
  // direction the game scores in.
  const trend = cbatTrend({ firstAvg, lastAvg }, !!cfg.lowerIsBetter)
  let verdict = null
  if (trend) {
    if (trend.steady) {
      verdict = <span className="text-slate-400">Holding steady over your last 5 runs</span>
    } else if (trend.improving) {
      verdict = <span className="text-emerald-300">Last 5 runs {trend.pct}% better than your first 5</span>
    } else {
      verdict = <span className="text-slate-400">Last 5 runs {Math.abs(trend.pct)}% below your first 5</span>
    }
  }

  return (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-2 mb-4">
      <div className="flex items-center justify-between mb-0.5 px-1">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide">Your Progress</p>
        <p className="text-[10px] text-slate-500">{attempts} attempts</p>
      </div>
      <CbatProgressChart
        series={series}
        lowerIsBetter={!!cfg.lowerIsBetter}
        formatScore={formatScore}
        variant="spark"
      />
      {verdict && <p className="text-[11px] text-center mt-1">{verdict}</p>}
    </div>
  )
}

export default function CbatGameOver({
  gameKey, score, scoreSaved, queued, personalBest, onPlayAgain, extraActions = [], children,
}) {
  const { apiFetch, API } = useAuth()
  const { enterGameOver, exitGameOver } = useGameChrome()
  const cfg = CBAT_LEADERBOARD_CONFIG[gameKey] || {}

  // While this results screen is mounted, mark the CBAT chrome as "game over" so
  // the menu soundtrack returns to full volume (see <CbatMenuMusic>).
  useEffect(() => {
    enterGameOver()
    return exitGameOver
  }, [enterGameOver, exitGameOver])

  const [weekly, setWeekly] = useState(null)
  const [weeklyState, setWeeklyState] = useState('loading') // loading | ready | offline | error
  const [progress, setProgress] = useState(null)            // null until loaded; never blocks the panel
  const [progressDone, setProgressDone] = useState(false)   // settled (loaded, failed or skipped) — gates the PB verdict
  const [shown, setShown] = useState(0)
  const rafRef = useRef(null)

  // Count-up animation for the personal beat.
  useEffect(() => {
    const dur = 700
    let start = null
    const step = (t) => {
      if (start == null) start = t
      const p = Math.min(1, (t - start) / dur)
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))))
      if (p < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [score])

  // Fetch the user's weekly standing (skip when the score is only queued offline).
  //
  // This waits for the score save to confirm (`scoreSaved`) before asking. Saving
  // the score and reading the weekly board are two separate requests: firing this
  // on mount raced the save and often read the board *before* the just-played
  // score had landed, so the server returned "not played this week" and the panel
  // silently vanished — even though the score saved a beat later. Gating on
  // `scoreSaved` closes that race; the fallback timer covers the drop path where
  // the save never confirms (see SAVE_WAIT_FALLBACK_MS).
  useEffect(() => {
    if (queued) { setWeeklyState('offline'); return }
    let cancelled = false
    const fetchStanding = () => {
      apiFetch(`${API}/api/games/cbat/${gameKey}/weekly/me`)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return
          if (d?.data?.played && d.data.neighbors?.length) { setWeekly(d.data); setWeeklyState('ready') }
          else setWeeklyState('error')
        })
        .catch(() => { if (!cancelled) setWeeklyState('error') })
    }
    if (scoreSaved) { fetchStanding(); return () => { cancelled = true } }
    const t = setTimeout(fetchStanding, SAVE_WAIT_FALLBACK_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [gameKey, queued, scoreSaved])  // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the user's own score history for the trend sparkline, in parallel with the weekly
  // standing above. Skipped when queued: an offline run isn't on the server yet, so the series
  // would be missing the very attempt the user just played — a trend that silently omits the
  // newest point is worse than no trend. For the same reason it waits for `scoreSaved`: fetching
  // before the save lands would omit the just-played point from the trend. It fetches itself
  // rather than taking a prop so none of the ~18 games rendering this screen need to change.
  useEffect(() => {
    if (queued) { setProgressDone(true); return }   // no server series offline — PB verdict falls back
    let cancelled = false
    const fetchProgress = () => {
      apiFetch(`${API}/api/games/cbat/${gameKey}/progress`)
        .then(r => r.json())
        .then(d => { if (!cancelled && d?.data?.series) setProgress(d.data) })
        .catch(() => { /* trend is additive — a failure just leaves the panel as it was */ })
        .finally(() => { if (!cancelled) setProgressDone(true) })
    }
    if (scoreSaved) { fetchProgress(); return () => { cancelled = true } }
    const t = setTimeout(fetchProgress, SAVE_WAIT_FALLBACK_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [gameKey, queued, scoreSaved])  // eslint-disable-line react-hooks/exhaustive-deps

  const formatScore = cfg.formatScore || ((s) => `${s}`)

  // A genuine PB means this run holds the record, not merely that it tied the top score — otherwise
  // games with a score ceiling flash "personal best" on every max, even a slower one. The progress
  // series carries per-run times so we can rank score-then-time (see isCbatNewBest). Until it lands
  // we hold the verdict rather than celebrate prematurely and then retract it; if the series never
  // comes (offline/failed), we fall back to the score-only check as a best effort.
  const preciseIsPB = isCbatNewBest(progress?.series, personalBest, {
    hideTime: cfg.hideTime,
    lowerIsBetter: cfg.lowerIsBetter,
  })
  const fallbackIsPB = personalBest != null && (cfg.lowerIsBetter
    ? score <= personalBest.bestScore
    : score >= personalBest.bestScore)
  const isPB = preciseIsPB != null ? preciseIsPB
    : progressDone ? fallbackIsPB
    : false

  const secondaryBtn = 'px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md flex flex-col gap-4"
    >
      {/* Panel 1 — personal beat + weekly position */}
      <div className="bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center">
        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Your Score</p>
        <p className="text-5xl font-mono font-bold text-brand-300 mb-2">{formatScore(shown)}</p>

        {isPB
          ? <p className="text-sm font-bold text-amber-300 mb-4">🎉 Personal best!</p>
          : personalBest
            ? <p className="text-xs text-slate-400 mb-4">Best {formatScore(personalBest.bestScore)}</p>
            : <p className="text-xs text-slate-400 mb-4">First run logged</p>}

        {progress && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <ProgressTrend progress={progress} cfg={cfg} />
          </motion.div>
        )}

        {weeklyState === 'ready' && weekly && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <WeeklyChase weekly={weekly} />
          </motion.div>
        )}
        {weeklyState === 'loading' && (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {weeklyState === 'offline' && (
          <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-1">
            <p className="text-xs text-amber-300">📡 Saved offline — your weekly rank updates when you reconnect.</p>
          </div>
        )}

        {scoreSaved && weeklyState !== 'offline' && (
          <p className="text-[11px] text-green-400 mt-1">✓ Score saved</p>
        )}
      </div>

      {/* Panel 2 — game-specific breakdown (rendered embedded, no own actions) */}
      {children}

      {/* Unified action row — identical across every game */}
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onPlayAgain}
          className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Play Again
        </button>
        <Link to={`/cbat/${gameKey}/leaderboard`} state={{ fromGame: true }} className={secondaryBtn}>🏆 View Leaderboard</Link>
        {extraActions.map((a, i) => (
          a.to
            ? <Link key={i} to={a.to} className={secondaryBtn}>{a.label}</Link>
            : <button key={i} onClick={a.onClick} className={secondaryBtn}>{a.label}</button>
        ))}
      </div>
    </motion.div>
  )
}
