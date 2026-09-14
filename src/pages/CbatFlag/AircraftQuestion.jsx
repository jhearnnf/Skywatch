export default function AircraftQuestion({ symbol, onAnswer, disabled, pulseSymbol = false }) {
  const hasSymbol = !!symbol

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <button
        onClick={() => !disabled && hasSymbol && onAnswer('no')}
        disabled={disabled || !hasSymbol}
        data-demo-answer
        className="shrink-0 px-2.5 py-1.5 bg-game-fill hover:bg-game-fill-strong disabled:opacity-40 disabled:cursor-not-allowed text-game-text text-xs font-bold rounded-lg transition-colors cursor-pointer"
      >
        NO
      </button>

      <div className="flex-1 min-w-0 text-center">
        {hasSymbol ? (
          <span className={`font-mono text-base font-bold tracking-widest ${pulseSymbol ? 'text-brand-300 cbat-flag-callsign-pulse' : 'text-game-text'}`}>{symbol}</span>
        ) : (
          <span className="font-mono text-base font-bold text-slate-600 tracking-widest">—</span>
        )}
      </div>

      <button
        onClick={() => !disabled && hasSymbol && onAnswer('yes')}
        disabled={disabled || !hasSymbol}
        data-demo-answer
        className="shrink-0 px-2.5 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
      >
        YES
      </button>
    </div>
  )
}
