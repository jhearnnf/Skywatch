export default function Numpad({ question, entered, onDigit, onDelete, disabled }) {
  const digits = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0']

  return (
    <div className="flex flex-col gap-2 max-[600px]:gap-1">
      {/* Combined question + entered display */}
      <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg p-2 max-[600px]:p-1 text-center min-h-[48px] max-[600px]:min-h-[32px] flex flex-col justify-center">
        {question ? (
          <>
            <p className="text-xs max-[600px]:text-[9px] text-slate-500 uppercase tracking-wide mb-0.5 max-[600px]:hidden">Solve</p>
            <p className="font-mono text-base max-[600px]:text-xs font-bold text-[#ddeaf8] leading-tight">
              {question.question} = <span className="text-brand-300">{entered || '_'}</span>
            </p>
          </>
        ) : (
          <p className="text-xs max-[600px]:text-[10px] text-slate-600 italic">Standby…</p>
        )}
      </div>

      {/* Entered digits — desktop only (mobile shows it inline above) */}
      <div className="bg-[#060e1a] border border-[#1a3a5c] rounded-lg px-3 py-1.5 text-center min-h-[34px] max-[600px]:hidden">
        <span className="font-mono text-lg font-bold text-brand-300 tracking-widest">
          {entered || <span className="text-slate-600">_</span>}
        </span>
      </div>

      {/* Digit grid */}
      <div className="grid grid-cols-3 gap-1.5 max-[600px]:gap-1">
        {digits.map((d) => (
          <button
            key={d}
            onClick={() => onDigit(d)}
            disabled={disabled}
            className="py-2.5 max-[600px]:py-1 bg-[#0a1628] border border-[#1a3a5c] hover:bg-[#0f2240] hover:border-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-[#ddeaf8] font-mono text-base max-[600px]:text-xs font-bold rounded-lg transition-all cursor-pointer"
          >
            {d}
          </button>
        ))}
        <button
          onClick={onDelete}
          disabled={disabled}
          className="col-span-3 py-2 max-[600px]:py-0.5 bg-[#0a1628] border border-[#1a3a5c] hover:bg-[#0f2240] hover:border-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-400 text-xs max-[600px]:text-[9px] font-bold rounded-lg transition-all cursor-pointer"
        >
          DELETE
        </button>
      </div>
    </div>
  )
}
