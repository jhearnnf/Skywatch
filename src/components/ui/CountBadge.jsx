import { badgeText } from '../../utils/chatBadge'

// The red count pill, wherever it sits inline next to a label — a rail row, the
// Community console link, a console tab.
//
// The navbar version is NOT this: it hangs off a nav emoji and has to be
// absolutely positioned, so it stays as `.nav-count-badge` in main.css. Both
// share the cap and the wording via utils/chatBadge, which is the part that
// actually has to agree.
//
// Renders nothing at zero, so call sites can pass a count straight through
// without guarding it themselves.
//
// `tone` swaps the colours out rather than letting a call site append competing
// ones: two Tailwind background utilities on the same element are decided by
// stylesheet order, not by which was written last, so overriding by suffix is a
// coin toss. Red everywhere except on a filled brand button, where red on blue
// is the one place it fights its own background.
const TONES = {
  red:     'bg-red-500 text-white',
  inverse: 'bg-white text-brand-600',
}

export default function CountBadge({ count = 0, label, tone = 'red', className = '' }) {
  if (!count) return null
  return (
    <span
      aria-label={label}
      className={`shrink-0 min-w-[16px] h-4 px-1 rounded-full ${TONES[tone] ?? TONES.red}
        text-[10px] font-extrabold leading-4 text-center tabular-nums ${className}`}
    >
      {badgeText(count)}
    </span>
  )
}
