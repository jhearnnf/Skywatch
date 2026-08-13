// Derives the /immerse collision shapes from the hangar model's real geometry
// and prints the body of src/components/world3d/data/sceneColliders.js.
//
//   node scripts/gen-scene-colliders.mjs [models-src/scene.glb]
//
// Needs the UNCOMPRESSED source model. models-src/ is gitignored (the shipped
// public/models/scene.glb is Draco-compressed and cannot be read without a
// decoder), so this cannot be re-run from a fresh clone — which is exactly why
// its output is committed rather than generated at build time.
//
// How it works:
//   1. Rasterise every triangle onto a CELL-unit X-Z grid, keeping only the
//      slab between the player's ankles and the top of their head. Anything
//      wholly above that (roof trusses, glazing, lamps, high wingtips) is not
//      solid and must not become a collider.
//   2. Split the result into connected components per mesh node, and accept the
//      ones that a disc explains better than a box as circle colliders — the
//      hangar is full of tyres, drums and cable reels, and a box around a tyre
//      denies the player four corners of floor that hold nothing.
//   3. Cover whatever is left with a greedy maximal-rectangle pass, refusing any
//      rectangle that is less than FILL_MIN solid, so the boxes hug the art.

import fs from 'node:fs'

const FILE = process.argv[2] ?? 'models-src/scene.glb'
const CELL = 0.1
// Player is 2.6 world units tall and one model unit is ~1.675 world units, so
// their head is at ~1.55 model units. Start just above the floor so tiles and
// painted markings do not register as obstacles.
const BAND_LO = 0.12
const BAND_HI = 1.5
// Lowest fraction of a rectangle that may be empty floor. Higher = tighter
// colliders but more of them.
const FILL_MIN = 0.92

// ---------------------------------------------------------------- glb reading

const buf = fs.readFileSync(FILE)
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${FILE} is not a .glb`)
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'))
const binStart = 20 + jsonLen
const BIN = buf.slice(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart))
if (json.extensionsRequired?.includes('KHR_draco_mesh_compression')) {
  throw new Error('model is Draco-compressed; point this at models-src/, not public/models/')
}

const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                   a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return o
}
function fromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  const [sx, sy, sz] = s
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ]
}
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const READ = {
  5120: (o) => BIN.readInt8(o), 5121: (o) => BIN.readUInt8(o),
  5122: (o) => BIN.readInt16LE(o), 5123: (o) => BIN.readUInt16LE(o),
  5125: (o) => BIN.readUInt32LE(o), 5126: (o) => BIN.readFloatLE(o),
}
function readAccessor(i) {
  const acc = json.accessors[i]
  const n = NUM[acc.type]
  const csz = SIZE[acc.componentType]
  const read = READ[acc.componentType]
  const out = new Float64Array(acc.count * n)
  if (acc.bufferView === undefined) return out
  const bv = json.bufferViews[acc.bufferView]
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const stride = bv.byteStride ?? n * csz
  for (let e = 0; e < acc.count; e++) {
    for (let c = 0; c < n; c++) out[e * n + c] = read(base + e * stride + c * csz)
  }
  return out
}
const xf = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

// ------------------------------------------------------------ rasterise nodes

const SHELL = /^Hangar_part/
const perNode = new Map()

function walk(idx, parent) {
  const n = json.nodes[idx]
  const world = mul(parent, n.matrix ? n.matrix.slice() : fromTRS(n.translation, n.rotation, n.scale))
  const name = n.name || `node${idx}`

  if (n.mesh !== undefined && !SHELL.test(name)) {
    const cells = perNode.get(name) ?? new Set()
    perNode.set(name, cells)
    for (const prim of json.meshes[n.mesh].primitives ?? []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue
      if (prim.attributes?.POSITION === undefined) continue
      const pos = readAccessor(prim.attributes.POSITION)
      const idxArr = prim.indices !== undefined
        ? readAccessor(prim.indices)
        : Float64Array.from({ length: pos.length / 3 }, (_, i) => i)

      for (let t = 0; t + 2 < idxArr.length; t += 3) {
        const p = []
        for (let k = 0; k < 3; k++) {
          const v = idxArr[t + k] * 3
          p.push(xf(world, pos[v], pos[v + 1], pos[v + 2]))
        }
        const ys = [p[0][1], p[1][1], p[2][1]]
        if (Math.max(...ys) < BAND_LO || Math.min(...ys) > BAND_HI) continue
        // Sample the triangle densely enough that a single large quad spanning
        // the band still paints every cell it crosses.
        const d = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
        const longest = Math.max(d(p[0], p[1]), d(p[1], p[2]), d(p[2], p[0]))
        const steps = Math.max(1, Math.min(96, Math.ceil(longest / (CELL * 0.5))))
        for (let a = 0; a <= steps; a++) {
          for (let b = 0; a + b <= steps; b++) {
            const u = a / steps, v = b / steps, w = 1 - u - v
            const y = p[0][1] * w + p[1][1] * u + p[2][1] * v
            if (y < BAND_LO || y > BAND_HI) continue
            const x = p[0][0] * w + p[1][0] * u + p[2][0] * v
            const z = p[0][2] * w + p[1][2] * u + p[2][2] * v
            cells.add(Math.floor(x / CELL) + ',' + Math.floor(z / CELL))
          }
        }
      }
    }
  }
  for (const c of n.children ?? []) walk(c, world)
}
for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, ident())

// ------------------------------------------------------------------- clustering

function components(set) {
  const seen = new Set()
  const out = []
  for (const k of set) {
    if (seen.has(k)) continue
    const stack = [k]; seen.add(k)
    const comp = []
    while (stack.length) {
      const cur = stack.pop(); comp.push(cur)
      const [x, z] = cur.split(',').map(Number)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const nk = (x + dx) + ',' + (z + dz)
        if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk) }
      }
    }
    out.push(comp)
  }
  return out
}

// A disc is accepted when it overlaps the component better than a box does. The
// radius is swept rather than derived from the area: a tyre with a bracket
// hanging off it has more area than its disc, and the equal-area radius would
// then sit inside the tyre and leave its rim exposed. Best IoU wins.
function tryCircle(comp, solid) {
  if (comp.length < 12) return null
  const pts = comp.map(k => k.split(',').map(Number))
  const cx = pts.reduce((s, p) => s + p[0] + 0.5, 0) / pts.length
  const cz = pts.reduce((s, p) => s + p[1] + 0.5, 0) / pts.length
  const rMax = Math.max(...pts.map(p => Math.hypot(p[0] + 0.5 - cx, p[1] + 0.5 - cz)))
  const own = new Set(comp)

  let best = null
  for (let r = rMax * 0.5; r <= rMax * 1.02; r += 0.1) {
    let discCells = 0, discSolid = 0, inDisc = 0
    const R = Math.ceil(r) + 1
    for (let i = Math.floor(cx - R); i <= Math.ceil(cx + R); i++) {
      for (let j = Math.floor(cz - R); j <= Math.ceil(cz + R); j++) {
        if (Math.hypot(i + 0.5 - cx, j + 0.5 - cz) > r) continue
        discCells++
        const k = i + ',' + j
        if (solid.has(k)) discSolid++
        if (own.has(k)) inDisc++
      }
    }
    if (!discCells) continue
    // union counts the component plus the part of the disc outside it
    const iou = inDisc / (comp.length + discCells - inDisc)
    const precision = discSolid / discCells
    if (!best || iou > best.iou) best = { r, iou, precision, recall: inDisc / comp.length }
  }
  // A real disc scores ~0.9; a lumpy blob like the airframe scores ~0.6, and
  // must fall through to rectangles rather than becoming one huge circle.
  if (!best || best.iou < 0.72 || best.precision < 0.8) return null

  // Then take whichever primitive explains the component better. Judging a disc
  // by how full its bounding box is does not work — a perfect disc fills pi/4 of
  // its box, and coarse cells push small ones well above that — but a solid
  // square scores 1.0 as a box against 0.79 as a circle, so comparing the two
  // fits directly separates them cleanly.
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1])
  const boxArea = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...zs) - Math.min(...zs) + 1)
  const boxIou = comp.length / boxArea
  if (best.iou <= boxIou * 1.02) return null

  return { ...best, x: cx * CELL, z: cz * CELL, r: best.r * CELL }
}

// Greedy maximal-rectangle cover. Rectangles may only be placed where the grid
// is at least FILL_MIN solid, and each pass takes the one covering the most
// still-uncovered cells.
function rectCover(comp) {
  const pts = comp.map(k => k.split(',').map(Number))
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])) + 1
  const z0 = Math.min(...pts.map(p => p[1])), z1 = Math.max(...pts.map(p => p[1])) + 1
  const W = x1 - x0, H = z1 - z0
  const solid = new Uint8Array(W * H)
  for (const [x, z] of pts) solid[(x - x0) * H + (z - z0)] = 1
  const uncov = solid.slice()

  const psum = (arr) => {
    const p = new Int32Array((W + 1) * (H + 1))
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
      p[(i + 1) * (H + 1) + j + 1] = arr[i * H + j] +
        p[i * (H + 1) + j + 1] + p[(i + 1) * (H + 1) + j] - p[i * (H + 1) + j]
    }
    return p
  }
  const box = (p, a, b, c, d) =>
    p[c * (H + 1) + d] - p[a * (H + 1) + d] - p[c * (H + 1) + b] + p[a * (H + 1) + b]

  const solidP = psum(solid)
  const out = []
  let remaining = pts.length
  while (remaining > 0) {
    const uncovP = psum(uncov)
    let best = null
    for (let a = 0; a < W; a++) for (let c = a + 1; c <= W; c++) {
      for (let b = 0; b < H; b++) for (let d = b + 1; d <= H; d++) {
        const u = box(uncovP, a, b, c, d)
        if (u === 0) continue
        const area = (c - a) * (d - b)
        if (box(solidP, a, b, c, d) / area < FILL_MIN) continue
        if (!best || u > best.u || (u === best.u && area > best.area)) best = { a, b, c, d, u, area }
      }
    }
    if (!best) break
    for (let i = best.a; i < best.c; i++) for (let j = best.b; j < best.d; j++) {
      if (uncov[i * H + j]) { uncov[i * H + j] = 0; remaining-- }
    }
    out.push({
      minX: (x0 + best.a) * CELL, maxX: (x0 + best.c) * CELL,
      minZ: (z0 + best.b) * CELL, maxZ: (z0 + best.d) * CELL,
    })
  }
  return out
}

// ----------------------------------------------------------------------- run

const solidAll = new Set()
for (const cells of perNode.values()) for (const k of cells) solidAll.add(k)

// Pass 1: circles, per node so coincident duplicate meshes do not merge props.
let circles = []
for (const [name, cells] of perNode) {
  for (const comp of components(cells)) {
    const c = tryCircle(comp, solidAll)
    if (!c) continue
    // Two meshes sharing one prop (different materials) yield the same disc.
    if (circles.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 0.15 && Math.abs(o.r - c.r) < 0.15)) continue
    circles.push({ ...c, node: name })
  }
}

// Pass 2: rectangles over everything no circle actually contains. Claiming a
// whole component would leave the bits poking out of its disc uncovered.
const inCircleCell = (i, j) =>
  circles.some(c => Math.hypot((i + 0.5) * CELL - c.x, (j + 0.5) * CELL - c.z) <= c.r)
const leftover = new Set(
  [...solidAll].filter(k => {
    const [i, j] = k.split(',').map(Number)
    return !inCircleCell(i, j)
  }),
)
const rects = []
for (const comp of components(leftover)) {
  // Slivers left around a fitted disc are far narrower than the player and
  // would only add confetti colliders nobody can touch.
  if (comp.length < 10) continue
  for (const r of rectCover(comp)) rects.push(r)
}

// Pass 3: drop discs a rectangle already swallows whole. The aircraft's wheels
// fit their own tidy circles, but they sit under the airframe, whose footprint
// is solid at walking height anyway — so those circles deny nothing that is not
// already denied, and are pure cost every frame.
circles = circles.filter(c => !rects.some(r =>
  c.x - c.r >= r.minX && c.x + c.r <= r.maxX &&
  c.z - c.r >= r.minZ && c.z + c.r <= r.maxZ))

// ------------------------------------------------------------------- reporting

const inCircle = (x, z) => circles.some(c => Math.hypot(x - c.x, z - c.z) <= c.r)
const inRect = (x, z) => rects.some(r => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ)

// Raw over-coverage overstates how big the colliders feel: the player is a disc
// of radius 0.269 model units, so floor within that distance of real geometry
// was never standable anyway. What actually reads as an invisible wall is
// collider over open floor the player could otherwise have occupied.
const PLAYER_R = 0.45 / (67 / 40.000005)
const reach = Math.ceil(PLAYER_R / CELL)
function nearSolid(i, j) {
  for (let a = -reach; a <= reach; a++) {
    for (let b = -reach; b <= reach; b++) {
      if (Math.hypot(a, b) * CELL > PLAYER_R) continue
      if (solidAll.has((i + a) + ',' + (j + b))) return true
    }
  }
  return false
}

let covered = 0, missed = 0, over = 0, overReachable = 0
for (let i = Math.floor(-13 / CELL); i < Math.ceil(12.5 / CELL); i++) {
  for (let j = Math.floor(-10.5 / CELL); j < Math.ceil(10 / CELL); j++) {
    const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL
    const s = solidAll.has(i + ',' + j)
    const c = inCircle(x, z) || inRect(x, z)
    if (s && c) covered++
    else if (s) missed++
    else if (c) { over++; if (!nearSolid(i, j)) overReachable++ }
  }
}
const solidTotal = covered + missed
const shapeArea = covered + over
console.error(`cell ${CELL}  band ${BAND_LO}..${BAND_HI}  fillMin ${FILL_MIN}`)
console.error(`shapes: ${circles.length} circles + ${rects.length} rects`)
console.error(`geometry covered : ${(covered / solidTotal * 100).toFixed(1)}%  (${missed} cells missed)`)
console.error(`over-coverage    : ${(over / shapeArea * 100).toFixed(1)}% raw, ` +
              `${(overReachable / shapeArea * 100).toFixed(1)}% on floor the player could reach`)

// --------------------------------------------------------------------- output

const r2 = (n) => Number(n.toFixed(2))
const area = (r) => (r.maxX - r.minX) * (r.maxZ - r.minZ)
console.log(`// GENERATED by scripts/gen-scene-colliders.mjs — do not edit by hand.
//
// Collision shapes for public/models/scene.glb, in the MODEL's own units (one is
// ~1.675 world units). Derived from the mesh itself: every triangle between
// y=${BAND_LO} and y=${BAND_HI} — the slab from the player's ankles to the top of their
// head — rasterised onto a ${CELL}-unit grid, then fitted with discs where the art is
// round and covered with rectangles that are at least ${Math.round(FILL_MIN * 100)}% solid everywhere else.
//
// Covers ${(covered / solidTotal * 100).toFixed(1)}% of that geometry. ${(overReachable / shapeArea * 100).toFixed(1)}% of the shapes' area falls on open
// floor further than a player-radius from anything solid — i.e. floor that is
// genuinely walkable and wrongly denied. Re-run the script to regenerate.

export const PROP_CIRCLES = [`)
for (const c of circles.sort((a, b) => b.r - a.r)) {
  console.log(`  { x: ${r2(c.x)}, z: ${r2(c.z)}, r: ${r2(c.r)} }, // ${c.node}`)
}
console.log(']\n\nexport const PROP_BOXES = [')
for (const r of rects.sort((a, b) => area(b) - area(a))) {
  console.log(`  { minX: ${r2(r.minX)}, maxX: ${r2(r.maxX)}, minZ: ${r2(r.minZ)}, maxZ: ${r2(r.maxZ)} },`)
}
console.log(']')
