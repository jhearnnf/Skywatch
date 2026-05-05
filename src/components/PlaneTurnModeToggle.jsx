export default function PlaneTurnModeToggle({ value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Mode"
      className="inline-flex rounded-full border border-[#1a3a5c] bg-[#0a1628] p-0.5 text-[10px] font-bold"
    >
      {['2d', '3d'].map((opt) => (
        <button
          key={opt}
          role="tab"
          aria-selected={value === opt}
          onClick={() => onChange(opt)}
          className={`px-2.5 py-0.5 rounded-full transition-colors ${
            value === opt
              ? 'bg-brand-600 text-white'
              : 'text-slate-400 hover:text-brand-300'
          }`}
        >
          {opt.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
