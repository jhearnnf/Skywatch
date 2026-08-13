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
// generateSitRound({ classes, rotations, hillCount, questionsPerClip }, rng)
//   → { grid, rotation, layers, clip, questions, corruptedClasses }
//     layers    = [{ cls, objects: [{ id, cls, col, row }] }] — hills on each
//     clip      = [{ id, cls, col, row }]  (col/row are 0-indexed)
//     questions = [{ askedClass, answer, prompt }]
//     answer    = true when that class is placed correctly in the clip

export const GRID = 6
export const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

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
  aircraft: 'aircraft',
  helicopter: 'helicopters',
  hill: 'hills',
}

// Per-class count. Aircraft and helicopters stay sparse — they carry a heading
// as well as a position, which is more to hold than a static feature.
const CLASS_COUNT = {
  farm: 2, truck: 2, troops: 1, trees: 2, aircraft: 1, helicopter: 1,
}

// Classes that carry a flight path (a heading arrow) as well as a position.
export const MOVING_CLASSES = new Set(['aircraft', 'helicopter'])
const HEADINGS = ['N', 'E', 'S', 'W']

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
export function sitRoundPlan(index, { classPool, rotations, questionsPerClip }) {
  const floor = questionsPerClip + 1
  const unlocked = Math.min(classPool.length, floor + index)
  return {
    classes: classPool.slice(0, unlocked),
    rotations,
    questionsPerClip,
  }
}

export function generateSitRound({ classes, rotations, hillCount = 2, questionsPerClip = 2 }, rng = Math.random) {
  const cells = []
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) cells.push({ col: c, row: r })
  const free = shuffle(cells, rng)
  let next = 0
  const take = () => free[next++]

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
  const layers = classes.map(cls => {
    const objects = [...hills]
    for (let i = 0; i < CLASS_COUNT[cls]; i++) {
      const cell = take()
      const obj = { id: `${cls}-${i}`, cls, col: cell.col, row: cell.row }
      if (MOVING_CLASSES.has(cls)) obj.heading = pick(HEADINGS, rng)
      objects.push(obj)
    }
    return { cls, objects }
  })

  // The full scene, which no layer shows and which only the clip ever displays.
  const scene = [...hills, ...layers.flatMap(l => l.objects.filter(o => o.cls !== 'hill'))]

  const rotation = pick(rotations, rng)

  // The clip is the assembled scene, rotated. `truth` is a frozen copy of what
  // the clip SHOULD look like, taken before anything is corrupted — the review
  // screen shows the two side by side, and reconstructing it afterwards by
  // un-rotating a corrupted clip would be guesswork.
  const clip = scene.map(o => {
    const { col, row } = rotateCell(o.col, o.row, rotation)
    const out = { ...o, col, row }
    if (o.heading) out.heading = rotateHeading(o.heading, rotation)
    return out
  })
  const truth = clip.map(o => ({ ...o }))

  // Cells nothing occupies in the clip — where a corrupted object can move to
  // without landing on top of something and reading as a different error.
  const occupied = new Set(clip.map(o => `${o.col},${o.row}`))
  const vacant = shuffle(
    cells.filter(c => !occupied.has(`${c.col},${c.row}`)),
    rng,
  )
  let vacantNext = 0
  const takeVacant = () => vacant[vacantNext++]

  // Move one object of `cls` to a free cell, so that class reads as wrong.
  const corrupt = (cls) => {
    const candidates = clip.filter(o => o.cls === cls)
    if (!candidates.length) return false
    const cell = takeVacant()
    if (!cell) return false
    const victim = candidates[Math.floor(rng() * candidates.length)]
    victim.col = cell.col
    victim.row = cell.row
    occupied.add(`${cell.col},${cell.row}`)
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
  }
}

export function generateSitRounds({ roundCount, classPool, rotations, hillCount, questionsPerClip }, rng = Math.random) {
  const out = []
  for (let i = 0; i < roundCount; i++) {
    const plan = sitRoundPlan(i, { classPool, rotations, questionsPerClip })
    out.push(generateSitRound({ ...plan, hillCount }, rng))
  }
  return out
}
