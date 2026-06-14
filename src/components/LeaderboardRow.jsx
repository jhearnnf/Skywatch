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

export const rowCols = (variant, cfg) =>
  variant === 'weekly'
    ? 'grid-cols-[3rem_1fr_5rem_4rem]'
    : (cfg?.hideTime ? 'grid-cols-[3rem_1fr_5rem]' : 'grid-cols-[3rem_1fr_5rem_4.5rem]')

const agentName = (e) =>
  e.name || e.displayName || (e.email ? e.email : `Agent ${e.agentNumber || '???'}`)

export default function LeaderboardRow({ entry, variant, cfg = {}, isMe = false, divider = false, mode3d = false }) {
  const achievedAtTitle = entry.achievedAt
    ? new Date(entry.achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <div
      className={`grid ${rowCols(variant, cfg)} gap-2 px-4 py-2.5 text-sm ${divider ? 'border-t border-[#1a3a5c]' : ''} ${
        isMe ? 'bg-brand-600/10 border-l-2 border-l-brand-400' : ''
      }`}
    >
      <span className="font-mono font-bold text-slate-400">
        {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
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
    </div>
  )
}
