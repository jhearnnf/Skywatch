// Resolve enabled-state for a CBAT game tile.
//
// The backend registry splits 'plane-turn' into 'plane-turn-2d' and
// 'plane-turn-3d', but the user-facing hub still presents one TRACE 1/2 tile
// keyed 'plane-turn'. The tile is considered enabled if EITHER underlying mode
// is enabled — disabling both is the only way to hide the tile entirely.
//
// All callers reading settings.cbatGameEnabled[gameKey] should go through this
// helper so the plane-turn alias stays consistent across hub, route guard,
// and homePreview.
export function isCbatGameEnabled(cbatGameEnabled, gameKey) {
  const map = cbatGameEnabled ?? {}
  if (gameKey === 'plane-turn') {
    return map['plane-turn-2d'] !== false || map['plane-turn-3d'] !== false
  }
  if (gameKey === 'visualisation') {
    return map['visualisation-2d'] !== false || map['visualisation-3d'] !== false
  }
  return map[gameKey] !== false
}
