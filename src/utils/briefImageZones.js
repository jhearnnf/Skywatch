export const PLACEHOLDER_IMG = '/images/placeholder-brief.svg'

// Four distinct focal points used when reusing the same image across sections.
// Each value is a CSS object-position — shows a different region of the image
// without upscaling, so there's no pixelation.
export const ZOOM_POSITIONS = [
  'center 30%',
  '20% 20%',
  '80% 20%',
  '50% 78%',
]

// A Media doc's `name` is usually a clean page/search-term title, but older
// records sometimes hold a Cloudinary publicId (e.g. "brief-images/brief-...").
// Display layers should only show it when it reads as a human-written title.
export function isRealImageTitle(name) {
  if (!name) return false
  const s = String(name).trim()
  if (!s) return false
  if (s.includes('/')) return false
  // Cloudinary publicId auto-prefixes: brief-123, brief_123, brief123 (any case)
  if (/^brief[-_]?\d/i.test(s)) return false
  return true
}

/**
 * Returns one image zone per section.
 * - If media[i] exists: use that image at centre.
 * - Otherwise: reuse the last available image (or placeholder) with a
 *   different focal point per section so each card looks distinct.
 *
 * `cutoutSrc` (transparent-background subject cutout) is passed through from
 * the Media doc when present. The display layer decides whether to render it
 * based on brief.category — extraction is only offered on Aircraft briefs.
 *
 * @param {Array}  media  brief.media array from the API
 * @param {number} total  number of sections
 * @returns {{ src: string, position: string, alt: string | null, cutoutSrc: string | null }[]}
 */
export function buildImageZones(media, total) {
  const images = (media ?? []).filter(m => m?.cloudinaryPublicId)
  return Array.from({ length: total }, (_, i) => {
    if (images[i]) return {
      src:       images[i].mediaUrl,
      position:  'center center',
      alt:       images[i].name ?? null,
      cutoutSrc: images[i].cutoutUrl ?? null,
    }
    const last = images.length ? images[images.length - 1] : null
    const fallback = last ? last.mediaUrl : PLACEHOLDER_IMG
    return {
      src:       fallback,
      position:  ZOOM_POSITIONS[i % ZOOM_POSITIONS.length],
      alt:       last?.name ?? null,
      cutoutSrc: last?.cutoutUrl ?? null,
    }
  })
}
