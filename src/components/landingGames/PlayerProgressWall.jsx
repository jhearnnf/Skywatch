import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import ImprovementChart from './ImprovementChart'
import { CBAT_LEADERBOARD_CONFIG } from '../../data/cbatGames'

// Social proof for the landing page: three real players' score histories, each
// picked at random from the top ten of that game's leaderboard by
// GET /api/games/cbat/showcase (see backend/utils/cbatShowcase.js for who is
// eligible and why).
//
// It sits directly above the closing CTA and argues that CTA's case before it
// is made: these say practice worked for these players, over this many plays
// and this much time, and the card below then asks.
//
// NO RAW SCORES ANYWHERE. A visitor who has never played cannot read "803" —
// not on an axis, not in a footer. So the chart is stripped to a trend line (see
// ImprovementChart) and the card states only the figures that carry meaning
// without knowing the game: how much better, over how many plays, across how
// long. The scores themselves stay in the payload, doing their work behind the
// percentage.
//
// The improvement figure is the same first-five vs last-five comparison the
// player sees on their own "You" tab, so a player who finds themselves here
// reads the identical number.
//
// PRIVACY. Everywhere else in the app these charts are seen by the player
// themselves or by signed-in users; this is the one public view, so the endpoint
// hands over no display name, no account id and no timestamps (see
// backend/utils/cbatShowcase.js). That is why the x-axis counts plays rather
// than dates, and why elapsed time is stated in whole weeks: "27 runs over 6
// weeks" carries the proof, "21 Jul, 20:14" carries a stranger's evening.

const CHART_HEIGHT = 150
const SKELETON_KEYS = ['a', 'b', 'c']

// Whole weeks or months — enough to show the improvement took real time, never
// enough to say when.
function spanPhrase(days) {
  if (!days || days < 7) return 'over a few days'
  const [n, unit] = days < 60 ? [Math.round(days / 7), 'week'] : [Math.round(days / 30), 'month']
  return `over ${n} ${unit}${n === 1 ? '' : 's'}`
}

function ProgressCard({ panel, index }) {
  const cfg = CBAT_LEADERBOARD_CONFIG[panel.gameKey] ?? {}

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className="card-intel rounded-2xl p-4"
      data-testid="progress-card"
      data-game={panel.gameKey}
    >
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <h3 className="font-bold text-slate-900 truncate">{panel.name}</h3>
        <span
          className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full"
          style={{
            color: '#7dd3a0',
            background: 'rgba(52,211,153,0.12)',
            border: '1px solid rgba(52,211,153,0.3)',
          }}
        >
          +{panel.improvementPct}%
        </span>
      </div>

      {/* The game is named on the x-axis instead ("TARGET PLAYS →"), where it
          labels the thing it actually describes. */}
      <p className="text-xs text-slate-500 mb-3">
        {panel.improvementPct}% better than when they started
      </p>

      <ImprovementChart
        series={panel.series}
        game={cfg.title ?? panel.gameKey}
        lowerIsBetter={panel.lowerIsBetter}
        height={CHART_HEIGHT}
      />

      {/* Effort and elapsed time only. The raw score averages used to sit here
          too, but "679 → 872" means nothing to someone who has never played the
          game — the percentage above already says how much better, and how much
          better is the only part a visitor can actually read. */}
      <p className="mt-2 pt-2 border-t border-slate-200/60 intel-mono text-slate-500">
        {panel.attempts} runs · {spanPhrase(panel.spanDays)}
      </p>
    </motion.div>
  )
}

export default function PlayerProgressWall() {
  const { API } = useAuth()
  const [panels, setPanels] = useState(null)   // null = still loading

  useEffect(() => {
    let aborted = false
    fetch(`${API}/api/games/cbat/showcase`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!aborted) setPanels(j?.data?.panels ?? []) })
      .catch(() => { if (!aborted) setPanels([]) })
    return () => { aborted = true }
  }, [API])

  // Nothing to prove with no qualifying players — the section disappears rather
  // than showing an empty promise.
  if (panels?.length === 0) return null

  return (
    <section className="pb-12 sm:pb-16 px-3 sm:px-5 max-w-5xl mx-auto" data-testid="player-progress-wall">
      <div className="text-center mb-4 sm:mb-6">
        <div className="flex items-center justify-center gap-2 mb-2 sm:mb-3">
          <span className="intel-tag">PROVEN PROGRESS</span>
        </div>
        <h2 className="text-xl sm:text-3xl font-bold text-slate-900 mb-1 px-3">
          It works. Here is the evidence.
        </h2>
        <p className="text-sm text-slate-500 px-3 max-w-xl mx-auto">
          Real scores from real SkyWatch players, pulled live from the leaderboards.
        </p>
      </div>

      {panels === null ? (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="progress-skeleton">
          {SKELETON_KEYS.map(key => (
            <div key={key} className="card-intel rounded-2xl p-4 animate-pulse">
              <div className="h-4 w-24 rounded bg-slate-200/60 mb-2" />
              <div className="h-3 w-32 rounded bg-slate-200/40 mb-4" />
              <div className="rounded bg-slate-200/25" style={{ height: CHART_HEIGHT }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {panels.map((panel, i) => (
            <ProgressCard key={panel.gameKey} panel={panel} index={i} />
          ))}
        </div>
      )}

      {/* The lines are averaged, so the page says they are averaged. A clean
          curve on a page headed "here is the evidence" must not be left to imply
          it is showing raw runs. */}
      {panels !== null && (
        <p className="text-center text-xs text-slate-500/80 mt-3 px-3">
          Each line is a rolling average of that player's runs.
        </p>
      )}

      {/* No CTA of its own, deliberately. The closing card sits immediately
          below this section and carries the page's final ask; a second button a
          few pixels above it would compete with it rather than add to it. This
          section's job is to make that button worth pressing, not to duplicate
          it. */}
    </section>
  )
}
