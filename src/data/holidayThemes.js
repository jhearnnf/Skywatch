// Seasonal decoration for the CBAT hub (/cbat), picked by an admin under
// Game Options → CBAT → General Settings. Stored as `AppSettings.cbatHolidayTheme`.
//
// `implemented: false` themes are listed so the admin can see what is coming,
// but their buttons are disabled and the hub draws nothing for them. Keep the
// keys in step with the enum in backend/models/AppSettings.js.
export const HOLIDAY_THEMES = [
  { key: 'none',      label: 'Off',       implemented: true },
  { key: 'christmas', label: 'Christmas', implemented: true },
  { key: 'easter',    label: 'Easter',    implemented: true },
  { key: 'halloween', label: 'Halloween', implemented: true },
]

export function holidayTheme(key) {
  return HOLIDAY_THEMES.find(t => t.key === key) ?? null
}

// True when the hub has something to draw for this key.
export function isHolidayThemeLive(key) {
  const t = holidayTheme(key)
  return Boolean(t && t.key !== 'none' && t.implemented)
}

// Christmas: which CBAT hub tiles get a snow cap. A stable pick from the game
// key (about two in five), so the same tiles are snowy every visit and the
// pattern looks scattered rather than every-other.
export function hasSnowCap(key) {
  return hashKey(key) % 5 < 2
}

// Christmas: a mini tree standing on the top edge of a few tiles, each on its
// own little pile of snow, spread down the page.
// Returns { along (0-1, where on the edge), scale (0.8-1) } or null.
export function christmasTreeFor(key) {
  const h = hashKey(`tree:${key}`)
  if (h % 7 !== 0) return null
  return {
    along: ((h >>> 3) % 100) / 100,
    scale: 0.8 + ((h >>> 9) % 21) / 100,
  }
}

// Easter: which tiles have eggs on their top edge (about one in five, so a
// handful of spots across the page), and what is there. Usually a little
// cluster of two to four eggs of mixed size, colour and pattern; now and then a
// single egg on its own. Stable per game key like the snow caps (same eggs in
// the same places every visit), and salted so they do not follow the snow.
//
// Returns { along, eggs } or null. `along` (0-1) is where the group sits along
// the tile's edge; each egg is { scale (0.55-1), tilt (degrees), colour (an
// index into the component's palette, 0-4), pattern (0 band, 1 zigzag, 2 dots) }.
// Neighbouring eggs never share a colour.
export const EGG_COLOUR_COUNT = 5
export const EGG_PATTERN_COUNT = 3

export function easterEggFor(key) {
  const h = hashKey(`egg:${key}`)
  if (h % 5 !== 0) return null
  const rand = seededRandom(h)
  const count = rand() < 0.2 ? 1 : 2 + Math.floor(rand() * 3)
  const eggs = []
  for (let i = 0; i < count; i++) {
    eggs.push({
      // A lone egg is full size; in a group one is big and the rest vary.
      scale:   count === 1 || i === 0 ? 1 : 0.55 + rand() * 0.4,
      tilt:    Math.round(rand() * 30 - 15),
      colour:  Math.floor(rand() * EGG_COLOUR_COUNT),
      pattern: Math.floor(rand() * EGG_PATTERN_COUNT),
    })
  }
  // The big one in the middle of the group rather than always on the left.
  if (count > 2) [eggs[0], eggs[1]] = [eggs[1], eggs[0]]
  // After the reorder, so no two eggs side by side end up the same colour.
  for (let i = 1; i < count; i++) {
    if (eggs[i].colour === eggs[i - 1].colour) eggs[i].colour = (eggs[i].colour + 1) % EGG_COLOUR_COUNT
  }
  return { along: rand(), eggs }
}

// Small deterministic PRNG (mulberry32), seeded from the key's hash.
function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Halloween: a cobweb in one corner of a couple of tiles. Returns
// { corner: 'tl' | 'tr' | 'bl' | 'br', size (0.85-1) } or null.
const WEB_CORNERS = ['tl', 'tr', 'bl', 'br']
export function spiderWebFor(key) {
  const h = hashKey(`spiderweb:${key}`)
  if (h % 9 !== 0) return null
  return {
    corner: WEB_CORNERS[(h >>> 4) % 4],
    size:   0.85 + ((h >>> 8) % 16) / 100,
  }
}

// Halloween: a jack-o'-lantern with a flickering candle on the top edge of a
// couple of tiles. Returns { along (0-1), scale (0.85-1) } or null.
export function jackOLanternFor(key) {
  const h = hashKey(`jack:${key}`)
  if (h % 9 !== 0) return null
  return {
    along: ((h >>> 3) % 100) / 100,
    scale: 0.85 + ((h >>> 9) % 16) / 100,
  }
}

function hashKey(key) {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return hash
}
