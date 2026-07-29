// Shared difficulty selector for CBAT games that ship an Easier/Hard split
// (FLAG, CUT). Each game owns its own tuning table; this is only the chrome.
//
// A tuning object needs { key, label, bars, blurb } to render here.

const BAR_TONES = {
  solid:  ['bg-white',     'bg-white/25'],       // on a filled brand button
  muted:  ['bg-slate-600', 'bg-slate-400/40'],   // unselected button
  accent: ['bg-brand-600', 'bg-brand-600/25'],   // on a dark surface
}

// A threat-level meter — 1 of 3 bars for Easier, 3 of 3 for Hard — so a button
// says what it is without needing a legend.
export function DifficultyBars({ filled, tone = 'muted' }) {
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

// One of the pair flanking a game's title on its instructions card. The selected
// one is a live brand button (the same weight as Start); the other is greyed
// back. During the launch flash the selected one strobes and the other dims.
export function DifficultyButton({ tuning, selected, onSelect, flashing, dimmed }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tuning.key)}
      aria-pressed={selected}
      data-difficulty={tuning.key}
      title={tuning.blurb}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-extrabold uppercase tracking-wide transition-all duration-200 cursor-pointer ${
        selected
          ? 'bg-brand-600 border-brand-600 text-white shadow-[0_0_12px_rgba(91,170,255,0.35)]'
          : 'bg-[#060e1a] border-[#1a3a5c] text-slate-600 hover:text-[#ddeaf8] hover:border-brand-600'
      }${flashing ? ' cbat-launch-flash' : ''}${dimmed ? ' cbat-launch-dim' : ''}`}
    >
      <DifficultyBars filled={tuning.bars} tone={selected ? 'solid' : 'muted'} />
      {tuning.label}
    </button>
  )
}

// The difficulty in play, shown beside the page title during a run so it's never
// ambiguous which board the score is heading for. Belongs in the header row
// above the game, never over it.
export function DifficultyMarker({ tuning }) {
  return (
    <span
      data-difficulty-marker={tuning.key}
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#0c1829] border border-[#1a3a5c] text-[10px] font-extrabold uppercase tracking-wide text-brand-300"
    >
      <DifficultyBars filled={tuning.bars} tone="accent" />
      {tuning.label}
    </span>
  )
}

// The pair, flanking a title. `difficulties` is ordered [easier, hard] so the
// easier option lands left of the title and hard lands right of it.
export function DifficultyTitleRow({ difficulties, difficulty, onSelect, launching, children }) {
  const btn = (t) => (
    <DifficultyButton
      tuning={t}
      selected={difficulty === t.key}
      onSelect={onSelect}
      flashing={launching && difficulty === t.key}
      dimmed={launching && difficulty !== t.key}
    />
  )
  return (
    <div className="flex items-center justify-center gap-3 mb-1">
      {btn(difficulties[0])}
      {children}
      {btn(difficulties[1])}
    </div>
  )
}
