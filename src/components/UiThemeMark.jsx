import { normalizeUiTheme } from '../lib/uiTheme'

// The two site themes as small marks, for anywhere a row has to say which
// look a score was set under (the leaderboard's Theme column).
//
//   skywatch — the crosshair logo from the top bar, at cell size.
//   cbat     — the Real CBAT look in miniature: the navy screen with its
//              pale-yellow outline and one of the grey bevelled key caps the
//              theme draws answer keys as. Not a real logo (the test software
//              has none we could use), just the theme's two signatures.
//
// Both are aria-hidden: the cell that holds them carries the label.

function SkywatchMark({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="17" stroke="#1d4ed8" strokeWidth="2.2" />
      <line x1="20" y1="1" x2="20" y2="12" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="20" y1="28" x2="20" y2="39" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="1" y1="20" x2="12" y2="20" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="28" y1="20" x2="39" y2="20" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="20" cy="20" r="7" stroke="#5baaff" strokeWidth="1.8" />
      <circle cx="20" cy="20" r="2.5" fill="#5baaff" />
    </svg>
  )
}

function RealCbatMark({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" fill="#000080" stroke="#ffff99" strokeWidth="2" />
      <line x1="9" y1="11" x2="31" y2="11" stroke="#ffffff" strokeWidth="2" />
      <rect x="12" y="17" width="16" height="14" fill="#b4b4b4" />
      <path d="M12 31 H28 V17" stroke="#606060" strokeWidth="2" fill="none" />
      <path d="M12 31 V17 H28" stroke="#f0f0f0" strokeWidth="2" fill="none" />
    </svg>
  )
}

const MARKS = { skywatch: SkywatchMark, cbat: RealCbatMark }

export default function UiThemeMark({ theme, size = 16 }) {
  const Mark = MARKS[normalizeUiTheme(theme)]
  return Mark ? <Mark size={size} /> : null
}
