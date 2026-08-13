// CBAT "Table Reading Test" (MATF) generator.
//
// MATF is the Table Reading Test — NOT a multi-attribute task battery. The
// initials mislead and have already caused one wrong mapping in the Aptitude
// Report, so check the glossary in the guide corpus before re-reading this by
// its abbreviation.
//
// Two parts, both taken from the corpus's description of the real sheet:
//
//   PART ONE — "a coordinate grid running −17 to +17 on both axes; you bring one
//   value across and one down and read the intersection, which is the same
//   whichever axis you assign each number to."
//
//   So the axes are SIGNED and run out to ±17 — 35 labels each way, not 17. This
//   generator built a 1..17 grid until the guide was read back against it, which
//   is a quarter of the real search area and none of the sign handling. The
//   corpus's one piece of prep advice ("draw out a grid running to 17 in each
//   direction") says the same thing.
//
//   The "either way round" shortcut is only true if the grid is SYMMETRIC, so
//   this builds a symmetric matrix — cellAt(a,b) === cellAt(b,a) for every pair.
//   It would have been easier to build a random matrix and simply not test the
//   claim, but then the one concrete technique anyone has offered for this test
//   would be false in our version, and a player who adopted it here would carry
//   a wrong habit into the real thing. `matfGenerator.test.js` pins the symmetry.
//
//   PART TWO — "puts Air Speed, Wind Velocity and Wind Angle on screen and needs
//   a three-step lookup: table by air speed, row by wind velocity, then column by
//   wind angle under either Drift Correction or Ground Speed."
//
//   THREE steps, not two. The sheet is therefore a stack of tables, one per air
//   speed, and only the right one holds the answer — picking the table is the
//   first thing the question asks of you and the easiest step to fumble. Each
//   angle column is split into a Drift Correction and a Ground Speed reading,
//   and the question names which of the two it wants.
//
//   The figures are computed from the actual wind triangle rather than rolled at
//   random, so the sheet is internally consistent the way a real navigation
//   table is: drift correction is asin(V·sinθ / TAS) and ground speed is
//   TAS·cos(drift) − V·cosθ. Which air speeds, wind velocities and wind angles
//   appear is still drawn per run, so the sheet cannot be memorised across
//   replays — something a real candidate, seeing it once, never has to worry
//   about.
//
// Both parts are SPEEDED. The real test is worked against a pre-printed
// laminated sheet beside the screen, and the corpus is explicit that "running it
// fast and accurately while managing a physical sheet and a screen at the same
// time is the actual test". We cannot reproduce the two surfaces on one display
// and do not pretend to — the reference panel and the question panel are
// separated as far as the layout allows, and the intro says what is missing.
//
// Every question offers FIVE numbered options, which is what the corpus reports
// ("Five numbered options each time").
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) to reproduce a run.
//
// buildMatfGrid(extent, rng)     → { extent, cells } — axes run −extent..+extent
// matfGridQuestion(grid, rng)    → { a, b, answer, options }
// buildMatfSheet(shape, rng)     → { tables: [{ airSpeed, rows, angles, cells }] }
// matfSheetQuestion(sheet, rng)  → { airSpeed, windVelocity, windAngle, readout, … }

export const MATF_OPTIONS = 5

export const READOUTS = {
  drift: { key: 'drift', label: 'Drift Correction', short: 'DRIFT', unit: '°' },
  ground: { key: 'ground', label: 'Ground Speed', short: 'GS', unit: 'kt' },
}

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Take `count` values from a pool at random and hand them back in the pool's own
// order, so a column of wind velocities still reads 10, 20, 30 rather than
// jumping about. A reference sheet whose rows were unordered would be a
// different — and much sillier — test.
function sampleSorted(pool, count, rng) {
  return shuffle(pool, rng).slice(0, count).sort((a, b) => a - b)
}

// ── Part one: the symmetric signed coordinate grid ───────────────────────────

// Axis labels, in display order: −extent … −1, 0, +1 … +extent.
export function axisLabels(extent) {
  return Array.from({ length: extent * 2 + 1 }, (_, i) => i - extent)
}

const indexOfLabel = (label, extent) => label + extent

export function buildMatfGrid(extent, rng = Math.random) {
  const size = extent * 2 + 1
  const cells = Array.from({ length: size }, () => new Array(size).fill(0))
  for (let r = 0; r < size; r++) {
    for (let c = r; c < size; c++) {
      // Two digits keeps every cell the same width, so the eye tracks along a
      // row without the column edges shifting under it.
      const v = 10 + Math.floor(rng() * 90)
      cells[r][c] = v
      cells[c][r] = v
    }
  }
  return { extent, cells }
}

export function cellAt(grid, a, b) {
  return grid.cells[indexOfLabel(a, grid.extent)][indexOfLabel(b, grid.extent)]
}

// Distractors are pulled from OTHER CELLS of the same grid, not invented. A
// wrong answer should be a value you could plausibly have landed on by
// miscounting a row or a column — an invented number is eliminable without
// reading the grid at all.
function neighbourOptions(grid, r, c, rng) {
  const size = grid.cells.length
  const answer = grid.cells[r][c]
  const near = []
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue
      const rr = r + dr, cc = c + dc
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue
      if (grid.cells[rr][cc] !== answer) near.push(grid.cells[rr][cc])
    }
  }
  const opts = new Set([answer])
  for (const v of shuffle(near, rng)) {
    if (opts.size >= MATF_OPTIONS) break
    opts.add(v)
  }
  let filler = 1
  while (opts.size < MATF_OPTIONS) { opts.add(10 + ((answer + filler) % 90)); filler++ }
  return shuffle([...opts], rng)
}

export function matfGridQuestion(grid, rng = Math.random) {
  const labels = axisLabels(grid.extent)
  const a = labels[Math.floor(rng() * labels.length)]
  const b = labels[Math.floor(rng() * labels.length)]
  // The pair is presented in a random order precisely because the order does
  // not matter — a player who has internalised that answers faster, which is
  // the point of the shortcut.
  const [first, second] = rng() < 0.5 ? [a, b] : [b, a]
  return {
    part: 'grid',
    a: first,
    b: second,
    answer: cellAt(grid, a, b),
    options: neighbourOptions(grid, indexOfLabel(a, grid.extent), indexOfLabel(b, grid.extent), rng),
  }
}

// ── Part two: the three-step wind lookup ─────────────────────────────────────

// Air speeds floor at 90 and wind velocities cap at 60, which together keep
// V·sinθ / TAS well under 1 (so the drift angle is always defined) and ground
// speed always positive. Widen either pool and check that still holds.
const AIR_SPEEDS = [90, 120, 150, 180, 210, 240, 270, 300]
const WIND_VELOCITIES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
const WIND_ANGLES = [20, 30, 45, 60, 75, 90, 105, 120, 135, 150, 160]

const RAD = Math.PI / 180

// The wind triangle, rounded to whole numbers the way a printed sheet is.
export function windCell(airSpeed, windVelocity, windAngle) {
  const crosswind = windVelocity * Math.sin(windAngle * RAD)
  const driftRad = Math.asin(crosswind / airSpeed)
  const headwind = windVelocity * Math.cos(windAngle * RAD)
  return {
    drift: Math.round(driftRad / RAD),
    ground: Math.round(airSpeed * Math.cos(driftRad) - headwind),
  }
}

export function buildMatfSheet({ tableCount, rowCount, angleCount }, rng = Math.random) {
  const airSpeeds = sampleSorted(AIR_SPEEDS, tableCount, rng)
  // One set of rows and columns across every table, exactly as a real sheet is
  // laid out: the tables differ only by air speed, which is what makes picking
  // the wrong one so easy and so costly.
  const rows = sampleSorted(WIND_VELOCITIES, rowCount, rng)
  const angles = sampleSorted(WIND_ANGLES, angleCount, rng)

  const tables = airSpeeds.map(airSpeed => ({
    airSpeed,
    cells: rows.map(v => angles.map(a => windCell(airSpeed, v, a))),
  }))

  return { tables, rows, angles }
}

export function sheetValue(sheet, airSpeed, windVelocity, windAngle, readout) {
  const table = sheet.tables.find(t => t.airSpeed === airSpeed)
  const r = sheet.rows.indexOf(windVelocity)
  const c = sheet.angles.indexOf(windAngle)
  if (!table || r < 0 || c < 0) return null
  return table.cells[r][c][readout]
}

export function matfSheetQuestion(sheet, rng = Math.random) {
  const ti = Math.floor(rng() * sheet.tables.length)
  const r = Math.floor(rng() * sheet.rows.length)
  const c = Math.floor(rng() * sheet.angles.length)
  const readout = rng() < 0.5 ? 'drift' : 'ground'

  const table = sheet.tables[ti]
  const answer = table.cells[r][c][readout]

  // Distractors are the cells a slipped finger actually lands on: the row above
  // and below, the column either side, and — the one this test is really about —
  // the SAME cell in the neighbouring air-speed table. Reading the right row and
  // column off the wrong table is the characteristic three-step-lookup error, so
  // it has to be on offer as an answer.
  const near = []
  const push = (t, rr, cc) => {
    if (rr < 0 || cc < 0 || rr >= sheet.rows.length || cc >= sheet.angles.length) return
    const v = t.cells[rr][cc][readout]
    if (v !== answer) near.push(v)
  }
  for (const dt of [-1, 1]) {
    const other = sheet.tables[ti + dt]
    if (other) push(other, r, c)
  }
  push(table, r - 1, c); push(table, r + 1, c)
  push(table, r, c - 1); push(table, r, c + 1)
  for (const dt of [-2, 2]) {
    const other = sheet.tables[ti + dt]
    if (other) push(other, r, c)
  }

  const opts = new Set([answer])
  for (const v of shuffle(near, rng)) {
    if (opts.size >= MATF_OPTIONS) break
    opts.add(v)
  }
  let filler = 1
  while (opts.size < MATF_OPTIONS) { opts.add(answer + filler); filler++ }

  return {
    part: 'sheet',
    airSpeed: table.airSpeed,
    windVelocity: sheet.rows[r],
    windAngle: sheet.angles[c],
    readout,
    readoutLabel: READOUTS[readout].label,
    unit: READOUTS[readout].unit,
    answer,
    options: shuffle([...opts], rng),
  }
}
