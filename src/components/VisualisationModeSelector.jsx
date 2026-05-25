// Selector for the /cbat/visualisation page. One pill group with 2D / 3D
// options, mirroring the styling of TraceModeSelector's groups.
export default function VisualisationModeSelector({ value, onChange }) {
  const options = [
    { value: '2d', label: '2D' },
    { value: '3d', label: '3D' },
  ]

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-500">Practise</span>
      <div
        role="tablist"
        aria-label="Practise mode"
        className="inline-flex rounded-full border border-[#1a3a5c] bg-[#0a1628] p-0.5 text-[11px] font-bold"
      >
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.value)}
              className={`relative px-3 py-1 rounded-full transition-colors ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:text-brand-300'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
