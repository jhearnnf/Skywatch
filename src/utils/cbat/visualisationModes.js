// The two boards behind the Visualisation tile, for the shared CbatModeRow.
//
// 2D and 3D are different tests, not two settings of one — you weld flat shapes
// in the first and rotate a solid in the second — so neither carries bars. The
// badge is the whole label here, so it doubles as the name.

export const VISUALISATION_MODE_KEYS = {
  '2d': 'visualisation-2d',
  '3d': 'visualisation-3d',
}

export const VISUALISATION_MODES = [
  { key: '2d', label: 'Practise', badge: '2D', gameKey: 'visualisation-2d', blurb: 'Weld flat shapes together and spot the match' },
  { key: '3d', label: 'Practise', badge: '3D', gameKey: 'visualisation-3d', blurb: 'Rotate a 3D composite and spot the match' },
]

// Modes an admin has left switched on. With only one left there is nothing to
// pick, and CbatModeRow renders nothing.
export function visualisationModes(isModeEnabled) {
  return isModeEnabled ? VISUALISATION_MODES.filter(m => isModeEnabled(m.key)) : VISUALISATION_MODES
}

export function visualisationMode(key) {
  return VISUALISATION_MODES.find(m => m.key === key) ?? VISUALISATION_MODES[0]
}
