/**
 * ActorPortrait
 * Pinned ID card for an actor on the Case Files actor-interrogations board.
 *
 * Props
 *   actor          { id, name, role, faction, portraitUrl?, portraitCredit? }
 *   isSelected     boolean — controlled by parent
 *   onClick        () => void
 *   questionsUsed? number  — how many questions this person has been asked
 *   maxQuestions?  number  — the per-person allowance, drawn as pips
 */

// CONTRACT-AMBIGUITY: "faction badge" — spec mentions faction but gives no badge
// colours. The card's lanyard strip borrows the same faction accent the
// interview panel already uses, so a person looks the same in both places.

import ActorFace from './ActorFace'
import { Stamp } from './CaseFileKit'
import { factionAccent } from '../../utils/caseFiles/actorAppearance'

export default function ActorPortrait({ actor, isSelected, onClick, onHoverChange, questionsUsed = 0, maxQuestions = 0 }) {
  const { name = 'Unknown', role = '', faction = '', portraitUrl, knowsAbout = [] } = actor
  const accent      = factionAccent(faction)
  const interviewed = questionsUsed > 0

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
      onMouseEnter={onHoverChange ? () => onHoverChange(true)  : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      onFocus={onHoverChange ? () => onHoverChange(true)  : undefined}
      onBlur={onHoverChange ? () => onHoverChange(false) : undefined}
      data-testid={`actor-portrait-${actor.id}`}
      aria-pressed={isSelected}
      className={[
        'relative flex flex-col items-center gap-2 px-3 pb-3 pt-4 rounded-md border overflow-hidden',
        'bg-surface-raised cursor-pointer select-none card-shadow',
        'transition-all duration-200',
        isSelected
          ? 'border-brand-600 ring-2 ring-brand-600/40 -translate-y-1 shadow-lg shadow-brand-600/20'
          : 'border-slate-300/40 hover:-translate-y-1 hover:border-brand-400 hover:shadow-md',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Lanyard strip in the faction's colour, like the top of a pass */}
      <span
        aria-hidden="true"
        className="absolute top-0 inset-x-0 h-1.5"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}66)` }}
      />

      {/* Portrait. A drawn face rather than two initials in a box: the board is
          meant to read as people you can go and question, and eight identical
          lettered tiles read as a filing cabinet. */}
      <div
        className="relative w-16 h-16 rounded-sm overflow-hidden shrink-0 border bg-[#0b1727] flex items-end justify-center"
        style={{ borderColor: `${accent}80` }}
      >
        {portraitUrl ? (
          <img
            src={portraitUrl}
            alt={name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <ActorFace actor={actor} size={62} idle />
        )}
        <div aria-hidden="true" className="absolute inset-0 cf-portrait-scanlines pointer-events-none opacity-60" />
      </div>

      {/* Name */}
      <p className="text-xs font-bold text-text text-center leading-tight line-clamp-2 w-full">
        {name}
      </p>

      {/* Role */}
      {role ? (
        // The tile is only ~112px wide, so most real roles ("Foreign Minister,
        // Russian Federation") get clipped. Keep the clamp for layout and put
        // the full string in a tooltip rather than losing it.
        <p
          title={role}
          className="text-[10px] text-text-muted text-center leading-tight line-clamp-2 w-full -mt-1"
        >
          {role}
        </p>
      ) : null}

      {/* Faction badge */}
      {faction ? (
        <span
          className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border whitespace-nowrap max-w-full truncate font-mono"
          style={{ color: accent, borderColor: `${accent}55`, background: `${accent}14` }}
        >
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

      {/* Questions used, one pip per question in the allowance */}
      {maxQuestions > 0 && (
        <div
          data-testid={`actor-questions-${actor.id}`}
          aria-label={`${questionsUsed} of ${maxQuestions} questions used`}
          className="flex items-center gap-1 mt-0.5"
        >
          {Array.from({ length: maxQuestions }).map((_, i) => (
            <span
              key={i}
              className={[
                'w-1.5 h-1.5 rounded-full transition-colors duration-300',
                i < questionsUsed ? 'bg-[#5baaff] shadow-[0_0_5px_rgba(91,170,255,0.8)]' : 'border border-slate-500/70',
              ].join(' ')}
            />
          ))}
        </div>
      )}

      {/* Stamped once they have been questioned, so the board doubles as a
          checklist of who you have already spoken to. */}
      {interviewed && (
        <div
          aria-hidden="true"
          data-testid={`actor-interviewed-${actor.id}`}
          className="absolute top-[52px] left-1/2 -translate-x-1/2 pointer-events-none"
        >
          <Stamp tone="green" size="xs" rotate={-12}>Interviewed</Stamp>
        </div>
      )}

      {/* Selected indicator dot */}
      {isSelected && (
        <span
          aria-hidden="true"
          className="absolute top-2.5 right-1.5 w-2 h-2 rounded-full bg-brand-600"
        />
      )}
    </div>
  )
}
