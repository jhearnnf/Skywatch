/**
 * faceGeometry.js
 * Builds every path in an interrogation portrait from a numeric descriptor.
 * Pure maths — no React, no DOM — so it can be unit-tested and so ActorFace
 * stays a list of shapes rather than a wall of hand-tuned path strings.
 *
 * The first version of the portraits shared one fixed face and varied only
 * colour, which meant eight people who differed by hair colour alone. Here the
 * skull, hairline, brows, eyes, nose, mouth, ears and age lines are all driven
 * by parameters, so each figure can be described rather than redrawn: face
 * width and length, jaw squareness, how far the hairline has receded, how
 * hooded the eyes are, how deep the lines from nose to mouth run.
 *
 * Everything a figure needs is a documented public feature. The descriptors in
 * actorAppearance.js stay factual and neutral — the point is a recognisable
 * likeness, never a caricature, so no parameter is ever pushed to a comic
 * extreme.
 *
 * Coordinate frame: the 120 × 150 viewBox ActorFace draws into. x = 60 is the
 * centre line; the head occupies roughly y 19 … 95 and the bust fills below it.
 */

// ── Frame constants ──────────────────────────────────────────────────────────

export const CX = 60

const CROWN_BASE = 19   // top of the skull at faceLength 1
const CHEEK_Y    = 55   // widest point of the head
const JAW_Y      = 79   // jaw corner
const CHIN_BASE  = 93   // bottom of the chin at faceLength 1
const EYE_Y      = 56
const NOSE_BASE  = 71
const MOUTH_BASE = 80
const HALF_W     = 25.5 // half the head width at faceWidth 1

// ── Descriptor ───────────────────────────────────────────────────────────────
//
// Every field is a multiplier around 1, an offset in px, or a 0..1 amount.
// A descriptor that sets nothing produces a plausible, unremarkable face.

export const FACE_DEFAULTS = {
  // Skull
  faceWidth: 1, faceLength: 1, cheekbone: 1, foreheadHeight: 1,
  jawWidth: 0.84, jawSquare: 0.5, chinWidth: 0.36,

  // Eyes. `hooding` is how far the upper lid covers the eye; `underEyeBag` is
  // the fold beneath it. Both read as age and are among the strongest cues to
  // who a face belongs to.
  eyeSize: 1, eyeSpacing: 1, hooding: 0.25, underEyeBag: 0.2,

  // Brows
  browThickness: 1, browHeight: 0, browLength: 1, browArch: 1,

  // Nose and mouth. `mouthCurve` is the resting set of the mouth: positive
  // turns the corners up, negative down. Expression adds to it.
  noseLength: 1, noseWidth: 1,
  mouthWidth: 1, lipUpper: 1, lipLower: 1, mouthCurve: 0,

  // Ears
  earSize: 1, earOut: 0,

  // Age and texture, all 0..1
  foreheadLines: 0.15, nasolabial: 0.3, crowsFeet: 0.2, jowls: 0.15,

  // Hair. `hairline` is the y of the hairline at the centre of the forehead —
  // a lower number sits higher on the head. `recession` pulls the temples back,
  // `peak` brings the centre down into a widow's peak.
  hairStyle: 'combed',      // combed | swept | cropped | thinning | bald
  hairline: 38, recession: 0, peak: 0, hairVolume: 1,
  part: 'left', sideburns: 0.5,

  // Build — drives the neck and shoulders, not the head.
  build: 1,
}

export const HAIR_STYLES = ['combed', 'swept', 'cropped', 'thinning', 'bald']

export function resolveFace(look) {
  return { ...FACE_DEFAULTS, ...(look ?? {}) }
}

// ── Metrics ──────────────────────────────────────────────────────────────────

/**
 * headMetrics(f)
 * The handful of derived measurements every other builder needs. Computing
 * these once keeps the features pinned to the skull they belong to: widen the
 * face and the eyes move apart with it, lengthen it and the mouth drops.
 */
export function headMetrics(f) {
  const hw          = HALF_W * f.faceWidth
  const cheekHW     = hw * f.cheekbone
  const lengthShift = (f.faceLength - 1) * 4
  return {
    hw,
    cheekHW,
    jawHW:  hw * f.jawWidth,
    chinHW: hw * f.chinWidth,
    topY:   CROWN_BASE - (f.faceLength - 1) * 5 - (f.foreheadHeight - 1) * 3.5,
    chinY:  CHIN_BASE + (f.faceLength - 1) * 5,
    cheekY: CHEEK_Y,
    jawY:   JAW_Y + lengthShift * 0.5,
    eyeY:   EYE_Y,
    noseY:  NOSE_BASE + lengthShift,
    mouthY: MOUTH_BASE + lengthShift,
  }
}

const r1 = (n) => Math.round(n * 10) / 10

// ── Head outline ─────────────────────────────────────────────────────────────

/**
 * headPath(f)
 * The skull, drawn as one closed curve: up the left side to the crown, down the
 * right to the cheekbone, in to the jaw corner, and along the jaw to the chin,
 * then mirrored. `jawSquare` moves the control handles at the jaw corner, which
 * is the difference between a square jaw and a tapered one.
 */
export function headPath(f) {
  const m  = headMetrics(f)
  const sq = f.jawSquare
  const { cheekHW, jawHW, chinHW, topY, chinY, cheekY, jawY } = m

  // How far down the side the curve stays wide before turning in to the jaw.
  const cheekRun = cheekY + (jawY - cheekY) * (0.32 + sq * 0.46)
  // Handle that squares off the jaw corner.
  const corner   = jawHW + (cheekHW - jawHW) * sq * 0.55

  return [
    `M ${r1(CX - cheekHW)} ${r1(cheekY)}`,
    `C ${r1(CX - cheekHW)} ${r1(topY + (cheekY - topY) * 0.30)}, ${r1(CX - cheekHW * 0.82)} ${r1(topY)}, ${CX} ${r1(topY)}`,
    `C ${r1(CX + cheekHW * 0.82)} ${r1(topY)}, ${r1(CX + cheekHW)} ${r1(topY + (cheekY - topY) * 0.30)}, ${r1(CX + cheekHW)} ${r1(cheekY)}`,
    `C ${r1(CX + cheekHW)} ${r1(cheekRun)}, ${r1(CX + corner)} ${r1(jawY - 2)}, ${r1(CX + jawHW)} ${r1(jawY)}`,
    `C ${r1(CX + jawHW * (0.84 + sq * 0.13))} ${r1(jawY + (chinY - jawY) * 0.58)}, ${r1(CX + chinHW * 1.7)} ${r1(chinY)}, ${CX} ${r1(chinY)}`,
    `C ${r1(CX - chinHW * 1.7)} ${r1(chinY)}, ${r1(CX - jawHW * (0.84 + sq * 0.13))} ${r1(jawY + (chinY - jawY) * 0.58)}, ${r1(CX - jawHW)} ${r1(jawY)}`,
    `C ${r1(CX - corner)} ${r1(jawY - 2)}, ${r1(CX - cheekHW)} ${r1(cheekRun)}, ${r1(CX - cheekHW)} ${r1(cheekY)}`,
    'Z',
  ].join(' ')
}

// ── Eyes ─────────────────────────────────────────────────────────────────────

/**
 * eyeGeometry(f, side)
 * side is -1 for the viewer's left eye, +1 for the right.
 * Returns the almond outline, the iris centre, the hooded upper lid and the
 * crease above it. The lid is a filled skin-coloured shape laid over the eye,
 * which is what actually makes a hooded eye read as hooded.
 */
export function eyeGeometry(f, side) {
  const m   = headMetrics(f)
  const cx  = CX + side * 12.6 * f.eyeSpacing * f.faceWidth
  const cy  = m.eyeY
  const rx  = 6.3 * f.eyeSize
  const ry  = 3.95 * f.eyeSize

  // The lid drops from the top of the eye by `hooding` of its height.
  const lidDrop = ry * (0.25 + f.hooding * 1.05)
  const lid = [
    `M ${r1(cx - rx - 0.6)} ${r1(cy - ry * 0.35)}`,
    `Q ${r1(cx)} ${r1(cy - ry - 3.4)} ${r1(cx + rx + 0.6)} ${r1(cy - ry * 0.35)}`,
    `L ${r1(cx + rx + 0.6)} ${r1(cy - ry + lidDrop)}`,
    `Q ${r1(cx)} ${r1(cy - ry + lidDrop - 1.6)} ${r1(cx - rx - 0.6)} ${r1(cy - ry + lidDrop)}`,
    'Z',
  ].join(' ')

  return {
    cx, cy, rx, ry,
    // Almond rather than a plain ellipse: flatter along the top, rounder below.
    outline: [
      `M ${r1(cx - rx)} ${r1(cy)}`,
      `Q ${r1(cx - rx * 0.35)} ${r1(cy - ry * 1.25)} ${r1(cx + rx * 0.45)} ${r1(cy - ry * 0.9)}`,
      `Q ${r1(cx + rx)} ${r1(cy - ry * 0.55)} ${r1(cx + rx)} ${r1(cy)}`,
      `Q ${r1(cx + rx * 0.5)} ${r1(cy + ry * 1.15)} ${r1(cx - rx * 0.2)} ${r1(cy + ry * 1.1)}`,
      `Q ${r1(cx - rx * 0.8)} ${r1(cy + ry * 0.9)} ${r1(cx - rx)} ${r1(cy)}`,
      'Z',
    ].join(' '),
    lid,
    crease: `M ${r1(cx - rx * 0.95)} ${r1(cy - ry - 1.2)} Q ${r1(cx)} ${r1(cy - ry - 3.9)} ${r1(cx + rx * 0.95)} ${r1(cy - ry - 1.2)}`,
    lashLine: `M ${r1(cx - rx)} ${r1(cy - ry * 0.35)} Q ${r1(cx - rx * 0.3)} ${r1(cy - ry * 1.3)} ${r1(cx + rx * 0.45)} ${r1(cy - ry * 0.95)}`,
    bag: `M ${r1(cx - rx * 0.85)} ${r1(cy + ry * 1.15)} Q ${r1(cx)} ${r1(cy + ry * 1.15 + 2.6 * f.underEyeBag + 1)} ${r1(cx + rx * 0.85)} ${r1(cy + ry * 1.0)}`,
    crowsFeet: [
      `M ${r1(cx + side * (rx + 1))} ${r1(cy - 1.5)} l ${r1(side * 3.2)} ${-1.6}`,
      `M ${r1(cx + side * (rx + 1))} ${r1(cy + 0.8)} l ${r1(side * 3.4)} ${0.4}`,
      `M ${r1(cx + side * (rx + 0.6))} ${r1(cy + 2.8)} l ${r1(side * 3)} ${2}`,
    ],
  }
}

// ── Brows ────────────────────────────────────────────────────────────────────

/**
 * browPath(f, side)
 * A tapered brow: a filled shape, not a stroke, so thickness can differ between
 * the inner and outer end the way a real brow does.
 */
export function browPath(f, side) {
  const eye = eyeGeometry(f, side)
  const len = 9.2 * f.browLength
  const th  = 2.5 * f.browThickness
  const y   = eye.cy - 9.5 - f.browHeight

  const inner = eye.cx - side * len * 0.75
  const outer = eye.cx + side * len * 0.85
  const arch  = y - 2.6 * f.browArch

  return [
    `M ${r1(inner)} ${r1(y + th * 0.35)}`,
    `Q ${r1(eye.cx)} ${r1(arch - th * 0.5)} ${r1(outer)} ${r1(y + th * 0.1)}`,
    `Q ${r1(eye.cx)} ${r1(arch + th * 0.9)} ${r1(inner)} ${r1(y + th * 1.25)}`,
    'Z',
  ].join(' ')
}

/** The pivot a brow rotates about for an expression: its outer end. */
export function browPivot(f, side) {
  const eye = eyeGeometry(f, side)
  return { x: eye.cx + side * 9.2 * f.browLength * 0.85, y: eye.cy - 9.5 - f.browHeight }
}

// ── Nose ─────────────────────────────────────────────────────────────────────

export function nosePaths(f) {
  const m  = headMetrics(f)
  const y  = m.noseY
  const nw = 4.4 * f.noseWidth
  const top = m.eyeY - 1

  return {
    // The shadow down one side of the bridge, which is what gives a flat
    // drawing a nose at all.
    bridge: `M ${r1(CX - 1.6)} ${r1(top)} C ${r1(CX - 2.6)} ${r1(top + (y - top) * 0.55)}, ${r1(CX - nw * 0.8)} ${r1(y - 3.5)}, ${r1(CX - nw * 0.62)} ${r1(y + 0.4)}`,
    // The underside of the tip, closed so it can be filled as a soft shadow.
    tip: `M ${r1(CX - nw * 0.72)} ${r1(y - 0.6)} Q ${CX} ${r1(y + 3.4 * f.noseLength)} ${r1(CX + nw * 0.72)} ${r1(y - 0.6)} Q ${CX} ${r1(y + 1)} ${r1(CX - nw * 0.72)} ${r1(y - 0.6)} Z`,
    // Wings either side, and the nostrils inside them.
    wingL: `M ${r1(CX - nw * 1.05)} ${r1(y - 2.2)} Q ${r1(CX - nw * 1.2)} ${r1(y + 1.6)} ${r1(CX - nw * 0.5)} ${r1(y + 1.9)}`,
    wingR: `M ${r1(CX + nw * 1.05)} ${r1(y - 2.2)} Q ${r1(CX + nw * 1.2)} ${r1(y + 1.6)} ${r1(CX + nw * 0.5)} ${r1(y + 1.9)}`,
    nostrilL: { cx: r1(CX - nw * 0.66), cy: r1(y + 0.9), rx: r1(nw * 0.24), ry: 0.9 },
    nostrilR: { cx: r1(CX + nw * 0.66), cy: r1(y + 0.9), rx: r1(nw * 0.24), ry: 0.9 },
  }
}

// ── Mouth ────────────────────────────────────────────────────────────────────

/**
 * mouthPaths(f, curveDelta)
 * `curveDelta` comes from the expression and adds to the resting set of the
 * mouth. Returns a filled lip shape plus the darker line where the lips meet.
 */
export function mouthPaths(f, curveDelta = 0) {
  const m     = headMetrics(f)
  const y     = m.mouthY
  const w     = 12.4 * f.mouthWidth
  const curve = f.mouthCurve + curveDelta
  const cornerY = y - curve * 3.2

  const upper = 2.9 * f.lipUpper
  const lower = 3.6 * f.lipLower

  return {
    lips: [
      `M ${r1(CX - w)} ${r1(cornerY)}`,
      // Cupid's bow: two small arcs meeting at a dip on the centre line.
      `Q ${r1(CX - w * 0.55)} ${r1(y - upper)} ${r1(CX - w * 0.16)} ${r1(y - upper * 0.45)}`,
      `Q ${CX} ${r1(y - upper * 0.78)} ${r1(CX + w * 0.16)} ${r1(y - upper * 0.45)}`,
      `Q ${r1(CX + w * 0.55)} ${r1(y - upper)} ${r1(CX + w)} ${r1(cornerY)}`,
      `Q ${CX} ${r1(y + lower)} ${r1(CX - w)} ${r1(cornerY)}`,
      'Z',
    ].join(' '),
    line: `M ${r1(CX - w)} ${r1(cornerY)} Q ${CX} ${r1(y + curve * -0.4 + 0.5)} ${r1(CX + w)} ${r1(cornerY)}`,
    // Where an open, talking mouth sits.
    open: { cx: CX, cy: y + 0.4, rx: r1(w * 0.72), ry: 3.4 },
  }
}

// ── Ears ─────────────────────────────────────────────────────────────────────

export function earGeometry(f, side) {
  const m  = headMetrics(f)
  const cx = CX + side * (m.cheekHW + 0.8 + f.earOut * 3)
  const cy = m.eyeY + 3
  const rx = 3.6 * f.earSize
  const ry = 9.2 * f.earSize
  return {
    cx, cy, rx, ry,
    inner: `M ${r1(cx + side * 0.4)} ${r1(cy - ry * 0.45)} Q ${r1(cx + side * rx * 0.55)} ${r1(cy)} ${r1(cx + side * 0.2)} ${r1(cy + ry * 0.5)}`,
  }
}

// ── Age lines ────────────────────────────────────────────────────────────────

/**
 * ageLines(f)
 * The folds that carry most of a face's age: nose-to-mouth on each side, lines
 * across the forehead, and a softening of the jaw. Each is returned with the
 * opacity it should be drawn at, so a descriptor turns them down to nothing
 * rather than the component branching on them.
 */
export function ageLines(f) {
  const m  = headMetrics(f)
  const nw = 4.4 * f.noseWidth
  const mw = 12.4 * f.mouthWidth

  const forehead = []
  const lineCount = f.foreheadLines > 0.28 ? 3 : 2
  for (let i = 0; i < lineCount; i += 1) {
    const y = m.topY + 12 + i * 5.2
    const half = m.cheekHW * (0.5 + i * 0.02)
    forehead.push(`M ${r1(CX - half)} ${r1(y)} Q ${CX} ${r1(y - 2.2)} ${r1(CX + half)} ${r1(y)}`)
  }

  return {
    nasolabial: [
      `M ${r1(CX - nw - 0.6)} ${r1(m.noseY - 1.5)} Q ${r1(CX - mw - 2.4)} ${r1(m.mouthY - 4)} ${r1(CX - mw * 0.86)} ${r1(m.mouthY + 3.4)}`,
      `M ${r1(CX + nw + 0.6)} ${r1(m.noseY - 1.5)} Q ${r1(CX + mw + 2.4)} ${r1(m.mouthY - 4)} ${r1(CX + mw * 0.86)} ${r1(m.mouthY + 3.4)}`,
    ],
    forehead,
    jowls: [
      `M ${r1(CX - m.jawHW * 0.94)} ${r1(m.jawY - 1)} Q ${r1(CX - m.jawHW * 0.8)} ${r1(m.chinY - 3)} ${r1(CX - m.chinHW * 1.5)} ${r1(m.chinY - 1.5)}`,
      `M ${r1(CX + m.jawHW * 0.94)} ${r1(m.jawY - 1)} Q ${r1(CX + m.jawHW * 0.8)} ${r1(m.chinY - 3)} ${r1(CX + m.chinHW * 1.5)} ${r1(m.chinY - 1.5)}`,
    ],
    // The crease under the lower lip; without it a chin reads as a blank curve.
    chinCrease: `M ${r1(CX - mw * 0.42)} ${r1(m.mouthY + 6)} Q ${CX} ${r1(m.mouthY + 8)} ${r1(CX + mw * 0.42)} ${r1(m.mouthY + 6)}`,
  }
}

// ── Hair ─────────────────────────────────────────────────────────────────────

/**
 * hairlinePoints(f)
 * Five points across the forehead, right to left. `recession` lifts the temples
 * towards the crown; `peak` brings the centre down. Between them they cover
 * everything from a full low hairline to a receded one.
 */
export function hairlinePoints(f) {
  const m = headMetrics(f)
  // The hairline is expressed in the descriptor as an absolute y, but it has to
  // follow a longer or shorter skull.
  const base    = f.hairline + (m.topY - CROWN_BASE) * 0.8
  // At rest the hairline runs slightly LOWER at the temples than at the centre.
  // Recession is what lifts the corners back towards the crown, and it has to
  // start from a natural hairline or every face reads as balding.
  const templeY = base + 3 - f.recession * 13
  const midY    = base + 1 - f.recession * 5 + f.peak * 1.5
  const centreY = base + f.peak * 5

  return [
    { x: CX + m.cheekHW * 0.72, y: templeY },
    { x: CX + m.cheekHW * 0.4,  y: midY },
    { x: CX,                    y: centreY },
    { x: CX - m.cheekHW * 0.4,  y: midY },
    { x: CX - m.cheekHW * 0.72, y: templeY },
  ]
}

/**
 * hairPath(f)
 * The hair as one closed shape: an outer contour standing slightly proud of the
 * skull, then back along the hairline. Returns null for a bald head, which gets
 * hairSides() instead.
 */
export function hairPath(f) {
  if (f.hairStyle === 'bald') return null

  const m    = headMetrics(f)
  // Hair stands only a little proud of the skull. A larger figure here reads as
  // a helmet sitting around the head rather than hair growing out of it.
  const vol  = 1.2 + 2.4 * f.hairVolume
  const hw   = m.cheekHW + vol * 0.3
  const topY = m.topY - vol
  // Where the hair stops down the side of the head — just above the ear at the
  // low end, mid-temple at the high end.
  const sideY = m.eyeY - 6 + f.sideburns * 9
  const pts  = hairlinePoints(f)

  return [
    `M ${r1(CX - hw)} ${r1(sideY)}`,
    `C ${r1(CX - hw)} ${r1(topY + (sideY - topY) * 0.28)}, ${r1(CX - hw * 0.72)} ${r1(topY)}, ${CX} ${r1(topY)}`,
    `C ${r1(CX + hw * 0.72)} ${r1(topY)}, ${r1(CX + hw)} ${r1(topY + (sideY - topY) * 0.28)}, ${r1(CX + hw)} ${r1(sideY)}`,
    `Q ${r1(CX + m.cheekHW * 0.92)} ${r1(sideY - 5)} ${r1(pts[0].x)} ${r1(pts[0].y)}`,
    `Q ${r1((pts[0].x + pts[1].x) / 2)} ${r1(pts[1].y - 1)} ${r1(pts[1].x)} ${r1(pts[1].y)}`,
    `Q ${r1((pts[1].x + pts[2].x) / 2)} ${r1(pts[2].y)} ${r1(pts[2].x)} ${r1(pts[2].y)}`,
    `Q ${r1((pts[2].x + pts[3].x) / 2)} ${r1(pts[2].y)} ${r1(pts[3].x)} ${r1(pts[3].y)}`,
    `Q ${r1((pts[3].x + pts[4].x) / 2)} ${r1(pts[3].y - 1)} ${r1(pts[4].x)} ${r1(pts[4].y)}`,
    `Q ${r1(CX - m.cheekHW * 0.92)} ${r1(sideY - 5)} ${r1(CX - hw)} ${r1(sideY)}`,
    'Z',
  ].join(' ')
}

/**
 * hairSides(f)
 * The band of hair round the sides and back that a bald head still has. Without
 * it a bald figure reads as a mannequin.
 */
export function hairSides(f) {
  const m    = headMetrics(f)
  const top  = m.topY + 14 + (1 - f.hairVolume) * 6
  const bot  = m.eyeY + 2 + f.sideburns * 9
  const out  = m.cheekHW + 1.4
  const inn  = m.cheekHW - 2.6

  const side = (s) => [
    `M ${r1(CX + s * out)} ${r1(top + 6)}`,
    `C ${r1(CX + s * (out + 0.8))} ${r1(top + (bot - top) * 0.6)}, ${r1(CX + s * out)} ${r1(bot - 2)}, ${r1(CX + s * (inn + 0.6))} ${r1(bot)}`,
    `C ${r1(CX + s * inn)} ${r1(bot - 8)}, ${r1(CX + s * inn)} ${r1(top + 10)}, ${r1(CX + s * inn)} ${r1(top + 4)}`,
    'Z',
  ].join(' ')

  return `${side(-1)} ${side(1)}`
}

/**
 * hairStrands(f)
 * A few strokes inside the hair so it is not a flat silhouette. They fan from
 * the part (or from the crown, for a swept style) towards the far side.
 */
export function hairStrands(f) {
  if (f.hairStyle === 'bald') return []

  const m     = headMetrics(f)
  const dir   = f.part === 'right' ? 1 : -1
  const pts   = hairlinePoints(f)
  const vol   = 1.2 + 2.4 * f.hairVolume
  const crown = m.topY - vol * 0.4
  const count = f.hairStyle === 'cropped' ? 3 : 4
  const out   = []

  // Where the strands start: at the part for a combed head, at the crown for a
  // swept one.
  const originX = f.hairStyle === 'swept' ? CX - dir * m.cheekHW * 0.1 : CX + dir * m.cheekHW * 0.42
  const originY = f.hairStyle === 'swept' ? crown + 1 : pts[2].y - 1

  for (let i = 0; i < count; i += 1) {
    const t   = (i + 1) / (count + 1)
    const endX = CX - dir * m.cheekHW * (0.35 + t * 0.62)
    const endY = crown + 4 + t * (pts[0].y - crown) * 0.85
    const ctrlX = CX - dir * m.cheekHW * t * 0.25
    const ctrlY = crown + 1 + t * 3
    out.push(`M ${r1(originX)} ${r1(originY + i * 1.4)} Q ${r1(ctrlX)} ${r1(ctrlY)} ${r1(endX)} ${r1(endY)}`)
  }
  return out
}

// ── Body ─────────────────────────────────────────────────────────────────────

/**
 * bodyPaths(f)
 * Neck, shoulders, collar, tie. Driven by `build` and pinned to the chin, so a
 * longer face does not float above its own collar.
 */
export function bodyPaths(f) {
  const m  = headMetrics(f)
  const b  = f.build
  const neckHW    = 8.2 * b
  const neckTop   = m.chinY - 12
  const shoulderY = m.chinY + 2
  const spread    = 48 * b
  // A tie is narrow at the knot and widens down the blade. Drawing it as a
  // constant-width bar under a diamond knot read as an arrow pointing up.
  const knotTop   = shoulderY + 11
  const knotBot   = shoulderY + 20

  return {
    neck:     `M ${r1(CX - neckHW)} ${r1(neckTop)} L ${r1(CX - neckHW)} ${r1(shoulderY + 7)} Q ${CX} ${r1(shoulderY + 15)} ${r1(CX + neckHW)} ${r1(shoulderY + 7)} L ${r1(CX + neckHW)} ${r1(neckTop)} Z`,
    neckShade: `M ${r1(CX - neckHW)} ${r1(neckTop)} Q ${CX} ${r1(neckTop + 9)} ${r1(CX + neckHW)} ${r1(neckTop)} Z`,
    shoulders: `M ${CX} ${r1(shoulderY)} C ${r1(CX - spread * 0.42)} ${r1(shoulderY)}, ${r1(CX - spread * 0.88)} ${r1(shoulderY + 12)}, ${r1(CX - spread)} ${r1(shoulderY + 32)} L ${r1(CX - spread - 4)} 150 L ${r1(CX + spread + 4)} 150 L ${r1(CX + spread)} ${r1(shoulderY + 32)} C ${r1(CX + spread * 0.88)} ${r1(shoulderY + 12)}, ${r1(CX + spread * 0.42)} ${r1(shoulderY)}, ${CX} ${r1(shoulderY)} Z`,
    shirt:     `M ${CX} ${r1(shoulderY + 36)} L ${r1(CX - 16 * b)} ${r1(shoulderY + 4)} Q ${r1(CX - 8 * b)} ${r1(shoulderY)} ${CX} ${r1(shoulderY + 8)} Q ${r1(CX + 8 * b)} ${r1(shoulderY)} ${r1(CX + 16 * b)} ${r1(shoulderY + 4)} Z`,
    collarL:   `M ${r1(CX - 16 * b)} ${r1(shoulderY + 4)} L ${CX} ${r1(shoulderY + 16)} L ${r1(CX - 8 * b)} ${r1(shoulderY + 20)} Z`,
    collarR:   `M ${r1(CX + 16 * b)} ${r1(shoulderY + 4)} L ${CX} ${r1(shoulderY + 16)} L ${r1(CX + 8 * b)} ${r1(shoulderY + 20)} Z`,
    tieKnot:   `M ${r1(CX - 3.2)} ${r1(knotTop)} L ${r1(CX + 3.2)} ${r1(knotTop)} L ${r1(CX + 4.6)} ${r1(knotBot)} L ${r1(CX - 4.6)} ${r1(knotBot)} Z`,
    tie:       `M ${r1(CX - 4.2)} ${r1(knotBot)} L ${r1(CX + 4.2)} ${r1(knotBot)} L ${r1(CX + 8.5)} 150 L ${r1(CX - 8.5)} 150 Z`,
    lapelL:    `M ${r1(CX - 16 * b)} ${r1(shoulderY + 4)} C ${r1(CX - 21 * b)} ${r1(shoulderY + 18)}, ${r1(CX - 21 * b)} ${r1(shoulderY + 38)}, ${r1(CX - 19 * b)} 150 L ${r1(CX - 32 * b)} 150 C ${r1(CX - 31 * b)} ${r1(shoulderY + 32)}, ${r1(CX - 27 * b)} ${r1(shoulderY + 12)}, ${r1(CX - 16 * b)} ${r1(shoulderY + 4)} Z`,
    lapelR:    `M ${r1(CX + 16 * b)} ${r1(shoulderY + 4)} C ${r1(CX + 21 * b)} ${r1(shoulderY + 18)}, ${r1(CX + 21 * b)} ${r1(shoulderY + 38)}, ${r1(CX + 19 * b)} 150 L ${r1(CX + 32 * b)} 150 C ${r1(CX + 31 * b)} ${r1(shoulderY + 32)}, ${r1(CX + 27 * b)} ${r1(shoulderY + 12)}, ${r1(CX + 16 * b)} ${r1(shoulderY + 4)} Z`,
    pin:       { cx: r1(CX - 25 * b), cy: r1(shoulderY + 26), r: 2.4 },
  }
}

// ── Glasses ──────────────────────────────────────────────────────────────────

/**
 * glassesPaths(f, kind)
 * 'rimless' draws only the lower rim and the bridge; 'thin' and 'thick' draw
 * full frames at different weights. Sized off the eyes, so they land on the
 * face they belong to.
 */
export function glassesPaths(f, kind = 'thin') {
  const left  = eyeGeometry(f, -1)
  const right = eyeGeometry(f, 1)
  const rx = left.rx + 2.6
  const ry = left.ry + 3.4

  const lens = (e) => ({
    x: r1(e.cx - rx), y: r1(e.cy - ry), w: r1(rx * 2), h: r1(ry * 2),
    rBase: kind === 'thick' ? 3 : 5,
  })

  return {
    kind,
    left:  lens(left),
    right: lens(right),
    bridge: `M ${r1(left.cx + rx)} ${r1(left.cy - 1)} Q ${CX} ${r1(left.cy - 3)} ${r1(right.cx - rx)} ${r1(right.cy - 1)}`,
    armL: `M ${r1(left.cx - rx)} ${r1(left.cy - 1.5)} L ${r1(left.cx - rx - 6)} ${r1(left.cy + 1.5)}`,
    armR: `M ${r1(right.cx + rx)} ${r1(right.cy - 1.5)} L ${r1(right.cx + rx + 6)} ${r1(right.cy + 1.5)}`,
    lowerL: `M ${r1(left.cx - rx)} ${r1(left.cy + ry * 0.55)} Q ${r1(left.cx)} ${r1(left.cy + ry)} ${r1(left.cx + rx)} ${r1(left.cy + ry * 0.4)}`,
    lowerR: `M ${r1(right.cx - rx)} ${r1(right.cy + ry * 0.4)} Q ${r1(right.cx)} ${r1(right.cy + ry)} ${r1(right.cx + rx)} ${r1(right.cy + ry * 0.55)}`,
  }
}

// ── Facial hair ──────────────────────────────────────────────────────────────

/**
 * facialHairPath(f, kind)
 * Clipped to the head by the caller. A beard and stubble use the same shape at
 * different opacities; a moustache is its own small shape above the mouth.
 */
export function facialHairPath(f, kind) {
  const m  = headMetrics(f)
  const mw = 12.4 * f.mouthWidth

  if (kind === 'moustache') {
    return `M ${r1(CX - mw * 0.92)} ${r1(m.mouthY - 5.2)} Q ${CX} ${r1(m.mouthY - 8.4)} ${r1(CX + mw * 0.92)} ${r1(m.mouthY - 5.2)} Q ${CX} ${r1(m.mouthY - 2.6)} ${r1(CX - mw * 0.92)} ${r1(m.mouthY - 5.2)} Z`
  }

  // Jaw-and-chin shape. It starts level with the nose, NOT up on the cheekbone:
  // a beard that climbs towards the eyes stops reading as a beard and starts
  // reading as a mask over the face.
  const top = m.noseY - 1
  return [
    `M ${r1(CX - m.cheekHW * 0.95)} ${r1(top)}`,
    `C ${r1(CX - m.cheekHW * 0.98)} ${r1(m.jawY + 2)}, ${r1(CX - m.jawHW * 0.78)} ${r1(m.chinY + 2)}, ${CX} ${r1(m.chinY + 2)}`,
    `C ${r1(CX + m.jawHW * 0.78)} ${r1(m.chinY + 2)}, ${r1(CX + m.cheekHW * 0.98)} ${r1(m.jawY + 2)}, ${r1(CX + m.cheekHW * 0.95)} ${r1(top)}`,
    `C ${r1(CX + m.cheekHW * 0.7)} ${r1(m.mouthY - 7)}, ${r1(CX + mw * 0.95)} ${r1(m.mouthY - 6)}, ${r1(CX + mw * 0.78)} ${r1(m.mouthY - 4.5)}`,
    `Q ${CX} ${r1(m.mouthY - 7.5)} ${r1(CX - mw * 0.78)} ${r1(m.mouthY - 4.5)}`,
    `C ${r1(CX - mw * 0.95)} ${r1(m.mouthY - 6)}, ${r1(CX - m.cheekHW * 0.7)} ${r1(m.mouthY - 7)}, ${r1(CX - m.cheekHW * 0.95)} ${r1(top)}`,
    'Z',
  ].join(' ')
}
