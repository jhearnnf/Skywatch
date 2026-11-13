// Shared colours for the Spatial Integration Test's object classes.
//
// Two renderers draw the same scene and must agree on what a truck looks like:
// the flat top-down SVG used for the study layers and the review diagram
// (CbatSit.jsx), and the 3D camera pass used for the clip (SitClipScene.jsx).
// A player registers the clip against the layers by colour and shape, so a
// palette that drifted between the two would break the test rather than
// restyle it.
//
// `shape` is the 2D marker only. The 3D scene builds its own geometry per class
// — a cone reads as a hill from above and as nothing in particular from the
// side — but it takes its colours from here.
//
// Every class gets a distinct SHAPE as well as a distinct colour. Colour alone
// would make the whole test a colour-matching exercise on a three-second look,
// and would fail anyone reading it on a poor screen.

// Once the clip's ground became textured grass, two of these stopped working:
// a green farm and green trees on a green field are realistic and useless. The
// farm is now barn red — which is both what a barn looks like and the strongest
// contrast available against grass — and the trees moved to a lighter, bluer
// green than the ground they stand on. Anything added here has to survive the
// same question: can you still pick it out of a field in three seconds?
export const CLASS_STYLE = {
  hill:       { fill: '#5a4a2c', stroke: '#8a7248', shape: 'triangle' },
  farm:       { fill: '#8c3a2b', stroke: '#c86a52', shape: 'square' },
  truck:      { fill: '#4a4a52', stroke: '#9aa2b0', shape: 'truck' },
  troops:     { fill: '#7a3030', stroke: '#e08080', shape: 'troops' },
  trees:      { fill: '#3f7a48', stroke: '#6fbf7a', shape: 'tree' },
  aircraft:   { fill: '#8a4520', stroke: '#f0a35c', shape: 'arrow' },
  // Cyan, not the yellow it used to be: the real test's jets are red and
  // yellow, and a yellow helicopter beside a yellow jet is two contacts that
  // only differ in silhouette on a three-second look.
  helicopter: { fill: '#1f5f6a', stroke: '#5fd8e6', shape: 'rotor' },
}

// The two jets carry their own colours, which are what tell them apart on the
// path map, the altitude graph and in the clip. Every passer who described them
// named the same pair.
export const JET_STYLE = {
  red:    { fill: '#9a2a22', stroke: '#ff6a5a', shape: 'arrow', label: 'Red jet' },
  yellow: { fill: '#8f7a12', stroke: '#ffe04a', shape: 'arrow', label: 'Yellow jet' },
}

// The style one object is drawn in: a jet by its colour, anything else by class.
export function styleFor(o) {
  if (o.cls === 'aircraft' && JET_STYLE[o.colour]) return JET_STYLE[o.colour]
  return CLASS_STYLE[o.cls]
}

// Which way a marker points on the ground. North is up on the 2D map, which is
// −Z in the 3D scene, so the two agree by construction.
export const HEADINGS = ['N', 'E', 'S', 'W']
export const HEADING_DEG = { N: 0, E: 90, S: 180, W: 270 }
