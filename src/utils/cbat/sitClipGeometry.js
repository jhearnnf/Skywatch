// Placing the Spatial Integration Test's objects in the 3D clip.
//
// Two pure functions, kept out of the scene component so they can be tested
// without standing up WebGL. Both are the kind of thing that fails silently:
// a sign error here mirrors the whole scene or every flight path in it, and the
// only symptom is that half the questions become unanswerable — which reads as
// the test being hard rather than broken.
//
// See components/cbat/SitClipScene.jsx for the renderer that uses them.

// One grid cell is 2 world units, so a 6×6 board spans −6..+6 either way and the
// scene is centred on the origin whatever the grid size.
export const CELL = 2

export function cellToWorld(col, row, grid) {
  return {
    x: (col + 0.5 - grid / 2) * CELL,
    // Row increases DOWN the plan view, and north is up on that plan, so a row
    // maps straight onto +Z with north at −Z. The clip and the study layers
    // agree on which way is north by construction.
    z: (row + 0.5 - grid / 2) * CELL,
  }
}

export const HEADING_DEG = { N: 0, E: 90, S: 180, W: 270 }

// Rotating the nose vector (0, 0, −1) about +Y by θ gives (−sinθ, 0, −cosθ).
// An easterly heading wants (+1, 0, 0), which needs θ = −90°: the spin is the
// NEGATIVE of the compass bearing. Getting this backwards swaps east and west
// on every aircraft and helicopter in the scene.
export function headingSpin(heading) {
  const deg = HEADING_DEG[heading]
  if (deg === undefined) return 0
  return -deg * Math.PI / 180
}

// The unit vector an object with this heading points along, in world space.
// Exported for the test — it is the clearest way to state what `headingSpin`
// is supposed to achieve without repeating the formula that produced it.
export function headingVector(heading) {
  const s = headingSpin(heading)
  return { x: -Math.sin(s), z: -Math.cos(s) }
}

// ── The camera ───────────────────────────────────────────────────────────────
// Lives here rather than in the scene so `fitsInFrame` below can be tested
// against the real numbers. The first cut of this scene sat at radius 17 and cut
// the far corners of the board off the picture — an object outside the frame is
// not a hard question, it is an unanswerable one, and nothing caught it but a
// screenshot.
export const CAMERA = {
  fovDeg: 40,          // vertical, which is what three.js means by fov
  radius: 24,
  elevationDeg: 27,
  // How far round the camera pans across the clip. Narrow on purpose: this is a
  // pass over the ground, not an orbit, and a wide sweep would hand the player
  // enough parallax to solve the layout without ever reading it.
  sweepDeg: 20,
  // The camera aims ABOVE the field, not at it, which tilts the view up and
  // trades a band of empty foreground grass for the same band of landscape and
  // horizon. It has to live here rather than only in the scene, because it moves
  // the board within the frame and `fitsInFrame` below has to account for it.
  lookAtY: 2.4,
}

// The clip is a landscape frame, not a square one. A square wastes a third of
// its height on empty sky, because a board seen at this elevation is far wider
// on screen than it is tall. The page's container has to use this too, or the
// framing checked below is not the framing anyone sees.
export const CLIP_ASPECT = 4 / 3

// The tallest thing standing in the scene, ground to top: the airborne aircraft
// marker rides at 2.6 and its body extends 0.55 above that. Used to size the
// vertical fit, so it has to track the scene — a guess here is a guess about
// whether anything gets cropped.
export const SCENE_MAX_HEIGHT = 3.2

// ── The landscape ────────────────────────────────────────────────────────────
// The clip used to be a 12 × 12 slab of ground floating in the void, which read
// as a board being turned rather than as a place being flown over. The terrain
// now runs far past the frame in every direction and rolls, so no edge is ever
// visible and there is nothing to read as a board.
//
// THE FIELD ITSELF STAYS DEAD FLAT. Every scored object stands in it, and the
// questions ask which square each one is in — objects sitting at different
// heights on a slope would break both the drop-ring cue for airborne contacts
// and the eye's ability to compare positions. `terrainHeight` therefore returns
// exactly zero everywhere inside the field, and the test pins that.
//
// Relief eases in slowly rather than starting at the fence: a hill close to the
// field could stand between the camera and the ground being judged, and hiding
// the thing the question is about is not difficulty, it is a broken question.

export const FIELD_HALF = 6      // the playing field is 12 × 12 world units
const FLAT_TO = 7.5              // dead flat out to here, so the field is safe
const ROLL_TO = 45               // full relief only this far out

// A lake, out where the ground has room to fall away. Placed to the north (−Z),
// which is the half of the world the camera looks across.
export const LAKE = { x: -16, z: -32, radius: 11, level: -1.2 }

// Deterministic value noise. Seeded off the integer lattice rather than a
// random(), so the landscape is the same every run and every device — a clip
// that reshaped the world between two players would not be the same test.
function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const smoothstep = (t) => t * t * (3 - 2 * t)

function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const u = smoothstep(fx), v = smoothstep(fz)
  const a = hash2(ix, iz), b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1)
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

// Four octaves, returned in −1..1.
function fbm(x, z) {
  let sum = 0, amp = 1, freq = 1, norm = 0
  for (let o = 0; o < 4; o++) {
    sum += amp * (valueNoise(x * freq, z * freq) * 2 - 1)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

export function terrainHeight(x, z) {
  // A SQUARE ramp, not a radial one, so the flat area matches the square field
  // rather than leaving the corners on a slope.
  const r = Math.max(Math.abs(x), Math.abs(z))
  const ramp = smoothstep(Math.min(1, Math.max(0, (r - FLAT_TO) / (ROLL_TO - FLAT_TO))))
  let h = (fbm(x * 0.035, z * 0.035) * 9 + fbm(x * 0.11, z * 0.11) * 1.3) * ramp

  // Carve the lake basin last, so the shoreline is guaranteed rather than
  // whatever the noise happened to leave there.
  const d = Math.hypot(x - LAKE.x, z - LAKE.z)
  const influence = LAKE.radius * 1.8
  if (d < influence) {
    const bowl = smoothstep(1 - d / influence)
    h = h * (1 - bowl) + (LAKE.level - 0.8 - 2.4 * bowl) * bowl
    // Inside the waterline the bed must sit under the surface whatever the
    // noise wanted, or the lake grows islands. Clamped a little PAST the visible
    // disc: at exactly the radius the bowl has eased off enough that the noise
    // can still poke through, which showed up as a rim of land standing in the
    // water all the way round the shore.
    if (d < LAKE.radius + 0.75) h = Math.min(h, LAKE.level - 0.35)
  }
  return h
}

// Does the whole board stay inside the picture? Checked on BOTH axes, because
// they bind differently: horizontally the worst case is a corner of the ground
// at half the diagonal, while vertically the board is foreshortened by the
// camera elevation but the airborne contacts stand up into the frame.
//
// The first cut of this scene failed the horizontal check and cut an aircraft
// out of the picture; the second passed it but was framed for a square, which
// is why the aspect is part of the sum rather than assumed to be 1.
export function fitsInFrame({
  grid,
  radius = CAMERA.radius,
  fovDeg = CAMERA.fovDeg,
  elevationDeg = CAMERA.elevationDeg,
  lookAtY = CAMERA.lookAtY,
  aspect = CLIP_ASPECT,
} = {}) {
  const halfDiagonal = ((grid * CELL) / 2) * Math.SQRT2
  const halfVertical = radius * Math.tan((fovDeg / 2) * (Math.PI / 180))
  const halfHorizontal = halfVertical * aspect

  // Vertical screen offset from the aim point, for a thing `h` above the ground
  // and `d` further from the camera than the centre. Aiming above the ground
  // pushes the whole board DOWN the frame, so the two directions no longer
  // bind equally and both have to be checked.
  const el = elevationDeg * (Math.PI / 180)
  const offset = (h, d) => (h - lookAtY) * Math.cos(el) + d * Math.sin(el)

  const highest = offset(SCENE_MAX_HEIGHT, halfDiagonal)   // tall thing, far edge
  const lowest = -offset(0, -halfDiagonal)                 // bare ground, near edge

  return halfHorizontal > halfDiagonal
    && halfVertical > highest
    && halfVertical > lowest
}
