// The one mode row every CBAT game uses.
//
// A tile can hold more than one board: a difficulty pair (FLAG, CUT, SAT…), a
// drill on its own leaderboard (ANT's Practise), or several different tests
// behind one tile (Trace's 2D/3D practise plus Trace 1 and Trace 2,
// Visualisation's 2D and 3D). Those used to be three separate pieces of chrome
// — DifficultyButton here, TraceModeSelector, VisualisationModeSelector — which
// meant three different-looking answers to the same question, and on ANT it
// meant two leaderboard links on one card because the drill had nowhere to sit.
//
// One row, one selection, one leaderboard link that follows it. Whatever a tile
// can play, you pick it in the same place on every game.
//
// ── WHERE THE ROW GOES ───────────────────────────────────────────────────────
// Title, then this row UNDER it, then the selected mode's blurb. Pages render
// their own title and blurb; this module renders only the row, and deliberately
// does NOT position itself relative to a title.
//
// That last part is load-bearing. A `DifficultyTitleRow` used to live here and
// flanked the title with one button either side; no page ever used it, and it
// caught two separate attempts at adding a split game because it reads as the
// obvious helper and is wrong on screen. It was deleted. CbatModeRow is not a
// revival of it: it lays out ONE row and knows nothing about the title, so a
// page still decides placement and the DOM-order tests in
// CbatDpt.difficulty.test.jsx / CbatAnt.difficulty.test.jsx /
// CbatRosterCompletion.test.jsx still mean something.
//
// ── BARS vs BADGES ───────────────────────────────────────────────────────────
// The 1-of-3 / 3-of-3 meter says "this one is harder". That is only true
// between the halves of a difficulty pair. Practise is not an easier Hard, it
// is a different exercise; Visualisation 2D is not an easier 3D, it is a
// different test. So a mode carries EITHER `bars` (a real difficulty) or a
// short `badge` ('2D', '3D', 'Drill') — never bars it hasn't earned, because a
// meter that ranks things which aren't on one scale is just a wrong meter.
//
// A mode object: { key, label, gameKey, bars?, badge?, blurb }

const BAR_TONES = {
  solid:  ['bg-white',     'bg-white/25'],       // on a filled brand button
  muted:  ['bg-slate-600', 'bg-slate-400/40'],   // unselected button
  accent: ['bg-brand-600', 'bg-brand-600/25'],   // on a dark surface
}

// A threat-level meter — 1 of 3 bars for Easier, 3 of 3 for Hard — so a button
// says what it is without needing a legend.
export function ModeBars({ filled, tone = 'muted' }) {
  const [onCls, offCls] = BAR_TONES[tone]
  return (
    <span className="flex items-end gap-[2px] h-[11px]" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={`w-[3px] rounded-[1px] ${i < filled ? onCls : offCls}`}
          style={{ height: 5 + i * 3 }}
        />
      ))}
    </span>
  )
}

// The badge that stands in for bars on a mode that isn't a difficulty. Small,
// after the label, and never a claim about how hard anything is.
function ModeBadge({ children, selected }) {
  return (
    <span
      className={`px-1 py-px rounded text-[8px] font-extrabold tracking-wider uppercase leading-none ${
        selected ? 'bg-white/20 text-white' : 'bg-[#14293f] text-slate-500'
      }`}
    >
      {children}
    </span>
  )
}

// One button in the row. The selected one is a live brand button (the same
// weight as Start); the others are greyed back. During the launch flash the
// selected one strobes and the rest dim.
//
// `data-difficulty` is the stable hook the page tests query by. It is named for
// difficulty rather than mode only because it predates the row; `data-mode` is
// the same value under the name that now fits.
export function ModeButton({ mode, selected, onSelect, flashing, dimmed }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode.key)}
      aria-pressed={selected}
      data-difficulty={mode.key}
      data-mode={mode.key}
      title={mode.blurb}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-extrabold uppercase tracking-wide transition-all duration-200 cursor-pointer ${
        selected
          ? 'bg-brand-600 border-brand-600 text-white shadow-[0_0_12px_rgba(91,170,255,0.35)]'
          : 'bg-[#060e1a] border-[#1a3a5c] text-slate-600 hover:text-[#ddeaf8] hover:border-brand-600'
      }${flashing ? ' cbat-launch-flash' : ''}${dimmed ? ' cbat-launch-dim' : ''}`}
    >
      {mode.bars != null && <ModeBars filled={mode.bars} tone={selected ? 'solid' : 'muted'} />}
      {mode.label}
      {mode.badge && <ModeBadge selected={selected}>{mode.badge}</ModeBadge>}
    </button>
  )
}

// The row itself. Wraps on a narrow screen rather than overflowing, which
// matters on Trace — four modes do not fit a phone in one line.
export function CbatModeRow({ modes, value, onSelect, launching = false, className = '' }) {
  if (!modes || modes.length < 2) return null
  return (
    <div className={`flex flex-wrap items-center justify-center gap-3 mb-1 ${className}`.trim()}>
      {modes.map(mode => (
        <ModeButton
          key={mode.key}
          mode={mode}
          selected={value === mode.key}
          onSelect={onSelect}
          flashing={launching && value === mode.key}
          dimmed={launching && value !== mode.key}
        />
      ))}
    </div>
  )
}

// The mode in play, shown beside the page title during a run so it is never
// ambiguous which board the score is heading for. Belongs in the header row
// above the game, never over it.
export function ModeMarker({ mode }) {
  return (
    <span
      data-difficulty-marker={mode.key}
      data-mode-marker={mode.key}
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#0c1829] border border-[#1a3a5c] text-[10px] font-extrabold uppercase tracking-wide text-brand-300"
    >
      {mode.bars != null && <ModeBars filled={mode.bars} tone="accent" />}
      {mode.label}
      {mode.badge && <ModeBadge>{mode.badge}</ModeBadge>}
    </span>
  )
}

