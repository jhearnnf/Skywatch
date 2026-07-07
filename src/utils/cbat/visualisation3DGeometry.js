// CBAT Visualisation 3D — composite geometry cache.
//
// Each composite is a clean manifold polyhedron built in visualisation3DShapes.js
// (no CSG, no T-junctions). The geometry depends only on the composite key, so we
// build it once and cache it — cheap even with ~12 shapes on screen at once.

import { buildShapeGeometry } from './visualisation3DShapes'

const cache = new Map()

// Returns a single BufferGeometry for a composite key (cached).
export function getCompositeGeometry(compositeKey) {
  if (cache.has(compositeKey)) return cache.get(compositeKey)
  const geometry = buildShapeGeometry(compositeKey)
  if (geometry) cache.set(compositeKey, geometry)
  return geometry
}
