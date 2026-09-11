// Small pill label for a row in a CBAT game's instructions panel (e.g. "Scene",
// "Light", "Alert"). Pulled out as a shared atom purely so ~20 near-identical
// intro screens read consistently — it carries no per-game logic.
export default function CbatIntroLabel({ tone = 'brand', children }) {
  const toneCls = tone === 'danger'
    ? 'bg-red-500/15 text-red-400'
    : 'bg-brand-600/15 text-brand-600'
  return (
    <span className={`shrink-0 min-w-[64px] lg:min-w-[78px] px-2 py-0.5 rounded text-[11px] lg:text-xs font-bold uppercase tracking-wide text-center ${toneCls}`}>
      {children}
    </span>
  )
}
