// CBAT Visualisation 3D — clean shape geometry.
//
// Each composite is built directly as ONE watertight manifold polyhedron:
// explicit vertices + polygon faces that share vertices along every edge. This
// replaced an earlier CSG-boolean-of-two-primitives approach that left
// T-junctions (a vertex sitting mid-edge of another triangle) — those render as
// hairline cracks on a real GPU and read as seams, making a composite look like
// "two blocks stuck together".
//
// Because faces are explicit polygons (triangulated as a fan only at render
// time), coplanar regions are a SINGLE face — e.g. a house's gable end is one
// pentagon (wall rectangle + roof triangle merged), never two faces with a line
// between them. Vertices are shared, so there are no cracks and no z-fighting.
//
// The same vertices drive the red corner dots (see shapeCorners), so a dot is
// always exactly on a real corner of the rendered solid.

import * as THREE from 'three'

// ── Builders ─────────────────────────────────────────────────────────────────
// Each returns { vertices: [[x,y,z], …], faces: [[vertexIndex, …], …] }, roughly
// centred on the origin. Faces are oriented outward by orientFaces() below.

// Regular n-gon in the XZ plane. First vertex at +Z (matches Three.js so shapes
// look consistent if ever mixed with primitive geometry).
function ngon(n, r, rot = 0) {
  const pts = []
  for (let k = 0; k < n; k++) {
    const a = rot + (k * 2 * Math.PI) / n
    pts.push([r * Math.sin(a), r * Math.cos(a)])
  }
  return pts
}

// A prism (n-gon base) with a smaller concentric n-gon prism stacked on top.
// The base's top becomes a flat ring (annulus) around the upper prism.
function prismStack({ n, r, rot = 0, baseH, topR, topH }) {
  const total = baseH + topH
  const y0 = -total / 2
  const yb = y0 + baseH
  const yt = y0 + baseH + topH
  const base = ngon(n, r, rot)
  const top = ngon(n, topR, rot)
  const V = []
  const push = (x, y, z) => (V.push([x, y, z]), V.length - 1)
  const bBot = base.map(([x, z]) => push(x, y0, z))
  const bTop = base.map(([x, z]) => push(x, yb, z))
  const tBot = top.map(([x, z]) => push(x, yb, z))
  const tTop = top.map(([x, z]) => push(x, yt, z))
  const F = []
  F.push([...bBot].reverse()) // bottom n-gon
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; F.push([bBot[k], bBot[j], bTop[j], bTop[k]]) } // base walls
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; F.push([bTop[k], bTop[j], tBot[j], tBot[k]]) } // top ring
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; F.push([tBot[k], tBot[j], tTop[j], tTop[k]]) } // upper walls
  F.push([...tTop]) // top n-gon
  return { vertices: V, faces: F }
}

// A prism (n-gon base) capped by a pyramid to a single apex.
function prismCap({ n, r, rot = 0, bodyH, capH }) {
  const total = bodyH + capH
  const y0 = -total / 2
  const yb = y0 + bodyH
  const ya = y0 + bodyH + capH
  const base = ngon(n, r, rot)
  const V = []
  const push = (x, y, z) => (V.push([x, y, z]), V.length - 1)
  const bBot = base.map(([x, z]) => push(x, y0, z))
  const bTop = base.map(([x, z]) => push(x, yb, z))
  const apex = push(0, ya, 0)
  const F = []
  F.push([...bBot].reverse())
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; F.push([bBot[k], bBot[j], bTop[j], bTop[k]]) } // walls
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; F.push([bTop[k], bTop[j], apex]) } // roof triangles
  return { vertices: V, faces: F }
}

// A box with a pitched (ridged) roof. Ridge runs along X, so the two gable ends
// (x = ±w/2) are single pentagons: wall rectangle + roof triangle as ONE face.
function houseRoof({ w, d, wallH, roofH }) {
  const total = wallH + roofH
  const y0 = -total / 2
  const ye = y0 + wallH
  const yr = y0 + wallH + roofH
  const hw = w / 2
  const hd = d / 2
  const V = []
  const push = (x, y, z) => (V.push([x, y, z]), V.length - 1)
  const b00 = push(-hw, y0, -hd), b10 = push(hw, y0, -hd), b11 = push(hw, y0, hd), b01 = push(-hw, y0, hd)
  const e00 = push(-hw, ye, -hd), e10 = push(hw, ye, -hd), e11 = push(hw, ye, hd), e01 = push(-hw, ye, hd)
  const rN = push(-hw, yr, 0), rP = push(hw, yr, 0)
  const F = [
    [b00, b01, b11, b10],          // bottom
    [b00, b10, e10, e00],          // wall z=-d/2
    [b11, b01, e01, e11],          // wall z=+d/2
    [b10, b11, e11, rP, e10],      // gable pentagon x=+w/2
    [b00, e00, rN, e01, b01],      // gable pentagon x=-w/2
    [e00, e10, rP, rN],            // roof slope z=-d/2
    [e01, rN, rP, e11],            // roof slope z=+d/2
  ]
  return { vertices: V, faces: F }
}

// A single n-gon extrusion tapering from rBot to rTop (a frustum).
function frustum({ n, rBot, rTop, rot = 0, height }) {
  const y0 = -height / 2
  const y1 = height / 2
  const b = ngon(n, rBot, rot)
  const t = ngon(n, rTop, rot)
  const V = []
  const push = (x, y, z) => (V.push([x, y, z]), V.length - 1)
  const bi = b.map(([x, z]) => push(x, y0, z))
  const ti = t.map(([x, z]) => push(x, y1, z))
  const F = [[...bi].reverse(), [...ti]]
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; F.push([bi[k], bi[j], ti[j], ti[k]]) }
  return { vertices: V, faces: F }
}

// ── Face orientation ─────────────────────────────────────────────────────────
// Reverse any face whose Newell normal points toward the shape centroid, so all
// normals face outward (correct lighting + backface culling). Valid for the
// star-convex-from-centroid shapes built above.
function polyNormal(V, face) {
  const nrm = new THREE.Vector3()
  for (let i = 0; i < face.length; i++) {
    const a = V[face[i]]
    const b = V[face[(i + 1) % face.length]]
    nrm.x += (a[1] - b[1]) * (a[2] + b[2])
    nrm.y += (a[2] - b[2]) * (a[0] + b[0])
    nrm.z += (a[0] - b[0]) * (a[1] + b[1])
  }
  return nrm.normalize()
}
function orientFaces({ vertices, faces }) {
  const cen = new THREE.Vector3()
  vertices.forEach((v) => cen.add(new THREE.Vector3(v[0], v[1], v[2])))
  cen.multiplyScalar(1 / vertices.length)
  const oriented = faces.map((f) => {
    const nrm = polyNormal(vertices, f)
    const fc = new THREE.Vector3()
    f.forEach((i) => fc.add(new THREE.Vector3(vertices[i][0], vertices[i][1], vertices[i][2])))
    fc.multiplyScalar(1 / f.length)
    return nrm.dot(fc.sub(cen)) < 0 ? [...f].reverse() : f
  })
  return { vertices, faces: oriented }
}

// ── Shape definitions ────────────────────────────────────────────────────────
export const SHAPES = {
  cubeStack:   orientFaces(prismStack({ n: 4, r: 0.7071, rot: Math.PI / 4, baseH: 0.8, topR: 0.42, topH: 0.5 })),
  pyramidTop:  orientFaces(prismCap({ n: 4, r: 0.7071, rot: Math.PI / 4, bodyH: 0.8, capH: 0.55 })),
  houseSquare: orientFaces(houseRoof({ w: 1, d: 0.9, wallH: 0.7, roofH: 0.55 })),
  triTent:     orientFaces(prismCap({ n: 3, r: 0.62, rot: 0, bodyH: 0.7, capH: 0.6 })),
  hexTower:    orientFaces(prismStack({ n: 6, r: 0.52, rot: 0, baseH: 0.8, topR: 0.32, topH: 0.5 })),
  hexPoint:    orientFaces(prismCap({ n: 6, r: 0.5, rot: 0, bodyH: 0.75, capH: 0.5 })),
  triStack:    orientFaces(prismStack({ n: 3, r: 0.6, rot: 0, baseH: 0.75, topR: 0.34, topH: 0.5 })),
  taperBlock:  orientFaces(frustum({ n: 4, rBot: 0.7071, rTop: 0.45, rot: Math.PI / 4, height: 1.0 })),
  hexGem:      orientFaces(frustum({ n: 6, rBot: 0.52, rTop: 0.3, rot: 0, height: 0.95 })),
  pentaTower:  orientFaces(prismStack({ n: 5, r: 0.55, rot: 0, baseH: 0.8, topR: 0.33, topH: 0.5 })),
  pentaCap:    orientFaces(prismCap({ n: 5, r: 0.55, rot: 0, bodyH: 0.75, capH: 0.5 })),
}

// Corner list for a shape: every vertex, with a stable id (index order).
export function shapeCorners(key) {
  const shape = SHAPES[key]
  if (!shape) return []
  return shape.vertices.map((pos, i) => ({ id: `c${i}`, pos }))
}

// Rotational-symmetry orbits of a shape's corners.
//
// Every shape here has its symmetry axis along Y (n-fold rotation for the
// n-gon prisms/caps, 2-fold for the ridged house). Corners in the same orbit
// are mapped onto each other by a symmetry, so a red dot on one is VISUALLY
// INDISTINGUISHABLE from a dot on another (the user can rotate one to match the
// other). The puzzle generator uses this to keep distractors out of the correct
// corner's orbit — otherwise a "wrong" option can look just as correct.
//
// Returns { cornerId: orbitId } where orbitId is the representative vertex
// index of the corner's orbit. Memoised per shape.
const _orbitCache = new Map()
export function shapeOrbits(key) {
  if (_orbitCache.has(key)) return _orbitCache.get(key)
  const shape = SHAPES[key]
  if (!shape) return {}
  const V = shape.vertices
  const n = V.length

  // Candidate rotations about Y: full turns split into m parts, m up to 12
  // (covers the 2-, 3-, 4-, 5-, 6-fold symmetries these shapes actually have).
  const candidates = new Set()
  for (const m of [1, 2, 3, 4, 5, 6, 8, 12]) {
    for (let k = 0; k < m; k++) candidates.add((2 * Math.PI * k) / m)
  }
  const rotY = (v, c, s) => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
  const matchIdx = (p) =>
    V.findIndex((w) => Math.abs(w[0] - p[0]) < 1e-3 && Math.abs(w[1] - p[1]) < 1e-3 && Math.abs(w[2] - p[2]) < 1e-3)

  // Keep only rotations that map the whole vertex set onto itself (symmetries).
  const symmetries = []
  for (const t of candidates) {
    const c = Math.cos(t)
    const s = Math.sin(t)
    if (V.every((v) => matchIdx(rotY(v, c, s)) >= 0)) symmetries.push({ c, s })
  }

  // Union corners that a symmetry maps onto each other.
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  for (const { c, s } of symmetries) {
    for (let i = 0; i < n; i++) {
      const j = matchIdx(rotY(V[i], c, s))
      if (j >= 0) parent[find(i)] = find(j)
    }
  }

  const orbit = {}
  for (let i = 0; i < n; i++) orbit[`c${i}`] = find(i)
  _orbitCache.set(key, orbit)
  return orbit
}

// BufferGeometry for a shape: each polygon face fan-triangulated, non-indexed so
// computeVertexNormals() yields flat per-face normals (coplanar faces stay
// seamless under flat shading).
export function buildShapeGeometry(key) {
  const shape = SHAPES[key]
  if (!shape) return null
  const { vertices, faces } = shape
  const out = []
  for (const f of faces) {
    for (let i = 1; i < f.length - 1; i++) {
      for (const idx of [f[0], f[i], f[i + 1]]) {
        out.push(vertices[idx][0], vertices[idx][1], vertices[idx][2])
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  geo.computeVertexNormals()
  return geo
}
