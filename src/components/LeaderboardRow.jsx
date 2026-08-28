// Shared CBAT leaderboard row, used by both the full leaderboard page
// (src/pages/CbatLeaderboard.jsx) and the post-game reveal's weekly chase
// window (src/components/CbatGameOver.jsx) so the snippet reads as a true
// preview of the destination — same medals, same "you" highlight, same columns.
//
// Two variants:
//   weekly   — Rank · Agent · Points (weekTotal) · Plays
//   all-time — Rank · Agent · <scoreLabel> · Time
//
// Name precedence matches everywhere: a precomputed `entry.name` (reveal
// neighbours) wins, else displayName → admin email → agent number.

import { motion } from 'framer-motion'
import CbatPassedBadge from './CbatPassedBadge'

// `compact` narrows the fixed columns for constrained containers (the post-game
// weekly-chase window, which is nested inside several layers of padding on a
// phone) so the flexible Agent column keeps enough room for names.
//
// The non-compact widths are mobile-first: the rank/score/plays columns are
// sized to their actual content below `sm` and only widen on larger screens.
// Agent is the `1fr` column, so every rem shaved off the fixed ones goes
// straight into the name — on a 360px phone that took it from ~10 characters
// to ~19, which is what a display name or "Agent 1234" needs to read.
export const rowCols = (variant, cfg, compact = false) =>
  variant === 'weekly'
    ? (compact
        ? 'grid-cols-[2.25rem_1fr_3.25rem_2.25rem]'
        : 'grid-cols-[2.5rem_1fr_3.25rem_2.25rem] sm:grid-cols-[3rem_1fr_5rem_4rem]')
    : (cfg?.hideTime
        ? 'grid-cols-[2.5rem_1fr_3.5rem] sm:grid-cols-[3rem_1fr_5rem]'
        : 'grid-cols-[2.5rem_1fr_3.5rem_3.5rem] sm:grid-cols-[3rem_1fr_5rem_4.5rem]')

// Row padding/gutter shrink alongside the columns on mobile for the same reason.
export const rowPad = (compact = false) =>
  compact ? 'gap-1.5 px-2.5' : 'gap-1.5 px-3 sm:gap-2 sm:px-4'

const agentName = (e) =>
  e.name || e.displayName || (e.email ? e.email : `Agent ${e.agentNumber || '???'}`)

// A weekly numeric cell that can flash and carry a "+N" gain badge.
//
// The badge sits in the row's padding gutter above the number (`-top-3` against `py-2.5`),
// where it clears both the divider and the digits of the row above. It scales in rather than
// fading so it registers in peripheral vision — a user reading their score will catch the
// movement even if they never look straight at this cell.
//
// While `pulse` is on, the number turns emerald to match the badge and pops once. The colour
// swap is a class change, not a tween: a flash should arrive instantly and it keeps the two
// theme colours out of the animation's keyframes. `tone` is kept separate from `className` for
// that swap — folding the colour into className would leave two competing text-* classes on the
// element, resolved by stylesheet order rather than by intent, and would drop the weight the
// cell is normally rendered at for the duration of the pulse.
function GainCell({ value, gain, pulse, tone, className = '' }) {
  return (
    <span className={`relative text-right font-mono ${className} ${pulse ? 'text-emerald-300' : tone}`}>
      {gain && (
        <motion.span
          initial={{ opacity: 0, y: 5, scale: 0.7 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          className="absolute -top-3 right-0 text-[9px] font-bold text-emerald-300 whitespace-nowrap pointer-events-none"
        >
          {gain}
        </motion.span>
      )}
      <motion.span
        className="inline-block"
        animate={pulse ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      >
        {value}
      </motion.span>
    </span>
  )
}

// `layout` opts a row into framer's FLIP reordering (used only during the
// leaderboard's post-game rank slide). `delta` is the change in position for the
// user's own row during that slide (positive = climbed) and renders a small
// ↑/↓ badge next to the rank; both are inert everywhere else.
//
// `gains` ({ points, plays }) annotates the weekly numeric cells with what the run
// just added ("+120", "+1"), and `pulse` illuminates them while that lands — both
// used only by the post-game increment replay, and both inert on the full board.
// The annotations are absolutely positioned in the row's vertical gutter: the
// weekly columns are sized to the digits they hold (see rowCols), so anything
// added in-flow would either reflow the grid or clip.
export default function LeaderboardRow({ entry, variant, cfg = {}, isMe = false, divider = false, layout = false, delta = null, compact = false, gains = null, pulse = false }) {
  const achievedAtTitle = entry.achievedAt
    ? new Date(entry.achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <motion.div
      layout={layout}
      transition={{ layout: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
      className={`grid ${rowCols(variant, cfg, compact)} ${rowPad(compact)} py-2.5 text-sm ${divider ? 'border-t border-[#1a3a5c]' : ''} ${
        isMe ? 'bg-brand-600/10 border-l-2 border-l-brand-400' : ''
      }`}
    >
      <span className="font-mono font-bold text-slate-400 flex items-center gap-1">
        {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
        {delta != null && delta !== 0 && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`text-[10px] font-bold ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}
          >
            {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
          </motion.span>
        )}
      </span>
      <span className={`min-w-0 flex items-center gap-1 ${isMe ? 'text-brand-600 font-bold' : 'text-[#ddeaf8]'}`}>
        {/* The name keeps the truncation, and the admin timestamp tooltip: both
            belong to the name itself. The mark is pulled out of it so a long
            name shortens rather than pushing the mark off the row. */}
        <span
          className={`truncate ${achievedAtTitle ? 'cursor-help' : ''}`}
          {...(achievedAtTitle ? { title: achievedAtTitle } : {})}
        >
          {agentName(entry)}{isMe ? ' (you)' : ''}
        </span>
        {entry.cbatPassed && <CbatPassedBadge />}
      </span>
      {variant === 'weekly' ? (
        <>
          <GainCell value={entry.weekTotal} gain={gains?.points} pulse={pulse} tone="text-brand-600" className="font-bold" />
          <GainCell value={entry.plays} gain={gains?.plays} pulse={pulse} tone="text-slate-400" />
        </>
      ) : (
        <>
          <span className="text-right font-mono font-bold text-brand-600">
            {cfg.formatScore ? cfg.formatScore(entry.bestScore) : entry.bestScore}
          </span>
          {!cfg.hideTime && <span className="text-right font-mono text-slate-400">{entry.bestTime.toFixed(cfg.timeDecimals ?? 1)}s</span>}
        </>
      )}
    </motion.div>
  )
}
