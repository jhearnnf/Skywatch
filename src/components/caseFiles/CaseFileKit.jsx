/**
 * CaseFileKit — the shared props of the Case Files "analyst's desk".
 *
 * Every stage used to invent its own header, footer button and flourish, so
 * one case felt like eight different apps. These are the pieces they now
 * share: a rubber stamp that slams onto the page, a sticky note, a stage
 * header, and the footer with its one primary action.
 *
 * Only `motion.div` is used here. Several stage tests mock framer-motion with
 * a `div` and nothing else, so a `motion.span` in a shared piece would break
 * every one of them.
 */

import { motion } from 'framer-motion'

// ── Sticky note ──────────────────────────────────────────────────────────────
// A physical prop on the board, so it keeps real post-it yellow with dark ink
// rather than following the theme tokens.
const STICKY_NOTE_STYLE = {
  background: 'linear-gradient(170deg, #f7df6e 0%, #eccb45 100%)',
  color:      '#3a2e05',
  fontFamily: "'Segoe Print', 'Bradley Hand', 'Marker Felt', 'Comic Sans MS', cursive",
  boxShadow:  '0 3px 6px rgba(0,0,0,0.45), inset 0 -8px 12px rgba(160,120,0,0.12)',
}

export function StickyNote({ children, tilt = -1.5, className = '', testId, style }) {
  return (
    <div
      data-testid={testId}
      className={`relative px-2.5 pt-3 pb-2.5 rounded-[1px] text-[12px] leading-snug ${className}`}
      style={{ ...STICKY_NOTE_STYLE, transform: `rotate(${tilt}deg)`, ...style }}
    >
      {/* Strip of tape */}
      <span
        aria-hidden="true"
        className="absolute -top-1.5 left-1/2 w-10 h-3 pointer-events-none"
        style={{ background: 'rgba(220,230,245,0.3)', transform: 'translateX(-50%) rotate(-2deg)' }}
      />
      {children}
    </div>
  )
}

// ── Rubber stamp ─────────────────────────────────────────────────────────────
const STAMP_TONES = {
  red:   { color: '#ff6b63', border: 'rgba(224,65,58,0.75)',  glow: 'rgba(224,65,58,0.25)'  },
  green: { color: '#4ade80', border: 'rgba(34,197,94,0.75)',  glow: 'rgba(34,197,94,0.22)'  },
  blue:  { color: '#7cc0ff', border: 'rgba(91,170,255,0.8)',  glow: 'rgba(91,170,255,0.25)' },
  amber: { color: '#fbbf24', border: 'rgba(245,158,11,0.8)',  glow: 'rgba(245,158,11,0.25)' },
}

const STAMP_SIZES = {
  xs: 'text-[9px] px-1.5 py-0.5 border-2 tracking-[0.2em]',
  sm: 'text-[11px] px-2.5 py-1 border-2 tracking-[0.25em]',
  md: 'text-sm px-4 py-1.5 border-[3px] tracking-[0.3em]',
  lg: 'text-2xl px-5 py-2 border-4 tracking-[0.25em]',
}

/**
 * Stamp — slams in from above with a spring, lands slightly crooked.
 * `slam={false}` renders it already on the page (for static labels).
 */
export function Stamp({
  children,
  tone = 'red',
  size = 'sm',
  rotate = -8,
  delay = 0,
  slam = true,
  className = '',
  testId,
}) {
  const t = STAMP_TONES[tone] ?? STAMP_TONES.red
  return (
    <motion.div
      data-testid={testId}
      initial={slam ? { scale: 2.6, opacity: 0, rotate: rotate - 10 } : false}
      animate={{ scale: 1, opacity: 1, rotate }}
      transition={{ type: 'spring', stiffness: 520, damping: 18, delay }}
      className={[
        'inline-block rounded-sm font-mono font-black uppercase leading-none select-none whitespace-nowrap cf-stamp-ink',
        STAMP_SIZES[size] ?? STAMP_SIZES.sm,
        className,
      ].join(' ')}
      style={{
        color:         t.color,
        borderColor:   t.border,
        outline:       `1px solid ${t.border}`,
        outlineOffset: '2px',
        boxShadow:     `0 0 14px ${t.glow}`,
        textShadow:    `0 0 8px ${t.glow}`,
      }}
    >
      {children}
    </motion.div>
  )
}

// ── Stage header ─────────────────────────────────────────────────────────────
/**
 * The same three-line masthead on every stage: a file-tab eyebrow, the
 * headline, and an optional date chip. `aside` sits opposite on wide screens
 * (counters, phase chips).
 */
export function StageHeader({ eyebrow, title, date, aside, children }) {
  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5 min-w-0">
        {(eyebrow || date) && (
          <div className="flex items-center gap-2 flex-wrap">
            {eyebrow && (
              <span className="inline-flex items-center gap-1.5 intel-mono text-[10px] tracking-[0.2em] text-brand-600">
                <span aria-hidden="true" className="w-1.5 h-1.5 bg-[#e0413a] rounded-[1px]" />
                {eyebrow}
              </span>
            )}
            {date && (
              <span className="intel-mono text-[10px] tracking-[0.15em] text-text-muted px-1.5 py-0.5 border border-slate-300/25 rounded-sm bg-surface/60">
                {date}
              </span>
            )}
          </div>
        )}
        {title && (
          <h2 className="text-lg sm:text-xl font-black text-text leading-snug">
            {title}
          </h2>
        )}
        {children}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </header>
  )
}

// ── Footer + primary action ──────────────────────────────────────────────────
export function StageFooter({ children, left, className = '' }) {
  return (
    <div
      className={[
        'shrink-0 border-t border-slate-300/15 bg-surface/95 backdrop-blur-sm px-4 py-3',
        'flex items-center gap-3',
        left ? 'justify-between' : 'justify-end',
        className,
      ].join(' ')}
    >
      {left}
      {children}
    </div>
  )
}

/**
 * ActionButton — the one primary control on a stage. A sheen sweeps across it
 * while it is ready, so the eye always knows where "next" is.
 */
export function ActionButton({
  children,
  onClick,
  disabled = false,
  busy = false,
  busyLabel = 'Working…',
  variant = 'primary',
  testId,
  className = '',
  type = 'button',
}) {
  const inactive = disabled || busy
  const base = 'relative overflow-hidden inline-flex items-center justify-center gap-2 px-6 py-3 rounded-btn text-sm font-bold tracking-wide transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60'
  const look = variant === 'secondary'
    ? (inactive
        ? 'border border-slate-300/20 text-text-faint cursor-not-allowed'
        : 'border border-brand-600/50 text-brand-600 hover:bg-brand-600/10 active:scale-[0.97]')
    : (inactive
        ? 'bg-surface-raised text-text-faint border border-slate-300/20 cursor-not-allowed'
        : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.97] shadow-[0_0_18px_rgba(91,170,255,0.35)] cf-action-sheen')

  return (
    <button
      type={type}
      data-testid={testId}
      onClick={onClick}
      disabled={inactive}
      className={`${base} ${look} ${className}`}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="inline-block w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"
        />
      )}
      <span className="relative">{busy ? busyLabel : children}</span>
    </button>
  )
}
