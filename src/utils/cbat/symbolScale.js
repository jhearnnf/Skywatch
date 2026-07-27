// Per-glyph size normalisation for the Symbols game.
//
// The symbol pool mixes scripts with wildly different metrics at the same
// font-size: a full-width CJK ideograph inks ~0.86em tall, a Cyrillic capital
// ~0.72em, a Cyrillic lowercase letter only ~0.5em (x-height), and many Arabic
// letters less still. Rendered at one font-size the tiles look inconsistent —
// some symbols are visibly tiny next to the target card.
//
// We measure each glyph's actual ink box on a canvas (same font stack and the
// same fallback chain the browser uses to paint it) and return a multiplier
// that brings every glyph to the same rendered height, capped so a wide glyph
// still fits its square tile. Callers apply it as an `em` font-size on a span
// inside the tile, so the responsive base size (text-2xl / sm:text-3xl) still
// drives the overall scale.

const MEASURE_PX = 100          // measure at a big size for sub-pixel accuracy
const TARGET_INK = 0.66         // desired ink height, in em
const MAX_INK_WIDTH = 0.82      // widest ink allowed, in em (tiles are square)
const MIN_SCALE = 0.6
const MAX_SCALE = 1.8

const FONT_STACK =
  "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif"

// Used when canvas ink metrics are unavailable (jsdom, very old browsers).
// Rough per-script averages — the same shape the measured path produces.
function fallbackScale(char) {
  const cp = char.codePointAt(0)
  if (cp >= 0x0410 && cp <= 0x042f) return 0.92 // Cyrillic uppercase
  if (cp >= 0x0430 && cp <= 0x044f) return 1.25 // Cyrillic lowercase (x-height)
  if (cp >= 0x0600 && cp <= 0x06ff) return 1.35 // Arabic
  if (cp >= 0x3040 && cp <= 0x30ff) return 0.78 // Hiragana / Katakana
  if (cp >= 0x4e00 && cp <= 0x9fff) return 0.78 // CJK ideographs
  if (cp >= 0xac00 && cp <= 0xd7af) return 0.78 // Hangul syllables
  return 1
}

const cache = new Map()
let ctx // lazily created, reused across measurements

function measureContext() {
  if (ctx !== undefined) return ctx
  ctx = null
  try {
    const canvas = document.createElement('canvas')
    const c = canvas.getContext && canvas.getContext('2d')
    // jsdom returns a context whose metrics are all zero — treat that as absent.
    if (c && typeof c.measureText === 'function') ctx = c
  } catch {
    ctx = null
  }
  return ctx
}

/**
 * Font-size multiplier that renders `char` at a consistent visual height.
 * Memoised per character; safe to call during render.
 */
export function getSymbolScale(char) {
  if (!char) return 1
  if (cache.has(char)) return cache.get(char)

  let scale = fallbackScale(char)
  const c = measureContext()
  if (c) {
    try {
      c.font = `${MEASURE_PX}px ${FONT_STACK}`
      const m = c.measureText(char)
      const inkH =
        (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0)
      const inkW =
        (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0)
      if (inkH > 0) {
        const byHeight = TARGET_INK / (inkH / MEASURE_PX)
        // Never let the cap push a glyph up — only down, if it would be too wide.
        const widthCap =
          inkW > 0 ? MAX_INK_WIDTH / (inkW / MEASURE_PX) : Infinity
        scale = Math.min(byHeight, widthCap)
      }
    } catch {
      // keep the fallback
    }
  }

  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
  scale = Math.round(scale * 1000) / 1000
  cache.set(char, scale)
  return scale
}

// Test seam — measurements are cached for the life of the page.
export function _clearSymbolScaleCache() {
  cache.clear()
  ctx = undefined
}
