import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useGameChrome } from '../context/GameChromeContext'
import { CBAT_LEADERBOARD_CONFIG } from '../data/cbatGames'
import LeaderboardRow, { rowCols, rowPad } from './LeaderboardRow'
import CbatProgressChart from './CbatProgressChart'
import { cbatTrend, cbatTrendPhrase, isCbatNewBest } from '../utils/cbatProgress'
import { cbatAdminViewOn, withCbatView } from '../utils/cbatAdminView'
import useCountUp from '../hooks/useCountUp'
import { isOnline, onNetworkChange } from '../lib/net'
import { onApiHealthChange, getApiHealth } from '../lib/apiHealth'
import { onOutboxChange, pendingCount } from '../lib/cbatOutbox'

// Shared CBAT game-completion screen. Every CBAT game renders this at
// phase === 'results', passing its results breakdown as `children` (with its
// own buttons/score-saved line suppressed via the breakdown's `embedded` prop).
//
// It is ONE screen, top to bottom: a personal beat (score + PB/delta), the
// user's weekly leaderboard position (a chase window that previews the full
// board), the game-specific breakdown, then a single unified action row. There
// is no separate "View Results" step — the breakdown is always visible inline.
//
// Queued: the score is saved locally but not yet ranked, so we skip the weekly
// and progress fetches and render <QueuedScoreNote/> in their place — it names
// whichever of offline / signed out / can't-reach-us is holding the upload up.
//
// Props:
//   gameKey      — leaderboard key (e.g. 'target', 'plane-turn-2d')
//   score        — this run's primary score (already in display units)
//   time         — this run's clock in seconds. Optional, and only shown for games whose time
//                  means something (see hideTime): it is the tiebreaker on every board and the
//                  second half of a run's result, so the screen that reports the run should say
//                  it rather than leaving the player to hunt for it in the breakdown below.
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

// Increment-replay timings. The pre-run figures are held long enough to actually be READ before
// anything moves — without that hold this is just a number appearing, which is what the panel
// did before. Everything after the hold is non-blocking: Play Again stays live throughout.
//
// The flash LEADS the change rather than accompanying it: the figures start pulsing while still
// showing their pre-run values, and only then do they move. That ordering is what makes the
// increment legible — the pulse says "watch this number", so the eye is already on it when it
// changes. Flashing and changing on the same frame means whichever the user happened to be
// looking at is the only one they see move.
const REPLAY_HOLD_MS = 300    // pre-run figures on screen, still and unremarked
const REPLAY_FLASH_MS = 700   // pulsing, values STILL pre-run — the cue, not the change
const REPLAY_COUNT_MS = 600   // the points count-up
const REPLAY_BADGE_MS = 1400  // how long "+120" lingers after the count settles

// When the numbers actually start moving. The count-up and the play-count flip share it so they
// land together — two figures changing 400ms apart would read as two separate events.
const REPLAY_CHANGE_AT = REPLAY_HOLD_MS + REPLAY_FLASH_MS

// Drives the replay: hold → flash → count → settled → badges gone. A pulse alone would be over
// in half a second and missed by anyone still reading their score, so the "+N" badges outlive it
// by more than a second; the rank delta, once shown, stays for good.
function useIncrementReplay(active) {
  const [phase, setPhase] = useState(active ? 'pre' : 'done')

  useEffect(() => {
    if (!active) return
    const at = [
      [REPLAY_HOLD_MS, 'flash'],
      [REPLAY_CHANGE_AT, 'count'],
      [REPLAY_CHANGE_AT + REPLAY_COUNT_MS, 'settled'],
      [REPLAY_CHANGE_AT + REPLAY_COUNT_MS + REPLAY_BADGE_MS, 'done'],
    ]
    const timers = at.map(([ms, next]) => setTimeout(() => setPhase(next), ms))
    return () => timers.forEach(clearTimeout)
  }, [active])

  return phase
}

// The competitive beat: where you sit on THIS WEEK's board, not the all-time one.
//
// That distinction has to survive a three-second glance, because the number beside your
// name is `weekTotal` — the sum of every run you've played this week — and it will not
// match the score you just posted. Users read the mismatch as "this must be some
// cumulative all-time total". Three things carry the correction, and none of them is
// optional: the WEEKLY chip (loud enough to outrank the "Your Progress" label above it),
// the Points/Plays column header, and the "points add up" subtitle. The subtitle and the
// column names are copied from the full board (src/pages/CbatLeaderboard.jsx) so this
// really does read as a preview of where "Weekly Board" takes you.
//
// The panel then REPLAYS what the run just did to those figures — holding the pre-run points and
// play count, illuminating them, then counting up — because watching 300 → 420 and 2 → 3 plays
// demonstrates the accumulation that the copy can only assert.
//
// The run's own contribution and the position it moved the user from both come from the server
// (`lastRunPoints`, `prevRank`) and cannot be derived here: a negative run's contribution is
// floored to 0, so the total legitimately doesn't move, and the lower-is-better games derive
// weekly points from rotations and time rather than from the score on screen. See cbatWeeklyMe.
//
// Three cases have nothing honest to replay, and each renders the settled figures immediately:
// the first play of the week (no previous position to move from — `prevRank` is null and plays
// would count from 0), a run whose contribution floored to 0 (the points don't move, so only
// the play count ticks), and a payload from before this field existed.
function WeeklyChase({ weekly }) {
  const me = weekly.neighbors.find(n => n.isMe)
  const countdown = fmtCountdown(weekly.resetsAt)

  const gained = weekly.lastRunPoints ?? 0
  const replaying = !!me && weekly.plays > 1
  const phase = useIncrementReplay(replaying)

  // Pre-run figures stay on screen through the flash — that's the point of it.
  const holding = phase === 'pre' || phase === 'flash'

  // Points tween; plays just flip. Counting 2 → 3 over 600ms looks broken — the pulse and the
  // "+1" carry that one, and it lands on the same frame the count-up starts.
  const points = useCountUp(me?.weekTotal ?? 0, {
    from: replaying ? me.weekTotal - gained : (me?.weekTotal ?? 0),
    duration: REPLAY_COUNT_MS,
    delay: REPLAY_CHANGE_AT,
  })
  const playsShown = replaying && holding ? weekly.plays - 1 : weekly.plays
  const pointsShown = replaying ? points : me?.weekTotal

  // Badges arrive with the change, not with the flash: the flash is "watch this", the badge is
  // the explanation of what then happened.
  const gains = replaying && (phase === 'count' || phase === 'settled')
    ? { points: gained > 0 ? `+${gained}` : null, plays: '+1' }
    : null
  // Rank never counts (#7 → #4 ticking downward reads as losing ground) — the climb is a badge,
  // held back until the points have finished landing so there's one thing to read at a time.
  const climb = weekly.prevRank != null ? weekly.prevRank - weekly.rank : 0
  const delta = climb !== 0 && (phase === 'settled' || phase === 'done') ? climb : null

  // The chase gap is derived from the same tweened figure as the row, so the two can't disagree
  // mid-flight — and the gap visibly closing is the whole point of the animation.
  const above = me ? weekly.neighbors.find(n => n.rank === me.rank - 1) : null
  const toPass = above ? Math.max(1, above.weekTotal - pointsShown) : null

  return (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-2 mb-4 text-left">
      <div className="flex items-center gap-1.5 px-1">
        <span className="px-1.5 py-0.5 rounded bg-brand-600 text-white text-[10px] font-extrabold uppercase tracking-wide">
          Weekly
        </span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Leaderboard</span>
      </div>
      <p className="text-[10px] text-slate-500 px-1 mt-1 mb-1.5">
        Points add up across every run this week{countdown ? ` · resets in ${countdown}` : ''}
      </p>
      <div className={`grid ${rowCols('weekly', null, true)} ${rowPad(true)} pb-1.5 border-b border-[#1a3a5c] text-[10px] text-slate-500 uppercase tracking-wide font-bold`}>
        <span>Rank</span>
        <span>Agent</span>
        <span className="text-right">Points</span>
        <span className="text-right">Plays</span>
      </div>
      {/* Rows keep their final order and final ranks throughout. Re-sorting them to the pre-run
          state would mean inventing a board: the window is centred on the post-run rank, so the
          players just overtaken are usually outside it. The moving number carries the change.
          The user's cells stay illuminated from the flash right through the count-up, so the
          figure they were told to watch is still lit while it moves. */}
      <div className="divide-y divide-[#1a3a5c]/50">
        {weekly.neighbors.map(n => (
          <LeaderboardRow
            key={`${n.rank}-${n.name}`}
            entry={n.isMe && replaying ? { ...n, weekTotal: pointsShown, plays: playsShown } : n}
            variant="weekly"
            isMe={n.isMe}
            compact
            {...(n.isMe ? { gains, pulse: phase === 'flash' || phase === 'count', delta } : {})}
          />
        ))}
      </div>
      <p className="text-xs text-brand-300 mt-2.5 text-center">
        {toPass != null
          ? <>{toPass} pts to pass <span className="font-bold">{above.name}</span></>
          : me?.rank === 1
            ? <>🥇 You lead the week — {pointsShown} pts</>
            : <>{pointsShown} pts this week</>}
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

// One plain-English verdict off a cbatTrend. The wording itself lives in cbatTrendPhrase so the
// leaderboard's "You" tab reads a given delta exactly the same way this screen does.
function trendVerdict(trend, kind) {
  const phrase = cbatTrendPhrase(trend, kind)
  if (!phrase) return null
  return <span className={phrase.tone === 'good' ? 'text-emerald-300' : 'text-slate-400'}>{phrase.text}</span>
}

// A run's clock, at the precision that game's leaderboard uses (Symbols runs cluster tightly
// enough to need 2dp, so a shared 1dp would flatten its whole speed chart).
const fmtTime = (decimals) => (t) => `${Number(t).toFixed(decimals)}s`

// The personal trend: a sparkline of recent attempts plus one plain-English verdict. Sits with
// the score/PB lines because it's part of the same personal beat — the competitive beat
// (<WeeklyChase>) comes after it.
//
// Games with a meaningful clock get a SECOND sparkline for speed, because score alone hides half
// the improvement: on Symbols and the like a player tops out at 15/15 and the score line flatlines
// while they're still shaving seconds off every run. Both charts plot the full history, so the two
// read as one story of the same runs.
//
// The speed chart then highlights only the runs that scored the same as the one just played, in
// amber against the rest dimmed. Speed is only comparable at equal accuracy — a fast run that
// scored 8 is not evidence of anything next to a slower 14 — but hiding those runs would break the
// shared timeline, so they stay on the chart and step back instead.
function ProgressTrend({ progress, cfg }) {
  const { series, firstAvg, lastAvg, timeFirstAvg, timeLastAvg, attempts } = progress
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
  // direction the game scores in. For the clock that direction is always down, hence the hard true.
  const verdict = trendVerdict(cbatTrend({ firstAvg, lastAvg }, !!cfg.lowerIsBetter), 'score')
  const speedVerdict = trendVerdict(cbatTrend({ firstAvg: timeFirstAvg, lastAvg: timeLastAvg }, true), 'speed')

  // The clock is only shown for games that have a real one — the fixed-duration games (Target,
  // FLAG, ACT, CUT) run the same length every time, so their "speed" is a constant. Runs missing a
  // time would leave gaps in the line, so a single one stands the whole chart down.
  const hasTimes = series.every(p => Number.isFinite(p.time) && p.time > 0)
  const showSpeed = !cfg.hideTime && hasTimes

  // Highlight from the SERIES' last point rather than the `score` prop: it is the same figure the
  // chart is drawing, so the legend can never name a score that isn't lit up on the line.
  const currentScore = series[series.length - 1].score
  const matches = series.filter(p => p.score === currentScore).length
  const formatTime = fmtTime(cfg.timeDecimals ?? 1)

  return (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-2 mb-4">
      <div className="flex items-center justify-between mb-0.5 px-1">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide">
          {showSpeed ? 'Your Progress · Score' : 'Your Progress'}
        </p>
        <p className="text-[10px] text-slate-500">{attempts} attempts</p>
      </div>
      <CbatProgressChart
        series={series}
        lowerIsBetter={!!cfg.lowerIsBetter}
        formatScore={formatScore}
        variant="spark"
      />
      {verdict && <p className="text-[11px] text-center mt-1">{verdict}</p>}

      {showSpeed && (
        <div className="mt-2 pt-2 border-t border-[#1a3a5c]">
          <div className="flex items-center justify-between mb-0.5 px-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Speed</p>
            {/* Names what the amber points are. Without it the two-tone line is a puzzle. */}
            <p className="text-[10px] text-slate-500">
              <span className="text-amber-300">●</span>{' '}
              {matches === 1
                ? <>first run at {formatScore(currentScore)}</>
                : <>your {matches} runs at {formatScore(currentScore)}</>}
            </p>
          </div>
          <CbatProgressChart
            series={series}
            metric="time"
            lowerIsBetter={true}
            formatScore={formatTime}
            valueLabel="Time"
            highlightScore={currentScore}
            variant="spark"
          />
          {speedVerdict && <p className="text-[11px] text-center mt-1">{speedVerdict}</p>}
        </div>
      )}
    </div>
  )
}

// Confirmation that a run which couldn't be submitted is nonetheless safe.
//
// This is the one moment the reassurance is worth anything — the player has
// just finished and is looking at a score the server has never seen. The global
// sync pill used to cover it, but it is fixed-position and this screen is
// inside a game, so it was taking space over the results; it now shows on the
// CBAT menu only (see OfflineStatus). Inline, in flow, is the right shape here.
//
// Says which of the three things is actually blocking the upload, because they
// need different things from the user: reconnect, sign in, or nothing at all.
// Vague copy here is what let a five-week outage go unnoticed.
function QueuedScoreNote() {
  const { user } = useAuth()
  const [online,  setOnline]  = useState(isOnline())
  const [health,  setHealth]  = useState(getApiHealth)
  const [pending, setPending] = useState(0)

  useEffect(() => onNetworkChange(setOnline), [])
  useEffect(() => onApiHealthChange(setHealth), [])

  // Owner-scoped, like the pill's: on a shared device another account's queued
  // runs are not ours to count (see cbatOutbox.pendingCount).
  const userId = user?._id ?? null
  useEffect(() => {
    let active = true
    const refresh = () => { Promise.resolve(pendingCount(userId)).then((n) => { if (active) setPending(n) }) }
    refresh()
    const off = onOutboxChange(refresh)
    return () => { active = false; off() }
  }, [userId])

  const noSession = !user || health.status === 'signedOut'

  let reason, cta = null
  if (!online) {
    // Offline first: reconnecting is the precondition for the other two, and a
    // "Sign in" link is useless without a network.
    reason = 'Uploads as soon as you reconnect.'
  } else if (noSession) {
    reason = 'Sign in and it uploads from here.'
    cta = <Link to="/login" className="text-brand-300 font-bold underline">Sign in</Link>
  } else if (health.status === 'unreachable') {
    reason = "We can't reach Skywatch right now — it uploads by itself once we can."
  } else {
    reason = 'Uploading in the background.'
  }

  // Only ever the *other* runs: this one is already accounted for by the
  // headline, and "1 run waiting" next to "your score is saved" reads as a
  // second, unexplained thing.
  const others = Math.max(0, pending - 1)

  return (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-1 text-left">
      <p className="text-xs text-amber-300 font-bold">📡 Score saved on this device</p>
      <p className="text-[11px] text-slate-400 mt-1">
        {reason} Your weekly rank updates then too.
      </p>
      {others > 0 && (
        <p className="text-[11px] text-slate-400 mt-1">
          {others} earlier {others === 1 ? 'run is' : 'runs are'} waiting as well.
        </p>
      )}
      {cta && <p className="text-[11px] mt-2">{cta}</p>}
    </div>
  )
}

export default function CbatGameOver({
  gameKey, score, time, scoreSaved, queued, personalBest, onPlayAgain, extraActions = [], children,
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
  // Count-up animation for the personal beat. Shares its curve with the weekly increment
  // below via useCountUp — two count-ups on one screen must ease identically.
  const shown = useCountUp(score, { duration: 700 })

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
      // Read (not subscribed): the hub's admin-view toggle isn't reachable from a
      // game-over screen, so the value can't change while this panel is up.
      apiFetch(withCbatView(`${API}/api/games/cbat/${gameKey}/weekly/me`, cbatAdminViewOn()))
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
  const formatTime = fmtTime(cfg.timeDecimals ?? 1)
  const showTime = !cfg.hideTime && Number.isFinite(time)

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
        {/* Score and clock sit side by side, but not as equals: the score stays the headline and
            the time is deliberately the smaller figure, because it only ever breaks ties between
            equal scores. Games with a fixed duration (hideTime) show the score alone — their
            "time" is the same constant every run. */}
        {showTime ? (
          <div className="flex items-end justify-center gap-8 mb-2">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Your Score</p>
              <p className="text-5xl font-mono font-bold text-brand-300">{formatScore(shown)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Time</p>
              <p className="text-3xl font-mono font-bold text-brand-300">{formatTime(time)}</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Your Score</p>
            <p className="text-5xl font-mono font-bold text-brand-300 mb-2">{formatScore(shown)}</p>
          </>
        )}

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
        {queued && <QueuedScoreNote />}

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
        {/* Both boards are reachable by name rather than behind one ambiguous
            "View Leaderboard". Only the weekly link carries `fromGame` — the
            rank-move slide at the destination runs on the weekly tab only — and
            the all-time link uses the ?period= deep-link the hub already relies on. */}
        <Link to={`/cbat/${gameKey}/leaderboard`} state={{ fromGame: true }} className={secondaryBtn}>🏆 Weekly Board</Link>
        <Link to={`/cbat/${gameKey}/leaderboard?period=all-time`} className={secondaryBtn}>All-Time Board</Link>
        {extraActions.map((a, i) => (
          a.to
            ? <Link key={i} to={a.to} className={secondaryBtn}>{a.label}</Link>
            : <button key={i} onClick={a.onClick} className={secondaryBtn}>{a.label}</button>
        ))}
      </div>
    </motion.div>
  )
}
