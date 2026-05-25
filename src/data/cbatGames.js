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
  { key: 'plane-turn',      emoji: '🗺️', title: 'TRACE 1/2',         desc: 'Practise your turn and heading, or take the Trace recall test.',             path: '/cbat/trace',           image: '/images/Plane Turn.png' },
  { key: 'flag',             emoji: '🚩', title: 'FLAG',             desc: 'Track aircraft, answer maths and identification questions, hit target shapes — all in 60 seconds.', path: '/cbat/flag',            image: '/images/FLAG.png' },
  { key: 'visualisation',    emoji: '🧮', title: 'Visualisation 2D/3D', desc: 'Mentally weld 2D shapes or mentally rotate 3D composites to spot the matching figure.', path: '/cbat/visualisation',    image: '/images/Visualisation 2D.png' },
  { key: 'dpt',              emoji: '🛩️', title: 'DPT',              desc: 'Dynamic Projection Test — vector multiple aircraft through gates and intercept enemy contacts using compass bearings.', path: '/cbat/dpt',             image: '/images/DPT.png' },
  { key: 'act',              emoji: '🎧', title: 'ACT',              desc: 'Auditory Capacity Test — track callsigns, steer through the right gates, react to bleeps.', path: '/cbat/act',             image: '/images/ACT.png' },
  { key: 'dad',              emoji: '🧭', title: 'DAD',              desc: 'Directions and Distances — coming soon.',               path: null,                    image: '/images/placeholder-brief.svg' },
]

// Admin-side list — one entry per backend cbatGameEnabled key. Diverges from
// CBAT_GAMES at TRACE 1/2 and Visualisation 2D/3D: the hub shows one tile each
// linking to a combined page, but the backend registry splits those keys into
// separate 2D/3D entries, so admins get an independent enable/disable per mode.
export const CBAT_ADMIN_GAMES = CBAT_GAMES.flatMap(g => {
  if (g.key === 'plane-turn') {
    return [
      { ...g, key: 'plane-turn-2d', title: 'Plane Turn 2D' },
      { ...g, key: 'plane-turn-3d', title: 'Plane Turn 3D' },
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
