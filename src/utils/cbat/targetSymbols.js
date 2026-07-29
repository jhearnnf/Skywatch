// How a Target scene symbol is described in words.
//
// The game shows the player a text label in the Scene Targets panel and expects
// them to find the symbol matching it, so the wording here is the contract
// between the two. Lives outside CbatTarget.jsx so the tutorial's example target
// can be checked against it without the page having to export non-components.

// "damaged high-priority hostile tanks facing north" — adjectives first, then the
// pluralised kind, then the facing. Order matters: it's what the player reads.
export function labelFor(t) {
  const adj = []
  if (t.damaged) adj.push('damaged')
  if (t.highPriority) adj.push('high-priority')
  adj.push(t.color)
  let base = t.kind + 's'
  if (t.direction) base += ` facing ${{ N: 'north', E: 'east', S: 'south', W: 'west' }[t.direction]}`
  return adj.join(' ') + ' ' + base
}

// The tutorial's worked example — one target carrying every mark the game uses,
// so the "Read a full target" section can draw them on one at a time. Fixed
// rather than random so the coach copy can name each part precisely.
export const DEMO_TARGET = {
  kind: 'tank', color: 'hostile', damaged: true, highPriority: true, direction: 'N',
}

// Does `shape` satisfy `target`? Kind and colour must be exact; the marks are
// requirements rather than an exact spec, so a target that doesn't ask for a mark
// is satisfied whether or not the shape carries it. Diamonds and decoys never
// count. This is the predicate the whole scoring loop turns on.
export function shapeMatches(shape, target) {
  if (shape.fake || shape.kind === 'unknown') return false
  if (shape.kind !== target.kind) return false
  if (shape.color !== target.color) return false
  if (target.damaged && !shape.damaged) return false
  if (target.highPriority && !shape.highPriority) return false
  if (target.direction && shape.direction !== target.direction) return false
  return true
}

// The example's label split into the tokens the tutorial lights individually.
// These are in labelFor()'s emission order, which is NOT the order the tutorial
// reveals the marks in (shape → colour → damaged → hi-pri → facing). The chip
// therefore shows the whole label from the start and lights the token belonging
// to the mark being drawn, so the player never sees the label in a word order the
// live game wouldn't produce. A test asserts these join back to labelFor().
export const DEMO_LABEL_TOKENS = ['damaged', 'high-priority', 'hostile', 'tanks', 'facing north']

// How many matching targets the player has to find before the section will move
// on. Having had the symbol explained, they have to prove they can read one.
export const DEMO_HUNT_REQUIRED = 5

// Salt for the hunt scene. Each entry differs from DEMO_TARGET in exactly one
// mark, so the player has to check every word of the label rather than pattern-
// matching "red box". A test asserts none of them match and that each differs in
// only one respect — a near miss that differed in two would teach nothing.
export const DEMO_NEAR_MISSES = [
  { ...DEMO_TARGET, direction: 'E' },       // right symbol, wrong way round
  { ...DEMO_TARGET, direction: 'S' },
  { ...DEMO_TARGET, damaged: false },       // no X
  { ...DEMO_TARGET, highPriority: false },  // no arms
  { ...DEMO_TARGET, color: 'friendly' },    // wrong side
  { ...DEMO_TARGET, color: 'neutral' },
  { ...DEMO_TARGET, kind: 'truck' },        // wrong shape
  { ...DEMO_TARGET, kind: 'building' },
]

// Every shape the hunt scene must contain, matches first. Positioning and the
// unrelated filler are the caller's business.
export function planDemoHuntTargets() {
  return [
    ...Array.from({ length: DEMO_HUNT_REQUIRED }, () => ({ ...DEMO_TARGET })),
    ...DEMO_NEAR_MISSES.map(m => ({ ...m })),
  ]
}
