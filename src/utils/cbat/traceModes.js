// The four boards behind the Trace tile, for the shared CbatModeRow.
//
// None of these is a difficulty of another — two are free practice and two are
// the recall tests — so none of them carries bars. The two practice modes share
// the label "Practise" and are told apart by a badge, which is what lets all
// four sit in one row instead of the two headed groups they used to need.

export const TRACE_MODE_KEYS = {
  '2d':   'plane-turn-2d',
  '3d':   'plane-turn-3d',
  trace1: 'trace-1',
  trace2: 'trace-2',
}

export const TRACE_MODES = [
  { key: '2d',     label: 'Practise', badge: '2D', gameKey: 'plane-turn-2d', blurb: 'Free practice — fly the turn in two dimensions' },
  { key: '3d',     label: 'Practise', badge: '3D', gameKey: 'plane-turn-3d', blurb: 'Free practice — fly the turn in three dimensions' },
  { key: 'trace1', label: 'Trace 1',               gameKey: 'trace-1',       blurb: 'The recall test — watch the Hawk T2 and name each turn' },
  { key: 'trace2', label: 'Trace 2',               gameKey: 'trace-2',       blurb: 'Four aircraft manoeuvre, then one question a round' },
]

// Modes an admin has left switched on. A mode disabled in Game Options drops
// out of the row entirely rather than rendering a button that goes nowhere.
export function traceModes(isModeEnabled) {
  return isModeEnabled ? TRACE_MODES.filter(m => isModeEnabled(m.key)) : TRACE_MODES
}

export function traceMode(key) {
  return TRACE_MODES.find(m => m.key === key) ?? TRACE_MODES[0]
}
