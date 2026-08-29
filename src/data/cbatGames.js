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
//   • SAT sums per-question time only, so it omits the observe window before
//     each situation. That window is now the situation's fact queue x the
//     difficulty's dwell — roughly 2×36s on Easier and 3×60s on Hard. Added back.
//   • Numerical Operations likewise omits FEEDBACK_MS between questions.
//   • ANT pauses its clock during round review, so its median understates the
//     wall-clock; the p75 is the fairer figure and is what's used.
// The five fixed-length games (FLAG 60s, Instruments 90s, Target 120s, CUT
// 180s) all measured within a couple of seconds of their caps, which is what
// confirms the units and that the medians are trustworthy elsewhere.
//
// DPT was a flat ~15 minutes when it was one eight-round ladder. The
// Easier/Hard split cut that ladder in half, so the tile now carries a range:
// Easier is rounds 1-4 (105 + 105 + 105 + 120 seconds ≈ 7 min) and Hard is
// rounds 5-8 (120 + 3 × 180 ≈ 11 min). It is still by far the longest game
// here, and a run can finish a round early by clearing every gate.
export const CBAT_GAMES = [
  { key: 'target',          emoji: '🎯', title: 'Target',           desc: 'Multi-task across eight panels — hunt shapes, match lights, ID aircraft, find codes.', path: '/cbat/target',          image: '/images/Target.png', estMinutes: 2 },
  { key: 'ant',             emoji: '📡', title: 'ANT',              desc: 'Airborne Numerical Test — speed, distance and time. Compute arrival, distance, fuel or speed against the clock.', path: '/cbat/ant',             image: '/images/ANT.png', estMinutes: 5 },
  { key: 'symbols',         emoji: '🔣', title: 'Symbols',          desc: 'Spot the target symbol in a growing grid, round by round.', path: '/cbat/symbols',         image: '/images/Symbols.png', estMinutes: 1 },
  { key: 'code-duplicates', emoji: '🧩', title: 'Code Duplicates',  desc: 'Memorise a sequence of digits, then count how many times one appeared.', path: '/cbat/code-duplicates', image: '/images/Code Duplicates.png', estMinutes: 2 },
  { key: 'angles',          emoji: '📐', title: 'Angles',           desc: 'Judge angles quickly and accurately.',                  path: '/cbat/angles',          image: '/images/Angles.png', estMinutes: 1 },
  { key: 'instruments',     emoji: '🛫', title: 'Instruments',      desc: 'Read cockpit instruments under time pressure.',         path: '/cbat/instruments',     image: '/images/Instruments.png', estMinutes: 1.5 },
  { key: 'plane-turn',      emoji: '🗺️', title: 'Trace 1/2',         desc: 'Practise your turn and heading, or take the Trace recall test.',             path: '/cbat/trace',           image: '/images/Plane Turn.png', estMinutes: [1, 2] },
  { key: 'flag',             emoji: '🚩', title: 'FLAG',             desc: 'Track aircraft, answer maths and identification questions, hit target shapes — all in 60 seconds.', path: '/cbat/flag',            image: '/images/FLAG.png', estMinutes: 1 },
  { key: 'visualisation',    emoji: '🧊', title: 'Visualisation 2D/3D', desc: 'Mentally weld 2D shapes or mentally rotate 3D composites to spot the matching figure.', path: '/cbat/visualisation',    image: '/images/Visualisation 2D.png', estMinutes: [1, 2] },
  { key: 'dpt',              emoji: '🛩️', title: 'DPT',              desc: 'Dynamic Projection Test — vector multiple aircraft through gates and intercept enemy contacts using compass bearings.', path: '/cbat/dpt',             image: '/images/DPT.png', estMinutes: [7, 11] },
  { key: 'act',              emoji: '🎧', title: 'ACT',              desc: 'Auditory Capacity Test — track callsigns, steer through the right gates, react to bleeps.', path: '/cbat/act',             image: '/images/ACT.png', estMinutes: 5 },
  { key: 'numerical-ops',    emoji: '🧮', title: 'Numerical Operations', desc: 'Two-number arithmetic against the clock — +, −, ×, ÷ across four escalating rounds.', path: '/cbat/numerical-ops',  image: '/images/Numerical Operations.png', estMinutes: [1, 2] },
  { key: 'dad',              emoji: '🧭', title: 'DAD',              desc: 'Directions and Distances — track a journey of relative turns from text alone, then name the direction back to the start.', path: '/cbat/dad',             image: '/images/DAD.png', estMinutes: 5 },
  // `badge: '…'` surfaces announcement text in the tile's top-right slot
  // (for a game that has gained something worth pointing at).
  { key: 'cut',              emoji: '🖥️', title: 'Cognitive Updating Test', desc: 'Juggle six aircraft displays at once — keep fuel, speed, sensors, pressure and load drops in tolerance while the warnings pile up.', path: '/cbat/cut',             image: '/images/CUT.png', estMinutes: 3 },
  { key: 'sat',              emoji: '🗺️', title: 'SAT',              desc: 'Situational Awareness Test — observe a tactical picture of units, aircraft and radio calls, then recall the details from memory.', path: '/cbat/sat',             image: '/images/SAT.png', estMinutes: [4, 6] },
  { key: 'rtt',              emoji: '📷', title: 'RTT',              desc: 'Rapid Tracking Test — slew a sensor camera onto moving targets and capture three centred frames of each before the pass ends.', path: '/cbat/rtt',             image: '/images/RTT.png', estMinutes: [1, 2] },
  // The five tests that completed the roster.
  { key: 'sit',              emoji: '🛰️', title: 'SIT',              desc: 'Spatial Integration Test. Study the ground one isolated layer at a time, then judge a rotated two-second clip of the whole scene on one detail alone.', path: '/cbat/sit',             image: '/images/SIT.png', estMinutes: [4, 6] },
  { key: 'slt',              emoji: '⚙️', title: 'SLT',              desc: 'System Logic Test. An index of fifteen tabs, two readable at once. No single tab answers a question, so find both figures before the search eats the time.', path: '/cbat/slt',             image: '/images/SLT.png', estMinutes: [5, 6] },
  { key: 'vlt',              emoji: '📖', title: 'VLT',              desc: 'Verbal Logic Test. Eight tabs of briefing prose, two readable at once. Every answer needs two of them joined, and the plainly-stated one is the trap.', path: '/cbat/vlt',             image: '/images/VLT.png', estMinutes: [10, 20] },
  { key: 'matf',             emoji: '📋', title: 'MATF',             desc: 'Table Reading Test. A coordinate grid running minus 17 to plus 17, then a wind sheet read in three steps, both against the clock.', path: '/cbat/matf',            image: '/images/MATF.png', estMinutes: [3, 4] },
  { key: 'vigilance',        emoji: '⭐', title: 'Vigilance',        desc: 'The star grid. Three minutes of clearing coordinates off a 9 by 9, row first then column, with priority tasks that appear when the job has gone quiet.', path: '/cbat/vigilance',       image: '/images/Vigilance.png', estMinutes: 3 },
  // The psychomotor test the Aptitude Report had no game for. SMA carries 15% of
  // the Pilot battery and 12% of Pilot ISR (RPAS) through the Psychomotor domain,
  // so it was the largest single uncovered weight left on the report.
  { key: 'sma',              emoji: '🕹️', title: 'SMA',              desc: 'Sensory Motor Apparatus Test. A red dot drifting across the display and a crosshair fixed at the centre. Keep the two aligned on a joystick, a mouse or a touch pad.', path: '/cbat/sma',             image: '/images/SMA.png', estMinutes: [0.5, 1] },
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

// Tile titles that do not survive the dense mobile grid, where a tile is about
// 83px wide and the label sits at 8.5px. Only the four that actually overflow
// are listed — everything else, "Instruments" included, fits at full length and
// is left alone rather than abbreviated for the sake of consistency.
//
// CUT is the odd one out in that it is not a truncation but the test's real
// code, which is how DAD, SIT, SLT, VLT and MATF are already labelled on the
// hub. The full names stay on the desktop tile, on the leaderboards and on each
// game's own page, so nothing here is the only place a game is named.
export const CBAT_SHORT_TITLES = {
  'code-duplicates': 'Code Dupes',
  'numerical-ops':   'Num Ops',
  'cut':             'CUT',
  'visualisation':   'Vis 2D/3D',
}

// The short label where one exists, the full title otherwise. Returns undefined
// for a game that needs no shortening, so a caller can render a single node
// instead of a mobile/desktop pair.
export function shortTitle(game) {
  return CBAT_SHORT_TITLES[game?.key]
}

// The run estimate at dense-grid size: "2m", "1.5m", "1–2m". The clock glyph and
// the word "min" both go — at 7.5px the emoji renders as a smudge and the word
// costs more width than the number it qualifies. Same en dash as the long form,
// for the same reason.
export function formatEstTimeCompact(game) {
  const est = game?.estMinutes
  if (est == null) return null
  if (Array.isArray(est)) {
    const [lo, hi] = est
    return lo === hi ? `${lo}m` : `${lo}–${hi}m`
  }
  return `${est}m`
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
  // The original eight-round board. No `difficultyGroup`: it is neither half
  // of the split, so it gets no Easier/Hard pills and names itself instead.
  // Clients predating the split still read it; it goes quiet as they update.
  'dpt':             { title: 'DPT (8-round)',    emoji: '🛩️', scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/dpt' },
  'dpt-hard':        { title: 'DPT',               emoji: '🛩️', scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/dpt', difficultyGroup: 'dpt' },
  'dpt-easier':      { title: 'DPT',               emoji: '🛩️', scoreLabel: 'Score',     lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/dpt', difficultyGroup: 'dpt' },
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
  // SIT / SLT / VLT keep the same question count on both difficulties, so each
  // pair shares a ceiling and one maxScore serves both.
  'sit':             { title: 'Spatial Integration Test', emoji: '🛰️', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 8, formatScore: (s) => `${s}/8`, backPath: '/cbat/sit', difficultyGroup: 'sit' },
  'sit-easier':      { title: 'Spatial Integration Test', emoji: '🛰️', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 8, formatScore: (s) => `${s}/8`, backPath: '/cbat/sit', difficultyGroup: 'sit' },
  'slt':             { title: 'System Logic Test', emoji: '⚙️', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 10, formatScore: (s) => `${s}/10`, backPath: '/cbat/slt', difficultyGroup: 'slt' },
  'slt-easier':      { title: 'System Logic Test', emoji: '⚙️', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 10, formatScore: (s) => `${s}/10`, backPath: '/cbat/slt', difficultyGroup: 'slt' },
  'vlt':             { title: 'Verbal Logic Test', emoji: '📖', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 8, formatScore: (s) => `${s}/8`, backPath: '/cbat/vlt', difficultyGroup: 'vlt' },
  'vlt-easier':      { title: 'Verbal Logic Test', emoji: '📖', scoreLabel: 'Correct', lowerIsBetter: false, maxScore: 8, formatScore: (s) => `${s}/8`, backPath: '/cbat/vlt', difficultyGroup: 'vlt' },
  // Speeded — the score is how many you got through, so there is no "/N" and no
  // maxScore. The time column is hidden for the same reason RTT's and CUT's are:
  // both parts always run their full clock, so every real time is identical.
  'matf':            { title: 'Table Reading Test', emoji: '📋', scoreLabel: 'Correct', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/matf', hideTime: true, difficultyGroup: 'matf' },
  'matf-easier':     { title: 'Table Reading Test', emoji: '📋', scoreLabel: 'Correct', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/matf', hideTime: true, difficultyGroup: 'matf' },
  // No difficultyGroup — Vigilance ships one difficulty on purpose.
  'vigilance':       { title: 'Vigilance Test', emoji: '⭐', scoreLabel: 'Score', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/vigilance', hideTime: true },
  // Accumulating score over a fixed clock, so no "/N" — and the clock is the
  // same every run, so the time column is hidden for RTT's and CUT's reason.
  // The two difficulties do NOT share a ceiling (1500 against 1000) and are not
  // on one scale anyway, because Easier's wider tolerance ring pays more per
  // second — hence no maxScore on either.
  'sma':             { title: 'Sensory Motor Apparatus Test', emoji: '🕹️', scoreLabel: 'Score', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/sma', hideTime: true, difficultyGroup: 'sma' },
  'sma-easier':      { title: 'Sensory Motor Apparatus Test', emoji: '🕹️', scoreLabel: 'Score', lowerIsBetter: false, formatScore: (s) => `${s}`, backPath: '/cbat/sma', hideTime: true, difficultyGroup: 'sma' },
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
  sit: [
    { gameKey: 'sit-easier', label: 'Easier' },
    { gameKey: 'sit',        label: 'Hard' },
  ],
  slt: [
    { gameKey: 'slt-easier', label: 'Easier' },
    { gameKey: 'slt',        label: 'Hard' },
  ],
  vlt: [
    { gameKey: 'vlt-easier', label: 'Easier' },
    { gameKey: 'vlt',        label: 'Hard' },
  ],
  matf: [
    { gameKey: 'matf-easier', label: 'Easier' },
    { gameKey: 'matf',        label: 'Hard' },
  ],
  sma: [
    { gameKey: 'sma-easier', label: 'Easier' },
    { gameKey: 'sma',        label: 'Hard' },
  ],
  // DPT's halves are literally halves: Easier plays rounds 1-4 of the ladder
  // and Hard plays rounds 5-8, so the two boards have different ceilings
  // (1,700 and 5,200) and nothing converts between them.
  dpt: [
    { gameKey: 'dpt-easier', label: 'Easier' },
    { gameKey: 'dpt-hard',   label: 'Hard' },
  ],
  // Vigilance is absent on purpose — it ships one difficulty. See
  // backend/models/GameSessionCbatVigilanceResult.js for the reasoning.
}

// gameKey → 'Easier' | 'Hard' for the games that ship a difficulty split;
// undefined for the ones that don't. Derived from the pill table above rather
// than hand-listed, so a new split game is covered by adding it there and
// nothing else.
export const CBAT_DIFFICULTY_BY_KEY = Object.fromEntries(
  Object.values(CBAT_DIFFICULTY_GROUPS).flat().map(d => [d.gameKey, d.label])
)

// A game's name with its difficulty spelled out — "FLAG (Hard)",
// "FLAG (Easier)", and a plain "Target" where the game has no split.
//
// BOTH halves are named, not just Easier. The two difficulties are separate
// boards backed by separate collections, so a score means nothing without
// knowing which one it was set on — and a bare "FLAG" sitting beside a
// "FLAG (Easier)" reads as ambiguous rather than as Hard. Mirrors
// cbatLabelWithDifficulty() in backend/constants/cbatGames.js.
//
// `baseTitle` overrides the board config's title, for the callers that already
// hold a name from the API (a session's gameLabel) and only need the suffix.
export function cbatTitleWithDifficulty(gameKey, baseTitle) {
  const title = baseTitle ?? CBAT_LEADERBOARD_CONFIG[gameKey]?.title ?? gameKey
  const difficulty = CBAT_DIFFICULTY_BY_KEY[gameKey]
  return difficulty ? `${title} (${difficulty})` : title
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
