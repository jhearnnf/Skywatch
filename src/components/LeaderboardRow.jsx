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

// `compact` narrows the fixed columns for constrained containers (the post-game
// weekly-chase window, which is nested inside several layers of padding on a
// phone) so the flexible Agent column keeps enough room for names.
export const rowCols = (variant, cfg, compact = false) =>
  variant === 'weekly'
    ? (compact ? 'grid-cols-[2.25rem_1fr_3.25rem_2.25rem]' : 'grid-cols-[3rem_1fr_5rem_4rem]')
    : (cfg?.hideTime ? 'grid-cols-[3rem_1fr_5rem]' : 'grid-cols-[3rem_1fr_5rem_4.5rem]')

const agentName = (e) =>
  e.name || e.displayName || (e.email ? e.email : `Agent ${e.agentNumber || '???'}`)

// `layout` opts a row into framer's FLIP reordering (used only during the
// leaderboard's post-game rank slide). `delta` is the change in position for the
// user's own row during that slide (positive = climbed) and renders a small
// ↑/↓ badge next to the rank; both are inert everywhere else.
export default function LeaderboardRow({ entry, variant, cfg = {}, isMe = false, divider = false, mode3d = false, layout = false, delta = null, compact = false }) {
  const achievedAtTitle = entry.achievedAt
    ? new Date(entry.achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <motion.div
      layout={layout}
      transition={{ layout: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
      className={`grid ${rowCols(variant, cfg, compact)} ${compact ? 'gap-1.5 px-2.5' : 'gap-2 px-4'} py-2.5 text-sm ${divider ? 'border-t border-[#1a3a5c]' : ''} ${
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
      <span
        className={`truncate ${achievedAtTitle ? 'cursor-help' : ''} ${isMe ? 'text-brand-600 font-bold' : 'text-[#ddeaf8]'}`}
        {...(achievedAtTitle ? { title: achievedAtTitle } : {})}
      >
        {agentName(entry)}{isMe ? ' (you)' : ''}
      </span>
      {variant === 'weekly' ? (
        <>
          <span className="text-right font-mono font-bold text-brand-600">{entry.weekTotal}</span>
          <span className="text-right font-mono text-slate-400">{entry.plays}</span>
        </>
      ) : (
        <>
          <span className="text-right font-mono font-bold text-brand-600">
            {cfg.formatScore ? cfg.formatScore(entry.bestScore) : entry.bestScore}
            {mode3d && (
              <span className="ml-1 text-[8px] font-bold px-1 py-0.5 rounded bg-brand-600/80 text-white leading-none align-middle">3D</span>
            )}
          </span>
          {!cfg.hideTime && <span className="text-right font-mono text-slate-400">{entry.bestTime.toFixed(1)}s</span>}
        </>
      )}
    </motion.div>
  )
}
