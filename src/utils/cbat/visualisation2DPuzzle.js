// CBAT Visualisation 2D — puzzle generator
//
// Each round shows N=3 or 4 regular polygon "pieces" with letter-labelled
// edges. Two edges sharing a letter weld to each other in the final shape.
// User picks the correct welded composite from 6 choices (1 correct + 5
// distractors).
//
// All shapes use unit edges so any edge can weld to any edge.

export const EDGE_LEN = 50

// Available shape primitives — regular polygons with unit edges.
export const SHAPES = {
  triangle: { sides: 3, label: 'Triangle' },
  square:   { sides: 4, label: 'Square' },
  pentagon: { sides: 5, label: 'Pentagon' },
  hexagon:  { sides: 6, label: 'Hexagon' },
}
export const SHAPE_KEYS = Object.keys(SHAPES)

// Compute regular polygon vertices, centroid at origin, vertex 0 at the top.
// SVG coords (y-down).
export function regularPolygonVertices(sides, edgeLen = EDGE_LEN) {
  const R = edgeLen / (2 * Math.sin(Math.PI / sides))
  const verts = []
  for (let i = 0; i < sides; i++) {
    const angle = Math.PI / 2 - (2 * Math.PI * i) / sides
    verts.push({ x: R * Math.cos(angle), y: -R * Math.sin(angle) })
  }
  return verts
}

// Apply 2D rotation about origin (radians).
export function rotateVerts(verts, theta) {
  const c = Math.cos(theta), s = Math.sin(theta)
  return verts.map(v => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c }))
}

// Build a rigid transform that maps b1 → a2 and b2 → a1 (so the edge b1-b2
// coincides with a1-a2 but anti-parallel — placing piece B on the opposite
// side of A's edge from A).
function weldTransform(a1, a2, b1, b2) {
  const angleA = Math.atan2(a1.y - a2.y, a1.x - a2.x)
  const angleB = Math.atan2(b2.y - b1.y, b2.x - b1.x)
  const rot = angleA - angleB
  const c = Math.cos(rot), s = Math.sin(rot)
  return (p) => {
    const dx = p.x - b1.x
    const dy = p.y - b1.y
    return {
      x: a2.x + dx * c - dy * s,
      y: a2.y + dx * s + dy * c,
    }
  }
}

// Place all shapes by BFS from shape 0, welding children to their parent.
// Returns [{ key, vertices, weldedEdges: Set<edgeIdx> }, ...]
export function layoutComposite(shapes, welds) {
  const verts = shapes.map(s => regularPolygonVertices(SHAPES[s.key].sides))
  const placed = new Array(shapes.length).fill(false)
  placed[0] = true

  const adj = shapes.map(() => [])
  welds.forEach(w => {
    adj[w.shapeAIdx].push({ neighbor: w.shapeBIdx, myEdge: w.edgeA, theirEdge: w.edgeB })
    adj[w.shapeBIdx].push({ neighbor: w.shapeAIdx, myEdge: w.edgeB, theirEdge: w.edgeA })
  })

  const queue = [0]
  while (queue.length) {
    const cur = queue.shift()
    for (const { neighbor, myEdge, theirEdge } of adj[cur]) {
      if (placed[neighbor]) continue
      const sCur = SHAPES[shapes[cur].key].sides
      const sNb  = SHAPES[shapes[neighbor].key].sides
      const a1 = verts[cur][myEdge]
      const a2 = verts[cur][(myEdge + 1) % sCur]
      const b1 = verts[neighbor][theirEdge]
      const b2 = verts[neighbor][(theirEdge + 1) % sNb]
      const T = weldTransform(a1, a2, b1, b2)
      verts[neighbor] = verts[neighbor].map(T)
      placed[neighbor] = true
      queue.push(neighbor)
    }
  }

  const weldedEdges = shapes.map(() => new Set())
  welds.forEach(w => {
    weldedEdges[w.shapeAIdx].add(w.edgeA)
    weldedEdges[w.shapeBIdx].add(w.edgeB)
  })

  return shapes.map((s, i) => ({
    key: s.key,
    vertices: verts[i],
    weldedEdges: weldedEdges[i],
  }))
}

// Translation-invariant key for comparing two composites — used to dedupe
// distractors against the correct answer and against each other.
export function compositeKey(layout) {
  const all = layout.flatMap(p => p.vertices)
  if (!all.length) return ''
  const minX = Math.min(...all.map(v => v.x))
  const minY = Math.min(...all.map(v => v.y))
  return all.map(v => `${Math.round(v.x - minX)},${Math.round(v.y - minY)}`)
    .sort()
    .join('|')
}

// ── Overlap detection ───────────────────────────────────────────────────────
// Used to reject layouts (correct or distractor) whose pieces visibly overlap
// each other. Welded pairs share an edge by construction so their vertices
// coincide along that edge — pointOnSegment returns true on the boundary so
// shared-edge vertices are NOT flagged as "strictly inside".

const OVERLAP_EPS = 1e-3

function pointOnSegment(p, a, b, eps = OVERLAP_EPS) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < eps) return Math.hypot(p.x - a.x, p.y - a.y) < eps
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx
  if (Math.abs(cross) > eps * len) return false
  const dot = (p.x - a.x) * dx + (p.y - a.y) * dy
  return dot >= -eps && dot <= len * len + eps
}

function pointStrictlyInsidePolygon(p, verts) {
  const n = verts.length
  for (let i = 0; i < n; i++) {
    if (pointOnSegment(p, verts[i], verts[(i + 1) % n])) return false
  }
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = verts[i].x, yi = verts[i].y
    const xj = verts[j].x, yj = verts[j].y
    const hit = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)
    if (hit) inside = !inside
  }
  return inside
}

function segmentsProperlyCross(a1, a2, b1, b2) {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x)
  if (Math.abs(d) < 1e-9) return false
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d
  const s = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d
  // Strictly interior on both segments — endpoint kisses (welded edges) are fine.
  const m = 1e-4
  return t > m && t < 1 - m && s > m && s < 1 - m
}

export function polygonsOverlap(va, vb) {
  for (const v of va) if (pointStrictlyInsidePolygon(v, vb)) return true
  for (const v of vb) if (pointStrictlyInsidePolygon(v, va)) return true
  const nA = va.length, nB = vb.length
  for (let i = 0; i < nA; i++) {
    const a1 = va[i], a2 = va[(i + 1) % nA]
    for (let j = 0; j < nB; j++) {
      const b1 = vb[j], b2 = vb[(j + 1) % nB]
      if (segmentsProperlyCross(a1, a2, b1, b2)) return true
    }
  }
  return false
}

export function compositeHasOverlap(layout) {
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      if (polygonsOverlap(layout[i].vertices, layout[j].vertices)) return true
    }
  }
  return false
}

// Bounding box of a laid-out composite.
export function bbox(layout) {
  const all = layout.flatMap(p => p.vertices)
  if (!all.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return {
    minX: Math.min(...all.map(v => v.x)),
    minY: Math.min(...all.map(v => v.y)),
    maxX: Math.max(...all.map(v => v.x)),
    maxY: Math.max(...all.map(v => v.y)),
  }
}

// Return random integer in [0, n).
function rint(n) { return Math.floor(Math.random() * n) }

// Random spanning tree of N shapes — each new shape attaches to a randomly
// chosen already-placed shape via random unused edges on each side.
function buildWeldTree(shapes) {
  const welds = []
  const placed = [0]
  const remaining = []
  for (let i = 1; i < shapes.length; i++) remaining.push(i)
  while (remaining.length) {
    const childIdx = remaining.shift()
    const parentIdx = placed[rint(placed.length)]
    const usedParent = new Set(welds.flatMap(w =>
      w.shapeAIdx === parentIdx ? [w.edgeA] : w.shapeBIdx === parentIdx ? [w.edgeB] : []
    ))
    const usedChild = new Set(welds.flatMap(w =>
      w.shapeAIdx === childIdx ? [w.edgeA] : w.shapeBIdx === childIdx ? [w.edgeB] : []
    ))
    const sParent = SHAPES[shapes[parentIdx].key].sides
    const sChild  = SHAPES[shapes[childIdx].key].sides
    const availP = []
    for (let e = 0; e < sParent; e++) if (!usedParent.has(e)) availP.push(e)
    const availC = []
    for (let e = 0; e < sChild;  e++) if (!usedChild.has(e))  availC.push(e)
    if (!availP.length || !availC.length) return null
    welds.push({
      shapeAIdx: parentIdx,
      shapeBIdx: childIdx,
      edgeA: availP[rint(availP.length)],
      edgeB: availC[rint(availC.length)],
      letter: String.fromCharCode(65 + welds.length),
    })
    placed.push(childIdx)
  }
  return welds
}

// Mutation strategies for distractors.
function mutateWrongEdge(shapes, welds) {
  const newWelds = welds.map(w => ({ ...w }))
  const wIdx = rint(newWelds.length)
  const w = newWelds[wIdx]
  const side = Math.random() < 0.5 ? 'edgeA' : 'edgeB'
  const shapeIdx = side === 'edgeA' ? w.shapeAIdx : w.shapeBIdx
  const sides = SHAPES[shapes[shapeIdx].key].sides
  // Avoid edges already used by other welds on that shape, when possible.
  const usedOther = new Set(newWelds.flatMap((ww, i) =>
    i === wIdx ? [] :
    ww.shapeAIdx === shapeIdx ? [ww.edgeA] :
    ww.shapeBIdx === shapeIdx ? [ww.edgeB] : []
  ))
  const candidates = []
  for (let e = 0; e < sides; e++) if (e !== w[side] && !usedOther.has(e)) candidates.push(e)
  if (!candidates.length) return null
  newWelds[wIdx] = { ...w, [side]: candidates[rint(candidates.length)] }
  return { shapes, welds: newWelds }
}

function mutateShapeSwap(shapes, welds) {
  const newShapes = shapes.map(s => ({ ...s }))
  const sIdx = rint(newShapes.length)
  const cur = newShapes[sIdx].key
  const alts = SHAPE_KEYS.filter(k => k !== cur)
  newShapes[sIdx] = { key: alts[rint(alts.length)] }
  const newSides = SHAPES[newShapes[sIdx].key].sides
  const newWelds = welds.map(w => {
    if (w.shapeAIdx === sIdx) return { ...w, edgeA: w.edgeA % newSides }
    if (w.shapeBIdx === sIdx) return { ...w, edgeB: w.edgeB % newSides }
    return { ...w }
  })
  return { shapes: newShapes, welds: newWelds }
}

function mutateLetterSwap(shapes, welds) {
  if (welds.length < 2) return null
  const newWelds = welds.map(w => ({ ...w }))
  const i = rint(newWelds.length)
  let j; do { j = rint(newWelds.length) } while (j === i)
  // Find a shape shared between the two welds.
  const setI = new Set([newWelds[i].shapeAIdx, newWelds[i].shapeBIdx])
  const sharedShape = [newWelds[j].shapeAIdx, newWelds[j].shapeBIdx].find(s => setI.has(s))
  if (sharedShape === undefined) return null
  const get = (w) => w.shapeAIdx === sharedShape ? w.edgeA : w.edgeB
  const set = (w, v) => {
    if (w.shapeAIdx === sharedShape) w.edgeA = v
    else w.edgeB = v
  }
  const ei = get(newWelds[i])
  const ej = get(newWelds[j])
  set(newWelds[i], ej)
  set(newWelds[j], ei)
  return { shapes, welds: newWelds }
}

function mutateRetopologise(shapes, welds) {
  // Rebuild a fresh random weld tree with the same shape set.
  const fresh = buildWeldTree(shapes)
  return fresh ? { shapes, welds: fresh } : null
}

const STRATEGIES = [mutateWrongEdge, mutateShapeSwap, mutateLetterSwap, mutateRetopologise]

function tryGenerateDistractor(shapes, welds, blockedKeys) {
  const order = [...STRATEGIES].sort(() => Math.random() - 0.5)
  for (const fn of order) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const m = fn(shapes, welds)
      if (!m) continue
      let layout
      try { layout = layoutComposite(m.shapes, m.welds) } catch { continue }
      if (compositeHasOverlap(layout)) continue
      const key = compositeKey(layout)
      if (!blockedKeys.has(key)) return { layout, key }
    }
  }
  return null
}

// Build one round.
//   roundIdx: 0..7
//   - rounds 0–1 (1–2 shown to user): 3 shapes, no rotation
//   - rounds 2–3: 4 shapes, no rotation
//   - rounds 4–7: 4 shapes, prompt shapes randomly rotated
export function buildRound(roundIdx) {
  const numShapes = roundIdx < 2 ? 3 : 4
  const allowRotation = roundIdx >= 4
  // Tier 0 = unrotated (rounds 0–3), Tier 1 = rotated (rounds 4–7).
  const tier = allowRotation ? 1 : 0

  for (let attempt = 0; attempt < 30; attempt++) {
    const shapes = []
    for (let i = 0; i < numShapes; i++) {
      shapes.push({ key: SHAPE_KEYS[rint(SHAPE_KEYS.length)] })
    }
    const welds = buildWeldTree(shapes)
    if (!welds) continue

    let correctLayout
    try { correctLayout = layoutComposite(shapes, welds) } catch { continue }
    // Reject configurations whose correct answer has self-overlapping pieces.
    if (compositeHasOverlap(correctLayout)) continue
    const correctKey = compositeKey(correctLayout)
    const blocked = new Set([correctKey])

    const distractors = []
    let stuck = 0
    while (distractors.length < 5 && stuck < 40) {
      const d = tryGenerateDistractor(shapes, welds, blocked)
      if (d) {
        distractors.push(d.layout)
        blocked.add(d.key)
        stuck = 0
      } else {
        stuck++
      }
    }
    if (distractors.length < 5) continue

    const promptRotations = allowRotation
      ? shapes.map(() => (rint(11) + 1) * 30 * Math.PI / 180) // 30°..330°
      : shapes.map(() => 0)

    const allChoices = [
      { layout: correctLayout, isCorrect: true },
      ...distractors.map(l => ({ layout: l, isCorrect: false })),
    ]
    // Fisher-Yates shuffle
    for (let i = allChoices.length - 1; i > 0; i--) {
      const j = rint(i + 1);
      [allChoices[i], allChoices[j]] = [allChoices[j], allChoices[i]]
    }
    const correctIdx = allChoices.findIndex(c => c.isCorrect)

    return {
      shapes,
      welds,
      promptRotations,
      choices: allChoices,
      correctIdx,
      tier,
    }
  }
  // Fallback — extremely unlikely to hit.
  return null
}

export function buildRounds(total = 8) {
  const out = []
  for (let i = 0; i < total; i++) {
    let r = null
    let safety = 0
    while (!r && safety < 5) { r = buildRound(i); safety++ }
    out.push(r)
  }
  return out
}
