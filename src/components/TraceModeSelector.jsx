// Selector for the /cbat/trace page. Two heading-pill groups read/write a single
// `mode` value, so picking any option deselects the others.
//   Practise group → '2d' · '3d'
//   Trace group    → 'trace1' · 'trace2' (Coming Soon — disabled)
export default function TraceModeSelector({ value, onChange }) {
  const practiseOptions = [
    { value: '2d', label: '2D Practise' },
    { value: '3d', label: '3D Practise' },
  ]
  const traceOptions = [
    { value: 'trace1', label: 'Trace 1', badge: 'NEW', badgeVariant: 'new' },
    { value: 'trace2', label: 'Trace 2', disabled: true, badge: 'SOON', badgeVariant: 'soon' },
  ]

  return (
    <div className="flex flex-col items-center gap-2.5">
      <Group heading="Practise" options={practiseOptions} value={value} onChange={onChange} />
      <Group heading="Trace"    options={traceOptions}    value={value} onChange={onChange} />
    </div>
  )
}

function Group({ heading, options, value, onChange }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-500">{heading}</span>
      <div
        role="tablist"
        aria-label={heading}
        className="inline-flex rounded-full border border-[#1a3a5c] bg-[#0a1628] p-0.5 text-[11px] font-bold"
      >
        {options.map((opt) => {
          const active = value === opt.value
          const disabled = !!opt.disabled
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={disabled}
              disabled={disabled}
              onClick={disabled ? undefined : () => onChange(opt.value)}
              className={`relative px-3 py-1 rounded-full transition-colors flex items-baseline gap-1.5 ${
                disabled
                  ? 'text-slate-600 cursor-not-allowed'
                  : active
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-400 hover:text-brand-300'
              }`}
            >
              <span>{opt.label}</span>
              {opt.sub && (
                <span className={`text-[8px] font-semibold uppercase tracking-wide ${disabled ? 'text-slate-700' : 'text-white/85'}`}>
                  {opt.sub}
                </span>
              )}
              {opt.badge && (
                <span
                  aria-hidden="true"
                  className={`absolute -top-1.5 -right-1.5 px-1 py-px rounded text-[8px] font-extrabold tracking-wider uppercase ${
                    opt.badgeVariant === 'soon'
                      ? 'bg-slate-300 text-slate-700 ring-1 ring-slate-400/60'
                      : 'bg-brand-500 text-white ring-1 ring-brand-300/70 shadow-[0_0_6px_rgba(91,170,255,0.7)]'
                  }`}
                >
                  {opt.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
