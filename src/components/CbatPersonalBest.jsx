// The personal-best panel on a CBAT instructions card.
//
// It exists as a shared component because of what flipping a mode used to do.
// Every page wrote `{personalBest && (<div>…</div>)}`, so switching Easier to
// Hard unmounted the whole panel while the new board's best was in flight and
// mounted it again a moment later. The card lost three lines and got them back,
// which reads as the layout glitching rather than as data loading.
//
// So the panel is ALWAYS rendered on a game that can switch boards, and it
// holds its own height across all three of its states:
//
//   loading   — a placeholder bar, because we don't know yet
//   no runs   — "No runs yet", because this board is genuinely empty
//   a best    — the value
//
// Nothing moves. Only the middle line changes, and it fades.
//
// The second bug this fixes is worse than the jump: pages guarded their setter
// with `if (d.data)`, so a board with no runs left the PREVIOUS board's best on
// screen under the new board's label. You switched to Hard and saw your Easier
// score called your Hard score. useCbatPersonalBest caches per game key and
// resolves a missing best to null, so a value on screen always belongs to the
// board named above it.

export default function CbatPersonalBest({
  label = null,
  best = null,
  loading = false,
  className = '',
  children,
}) {
  return (
    <div className={`bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 ${className}`.trim()}>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
        Personal Best{label ? ` · ${label}` : ''}
      </p>

      {/* Fixed height in every state — this line is the one that changes, and
          it is the reason the panel used to resize. */}
      <div className="h-7 flex items-center justify-center">
        {loading ? (
          <span
            className="block h-4 w-20 rounded bg-[#14293f] animate-pulse"
            aria-label="Loading your best score"
          />
        ) : best ? (
          <p className="text-lg font-mono font-bold text-brand-600 leading-none transition-opacity duration-200">
            {typeof children === 'function' ? children(best) : children}
          </p>
        ) : (
          <p className="text-sm text-slate-600 leading-none">No runs yet</p>
        )}
      </div>

      {/* Reserved whether or not there is an attempt count to put in it. */}
      <p className="text-[10px] text-slate-500 mt-0.5 min-h-[0.875rem]">
        {best ? `${best.attempts} attempt${best.attempts !== 1 ? 's' : ''}` : ' '}
      </p>
    </div>
  )
}
