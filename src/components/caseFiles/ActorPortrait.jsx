/**
 * ActorPortrait
 * Small ID-card tile for an actor in the Case Files actor-interrogations pinboard.
 *
 * Props
 *   actor      { id, name, role, faction, portraitUrl?, portraitCredit? }
 *   isSelected boolean — controlled by parent
 *   onClick    () => void
 */

// CONTRACT-AMBIGUITY: "faction badge" — spec mentions faction but gives no badge
// colours. Using a small muted chip styled with existing slate tokens since no
// faction-specific palette is defined.

export default function ActorPortrait({ actor, isSelected, onClick }) {
  const { name = 'Unknown', role = '', faction = '', portraitUrl, knowsAbout = [] } = actor

  // Initials fallback — up to 2 chars from name parts
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  function handleClick() {
    if (onClick) onClick(actor)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') handleClick()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid={`actor-portrait-${actor.id}`}
      aria-pressed={isSelected}
      className={[
        'relative flex flex-col items-center gap-2 p-3 rounded-xl border',
        'bg-surface-raised cursor-pointer select-none',
        'transition-all duration-200',
        isSelected
          ? 'border-brand-600 ring-2 ring-brand-600/40 -translate-y-0.5 shadow-lg shadow-brand-600/20'
          : 'border-slate-300 hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Portrait or initials circle */}
      <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-slate-300/60">
        {portraitUrl ? (
          <img
            src={portraitUrl}
            alt={name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full bg-brand-200 flex items-center justify-center">
            <span className="text-brand-600 text-xl font-extrabold intel-mono">{initials}</span>
          </div>
        )}
      </div>

      {/* Name */}
      <p className="text-xs font-bold text-text text-center leading-tight line-clamp-2 w-full">
        {name}
      </p>

      {/* Role */}
      {role ? (
        <p className="text-[10px] text-text-muted text-center leading-tight line-clamp-1 w-full -mt-1">
          {role}
        </p>
      ) : null}

      {/* Faction badge */}
      {faction ? (
        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-200/20 border border-slate-500/40 text-slate-500 whitespace-nowrap max-w-full truncate">
          {faction}
        </span>
      ) : null}

      {/* "Knows about" tags — plain-English hints so players can pick who to ask. */}
      {Array.isArray(knowsAbout) && knowsAbout.length > 0 && (
        <div
          data-testid={`actor-knows-${actor.id}`}
          className="flex flex-wrap gap-1 justify-center mt-0.5 w-full"
        >
          {knowsAbout.slice(0, 3).map((tag, i) => (
            <span
              key={i}
              className="text-[9px] leading-tight px-1.5 py-0.5 rounded bg-brand-100/30 text-brand-600 border border-brand-600/20"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Selected indicator dot */}
      {isSelected && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-600"
        />
      )}
    </div>
  )
}
