/**
 * mapHelpers.js
 * Pure utility functions for MapCanvas / MapPredictiveStage.
 * No React or Leaflet imports — safe to use in unit tests without jsdom.
 *
 * Note on arrowhead computation:
 *   Pure lat/lng arrowhead math requires projecting geodesic bearings,
 *   which diverges on different zoom levels and map projections.
 *   Instead we expose `useArrowheadPoints` (see MapCanvas.jsx) as a hook
 *   that uses `map.latLngToContainerPoint` + `containerPointToLatLng` to
 *   project into pixel space, compute the V, then unproject.
 *   `arrowheadPolyline` below is provided as the pure-math fallback; callers
 *   inside MapCanvas should prefer the hook form.
 *   CONTRACT-AMBIGUITY: spec allowed either approach; hook chosen for accuracy.
 */

/**
 * boundsCentre({ south, west, north, east })
 * Returns [lat, lng] centroid of a bounding box.
 */
export function boundsCentre({ south, west, north, east }) {
  return [(south + north) / 2, (west + east) / 2]
}

/**
 * lookupHotspot(hotspots, id)
 * Returns the hotspot with matching id, or undefined.
 */
export function lookupHotspot(hotspots, id) {
  if (!Array.isArray(hotspots) || id == null) return undefined
  return hotspots.find(h => h.id === id)
}

/**
 * arrowheadPolyline(fromLatLng, toLatLng, sizeMeters)
 * Pure-lat/lng approximation of a "V" arrowhead at toLatLng,
 * oriented along the from→to direction.
 *
 * Returns an array of [lat, lng] pairs forming the two arms of the V.
 * This is a flat-earth approximation suitable for small map regions;
 * for accurate screen-space rendering use useArrowheadPoints() instead.
 *
 * sizeMeters defaults to 30 000 (30 km) — visible at zoom 6–8.
 */
export function arrowheadPolyline(fromLatLng, toLatLng, sizeMeters = 30000) {
  const [fromLat, fromLng] = fromLatLng
  const [toLat, toLng]     = toLatLng

  // Convert sizeMeters to approximate degrees
  const sizeDeg = sizeMeters / 111320

  const dLat = toLat - fromLat
  const dLng = (toLng - fromLng) * Math.cos((toLat * Math.PI) / 180)
  const len  = Math.sqrt(dLat * dLat + dLng * dLng) || 1

  // Unit vector pointing from→to (in lat/lng space)
  const uLat = dLat / len
  const uLng = dLng / len

  // Perpendicular unit vector (rotate 90°)
  const pLat = -uLng
  const pLng =  uLat

  // Arrowhead wing length and half-spread
  const wing   = sizeDeg
  const spread = sizeDeg * 0.5

  const leftLat  = toLat - uLat * wing + pLat * spread
  const leftLng  = toLng - uLng * wing / Math.cos((toLat * Math.PI) / 180) + pLng * spread
  const rightLat = toLat - uLat * wing - pLat * spread
  const rightLng = toLng - uLng * wing / Math.cos((toLat * Math.PI) / 180) - pLng * spread

  // Return [leftWing, tip, rightWing] so a single Polyline renders the V
  return [
    [leftLat,  leftLng],
    [toLat,    toLng],
    [rightLat, rightLng],
  ]
}
