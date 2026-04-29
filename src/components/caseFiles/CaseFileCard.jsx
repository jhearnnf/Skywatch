// CaseFileCard — manila-folder-style card for a Case Files entry.
// CONTRACT-AMBIGUITY: "chapter count" label: spec says '3 chapters' — using
// `${chapterCount} chapter${chapterCount !== 1 ? 's' : ''}` for correct pluralisation.

function PadlockIcon() {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 13 15"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="1.5" y="6.5" width="10" height="7" rx="1.5" stroke="#6880a0" strokeWidth="1.4" />
      <path d="M3.5 6.5V4.5a3 3 0 0 1 6 0v2" stroke="#6880a0" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export default function CaseFileCard({ caseFile, onClick, tierLocked, minTier }) {
  const {
    title       = 'Untitled',
    affairLabel = '',
    summary     = '',
    coverImageUrl,
    status      = 'published',
    chapterCount = 0,
  } = caseFile

  const isLocked     = status === 'locked'
  // Tier-lock only applies when the card isn't already coming-soon
  const isTierLocked = !!tierLocked && !isLocked

  function handleClick() {
    if (isLocked) return
    if (onClick) onClick(caseFile)
  }

  function handleKeyDown(e) {
    if (isLocked) return
    if (e.key === 'Enter' || e.key === ' ') handleClick()
  }

  return (
    <div
      role={isLocked ? undefined : 'button'}
      tabIndex={isLocked ? undefined : 0}
      onClick={handleClick}
      onKeyDown={isLocked ? undefined : handleKeyDown}
      aria-disabled={isLocked || undefined}
      data-testid={`case-file-card-${caseFile.slug}`}
      className={[
        'relative flex flex-col rounded-2xl border bg-surface-raised card-shadow overflow-hidden',
        'transition-transform duration-200',
        isLocked
          ? 'opacity-55 cursor-not-allowed'
          : isTierLocked
            ? 'opacity-55 cursor-pointer hover:-translate-y-1 hover:border-brand-400 border-slate-200'
            : 'cursor-pointer hover:-translate-y-1 hover:border-brand-400 border-slate-200',
        !isLocked && !isTierLocked && 'border-slate-200',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Status-locked (coming soon) overlay badges */}
      {isLocked && (
        <>
          {/* Coming Soon pill — top-right */}
          <span
            data-testid="coming-soon-badge"
            className="absolute top-2 right-2 z-10 text-[9px] font-extrabold tracking-wider px-2 py-0.5 rounded-full bg-slate-300/20 border border-slate-500/40 text-slate-600 uppercase"
          >
            Coming Soon
          </span>
          {/* Padlock — top-left */}
          <span className="absolute top-2 left-2 z-10">
            <PadlockIcon />
          </span>
        </>
      )}

      {/* Tier-locked padlock — top-left (only when not coming-soon) */}
      {isTierLocked && (
        <span className="absolute top-2 left-2 z-10">
          <PadlockIcon />
        </span>
      )}

      {/* Cover image — 16:9 */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 bg-surface flex items-center justify-center">
            <span className="text-slate-400 text-3xl select-none" aria-hidden="true">📁</span>
          </div>
        )}
        {/* Gradient fade from image into card body */}
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-raised to-transparent pointer-events-none" />
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 px-4 pt-3 pb-4 gap-1">
        <h2 className="text-base font-extrabold text-brand-600 leading-snug">{title}</h2>
        {affairLabel ? (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{affairLabel}</p>
        ) : null}
        <p className="text-sm text-slate-600 leading-relaxed line-clamp-3 mt-1 flex-1">{summary}</p>

        {/* Footer row */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-200/30">
          <span className="text-xs text-slate-500 intel-mono">
            {chapterCount} {chapterCount === 1 ? 'chapter' : 'chapters'}
          </span>
          {isLocked && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <PadlockIcon />
              Locked
            </span>
          )}
          {isTierLocked && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <PadlockIcon />
              Premium
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
