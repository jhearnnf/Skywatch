// Source of truth for the CBAT game list. Imported by:
//  - src/pages/Cbat.jsx (the hub page)
//  - src/components/homePreview/registries/cbatRegistry.js (landing preview)
//
// Adding a new CBAT game: append a row here. The Cbat hub picks it up
// automatically; if its `path` is set and a matching scene exists in
// src/components/homePreview/scenes/cbat/, the landing preview includes it too.
//
// `estMinutes` — how long a run takes, shown on the hub tile so a player can
// pick a game that fits the time they have. A number, or [min, max] where one
// tile covers two run lengths (Trace 1/2, Visualisation 2D/3D, and the games
// with an Easier/Hard split). Rounded to the nearest minute, or .5 below two
// minutes where whole minutes would be misleading.
//
// These came from the median recorded `totalTime` of real runs in prod, not
// from guesswork — but `totalTime` does not mean the same thing in every game,
// so four needed correcting before use:
//   • ACT stores a placeholder (CbatAct.jsx computes it from a flat
//     curveLen = 100 per round, which is not the real tunnel length). Measured
//     properly off buildTunnelCurve().getLength() / speed, a run is ~5:08, not
//     the ~1:41 every row in the collection claims.
//   • SAT sums per-question time only, so it omits the OBSERVE_MS study window
//     before each situation — 3×28s on Hard, 2×28s on Easier. Added back.
//   • Numerical Operations likewise omits FEEDBACK_MS between questions.
//   • ANT pauses its clock during round review, so its median understates the
//     wall-clock; the p75 is the fairer figure and is what's used.
// The five fixed-length games (FLAG 60s, Instruments 90s, Target 120s, CUT
// 180s) all measured within a couple of seconds of their caps, which is what
// confirms the units and that the medians are trustworthy elsewhere.
//
// DPT really is ~15 minutes — 8 rounds at ROUND_DURATION_MS = 105s. It is by
// far the longest game here and the measurement agrees with the arithmetic.
export const CBAT_GAMES = [
  { key: 'target',          emoji: '🎯', title: 'Target',           desc: 'Multi-task across eight panels — hunt shapes, match lights, ID aircraft, find codes.', path: '/cbat/target',          image: '/images/Target.png', estMinutes: 2 },
  { key: 'ant',             emoji: '📡', title: 'ANT',              desc: 'Airborne Numerical Test — speed, distance and time. Compute arrival, distance, fuel or speed against the clock.', path: '/cbat/ant',             image: '/images/ANT.png', estMinutes: 5 },
  { key: 'symbols',         emoji: '🔣', title: 'Symbols',          desc: 'Spot the target symbol in a growing grid, round by round.', path: '/cbat/symbols',         image: '/images/Symbols.png', estMinutes: 1 },
  { key: 'code-duplicates', emoji: '🧩', title: 'Code Duplicates',  desc: 'Memorise a sequence of digits, then count how many times one appeared.', path: '/cbat/code-duplicates', image: '/images/Code Duplicates.png', estMinutes: 2 },
  { key: 'angles',          emoji: '📐', title: 'Angles',           desc: 'Judge angles quickly and accurately.',                  path: '/cbat/angles',          image: '/images/Angles.png', estMinutes: 1 },
  { key: 'instruments',     emoji: '🛫', title: 'Instruments',      desc: 'Read cockpit instruments under time pressure.',         path: '/cbat/instruments',     image: '/images/Instruments.png', estMinutes: 1.5 },
  { key: 'plane-turn',      emoji: '🗺️', title: 'Trace 1/2',         desc: 'Practise your turn and heading, or take the Trace recall test.',             path: '/cbat/trace',           image: '/images/Plane Turn.png', estMinutes: [1, 3] },
  { key: 'flag',             emoji: '🚩', title: 'FLAG',             desc: 'Track aircraft, answer maths and identification questions, hit target shapes — all in 60 seconds.', path: '/cbat/flag',            image: '/images/FLAG.png', estMinutes: 1, badge: 'New Difficulty Modes' },
  { key: 'visualisation',    emoji: '🧊', title: 'Visualisation 2D/3D', desc: 'Mentally weld 2D shapes or mentally rotate 3D composites to spot the matching figure.', path: '/cbat/visualisation',    image: '/images/Visualisation 2D.png', estMinutes: [1, 2] },
  { key: 'dpt',              emoji: '🛩️', title: 'DPT',              desc: 'Dynamic Projection Test — vector multiple aircraft through gates and intercept enemy contacts using compass bearings.', path: '/cbat/dpt',             image: '/images/DPT.png', estMinutes: 15 },
  { key: 'act',              emoji: '🎧', title: 'ACT',              desc: 'Auditory Capacity Test — track callsigns, steer through the right gates, react to bleeps.', path: '/cbat/act',             image: '/images/ACT.png', estMinutes: 5 },
  { key: 'numerical-ops',    emoji: '🧮', title: 'Numerical Operations', desc: 'Two-number arithmetic against the clock — +, −, ×, ÷ across four escalating rounds.', path: '/cbat/numerical-ops',  image: '/images/Numerical Operations.png', estMinutes: [1, 2], badge: 'New Difficulty Modes' },
  { key: 'dad',              emoji: '🧭', title: 'DAD',              desc: 'Directions and Distances — track a journey of relative turns from text alone, then name the direction back to the start.', path: '/cbat/dad',             image: '/images/DAD.png', estMinutes: 5 },
  // `isNew: true` surfaces a "New Game" badge on the hub tile; `badge: '…'`
  // surfaces arbitrary announcement text in the same slot (for a game that
  // isn't new but has gained something).
  { key: 'cut',              emoji: '🖥️', title: 'Cognitive Updating Test', desc: 'Juggle six aircraft displays at once — keep fuel, speed, sensors, pressure and load drops in tolerance while the warnings pile up.', path: '/cbat/cut',             image: '/images/CUT.png', estMinutes: 3, badge: 'New Difficulty Modes' },
  { key: 'sat',              emoji: '🗺️', title: 'SAT',              desc: 'Situational Awareness Test — observe a tactical picture of units, aircraft and radio calls, then recall the details from memory.', path: '/cbat/sat',             image: '/images/SAT.png', estMinutes: [2, 3], badge: 'New Difficulty Modes' },
  { key: 'rtt',              emoji: '📷', title: 'RTT',              desc: 'Rapid Tracking Test — slew a sensor camera onto moving targets and capture three centred frames of each before the pass ends.', path: '/cbat/rtt',             image: '/images/RTT.png', estMinutes: [1, 2], isNew: true },
]

// Render a game's `estMinutes` for display. Returns null when a game has no
// estimate, so a caller can omit the line entirely rather than print a blank.
// Written in sentence case — the hub tile uppercases it in CSS, the same way
// its "Coming soon" line does.
export function formatEstTime(game) {
  const est = game?.estMinutes
  if (est == null) return null
  if (Array.isArray(est)) {
    const [lo, hi] = est
    // An en dash, not a hyphen — it's a range, and it reads as one at 10px.
    return lo === hi ? `⏱ ${lo} min` : `⏱ ${lo}–${hi} min`
  }
  return `⏱ ${est} min`
}

// Per-leaderboard display config, keyed by the backend leaderboard gameKey
// (the URL segment, e.g. 'plane-turn-2d', 'trace-1', 'target'). Shared by the
// leaderboard page (src/pages/CbatLeaderboard.jsx) and the post-game reveal
// (src/components/CbatGameOver.jsx) so score formatting lives in one place.
// Adding a new game = one entry here + one entry in the backend CBAT_GAMES
// registry, and both the board and the reveal pick it up.
//   lowerIsBetter — all-time board direction (weekly is always higher-better,
//                   because lower-better games sum a derived points value).
//   hideTime      — game has no meaningful per-run time column.
//   timeDecimals  — decimal places on the time column (default 1). Symbols uses
//                   2 because runs cluster tightly and time is the tiebreaker.
//   maxScore      — the score a perfect run gets, where the game has a ceiling.
//                   Stated rather than parsed back out of formatScore, and it
//                   earns its place: a ceiling is what makes a score chart stop
//                   telling the truth about a good player (they max out and the
//                   line flatlines while they keep getting quicker), so the "You"
//                   tab charts speed as well for exactly these games.
export const CBAT_LEADERBOARD_CONFIG = {
  'plane-turn-2d':   { title: 'Trace Practise 2D', emoji: '🗺️', scoreLabel: 'Rotations', lowerIsBetter: true,  formatScore: (s) => `${s}`,     backPath: '/cbat/trace',          planeTurnMode: '2d' },
  'plane-turn-3d':   { title: 'Trace Practise 3D', emoji: '🗺️', scoreLabel: 'Rotations', lowerIsBetter: true,  formatScore: (s) => `${s}`,     backPath: '/cbat/trace',          planeTurnMode: '3d' },
  'trace-1':         { title: 'Trace 1',           emoji: '🛩️', scoreLabel: 'Correct',   lowerIsBetter: false, maxScore: 40, formatScore: (s) => `${s}/40`,  backPath: '/cbat/trace',          hideTime: true },
  'trace-2':         { title: 'Trace 2',           emoji: '🛩️', scoreLabel: 'Correct',   lowerIsBetter: false, maxScore: 8, formatScore: (s) => `${s}/8`,   backPath: '/cbat/trace',          hideTime: true },
  'angles':          { title: 'Angles',            emoji: '📐',  scoreLabel: 'Correct',   lowerIsBetter: false, maxScore: 20, formatScore: (s) => `${s}/20`,  backPath: '/cbat/angles' },
  'code-duplicates': { title: 'Code Duplicates',   emoji: '🧩',  scoreLabel: 'Correct',   lowerIsBetter: false, maxScore: 15, formatScore: (s) => `${s}/15`,  backPath: '/cbat/code-duplicates' },
  'symbols':         { title: 'Symbols',           emoji: '🔣',  scoreLabel: 'Correct',   lowerIsBetter: false, maxScore: 15, formatScore: (s) => `${s}/15`,  backPath: '/cbat/symbols', timeDecimals: 2 },
  'target':          { title: 'Target',            emoji: '🎯',  scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/target',         hideTime: true },
  'instruments':     { title: 'Instruments',       emoji: '🛫',  scoreLabel: 'Correct',   lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/instruments',    hideTime: true },
  'ant':             { title: 'ANT',               emoji: '📡',  scoreLabel: 'Points',    lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/ant' },
  'flag':            { title: 'FLAG',              emoji: '🚩',  scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/flag',           hideTime: true, difficultyGroup: 'flag' },
  'flag-easier':     { title: 'FLAG',              emoji: '🚩',  scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/flag',           hideTime: true, difficultyGroup: 'flag' },
  'visualisation-2d':{ title: 'Visualisation 2D',  emoji: '🧮',  scoreLabel: 'Correct',   lowerIsBetter: false, maxScore: 8, formatScore: (s) => `${s}/8`,   backPath: '/cbat/visualisation' },
  'visualisation-3d':{ title: 'Visualisation 3D',  emoji: '🧊',  scoreLabel: 'Correct',   lowerIsBetter: false, maxScore: 8, formatScore: (s) => `${s}/8`,   backPath: '/cbat/visualisation' },
  'dpt':             { title: 'DPT',               emoji: '🛩️', scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/dpt' },
  'act':             { title: 'ACT',               emoji: '🎧',  scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`,     backPath: '/cbat/act',            hideTime: true },
  'numerical-ops':   { title: 'Numerical Operations', emoji: '🧮', scoreLabel: 'Correct %', lowerIsBetter: false, maxScore: 100, formatScore: (s) => `${s}%`, backPath: '/cbat/numerical-ops', difficultyGroup: 'numerical-ops' },
  'numerical-ops-easier': { title: 'Numerical Operations', emoji: '🧮', scoreLabel: 'Correct %', lowerIsBetter: false, maxScore: 100, formatScore: (s) => `${s}%`, backPath: '/cbat/numerical-ops', difficultyGroup: 'numerical-ops' },
  'dad':             { title: 'Directions & Distances', emoji: '🧭', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 15, formatScore: (s) => `${s}/15`, backPath: '/cbat/dad' },
  'sat':             { title: 'Situational Awareness Test', emoji: '🗺️', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 18, formatScore: (s) => `${s}/18`, backPath: '/cbat/sat', difficultyGroup: 'sat' },
  // Easier asks 10 questions (2 situations × 5) where Hard asks 18, so unlike
  // the other splits the two boards don't share a ceiling. Separate collections
  // anyway, so nothing is being compared across them.
  'sat-easier':      { title: 'Situational Awareness Test', emoji: '🗺️', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 10, formatScore: (s) => `${s}/10`, backPath: '/cbat/sat', difficultyGroup: 'sat' },
  'cut':             { title: 'Cognitive Updating Test', emoji: '🖥️', scoreLabel: 'Score', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/cut', hideTime: true, difficultyGroup: 'cut' },
  'cut-easier':      { title: 'Cognitive Updating Test', emoji: '🖥️', scoreLabel: 'Score', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/cut', hideTime: true, difficultyGroup: 'cut' },
  // Run length is fixed per difficulty, so every real time is near-identical and
  // the column tells nobody anything — hidden, like CUT's and FLAG's.
  'rtt':             { title: 'Rapid Tracking Test', emoji: '📷', scoreLabel: 'Score', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/rtt', hideTime: true, difficultyGroup: 'rtt' },
  'rtt-easier':      { title: 'Rapid Tracking Test', emoji: '📷', scoreLabel: 'Score', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/rtt', hideTime: true, difficultyGroup: 'rtt' },
}

// Games whose difficulties keep separate leaderboards. The leaderboard page
// renders these as a pill pair beside its title so a user can flip between the
// two boards without going back through the game. Keyed by the
// `difficultyGroup` on each CBAT_LEADERBOARD_CONFIG entry; order is the order
// the pills appear in.
export const CBAT_DIFFICULTY_GROUPS = {
  flag: [
    { gameKey: 'flag-easier', label: 'Easier' },
    { gameKey: 'flag',        label: 'Hard' },
  ],
  cut: [
    { gameKey: 'cut-easier', label: 'Easier' },
    { gameKey: 'cut',        label: 'Hard' },
  ],
  'numerical-ops': [
    { gameKey: 'numerical-ops-easier', label: 'Easier' },
    { gameKey: 'numerical-ops',        label: 'Hard' },
  ],
  sat: [
    { gameKey: 'sat-easier', label: 'Easier' },
    { gameKey: 'sat',        label: 'Hard' },
  ],
  rtt: [
    { gameKey: 'rtt-easier', label: 'Easier' },
    { gameKey: 'rtt',        label: 'Hard' },
  ],
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
      { ...g, key: 'trace-2',       title: 'Trace 2' },
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
