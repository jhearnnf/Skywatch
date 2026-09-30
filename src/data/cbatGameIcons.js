import { CBAT_GAMES, CBAT_LEADERBOARD_CONFIG } from './cbatGames'

// Drawn icons for the CBAT games, one per hub game plus CLAN. They replace the
// OS emoji wherever a game is named with a picture: emoji are drawn by the
// operating system, so Windows, iOS and Android each show something different
// (and some glyphs are missing on Windows). These are inline SVG with no text
// in them, so every device renders the same pixels.
//
// Each entry is the inside of a 32×32 viewBox. The colours come from CSS
// (`.cbat-gi` in main.css), so one set serves both themes. Class names:
//   a    accent line            t    tinted fill under a line
//   f    solid fill (line hue)  af   solid fill (accent hue)
//   fill tint, no line          d    dashed      dim  faded
//
// The `emoji` field in cbatGames.js stays for plain-text places (chat, share
// text, the Aptitude Report's inline labels).

const VIGILANCE_DOTS = [5, 12, 19, 26]
  .flatMap(y => [5, 12, 19, 26].map(x => (x === 19 && y === 12) ? '' : `<circle class="f" cx="${x}" cy="${y}" r="1.4"/>`))
  .join('')

export const CBAT_GAME_ICONS = {
  target: '<circle cx="16" cy="16" r="10"/><path d="M16 2.5v6M16 23.5v6M2.5 16h6M23.5 16h6"/><path class="a t" d="M16 12.2l3.8 3.8-3.8 3.8-3.8-3.8z"/>',
  ant: '<path class="fill" d="M16 4.5L22.25 15.5H9.75Z"/><path d="M16 4.5L28.5 26.5H3.5Z"/><path class="a" d="M9.75 15.5H22.25M16 15.5V26.5"/>',
  symbols: '<circle cx="9" cy="9" r="4.2"/><path d="M19.5 5.5l7 7m0-7l-7 7M9 18.6L13.4 26.2H4.6Z"/><rect class="a t" x="17" y="17" width="12" height="12"/><path class="af" d="M23 19.6l3.4 3.4-3.4 3.4-3.4-3.4z"/>',
  'code-duplicates': '<path class="a" d="M3.5 7h6v12M22.5 7h6v12"/><path d="M13 7v6.5h6M19 7v12"/><path d="M6.5 23.5v3h19v-3"/>',
  angles: '<path class="d dim" d="M22 26A18 18 0 0 0 4 8"/><path d="M4 26H28M4 26L21 9"/><path class="a" d="M13 26A9 9 0 0 0 10.36 19.64"/>',
  instruments: '<path class="fill" d="M4.6 19L27.4 13A11.8 11.8 0 0 1 4.6 19Z"/><circle cx="16" cy="16" r="12"/><path d="M4.6 19L27.4 13M13.2 10.8L18.8 9.3"/><path class="a" d="M7.5 16.5H12.5L16 19.5L19.5 16.5H24.5"/>',
  'plane-turn': '<path class="t" d="M16 8L17.6 13.5L24 17V18.8L17.4 17.2L17 21.5L19.2 23.2V24.4L16 23.6L12.8 24.4V23.2L15 21.5L14.6 17.2L8 18.8V17L14.4 13.5Z"/><path class="a" d="M7.16 7.16A12.5 12.5 0 0 1 24.84 7.16M21.7 6.6L24.84 7.16L24.28 4.01"/><path class="a d" d="M28.5 16A12.5 12.5 0 0 1 16 28.5"/>',
  flag: '<rect x="3" y="5" width="26" height="22" rx="2"/><path d="M17 5V27M17 16H29"/><circle class="f" cx="8" cy="11.5" r="1.7"/><circle class="f" cx="12.5" cy="20.5" r="1.7"/><path class="d dim" d="M8 11.5L6 15M12.5 20.5L10 23"/><path d="M23 8.3v5.4M20.3 11h5.4"/><path class="a t" d="M23 18.8L26 23.8H20Z"/>',
  clan: '<path class="a t" d="M16 3.5l5 5-5 5-5-5z"/><path class="d dim" d="M16 15v3.5"/><rect x="5" y="20" width="22" height="8" rx="1"/><path d="M5 22.7H27M5 25.3H27"/>',
  visualisation: '<path class="d dim" d="M16 4V16M6 21.5L16 16L26 21.5"/><path class="a t" d="M16 4L26 9.5L16 15L6 9.5Z"/><path d="M6 9.5V21.5L16 27L26 21.5V9.5M16 15V27"/>',
  dpt: '<path class="d" d="M3.5 25C9 18 13 16 19 16H22"/><path class="f" d="M22 12L29 16L22 20L24 16Z"/><path class="a" d="M17 4V10.5M17 21.5V28M14.5 4H19.5M14.5 28H19.5"/>',
  act: '<path d="M6 19V16a10 10 0 0 1 20 0v3"/><rect x="4" y="18" width="5" height="9" rx="1.5"/><rect x="23" y="18" width="5" height="9" rx="1.5"/><path class="a" d="M11 22.5h1.8l1.4-3.5 1.8 7 1.8-7 1.4 3.5H21"/>',
  'numerical-ops': '<path d="M10 6v8M6 10h8M18 10h8M7.2 19.2l5.6 5.6m0-5.6l-5.6 5.6"/><path class="a" d="M18 22h8"/><circle class="af" cx="22" cy="18.3" r="1.4"/><circle class="af" cx="22" cy="25.7" r="1.4"/>',
  dad: '<path class="a d" d="M26 6L6 26"/><path d="M6 26V13H13V6H26M23.5 3.5L26 6L23.5 8.5"/><circle class="t" cx="6" cy="26" r="2.3"/>',
  cut: '<rect x="3" y="6" width="8" height="9" rx="1"/><rect x="12" y="6" width="8" height="9" rx="1"/><rect class="a t" x="21" y="6" width="8" height="9" rx="1"/><rect x="3" y="17" width="8" height="9" rx="1"/><rect x="12" y="17" width="8" height="9" rx="1"/><rect x="21" y="17" width="8" height="9" rx="1"/><path class="a" d="M25 8.6v2.4"/><circle class="af" cx="25" cy="12.9" r="1"/>',
  sat: '<rect x="3.5" y="5" width="13" height="9"/><path d="M3.5 5L16.5 14M16.5 5L3.5 14"/><path class="a t" d="M23 16.5l5 5-5 5-5-5z"/><path class="f" d="M22.5 4l6 3.5-6 3.5 1.5-3.5z"/><path d="M4 22a6 6 0 0 1 6 6M4 18a10 10 0 0 1 10 10"/><circle class="f" cx="4.5" cy="27.5" r="1.4"/>',
  rtt: '<path d="M4 10V4h6M22 4h6v6M28 22v6h-6M10 28H4v-6M16 12.5v7M12.5 16h7"/><path class="a d" d="M25.5 24.5Q27.5 17 23.8 12.2"/><circle class="af" cx="22.5" cy="9.5" r="2.4"/>',
  sit: '<path d="M4 21L16 27L28 21"/><path d="M4 16L16 22L28 16"/><path class="a t" d="M16 5L28 11L16 17L4 11Z"/>',
  slt: '<path d="M10 8H17A8 8 0 0 1 17 24H10Z"/><path d="M3 12H10M3 20H10"/><circle class="af" cx="3.5" cy="12" r="1.9"/><circle class="af" cx="3.5" cy="20" r="1.9"/><path class="a" d="M25 16H29.5"/>',
  vlt: '<path d="M4 4H17L21 8V28H4Z"/><path d="M17 4V8H21M8 16h7M8 24h5"/><path class="a" d="M8 12h9M8 20h9M23.5 12H27V20H23.5"/>',
  matf: '<rect class="fill" x="4" y="12" width="24" height="8"/><rect class="fill" x="20" y="4" width="8" height="24"/><rect x="4" y="4" width="24" height="24"/><path d="M12 4V28M20 4V28M4 12H28M4 20H28"/><rect class="a" x="20" y="12" width="8" height="8"/>',
  vigilance: `${VIGILANCE_DOTS}<path class="af" d="M19 7.5L20.12 10.46L23.28 10.61L20.81 12.59L21.65 15.64L19 13.9L16.35 15.64L17.19 12.59L14.72 10.61L17.88 10.46Z"/>`,
  sma: '<path d="M16 6v6M16 20v6M6 16h6M20 16h5"/><circle cx="16" cy="16" r="1.2"/><path class="a d" d="M28 11Q29.5 19 25.5 21.5"/><circle class="af" cx="23" cy="23" r="2.6"/>',
}

const GAME_KEY_BY_PATH = Object.fromEntries(CBAT_GAMES.map(g => [g.path, g.key]))

// Resolve any key a caller holds (a hub game key, or a leaderboard key such as
// 'flag-easier', 'trace-1' or 'visualisation-3d') to its icon key. A leaderboard
// key with no icon of its own borrows its Easier/Hard pair's (`difficultyGroup`,
// which is how CLAN's boards find CLAN: it has no hub tile of its own), else
// its parent game's through `backPath`.
export function cbatIconKey(key) {
  if (CBAT_GAME_ICONS[key]) return key
  const group = CBAT_LEADERBOARD_CONFIG[key]?.difficultyGroup
  if (group && CBAT_GAME_ICONS[group]) return group
  const back = CBAT_LEADERBOARD_CONFIG[key]?.backPath
  const parent = back && GAME_KEY_BY_PATH[back]
  return parent && CBAT_GAME_ICONS[parent] ? parent : null
}
