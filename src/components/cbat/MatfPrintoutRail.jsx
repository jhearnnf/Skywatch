// The Table Reading Test's saved sheets, in the rail beside the instructions.
//
// Same cabinet as the joystick panel on ACT/RTT/SMA — a bordered machine in the
// left-hand track rather than another box inside the instructions card, which
// is already tall enough. It borrows the shell (`cbat-arcade-panel`) and NOT
// the attract blink: the joystick panel blinks because it is answering a
// question the player is actively asking ("is my stick working"), and this is
// just a shelf of paper they have already printed. Blinking it would be the
// cabinet shouting at someone who was reading the instructions.
//
// Only rendered when the player has printed at least once, so a first-time
// player never sees an empty shelf and wonders what they missed.
//
// THE LEADERBOARD WARNING IS NOT OPTIONAL. Replaying a sheet means playing a
// grid you have already looked at, and the real test's numbers are ones you
// have never seen. The run still happens and is still worth doing on paper; it
// is simply not ranked, and the player has to know that BEFORE they pick, not
// on the results screen.

import { matfSheetCode, matfPrintoutShape, matfPrintoutDate } from '../../utils/cbat/matfPrint'

export default function MatfPrintoutRail({ printouts, onReplay, onClear, className = '' }) {
  if (!printouts?.length) return null

  return (
    <div className={`cbat-arcade-panel rounded-lg border-2 border-game-line p-3 text-left ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b-2 border-[#12283f]">
        <span className="font-mono text-[10px] font-extrabold uppercase tracking-[0.22em] text-brand-600">
          Your printed sheets
        </span>
        <span className="text-base leading-none" aria-hidden="true">🖨️</span>
      </div>

      <p className="text-xs text-game-muted leading-snug mb-3">
        Still got one of these on your desk? Load it and the test will use exactly those numbers.
      </p>

      <ul className="space-y-2">
        {printouts.map(p => (
          <li key={p.seed}>
            <button
              type="button"
              onClick={() => onReplay(p)}
              className="w-full rounded border border-game-line bg-game-panel px-2.5 py-2 text-left hover:border-brand-400 hover:bg-game-raised transition-colors cursor-pointer"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-bold text-brand-600">{matfSheetCode(p.seed)}</span>
                <span className="font-mono text-[10px] text-game-muted">{matfPrintoutDate(p.printedAt)}</span>
              </span>
              <span className="block text-[11px] text-game-muted mt-0.5">{matfPrintoutShape(p.difficulty)}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-game-line pt-2 text-[11px] leading-snug text-amber-400">
        Runs on a saved sheet are not submitted to the leaderboard. You have seen these numbers
        before, and on the real test you never have.
      </p>

      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 text-[10px] font-mono uppercase tracking-wide text-game-muted hover:text-brand-600 transition-colors cursor-pointer"
        >
          Forget these sheets
        </button>
      )}
    </div>
  )
}
