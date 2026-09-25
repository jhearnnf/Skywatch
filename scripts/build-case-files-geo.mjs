#!/usr/bin/env node
/**
 * Builds src/data/caseFiles/theatreGeo.json — the country outlines the Case
 * Files tactical map draws. Run once when the covered region changes; the
 * output is committed, so nothing here runs at build or play time.
 *
 *   npm i --no-save world-atlas@2 topojson-client@3   (or install them in any
 *   folder and pass --from <that folder>)
 *   node scripts/build-case-files-geo.mjs [--from <dir with node_modules>]
 *
 * Source: Natural Earth 1:50m admin-0 countries, via the world-atlas package
 * (public domain). Every country is clipped to THEATRE_BBOX, simplified, and
 * rounded to 0.01° (about 1km) so the whole region ships in a few dozen KB.
 */

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const fromArg = process.argv.indexOf('--from')
const base    = fromArg > -1 ? path.resolve(process.argv[fromArg + 1]) : process.cwd()
const require = createRequire(path.join(base, 'package.json'))
const topojson = require('topojson-client')
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'))

// Europe, the Middle East and western Russia: every theatre a case covers.
const THEATRE_BBOX = { west: -25, east: 100, south: 12, north: 75 }
const TOLERANCE    = 0.04   // degrees, Douglas-Peucker
const MIN_RING_AREA = 0.02  // square degrees; drops specks of island

// ── Clipping (Sutherland–Hodgman against the bbox) ──────────────────────────
function clipRing(ring, b) {
  const edges = [
    (p) => p[0] >= b.west,  (p) => p[0] <= b.east,
    (p) => p[1] >= b.south, (p) => p[1] <= b.north,
  ]
  const cut = [
    (a, c) => lerpX(a, c, b.west), (a, c) => lerpX(a, c, b.east),
    (a, c) => lerpY(a, c, b.south), (a, c) => lerpY(a, c, b.north),
  ]
  let out = ring
  for (let e = 0; e < 4 && out.length; e++) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur  = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      const inCur = edges[e](cur), inPrev = edges[e](prev)
      if (inCur) {
        if (!inPrev) out.push(cut[e](prev, cur))
        out.push(cur)
      } else if (inPrev) {
        out.push(cut[e](prev, cur))
      }
    }
  }
  return out
}
function lerpX(a, c, x) { const t = (x - a[0]) / (c[0] - a[0]); return [x, a[1] + t * (c[1] - a[1])] }
function lerpY(a, c, y) { const t = (y - a[1]) / (c[1] - a[1]); return [a[0] + t * (c[0] - a[0]), y] }

// ── Simplification (Douglas–Peucker) ────────────────────────────────────────
function simplify(pts, tol) {
  if (pts.length < 4) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tol && idx > -1) { keep[idx] = 1; stack.push([s, idx], [idx, e]) }
  }
  return pts.filter((_, i) => keep[i])
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1]
  return Math.sqrt(x * x + y * y)
}

function area(ring) {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  return Math.abs(s / 2)
}
function inside(p, ring) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
function edgeDist(p, ring) {
  let m = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) m = Math.min(m, segDist(p, ring[j], ring[i]))
  return m
}

// A label point well inside the country's biggest piece: the grid point
// furthest from any edge. A centroid falls outside a crescent-shaped country.
function labelPoint(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  let best = null, bestD = -1
  const N = 24
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = [minX + ((maxX - minX) * i) / N, minY + ((maxY - minY) * j) / N]
    if (!inside(p, ring)) continue
    const d = edgeDist(p, ring)
    if (d > bestD) { bestD = d; best = p }
  }
  return best ?? ring[0]
}

const round = (n) => Math.round(n * 100) / 100

const countries = []
for (const f of topojson.feature(topo, topo.objects.countries).features) {
  const g = f.geometry
  if (!g) continue
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  const outPolys = []
  let biggest = null, biggestArea = 0
  for (const poly of polys) {
    const rings = []
    for (let r = 0; r < poly.length; r++) {
      let ring = poly[r].slice(0, -1)
      ring = clipRing(ring, THEATRE_BBOX)
      if (ring.length < 3) continue
      ring = simplify([...ring, ring[0]], TOLERANCE).slice(0, -1)
      if (ring.length < 3) continue
      const a = area(ring)
      if (r === 0 && a < MIN_RING_AREA) break   // speck of island: drop the whole piece
      if (r > 0 && a < MIN_RING_AREA) continue
      rings.push(ring)
      if (r === 0 && a > biggestArea) { biggestArea = a; biggest = ring }
    }
    if (rings.length) outPolys.push(rings)
  }
  if (!outPolys.length) continue
  const lp = labelPoint(biggest)
  countries.push({
    id:    String(f.id ?? f.properties?.name),
    name:  f.properties?.name ?? '',
    label: [round(lp[0]), round(lp[1])],
    area:  Math.round(biggestArea),
    // Flat [lng, lat, lng, lat, …] per ring: about half the size of pairs.
    polys: outPolys.map((rings) => rings.map((ring) => ring.flatMap(([x, y]) => [round(x), round(y)]))),
  })
}

// Crimea is drawn as part of Ukraine: the internationally recognised border,
// and the UK's position. Natural Earth's default dataset shows the de facto
// line and puts it inside Russia, so move that piece across.
const CRIMEA_POINT = [34.1, 44.95]
const russia  = countries.find((c) => c.name === 'Russia')
const ukraine = countries.find((c) => c.name === 'Ukraine')
if (russia && ukraine) {
  const pairs = (flat) => flat.reduce((acc, v, i) => (i % 2 ? acc[acc.length - 1].push(v) : acc.push([v]), acc), [])
  const idx = russia.polys.findIndex((rings) => inside(CRIMEA_POINT, pairs(rings[0])))
  if (idx > -1) {
    ukraine.polys.push(...russia.polys.splice(idx, 1))
    console.log('Moved Crimea from Russia to Ukraine')
  }
}

countries.sort((a, b) => b.area - a.area)

const out = path.resolve('src/data/caseFiles/theatreGeo.json')
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ source: 'Natural Earth 1:50m via world-atlas', bbox: THEATRE_BBOX, countries }))
console.log(`${countries.length} countries -> ${out} (${(readFileSync(out).length / 1024).toFixed(1)} KB)`)
