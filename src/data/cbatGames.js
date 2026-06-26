// Source of truth for the CBAT game list. Imported by:
//  - src/pages/Cbat.jsx (the hub page)
//  - src/components/homePreview/registries/cbatRegistry.js (landing preview)
//
// Adding a new CBAT game: append a row here. The Cbat hub picks it up
// automatically; if its `path` is set and a matching scene exists in
// src/components/homePreview/scenes/cbat/, the landing preview includes it too.
export const CBAT_GAMES = [
  { key: 'target',          emoji: '🎯', title: 'Target',           desc: 'Multi-task across eight panels — hunt shapes, match lights, ID aircraft, find codes.', path: '/cbat/target',          image: '/images/Target.png' },
  { key: 'ant',             emoji: '📡', title: 'ANT',              desc: 'Airborne Numerical Test — speed, distance and time. Compute arrival, distance, fuel or speed against the clock.', path: '/cbat/ant',             image: '/images/ANT.png' },
  { key: 'symbols',         emoji: '🔣', title: 'Symbols',          desc: 'Spot the target symbol in a growing grid, round by round.', path: '/cbat/symbols',         image: '/images/Symbols.png' },
  { key: 'code-duplicates', emoji: '🧩', title: 'Code Duplicates',  desc: 'Memorise a sequence of digits, then count how many times one appeared.', path: '/cbat/code-duplicates', image: '/images/Code Duplicates.png' },
  { key: 'angles',          emoji: '📐', title: 'Angles',           desc: 'Judge angles quickly and accurately.',                  path: '/cbat/angles',          image: '/images/Angles.png' },
  { key: 'instruments',     emoji: '🛫', title: 'Instruments',      desc: 'Read cockpit instruments under time pressure.',         path: '/cbat/instruments',     image: '/images/Instruments.png' },
  { key: 'plane-turn',      emoji: '🗺️', title: 'Trace 1/2',         desc: 'Practise your turn and heading, or take the Trace recall test.',             path: '/cbat/trace',           image: '/images/Plane Turn.png' },
  { key: 'flag',             emoji: '🚩', title: 'FLAG',             desc: 'Track aircraft, answer maths and identification questions, hit target shapes — all in 60 seconds.', path: '/cbat/flag',            image: '/images/FLAG.png' },
  { key: 'visualisation',    emoji: '🧊', title: 'Visualisation 2D/3D', desc: 'Mentally weld 2D shapes or mentally rotate 3D composites to spot the matching figure.', path: '/cbat/visualisation',    image: '/images/Visualisation 2D.png' },
  { key: 'dpt',              emoji: '🛩️', title: 'DPT',              desc: 'Dynamic Projection Test — vector multiple aircraft through gates and intercept enemy contacts using compass bearings.', path: '/cbat/dpt',             image: '/images/DPT.png' },
  { key: 'act',              emoji: '🎧', title: 'ACT',              desc: 'Auditory Capacity Test — track callsigns, steer through the right gates, react to bleeps.', path: '/cbat/act',             image: '/images/ACT.png' },
  { key: 'numerical-ops',    emoji: '🧮', title: 'Numerical Operations', desc: 'Two-number arithmetic against the clock — +, −, ×, ÷ across four escalating rounds.', path: '/cbat/numerical-ops',  image: '/images/Numerical Operations.png' },
  { key: 'dad',              emoji: '🧭', title: 'DAD',              desc: 'Directions and Distances — track a journey of relative turns from text alone, then name the direction back to the start.', path: '/cbat/dad',             image: '/images/DAD.png' },
  // `beta: true` surfaces a BETA badge on the hub tile — SAT is live but still
  // being polished. Drop the flag once it's finished.
  { key: 'sat',              emoji: '🗺️', title: 'SAT',              desc: 'Situational Awareness Test — observe a tactical picture of units, aircraft and radio calls, then recall the details from memory.', path: '/cbat/sat',             image: '/images/SAT.png', beta: true },
]

// Per-leaderboard display config, keyed by the backend leaderboard gameKey
// (the URL segment, e.g. 'plane-turn-2d', 'trace-1', 'target'). Shared by the
// leaderboard page (src/pages/CbatLeaderboard.jsx) and the post-game reveal
// (src/components/CbatGameOver.jsx) so score formatting lives in one place.
// Adding a new game = one entry here + one entry in the backend CBAT_GAMES
// registry, and both the board and the reveal pick it up.
//   lowerIsBetter — all-time board direction (weekly is always higher-better,
//                   because lower-better games sum a derived points value).
//   hideTime      — game has no meaningful per-run time column.
export const CBAT_LEADERBOARD_CONFIG = {
  'plane-turn-2d':   { title: 'Trace Practise 2D', emoji: '🗺️', scoreLabel: 'Rotations', lowerIsBetter: true,  formatScore: (s) => `${s}`,     backPath: '/cbat/trace',          planeTurnMode: '2d' },
  'plane-turn-3d':   { title: 'Trace Practise 3D', emoji: '🗺️', scoreLabel: 'Rotations', lowerIsBetter: true,  formatScore: (s) => `${s}`,     backPath: '/cbat/trace',          planeTurnMode: '3d' },
  'trace-1':         { title: 'Trace 1',           emoji: '🛩️', scoreLabel: 'Correct',   lowerIsBetter: false, formatScore: (s) => `${s}/40`,  backPath: '/cbat/trace',          hideTime: true },
  'angles':          { title: 'Angles',            emoji: '📐',  scoreLabel: 'Correct',   lowerIsBetter: false, formatScore: (s) => `${s}/20`,  backPath: '/cbat/angles' },
  'code-duplicates': { title: 'Code Duplicates',   emoji: '🧩',  scoreLabel: 'Correct',   lowerIsBetter: false, formatScore: (s) => `${s}/15`,  backPath: '/cbat/code-duplicates' },
  'symbols':         { title: 'Symbols',           emoji: '🔣',  scoreLabel: 'Correct',   lowerIsBetter: false, formatScore: (s) => `${s}/15`,  backPath: '/cbat/symbols' },
  'target':          { title: 'Target',            emoji: '🎯',  scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/target',         hideTime: true },
  'instruments':     { title: 'Instruments',       emoji: '🛫',  scoreLabel: 'Correct',   lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/instruments',    hideTime: true },
  'ant':             { title: 'ANT',               emoji: '📡',  scoreLabel: 'Points',    lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/ant' },
  'flag':            { title: 'FLAG',              emoji: '🚩',  scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/flag',           hideTime: true },
  'visualisation-2d':{ title: 'Visualisation 2D',  emoji: '🧮',  scoreLabel: 'Correct',   lowerIsBetter: false, formatScore: (s) => `${s}/8`,   backPath: '/cbat/visualisation' },
  'visualisation-3d':{ title: 'Visualisation 3D',  emoji: '🧊',  scoreLabel: 'Correct',   lowerIsBetter: false, formatScore: (s) => `${s}/8`,   backPath: '/cbat/visualisation' },
  'dpt':             { title: 'DPT',               emoji: '🛩️', scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/dpt' },
  'act':             { title: 'ACT',               emoji: '🎧',  scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/act',            hideTime: true },
  'numerical-ops':   { title: 'Numerical Operations', emoji: '🧮', scoreLabel: 'Correct %', lowerIsBetter: false, formatScore: (s) => `${s}%`, backPath: '/cbat/numerical-ops' },
  'dad':             { title: 'Directions & Distances', emoji: '🧭', scoreLabel: 'Correct', lowerIsBetter: false, formatScore: (s) => `${s}/15`, backPath: '/cbat/dad' },
  'sat':             { title: 'Situational Awareness Test', emoji: '🗺️', scoreLabel: 'Correct', lowerIsBetter: false, formatScore: (s) => `${s}/18`, backPath: '/cbat/sat' },
}

// Admin-side list — one entry per backend cbatGameEnabled key. Diverges from
// CBAT_GAMES at TRACE 1/2 and Visualisation 2D/3D: the hub shows one tile each
// linking to a combined page, but the backend registry splits those keys into
// separate per-mode entries, so admins get an independent enable/disable per
// mode. The TRACE 1/2 tile fans out into the two Practise modes plus Trace 1.
export const CBAT_ADMIN_GAMES = CBAT_GAMES.flatMap(g => {
  if (g.key === 'plane-turn') {
    return [
      { ...g, key: 'plane-turn-2d', title: 'Trace Practise 2D' },
      { ...g, key: 'plane-turn-3d', title: 'Trace Practise 3D' },
      { ...g, key: 'trace-1',       title: 'Trace 1' },
    ]
  }
  if (g.key === 'visualisation') {
    return [
      { ...g, key: 'visualisation-2d', title: 'Visualisation 2D' },
      { ...g, key: 'visualisation-3d', title: 'Visualisation 3D' },
    ]
  }
  return [g]
})
