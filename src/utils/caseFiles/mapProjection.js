/**
 * mapProjection — the screen projection behind the Case Files tactical map.
 *
 * Plain spherical Mercator, fitted so the case's bounds sit inside the box
 * with a margin. Mercator keeps angles true, which is what makes an attack
 * route "point at" the right city, and at a single theatre's scale its area
 * stretch is mild. No tiles and no library: the map draws its own geography.
 */

import { createContext, useContext } from 'react'

const DEG = Math.PI / 180

function mercY(lat) {
  const clamped = Math.max(-85, Math.min(85, lat))
  return Math.log(Math.tan(Math.PI / 4 + (clamped * DEG) / 2))
}

/**
 * fitProjection(bounds, width, height, pad) → { project, invert, scale }
 *   project(lat, lng) → { x, y } in container pixels
 */
export function fitProjection(bounds, width, height, pad = 28) {
  const b = bounds ?? { south: 44, west: 22, north: 56, east: 42 }
  const x0 = b.west * DEG
  const x1 = b.east * DEG
  const y0 = mercY(b.south)
  const y1 = mercY(b.north)
  const w  = Math.max(1, width  - pad * 2)
  const h  = Math.max(1, height - pad * 2)
  const scale = Math.min(w / (x1 - x0 || 1), h / (y1 - y0 || 1))
  // Centre the case area; the spare room on the long axis shows more of the
  // surrounding geography rather than empty margin.
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2

  const project = (lat, lng) => ({
    x: width  / 2 + (lng * DEG - cx) * scale,
    y: height / 2 - (mercY(lat) - cy) * scale,
  })
  const invert = (x, y) => {
    const lng = ((x - width / 2) / scale + cx) / DEG
    const my  = cy - (y - height / 2) / scale
    const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) / DEG
    return { lat, lng }
  }
  return { project, invert, scale }
}

/** SVG path for rings stored flat as [lng, lat, lng, lat, …]. */
export function ringsToPath(polys, project) {
  let d = ''
  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const p = project(ring[i + 1], ring[i])
        d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      }
      d += 'Z'
    }
  }
  return d
}

/** Point-in-polygon on a flat [lng, lat, …] ring. */
export function ringContains(ring, lng, lat) {
  let c = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** True when the country's outer rings contain the point. */
export function countryContains(country, lng, lat) {
  return country.polys.some((rings) => ringContains(rings[0], lng, lat))
}

// ── Projection context ───────────────────────────────────────────────────────
// Overlays (the movement animation) read the live projection through this.
// It mirrors the two Leaflet map methods they were written against, so the
// value is a stable object whose methods always use the current fit.
export const MapProjectionContext = createContext(null)

export function useMapProjection() {
  return useContext(MapProjectionContext)
}
