// Brief Reel — palette
//
// Universal faction → colour mapping. Same colour means the same thing in
// every reel across the app, so users build associations over time. The
// stickman colour is the faction colour; aircraft borrow the same logic.

export const FACTION_COLOR = {
  'raf-primary':   '#ff8c2a', // bright orange — the one figure being profiled / quoted
  'raf-secondary': '#5baaff', // brand electric blue — other RAF figures
  'ally':          '#e4ebf3', // off-white — allied non-RAF (US/French/NATO)
  'civilian':      '#8ba0c0', // slate-light — analysts / journalists / officials
  'adversary':     '#b8484e', // muted red — opposing force (deliberately desaturated)
};

// Aircraft default colour follows the RAF blue. Generic foreign aircraft use
// the neutral slate-grey to avoid faction-coding sensitive airframes.
export const AIRCRAFT_DEFAULT_COLOR = '#5baaff';
export const AIRCRAFT_GENERIC_COLOR = '#8ba0c0';

// Speech bubble + label theme — pulled from src/main.css dark surface tokens.
export const BUBBLE_FILL   = '#102040';   // --color-surface-raised
export const BUBBLE_STROKE = '#5baaff';   // --color-brand-600
export const TEXT_FG       = '#ddeaf8';   // --color-text
export const LABEL_FILL    = '#0c1829';   // --color-surface
export const STROKE_PULSE  = 'rgba(91, 170, 255, 0.6)';

// Stage background tokens.
export const STAGE_BG       = '#06101e';  // --color-bg
export const STAGE_GRID     = 'rgba(91, 170, 255, 0.06)';
export const SKY_GRADIENT_TOP    = '#0a1f3a';
export const SKY_GRADIENT_BOTTOM = '#062a52';

export function factionColor(faction) {
  return FACTION_COLOR[faction] || FACTION_COLOR['civilian'];
}
