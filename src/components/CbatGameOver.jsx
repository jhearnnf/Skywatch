import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { CBAT_LEADERBOARD_CONFIG } from '../data/cbatGames'
import LeaderboardRow from './LeaderboardRow'

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
// Reduced motion: no count-up / slide — the final state is shown immediately.
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
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-left">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide">This Week</p>
        {countdown && <p className="text-[10px] text-slate-500">resets in {countdown}</p>}
      </div>
      <div className="divide-y divide-[#1a3a5c]/50">
        {weekly.neighbors.map(n => (
          <LeaderboardRow key={`${n.rank}-${n.name}`} entry={n} variant="weekly" isMe={n.isMe} />
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

export default function CbatGameOver({
  gameKey, score, scoreSaved, queued, personalBest, onPlayAgain, extraActions = [], children,
}) {
  const { apiFetch, API } = useAuth()
  const reduce = useReducedMotion()
  const cfg = CBAT_LEADERBOARD_CONFIG[gameKey] || {}

  const [weekly, setWeekly] = useState(null)
  const [weeklyState, setWeeklyState] = useState('loading') // loading | ready | offline | error
  const [shown, setShown] = useState(reduce ? score : 0)
  const rafRef = useRef(null)

  // Count-up animation for the personal beat (skipped under reduced motion).
  useEffect(() => {
    if (reduce) { setShown(score); return }
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
  }, [score, reduce])

  // Fetch the user's weekly standing (skip when the score is only queued offline).
  useEffect(() => {
    if (queued) { setWeeklyState('offline'); return }
    let cancelled = false
    apiFetch(`${API}/api/games/cbat/${gameKey}/weekly/me`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d?.data?.played && d.data.neighbors?.length) { setWeekly(d.data); setWeeklyState('ready') }
        else setWeeklyState('error')
      })
      .catch(() => { if (!cancelled) setWeeklyState('error') })
    return () => { cancelled = true }
  }, [gameKey, queued])  // eslint-disable-line react-hooks/exhaustive-deps

  const formatScore = cfg.formatScore || ((s) => `${s}`)
  const isPB = personalBest != null && (cfg.lowerIsBetter
    ? score <= personalBest.bestScore
    : score >= personalBest.bestScore)

  const secondaryBtn = 'px-5 py-2.5 bg-[#1a3a5c] hover:bg-[#254a6e] text-[#ddeaf8] text-sm font-bold rounded-lg transition-colors no-underline'

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
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

        {weeklyState === 'ready' && weekly && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.4 }}
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
