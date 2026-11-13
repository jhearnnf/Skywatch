// CBAT "Spatial Integration Test" (SIT) round generator.
//
// What the real test is, from the candidate accounts in the guide corpus:
// "Eight or nine tabs, each showing one isolated layer of the same landscape —
// farm position, truck, troops, trees, aircraft flight paths with their speed
// and altitude charts, helicopter paths with theirs. No tab shows the full
// picture, and the whole sequence runs for one minute, so the time per tab is
// not equal. Afterwards you get a 3D rendered video of the scene and about 50
// seconds of true/false questions on it, with no replay."
//
// THE LAYERS ARE THE TEST. This generator handed the player one composite map
// holding everything at once until the guide was read back against it — which is
// a memory task. Assembling a scene you have only ever seen a layer at a time is
// what makes it an INTEGRATION task, and it is the thing the name of the test is
// pointing at. `study` is therefore a list of layers, and no layer holds more
// than one class of object.
//
// Three mechanics from the corpus drive every other decision here:
//
//   1. "Only the detail being asked about has to be right. Everything else in
//      the image can be wrong and it doesn't matter." This is described as
//      possibly the difference between passing and failing, so the generator
//      makes it the ACTUAL winning strategy rather than just saying it in the
//      instructions: on every clip, at least one class NOBODY ASKS ABOUT is
//      deliberately wrong. A player who checks the whole frame therefore answers
//      "no" and loses the point. A player who checks only what was asked scores.
//
//   2. "Use fixed terrain like hills as reference points." The hills are the
//      only feature that never moves, and — because they appear on EVERY layer —
//      they are also the only thing that lets the layers be registered against
//      each other at all. Drop them from a layer and that layer becomes
//      unusable, not merely harder.
//
//   3. Several questions per clip, not one. The corpus gives "about 50 seconds
//      of true/false questions on it, with no replay" — plural, off a single
//      viewing. One question per clip lets a player watch for one thing only.
//
// The integration itself is a ROTATION: the clip shows the same terrain turned
// 90°, 180° or 270° from the studied layers. That is what makes this a spatial
// task rather than a memory one — the positions are all still there, just not
// where you left them, and the hills tell you by how much.
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) to reproduce a round
// in tests. Defaults to Math.random for live play.
//
// THE LAYERS ARE NOT ALL NORTH-UP EITHER. A candidate who sat the real test
// (2026-10) reported that some tabs — the trucks tab was the example — showed
// the map turned, with the compass rose turned the same way. So a layer can
// carry its own `rotation`, and lining it up against the others means turning
// it back in your head first. The objects on a layer stay in TRUE (north-up)
// coordinates; the rotation is applied when it is drawn, exactly as a turned
// paper map still shows the same ground. Keeping the data north-up is what
// lets every other rule in this file stay stated against one frame.
//
// AIRCRAFT FLY, AND IT IS THE FLIGHT THAT IS JUDGED. Four passers in the CBAT
// outcome survey (2026-10/11) describe the real test's aircraft the same way:
// a red jet and a yellow jet arrive late in the test, each briefed as a dotted
// path on the map plus a separate altitude-against-time graph, and a helicopter
// briefed as a row of dots marked H, M or L. In the clip they fly through the
// scene, and "the flight path, speed and altitude/changes in altitude had to be
// accurate". So a moving object here is a straight flight, not a parked marker:
//
//   col/row    where the flight STARTS (north-up, like everything else)
//   heading    which way it flies, N/E/S/W
//   jets       `colour` red|yellow, `profile` climb|descend|level
//   helicopter `levels`, one of L/M/H per waypoint, first and last different
//
// A wrong flight is wrong in exactly ONE of two ways: its DIRECTION (turned a
// quarter or more, or flown backwards) or its ALTITUDE (the opposite trend for
// a jet, the H/M/L sequence run backwards for the helicopter). Speed is left
// out on purpose for now: every flight of a class covers the same distance in
// the same time, because a turning three-second camera pass gives the player
// nothing to measure speed against. A passer is being asked how they judged it.
//
// The two jets are ONE class ("jets"), asked about together. Two classes would
// push Hard's pool to seven, and the one-more-class-per-clip ramp tops out at
// six, so the yellow jet or the helicopter would never appear.
//
// generateSitRound({ classes, rotations, layerRotations, maxRotatedLayers,
//                    hillCount, questionsPerClip }, rng)
//   → { grid, rotation, layers, clip, truth, questions, corruptedClasses, corruptions }
//     layers    = [{ cls, kind, rotation, objects }] — kind 'map' carries the
//                 hills; kind 'altitude' is the jets' altitude graph, no ground
//     clip      = [{ id, cls, col, row, ...flight }]  (col/row are 0-indexed)
//     questions = [{ askedClass, answer, prompt }]
//     answer    = true when that class is correct in the clip
//     corruptions = [{ id, cls, kind }], kind 'position' | 'direction' | 'altitude'

// 8 × 8, not 6 × 6. The real test's ground is roomier than ours was — a sitter
// (2026-10) found it "easier to distinguish whether objects were in the right
// place" — and on a 6 × 6 board the same dozen objects sat shoulder to shoulder.
// The object counts did not grow with it, so the extra room is all spacing.
export const GRID = 8
export const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// How far a corrupted object must move, in cells (Chebyshev: a diagonal step
// counts as one). A one-cell nudge in an oblique 3D pass is a judgement about
// perspective, not about where the thing is, and the real test's misplacements
// read as plainly wrong. Two cells is unmistakable without being a giveaway.
export const MIN_CORRUPTION_DISTANCE = 2

// Every class that can appear, in the order rounds unlock them. Named after the
// things the corpus lists — "farm position, truck, troops, trees, aircraft
// flight paths ... helicopter paths". `hill` is not here: hills are the fixed
// reference terrain, are never asked about and are never corrupted, so they are
// generated separately and drawn onto every layer.
export const OBJECT_CLASSES = ['farm', 'truck', 'troops', 'trees', 'aircraft', 'helicopter']

export const CLASS_LABEL = {
  farm: 'farms',
  truck: 'trucks',
  troops: 'troops',
  trees: 'trees',
  aircraft: 'jets',
  helicopter: 'helicopters',
  hill: 'hills',
}

// Per-class count. Two jets, red and yellow, as every passer describes; one
// helicopter. A flight is more to hold than a parked object.
const CLASS_COUNT = {
  farm: 2, truck: 2, troops: 1, trees: 2, aircraft: 2, helicopter: 1,
}

// Classes that fly during the clip.
export const MOVING_CLASSES = new Set(['aircraft', 'helicopter'])
const HEADINGS = ['N', 'E', 'S', 'W']

// The jets' colours, in id order: aircraft-0 is red, aircraft-1 yellow.
export const JET_COLOURS = ['red', 'yellow']
export const JET_PROFILES = ['climb', 'descend', 'level']
export const HELI_LEVELS = ['L', 'M', 'H']

// How many cells a flight covers across the clip. Fixed per class, which is
// what "speed is left out" means: a jet always covers three cells and a
// helicopter two, so no flight can be wrong on speed alone.
export const FLIGHT_CELLS = { aircraft: 3, helicopter: 2 }

// One cell step in each direction. Row grows DOWN the plan, north is up.
const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }

// Every cell a flight passes over, start first. The briefing's dots sit on
// these cells, evenly spaced in time.
export function flightCells(o) {
  const n = FLIGHT_CELLS[o.cls]
  const step = STEP[o.heading]
  if (!n || !step) return [{ col: o.col, row: o.row }]
  return Array.from({ length: n + 1 }, (_, i) => ({ col: o.col + step[0] * i, row: o.row + step[1] * i }))
}

// Where a flight is at a fraction t (0 → 1) of the clip, in fractional cells.
export function flightPointAt(o, t) {
  const n = FLIGHT_CELLS[o.cls] || 0
  const step = STEP[o.heading] || [0, 0]
  const k = Math.min(1, Math.max(0, t)) * n
  return { col: o.col + step[0] * k, row: o.row + step[1] * k }
}

// Height as a fraction of the class's band (0 = lowest, 1 = highest). The
// study graph and the 3D clip both read this, so the two cannot disagree.
const JET_LOW = 0.12
const JET_HIGH = 0.88
export const HELI_FRAC = { L: 0.12, M: 0.5, H: 0.88 }
export function flightHeightAt(o, t) {
  const c = Math.min(1, Math.max(0, t))
  if (o.cls === 'aircraft') {
    if (o.profile === 'climb') return JET_LOW + (JET_HIGH - JET_LOW) * c
    if (o.profile === 'descend') return JET_HIGH - (JET_HIGH - JET_LOW) * c
    return 0.5
  }
  if (o.cls === 'helicopter' && o.levels?.length > 1) {
    const span = (o.levels.length - 1) * c
    const i = Math.min(o.levels.length - 2, Math.floor(span))
    const f = span - i
    return HELI_FRAC[o.levels[i]] * (1 - f) + HELI_FRAC[o.levels[i + 1]] * f
  }
  return 0
}

function flightFits(col, row, heading, cls, size = GRID) {
  return flightCells({ cls, col, row, heading })
    .every(c => c.col >= 0 && c.col < size && c.row >= 0 && c.row < size)
}

// Does a clip object match what it should have been? Position for everything,
// and for a flight its direction and altitude as well.
export function sameAsTruth(o, t) {
  if (o.col !== t.col || o.row !== t.row) return false
  if (!MOVING_CLASSES.has(o.cls)) return true
  if (o.heading !== t.heading) return false
  if (o.profile !== t.profile) return false
  return (o.levels || []).join() === (t.levels || []).join()
}

// The study tabs a set of classes makes: one map per class, plus the jets'
// altitude graph, which is a tab of its own in the real test.
export function sitLayerCount(classes) {
  return classes.length + (classes.includes('aircraft') ? 1 : 0)
}

export function layerLabel(layer) {
  return layer.kind === 'altitude' ? 'jet altitude' : CLASS_LABEL[layer.cls]
}

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)]

// Rotate a cell clockwise about the centre of a GRID×GRID board.
//   90°:  (col, row) → (GRID-1-row, col)
// Applied repeatedly for 180 and 270. Kept as one small function so the
// rotation used to build the clip and the rotation a test checks against are
// literally the same code.
export function rotateCell(col, row, degrees, size = GRID) {
  let c = col, r = row
  const turns = ((degrees / 90) % 4 + 4) % 4
  for (let i = 0; i < turns; i++) {
    const nc = size - 1 - r
    const nr = c
    c = nc; r = nr
  }
  return { col: c, row: r }
}

// A heading rotates with the map it is drawn on.
export function rotateHeading(heading, degrees) {
  const turns = ((degrees / 90) % 4 + 4) % 4
  const i = HEADINGS.indexOf(heading)
  if (i < 0) return heading
  return HEADINGS[(i + turns) % HEADINGS.length]
}

export function cellRef(col, row) {
  return `${COL_LABELS[col]}${row + 1}`
}

// Which classes a round uses, and how far it may rotate. Rounds ramp — "as it
// goes on it adds more for you to learn, including aircraft, helicopters and
// their flight paths" — so each clip unlocks one more layer than the last.
//
// The floor is questionsPerClip + 1, never lower: every clip has to corrupt one
// class that nobody asks about, and that is impossible if every class present is
// asked about. The distractor rule is the whole test, so the floor protects it.
export function sitRoundPlan(index, { classPool, rotations, layerRotations, maxRotatedLayers, questionsPerClip }) {
  const floor = questionsPerClip + 1
  const unlocked = Math.min(classPool.length, floor + index)
  return {
    classes: classPool.slice(0, unlocked),
    rotations,
    layerRotations,
    maxRotatedLayers,
    questionsPerClip,
  }
}

const chebyshev = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))

export function generateSitRound({
  classes, rotations, layerRotations = [], maxRotatedLayers = 0,
  hillCount = 2, questionsPerClip = 2,
}, rng = Math.random) {
  const cells = []
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) cells.push({ col: c, row: r })
  const free = shuffle(cells, rng)
  let next = 0
  const take = () => free[next++]
  // The next free cell that passes `ok`, swapped forward so `take` never hands
  // it out twice. A flight needs a start its whole path fits from.
  const takeWhere = (ok) => {
    const i = free.findIndex((c, j) => j >= next && ok(c))
    if (i < 0) return take()
    ;[free[next], free[i]] = [free[i], free[next]]
    return take()
  }

  // Hills first — the fixed reference terrain. Never corrupted, never asked.
  const hills = []
  for (let i = 0; i < hillCount; i++) {
    const cell = take()
    hills.push({ id: `hill-${i}`, cls: 'hill', col: cell.col, row: cell.row })
  }

  // One layer per class, each carrying the hills and NOTHING from any other
  // class. This is the thing that makes the test an integration task: the whole
  // scene exists, but the player only ever sees a slice of it at a time and has
  // to build the rest themselves.
  const mapLayers = classes.map(cls => {
    const objects = [...hills]
    for (let i = 0; i < CLASS_COUNT[cls]; i++) {
      if (MOVING_CLASSES.has(cls)) {
        const heading = pick(HEADINGS, rng)
        const cell = takeWhere(c => flightFits(c.col, c.row, heading, cls))
        const obj = { id: `${cls}-${i}`, cls, col: cell.col, row: cell.row, heading }
        if (cls === 'aircraft') {
          obj.colour = JET_COLOURS[i % JET_COLOURS.length]
          obj.profile = pick(JET_PROFILES, rng)
        } else {
          // First and last always differ, so running the sequence backwards
          // (the helicopter's altitude fault) always changes something.
          const first = pick(HELI_LEVELS, rng)
          obj.levels = [first, pick(HELI_LEVELS, rng), pick(HELI_LEVELS.filter(l => l !== first), rng)]
        }
        objects.push(obj)
        continue
      }
      const cell = take()
      objects.push({ id: `${cls}-${i}`, cls, col: cell.col, row: cell.row })
    }
    return { cls, kind: 'map', rotation: 0, objects }
  })

  // Turn some of the map layers. Between one and `maxRotatedLayers` of them, and
  // never all: at least one layer stays north-up, so there is always a map that
  // reads the way the compass rose normally sits. The altitude graph is not a
  // map and is never turned.
  const rotatable = Math.min(maxRotatedLayers, mapLayers.length - 1)
  if (layerRotations.length && rotatable > 0) {
    const count = 1 + Math.floor(rng() * rotatable)
    for (const layer of shuffle(mapLayers, rng).slice(0, count)) {
      layer.rotation = pick(layerRotations, rng)
    }
  }

  // The jets' altitude graph sits straight after their path map, as its own
  // tab: "flight paths on a separate briefing page on a graph, tracking time on
  // the x axis and altitude on the y axis".
  const layers = mapLayers.flatMap(layer => (layer.cls === 'aircraft'
    ? [layer, { cls: 'aircraft', kind: 'altitude', rotation: 0, objects: layer.objects.filter(o => o.cls === 'aircraft') }]
    : [layer]))

  // The full scene, which no layer shows and which only the clip ever displays.
  const scene = [...hills, ...mapLayers.flatMap(l => l.objects.filter(o => o.cls !== 'hill'))]

  const rotation = pick(rotations, rng)

  // The clip is the assembled scene, rotated. `truth` is a frozen copy of what
  // the clip SHOULD look like, taken before anything is corrupted — the review
  // screen shows the two side by side, and reconstructing it afterwards by
  // un-rotating a corrupted clip would be guesswork.
  const clip = scene.map(o => {
    const { col, row } = rotateCell(o.col, o.row, rotation)
    const out = { ...o, col, row }
    if (o.heading) out.heading = rotateHeading(o.heading, rotation)
    if (o.levels) out.levels = [...o.levels]
    return out
  })
  const truth = clip.map(o => (o.levels ? { ...o, levels: [...o.levels] } : { ...o }))

  // Cells nothing occupies in the clip — where a corrupted object can move to
  // without landing on top of something and reading as a different error.
  const occupied = new Set(clip.map(o => `${o.col},${o.row}`))
  const vacant = shuffle(
    cells.filter(c => !occupied.has(`${c.col},${c.row}`)),
    rng,
  )

  const corruptions = []
  const cellKey = (c) => `${c.col},${c.row}`

  // A flight goes wrong in exactly one way: its direction or its altitude.
  // Never its speed, which is fixed per class (see FLIGHT_CELLS).
  const corruptFlight = (victim) => {
    const kind = rng() < 0.5 ? 'direction' : 'altitude'
    if (kind === 'altitude') {
      if (victim.cls === 'aircraft') {
        // The opposite trend: climb and descend swap, level becomes either.
        victim.profile = victim.profile === 'climb' ? 'descend'
          : victim.profile === 'descend' ? 'climb'
            : pick(['climb', 'descend'], rng)
      } else {
        victim.levels = [...victim.levels].reverse()
      }
    } else {
      // Turned a quarter or more from the same start, or flown back the way it
      // came from the far end. Only options the whole path fits, and never a
      // start that something else is standing on.
      const end = flightCells(victim).at(-1)
      const options = [90, 180, 270]
        .map(turn => ({ col: victim.col, row: victim.row, heading: rotateHeading(victim.heading, turn) }))
        .filter(o => flightFits(o.col, o.row, o.heading, victim.cls))
      if (!occupied.has(cellKey(end))) {
        options.push({ col: end.col, row: end.row, heading: rotateHeading(victim.heading, 180) })
      }
      const choice = pick(options, rng)
      occupied.delete(cellKey(victim))
      Object.assign(victim, choice)
      occupied.add(cellKey(victim))
    }
    corruptions.push({ id: victim.id, cls: victim.cls, kind })
    return true
  }

  // Move one object of `cls` to a free cell at least MIN_CORRUPTION_DISTANCE
  // from where it belongs, so that class reads as plainly wrong. A flight is
  // made wrong in its direction or its altitude instead.
  const corrupt = (cls) => {
    const candidates = clip.filter(o => o.cls === cls)
    if (!candidates.length) return false
    const victim = candidates[Math.floor(rng() * candidates.length)]
    if (MOVING_CLASSES.has(cls)) return corruptFlight(victim)
    const i = vacant.findIndex(c =>
      !occupied.has(`${c.col},${c.row}`) && chebyshev(c, victim) >= MIN_CORRUPTION_DISTANCE)
    if (i < 0) return false
    const [cell] = vacant.splice(i, 1)
    victim.col = cell.col
    victim.row = cell.row
    occupied.add(`${cell.col},${cell.row}`)
    corruptions.push({ id: victim.id, cls, kind: 'position' })
    return true
  }

  // Distinct classes, one per question — asking twice about the same class off
  // one clip is a free second mark.
  const askedClasses = shuffle(classes, rng).slice(0, Math.min(questionsPerClip, classes.length))

  const corruptedClasses = []
  const questions = askedClasses.map(askedClass => {
    const answer = rng() < 0.5   // true = that class IS correct in the clip
    if (!answer && corrupt(askedClass)) corruptedClasses.push(askedClass)
    return {
      askedClass,
      answer,
      prompt: `Are the ${CLASS_LABEL[askedClass]} in this image correct?`,
    }
  })

  // The mechanic that makes "only check what was asked" the winning play: at
  // least one class NOBODY IS ASKED ABOUT is wrong too, so the frame as a whole
  // is unreliable whichever way the answers go. This is why sitRoundPlan floors
  // the class count at questionsPerClip + 1 — with every class asked about there
  // would be nothing left to corrupt.
  const others = classes.filter(c => !askedClasses.includes(c))
  if (others.length) {
    const distractor = pick(others, rng)
    if (corrupt(distractor)) corruptedClasses.push(distractor)
  }

  return {
    grid: GRID,
    rotation,
    layers,
    clip,
    truth,
    questions,
    corruptedClasses,
    corruptions,
  }
}

export function generateSitRounds({
  roundCount, classPool, rotations, layerRotations, maxRotatedLayers, hillCount, questionsPerClip,
}, rng = Math.random) {
  const out = []
  for (let i = 0; i < roundCount; i++) {
    const plan = sitRoundPlan(i, { classPool, rotations, layerRotations, maxRotatedLayers, questionsPerClip })
    out.push(generateSitRound({ ...plan, hillCount }, rng))
  }
  return out
}
