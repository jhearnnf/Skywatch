/**
 * EvidenceCard
 * A pinned evidence file on the corkboard — dossier sheet with a pushpin,
 * exhibit header, rubber-stamp category, typed excerpt and a sticky note for
 * "why it matters". Subtle paper-grain texture, slight random rotation jitter,
 * and a brand-600 ring when selected.
 *
 * Props
 *   item               { id, title, type, description, imageUrl, imageCredit, sourceUrl }
 *   isSelected         boolean
 *   onClick            () => void
 *   onPositionChange   (id, {x, y}) => void  — center pos in board coords
 *   absolutePosition?  { x, y }  — when provided, card uses position:absolute
 *                      at this top-left coord (mobile corkboard path); without
 *                      it the card flows in the parent grid (desktop path).
 *   cardSize?          { width, height }  — required when absolutePosition set
 *   compact?           boolean — tightens font sizes / padding for the small
 *                      mobile board card. Defaults true when absolutePosition set.
 *   exhibitNo?         number — shown as "EXHIBIT 03" in the file header.
 */

import { useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { StickyNote } from './CaseFileKit'

// ── Type icons ────────────────────────────────────────────────────────────────
const TYPE_ICONS = {
  satellite:    '📡',
  transcript:   '📃',
  photo:        '📷',
  document:     '📄',
  osint:        '🌐',
  map_overlay:  '🗺️',
}

const TYPE_LABELS = {
  satellite:    'Satellite imagery',
  transcript:   'Transcript',
  photo:        'Photograph',
  document:     'Document',
  osint:        'Open source',
  map_overlay:  'Map overlay',
}

function typeIcon(type) {
  return TYPE_ICONS[type] ?? '📄'
}

// ── Deterministic rotation from item id hash ─────────────────────────────────
// Maps an arbitrary string id to a float in [-2, +2] degrees.
function hashRotation(id = '') {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }
  // Map [0, 2^32) → [-2, +2]
  return ((h % 1000) / 1000) * 4 - 2
}

// ── Paper grain texture (inline SVG noise via CSS background-image) ───────────
// A very subtle, low-opacity SVG feTurbulence filter rendered as a data URI.
// Gives the card a tactile paper feel without any asset dependency.
const PAPER_GRAIN_STYLE = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.045'/%3E%3C/svg%3E")`,
  backgroundSize:  '200px 200px',
}

// Faint typed-page rules behind the document excerpt (18px = its line height).
const RULED_LINES_STYLE = {
  backgroundImage:    'repeating-linear-gradient(to bottom, transparent 0, transparent 17px, rgba(91,170,255,0.08) 17px, rgba(91,170,255,0.08) 18px)',
  backgroundPosition: '0 8px',
}

// ── Framer Motion variants ────────────────────────────────────────────────────
const cardVariants = {
  hidden: { scale: 0.7, opacity: 0 },
  visible: {
    scale:      1,
    opacity:    1,
    transition: { type: 'spring', stiffness: 400, damping: 22 },
  },
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function EvidenceCard({
  item,
  isSelected,
  onClick,
  onPositionChange,
  absolutePosition,
  cardSize,
  compact: compactProp,
  exhibitNo,
}) {
  const cardRef = useRef(null)
  const rotation = hashRotation(item?.id)
  const isAbsolute = !!absolutePosition && !!cardSize
  const compact = compactProp ?? isAbsolute

  // Report center position to parent after mount + on resize
  const reportPosition = useCallback(() => {
    if (!onPositionChange || !item?.id) return

    // Absolute mode: position is known from props — report center directly
    // without touching the DOM. This is critical inside transformed parents
    // (pan/zoom wrapper) where getBoundingClientRect returns viewport-space
    // coords that wouldn't match the board's coordinate system.
    if (isAbsolute) {
      onPositionChange(item.id, {
        x: absolutePosition.x + cardSize.width  / 2,
        y: absolutePosition.y + cardSize.height / 2,
      })
      return
    }

    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const parentRect = cardRef.current.offsetParent?.getBoundingClientRect?.() ?? { left: 0, top: 0 }
    onPositionChange(item.id, {
      x: rect.left - parentRect.left + rect.width  / 2,
      y: rect.top  - parentRect.top  + rect.height / 2,
    })
  }, [item?.id, onPositionChange, isAbsolute, absolutePosition?.x, absolutePosition?.y, cardSize?.width, cardSize?.height])

  useEffect(() => {
    reportPosition()
  }, [reportPosition])

  if (!item) return null

  const { id, title, type, description, imageUrl, imageCredit, category, whyItMatters } = item

  const positionStyle = isAbsolute
    ? {
        position: 'absolute',
        left:     absolutePosition.x,
        top:      absolutePosition.y,
        width:    cardSize.width,
        height:   cardSize.height,
      }
    : {}

  const exhibitLabel = exhibitNo != null ? `EXHIBIT ${String(exhibitNo).padStart(2, '0')}` : 'EXHIBIT'

  return (
    <motion.div
      ref={cardRef}
      data-testid={`evidence-card-${id}`}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      // Hover lift — small translateY with cursor crosshair to match reticle aesthetic
      whileHover={{ y: -4, transition: { duration: 0.18 } }}
      onClick={onClick}
      style={{
        rotate:       isAbsolute ? 0 : rotation,
        transformOrigin: 'center center',
        cursor:       'crosshair',
        ...PAPER_GRAIN_STYLE,
        ...positionStyle,
      }}
      className={[
        'relative flex flex-col rounded-sm overflow-hidden select-none',
        'bg-surface-raised border transition-all duration-150',
        'card-shadow',
        // Selected ring
        isSelected
          ? 'border-brand-600 ring-2 ring-brand-600/60'
          : 'border-slate-300/30 hover:border-slate-400/50',
      ].join(' ')}
    >
      {/* ── File header: type icon + exhibit number + type ───────────────
          The icon must stay the first aria-hidden node (tests look it up). */}
      <div
        className={[
          'flex items-center gap-1.5 border-b border-dashed border-slate-300/30 font-mono uppercase text-text-muted',
          compact ? 'px-2 pt-1 pb-0.5 text-[8px] tracking-wider' : 'px-2.5 pt-1.5 pb-1 text-[9px] tracking-[0.15em]',
        ].join(' ')}
      >
        <span aria-hidden="true" className="text-xs leading-none" title={type}>
          {typeIcon(type)}
        </span>
        <span className="font-bold text-text whitespace-nowrap shrink-0">{exhibitLabel}</span>
        {!compact && TYPE_LABELS[type] && (
          <span className="ml-auto truncate pr-4">{TYPE_LABELS[type]}</span>
        )}
      </div>

      {/* ── Pushpin: red to match the string, blue while selected ────── */}
      <span
        aria-hidden="true"
        className="absolute top-1 right-1.5 z-10 w-3 h-3 rounded-full pointer-events-none"
        style={{
          background: isSelected
            ? 'radial-gradient(circle at 35% 30%, #cfe6ff 0%, #5baaff 45%, #1d4f8f 100%)'
            : 'radial-gradient(circle at 35% 30%, #ffb3b3 0%, #e0413a 45%, #7a1512 100%)',
          boxShadow: '1px 2px 3px rgba(0,0,0,0.6)',
        }}
      />

      {/* ── Image area or typed document excerpt ─────────────────────── */}
      {imageUrl ? (
        <div className="relative w-full flex-shrink-0" style={compact ? { height: '45%' } : { paddingBottom: '56.25%' }}>
          <img
            src={imageUrl}
            alt={title}
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Gradient fade into card body */}
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface-raised to-transparent pointer-events-none" />
        </div>
      ) : (
        <div
          className={[
            compact
              ? 'px-2 pt-1 pb-1 font-mono text-[10px] leading-snug text-text line-clamp-4 flex-1'
              : 'mx-2.5 mt-2 px-2.5 py-2 font-mono text-[12px] leading-[18px] text-text min-h-[120px] border-l-2 border-[#e0413a]/50 bg-surface/60',
          ].join(' ')}
          style={compact ? undefined : RULED_LINES_STYLE}
          aria-label="Evidence excerpt"
        >
          {description}
        </div>
      )}

      {/* ── Source line ──────────────────────────────────────────────── */}
      {imageCredit && !compact && (
        <p className="px-2.5 mt-1.5 font-mono text-[9px] uppercase tracking-wider text-text-muted leading-tight">
          <span className="font-bold">Source:</span>{' '}
          <span className="normal-case tracking-normal italic">{imageCredit}</span>
        </p>
      )}

      {/* ── Card body ────────────────────────────────────────────────── */}
      <div className={compact ? 'px-2 pt-1 pb-1.5 flex flex-col gap-0.5 flex-1 min-h-0' : 'px-2.5 pt-2 pb-3 flex flex-col gap-1.5 flex-1'}>
        {/* Category as a rubber stamp. Optional. */}
        {category && !compact && (
          <span
            data-testid={`evidence-category-${id}`}
            className="self-start font-mono text-[9px] font-black uppercase tracking-[0.2em] px-1.5 py-0.5 rounded-sm border-2 border-[#e0413a]/70 text-[#ff6b63] opacity-90"
            style={{
              transform:     `rotate(${rotation > 0 ? -3 : 2}deg)`,
              outline:       '1px solid rgba(224,65,58,0.35)',
              outlineOffset: '1px',
            }}
          >
            {category}
          </span>
        )}
        <p className={[
          compact
            ? 'text-[11px] font-semibold text-text leading-tight line-clamp-2'
            : 'text-sm font-semibold text-text leading-snug',
        ].join(' ')}>
          {title}
        </p>
        {/* Description shown below title only when there's an image (no double-up) */}
        {imageUrl && description && (
          <p className={[
            compact
              ? 'font-mono text-[9px] leading-tight text-text-muted line-clamp-2 mt-0.5'
              : 'font-mono text-[11px] leading-snug text-text-muted mt-0.5',
          ].join(' ')}>
            {description}
          </p>
        )}
        {/* Why it matters: a sticky note taped to the bottom of the file. Optional. */}
        {whyItMatters && !compact && (
          <StickyNote
            testId={`evidence-why-${id}`}
            tilt={rotation > 0 ? 1.5 : -1.5}
            className="mt-auto mx-1"
          >
            <span className="font-bold">Why it matters:</span> {whyItMatters}
          </StickyNote>
        )}
      </div>

      {/* Selected pulse border overlay */}
      {isSelected && (
        <span
          aria-label="Selected"
          className="absolute inset-0 rounded-sm ring-2 ring-brand-600/40 pointer-events-none"
        />
      )}
    </motion.div>
  )
}
