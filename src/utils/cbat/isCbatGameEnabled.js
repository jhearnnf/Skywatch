// Resolve enabled-state for a CBAT game tile.
//
// The user-facing hub presents one TRACE 1/2 tile keyed 'plane-turn' that links
// to the combined /cbat/trace page. That page hosts three independently-gated
// modes — Practise 2D ('plane-turn-2d'), Practise 3D ('plane-turn-3d') and
// Trace 1 ('trace-1') — so the tile is enabled if ANY of them is enabled.
// Disabling all three is the only way to hide the tile entirely.
//
// All callers reading settings.cbatGameEnabled[gameKey] should go through this
// helper so the plane-turn alias stays consistent across hub, route guard,
// and homePreview.
export function isCbatGameEnabled(cbatGameEnabled, gameKey) {
  const map = cbatGameEnabled ?? {}
  if (gameKey === 'plane-turn') {
    return map['plane-turn-2d'] !== false || map['plane-turn-3d'] !== false || map['trace-1'] !== false
  }
  if (gameKey === 'visualisation') {
    return map['visualisation-2d'] !== false || map['visualisation-3d'] !== false
  }
  return map[gameKey] !== false
}
