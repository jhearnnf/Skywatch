/**
 * EvidenceCard
 * A pinned evidence item on the corkboard — photo/document aesthetic with
 * subtle paper-grain CSS texture, slight random rotation jitter, and a
 * brand-600 ring when selected.
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
 */

import { useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'

// ── Type icons ────────────────────────────────────────────────────────────────
const TYPE_ICONS = {
  satellite:    '📡',
  transcript:   '📃',
  photo:        '📷',
  document:     '📄',
  osint:        '🌐',
  map_overlay:  '🗺️',
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
        // Mobile / grid: reduce rotation effect by zeroing it in CSS (override inline style)
        '@media (max-width: 600px) { rotate: 0deg }',
      ].join(' ')}
    >
      {/* ── Type icon badge — top-left ─────────────────────────────────── */}
      <span
        aria-hidden="true"
        className="absolute top-1.5 left-1.5 z-10 text-xs leading-none"
        title={type}
      >
        {typeIcon(type)}
      </span>

      {/* ── Image area or description excerpt ─────────────────────────── */}
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
              ? 'px-2 pt-5 pb-1 font-mono text-[10px] leading-snug text-text line-clamp-4 flex-1'
              : 'px-3 pt-6 pb-2 font-mono text-[12px] leading-snug text-text line-clamp-6 min-h-[120px]',
          ].join(' ')}
          aria-label="Evidence excerpt"
        >
          {description}
        </div>
      )}

      {/* ── Image credit ───────────────────────────────────────────────── */}
      {imageCredit && !compact && (
        <p className="px-2.5 text-[10px] italic text-text-muted leading-tight mt-1">
          {imageCredit}
        </p>
      )}

      {/* ── Card body: title ───────────────────────────────────────────── */}
      <div className={compact ? 'px-2 pt-1 pb-1.5 flex flex-col gap-0.5 flex-1 min-h-0' : 'px-2.5 pt-1.5 pb-2.5 flex flex-col gap-1'}>
        {/* Plain-language category tag — helps players spot themes without
            domain knowledge. Optional. */}
        {category && !compact && (
          <span
            data-testid={`evidence-category-${id}`}
            className="self-start text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-100/40 border border-brand-600/30 text-brand-600"
          >
            {category}
          </span>
        )}
        <p className={[
          compact
            ? 'text-[11px] font-semibold text-text leading-tight line-clamp-2'
            : 'text-sm font-semibold text-text leading-snug line-clamp-2',
        ].join(' ')}>
          {title}
        </p>
        {/* Description shown below title only when there's an image (no double-up) */}
        {imageUrl && description && (
          <p className={[
            compact
              ? 'font-mono text-[9px] leading-tight text-text-muted line-clamp-2 mt-0.5'
              : 'font-mono text-[11px] leading-snug text-text-muted line-clamp-3 mt-0.5',
          ].join(' ')}>
            {description}
          </p>
        )}
        {/* Why it matters — one-line plain-English signal call-out. Optional. */}
        {whyItMatters && !compact && (
          <p
            data-testid={`evidence-why-${id}`}
            className="text-[11px] leading-snug text-amber-300/90 mt-1 italic"
          >
            Why it matters: {whyItMatters}
          </p>
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
