// The aircraft pictures for Instruments Orientation, as flat SVG polygons.
//
// A low-poly aircraft is built in its own frame (nose +z, right wing +x, up
// +y), rolled, pitched and yawed onto its heading, then seen from a camera
// that never moves: due south of the aircraft, a little above it, looking
// north. Faces are lit from above and sorted back to front, so the result is
// the kind of shaded silhouette the paper test draws, and it comes out the
// same every time for the same numbers. No WebGL: four of these render on a
// phone without a context each, and a test can assert on the geometry.
//
// Output coordinates are in a viewBox 100 tall and `width` wide (100 by
// default; the cards use 150, the real test's landscape frame) with the
// aircraft centred, and the horizon drawn where a level camera at this
// elevation puts it, so the ground sits under the aircraft rather than
// through it.

const DEG = Math.PI / 180

// Camera: distance from the aircraft, elevation above its level, and how many
// viewBox units one aircraft unit covers at that distance. The elevation is
// small on purpose: it shows enough of the wing tops to read the bank without
// pushing the horizon out of the picture.
const CAM_DISTANCE = 40
const CAM_ELEVATION = 4 * DEG
const CAM_SCALE = 6.4

// Light from high, ahead-left of the camera, so the two wings of a banked
// aircraft shade differently.
const LIGHT = normalise([-0.45, 1, -0.35])

function normalise(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

// ── The aircraft ─────────────────────────────────────────────────────────────
// A tapered fuselage, a canopy bump, two wing halves, two tailplane halves and
// a fin. Each part is a list of faces; a face is a list of points, wound
// anticlockwise when seen from outside. `solid` parts are closed, so a face
// whose outward normal points away from the camera is dropped; the thin flat
// parts are drawn whichever side faces the camera.

function ring(z, hw, hh, yOffset = 0) {
  return [[-hw, -hh + yOffset, z], [hw, -hh + yOffset, z], [hw, hh + yOffset, z], [-hw, hh + yOffset, z]]
}

// Quads joining two rings of four, wound so normals face outwards.
function tube(a, b) {
  const faces = []
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    faces.push([a[i], a[j], b[j], b[i]])
  }
  return faces
}

function buildParts() {
  const noseTip = ring(5.2, 0.18, 0.18, 0.05)
  const noseMid = ring(3.0, 0.5, 0.5, 0)
  const body    = ring(0.5, 0.62, 0.62, 0)
  const rear    = ring(-3.2, 0.42, 0.42, 0.05)
  const tail    = ring(-5.0, 0.22, 0.22, 0.12)
  const fuselage = [
    ...tube(noseTip, noseMid), ...tube(noseMid, body), ...tube(body, rear), ...tube(rear, tail),
    [tail[3], tail[2], tail[1], tail[0]],             // tail cap, facing -z
    [noseTip[0], noseTip[1], noseTip[2], noseTip[3]], // nose cap, facing +z
  ]

  const canopyLo = ring(2.6, 0.36, 0.05, 0.55)
  const canopyHi = ring(0.6, 0.3, 0.05, 0.9)
  const canopy = [
    ...tube(canopyLo, canopyHi),
    [canopyHi[3], canopyHi[2], canopyHi[1], canopyHi[0]],
    [canopyLo[0], canopyLo[1], canopyLo[2], canopyLo[3]],
  ]

  // Swept wings: root chord z 1.2 → -1.4, tip chord z -1.1 → -2.3 at |x| = 5.
  const wingY = -0.15
  const rightWing = [[0.55, wingY, 1.2], [5.0, wingY, -1.1], [5.0, wingY, -2.3], [0.55, wingY, -1.4]]
  const leftWing  = [[-0.55, wingY, 1.2], [-0.55, wingY, -1.4], [-5.0, wingY, -2.3], [-5.0, wingY, -1.1]]

  const tpY = 0.25
  const rightTail = [[0.35, tpY, -3.7], [2.3, tpY, -4.6], [2.3, tpY, -5.1], [0.35, tpY, -4.9]]
  const leftTail  = [[-0.35, tpY, -3.7], [-0.35, tpY, -4.9], [-2.3, tpY, -5.1], [-2.3, tpY, -4.6]]

  const fin = [[0, 0.4, -3.0], [0, 0.4, -5.0], [0, 2.5, -5.0], [0, 2.5, -4.1]]

  const skin = [0.80, 0.84, 0.88]
  return [
    { faces: fuselage, solid: true, base: skin },
    { faces: canopy, solid: true, base: [0.35, 0.55, 0.78] },
    { faces: [rightWing], solid: false, base: skin },
    { faces: [leftWing], solid: false, base: skin },
    { faces: [rightTail], solid: false, base: skin },
    { faces: [leftTail], solid: false, base: skin },
    { faces: [fin], solid: false, base: [0.72, 0.76, 0.82] },
  ]
}

const PARTS = buildParts()

// ── Attitude → world ─────────────────────────────────────────────────────────
// Roll about the nose axis, then pitch about the wing axis, then yaw onto the
// heading. Bank is positive to the right (right wing down), pitch positive
// nose up, heading clockwise from north as a compass reads it.
function rotator({ heading, pitch, bank }) {
  const cb = Math.cos(bank * DEG), sb = Math.sin(bank * DEG)
  const cp = Math.cos(pitch * DEG), sp = Math.sin(pitch * DEG)
  const ch = Math.cos(heading * DEG), sh = Math.sin(heading * DEG)
  return ([x, y, z]) => {
    // roll: right wing (1,0,0) drops for a positive bank
    const x1 = x * cb + y * sb
    const y1 = -x * sb + y * cb
    const z1 = z
    // pitch: nose (0,0,1) rises for a positive pitch
    const x2 = x1
    const y2 = y1 * cp + z1 * sp
    const z2 = -y1 * sp + z1 * cp
    // yaw: nose swings from north (+z) towards east (+x) as heading grows
    const x3 = x2 * ch + z2 * sh
    const y3 = y2
    const z3 = -x2 * sh + z2 * ch
    return [x3, y3, z3]
  }
}

// ── Camera ───────────────────────────────────────────────────────────────────
const CAM_POS = [0, CAM_DISTANCE * Math.sin(CAM_ELEVATION), -CAM_DISTANCE * Math.cos(CAM_ELEVATION)]
const CAM_FWD = [0, -Math.sin(CAM_ELEVATION), Math.cos(CAM_ELEVATION)]
const CAM_UP  = [0, Math.cos(CAM_ELEVATION), Math.sin(CAM_ELEVATION)]
const CAM_RIGHT = [1, 0, 0]

function toView(p) {
  const q = sub(p, CAM_POS)
  return [dot(q, CAM_RIGHT), dot(q, CAM_UP), dot(q, CAM_FWD)]
}

function project([vx, vy, vz], cx) {
  const k = (CAM_DISTANCE * CAM_SCALE) / vz
  return [cx + vx * k, 50 - vy * k]
}

// Where a level horizon crosses the picture: a point infinitely far along the
// camera's level line. Constant for the fixed camera.
export const HORIZON_Y = 50 - CAM_DISTANCE * CAM_SCALE * Math.tan(CAM_ELEVATION)

function shade(base, normal) {
  const lit = 0.5 + 0.5 * Math.max(0, dot(normal, LIGHT))
  const c = base.map(v => Math.round(255 * Math.min(1, v * (0.45 + 0.65 * lit))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// The polygons to draw, back to front, each `{ points: [[x, y], …], fill }`.
export function aircraftPolygons(attitude, { width = 100 } = {}) {
  const cx = width / 2
  const rotate = rotator(attitude)
  const out = []
  for (const part of PARTS) {
    for (const face of part.faces) {
      const world = face.map(rotate)
      const view = world.map(toView)
      let normal = normalise(cross(sub(world[1], world[0]), sub(world[2], world[0])))
      // Camera → face centre, in world space.
      const centre = world
        .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
        .map(v => v / world.length)
      const toCam = normalise(sub(CAM_POS, centre))
      const facing = dot(normal, toCam)
      if (part.solid && facing <= 0) continue
      if (!part.solid && facing < 0) normal = normal.map(v => -v)
      const depth = view.reduce((s, v) => s + v[2], 0) / view.length
      out.push({ points: view.map(v => project(v, cx)), fill: shade(part.base, normal), depth })
    }
  }
  out.sort((a, b) => b.depth - a.depth)
  return out.map(({ points, fill }) => ({ points, fill }))
}

export function polygonPoints(points) {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
}
