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

/**
 * Returns one image zone per section.
 * - If media[i] exists: use that image at centre.
 * - Otherwise: reuse the last available image (or placeholder) with a
 *   different focal point per section so each card looks distinct.
 *
 * @param {Array}  media  brief.media array from the API
 * @param {number} total  number of sections
 * @returns {{ src: string, position: string }[]}
 */
export function buildImageZones(media, total) {
  const images = (media ?? []).filter(m => m?.cloudinaryPublicId)
  return Array.from({ length: total }, (_, i) => {
    if (images[i]) return { src: images[i].mediaUrl, position: 'center center' }
    const fallback = images.length ? images[images.length - 1].mediaUrl : PLACEHOLDER_IMG
    return { src: fallback, position: ZOOM_POSITIONS[i % ZOOM_POSITIONS.length] }
  })
}
