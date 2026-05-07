export default function PlaneTurnModeToggle({ value, onChange }) {
  const options = [
    { value: '2d', label: '2D', sub: 'Practice' },
    { value: '3d', label: '3D', sub: 'Hard' },
  ]
  return (
    <div
      role="tablist"
      aria-label="Mode"
      className="inline-flex rounded-full border border-[#1a3a5c] bg-[#0a1628] p-0.5 text-[10px] font-bold"
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            aria-label={`${opt.label} mode (${opt.sub})`}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-0.5 rounded-full transition-colors flex items-baseline gap-1 ${
              active
                ? 'bg-brand-600 text-white'
                : 'text-slate-400 hover:text-brand-300'
            }`}
          >
            <span>{opt.label}</span>
            <span
              className={`text-[8px] font-semibold uppercase tracking-wide ${
                active ? 'text-white/85' : 'text-slate-500'
              }`}
            >
              {opt.sub}
            </span>
          </button>
        )
      })}
    </div>
  )
}
