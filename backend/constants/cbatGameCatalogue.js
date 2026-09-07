'use strict';

/**
 * What SkyWatch actually has, written for the guide bot.
 *
 * The bot was grounded in the community guide and nothing else, so it knew the
 * real battery inside out and knew nothing whatsoever about the app it lives
 * in. Asked about "the 3D practise" it replied that if a practice app had a 3D
 * variant "that's something the app has built, not something from the real
 * test" — technically true, useless to a user standing in front of the game,
 * and it reads as the bot disowning its own product. Same shape for "trace 3d",
 * "the ant board", "the easier one": every one of those names something that
 * exists on the hub.
 *
 * So this is a second, separate source of truth, and it is a different KIND of
 * thing from the guide. The guide is what candidates reported and is uncertain
 * by nature; this is a description of our own software and is simply fact. It
 * is stated here rather than uploaded with the guide because it is ours to
 * know, must never need a re-upload to stay current, and must survive the
 * retrieval slice that trims the guide per question.
 *
 * Kept in step with the registry by a test, not by discipline:
 * __tests__/unit/cbatGameCatalogue.test.js asserts every CBAT_GAMES key appears
 * in exactly one entry's `registryKeys`, that `difficulties` matches whether the
 * registry has an Easier board, and that every `simulates` code is a real one
 * from cbatBatteries.json. Adding a game to CBAT_GAMES without describing it
 * here fails that test — see the invariants listed on the registry itself.
 *
 * Deliberately free of `require`s. The bot's unit tests load this module, and
 * pulling in cbatGames.js would drag every Mongoose result model in with it.
 * The drift test does the cross-referencing instead, where models are cheap.
 */

// One entry per thing a player can pick and play. A game whose difficulties are
// two separate boards (FLAG, SAT, ...) is ONE entry; a tile that hides four
// genuinely different games behind it (Trace) is four, because telling those
// apart is the whole problem this file exists to fix.
//
//   name         what the app calls it on screen
//   tile         the hub tile it sits under, when that is not the name itself
//   registryKeys the CBAT_GAMES keys this covers (drift guard, not printed)
//   simulates    the real CBAT test code it is built from, or null
//   aliases      what people actually type. Lower case, no punctuation.
//   what         one sentence: what you do. Present tense, plain British English.
//   difficulties the split, where there is one
const CBAT_GAME_CATALOGUE = [
  {
    name: 'Target',
    registryKeys: ['target'],
    simulates: 'TRT',
    aliases: ['target', 'trt', 'target recognition'],
    what: 'eight panels running at once for two minutes - hunt shapes, match warning lights, identify aircraft and find codes. Its Tutorial button opens a practice mode that unlocks the panels one at a time.',
  },
  {
    name: 'ANT',
    registryKeys: ['ant', 'ant-hard'],
    simulates: 'ANT',
    aliases: ['ant', 'airborne numerical', 'airbourne numerical', 'the ant board'],
    what: 'speed, distance, time and fuel. Easier reads the figures off a board; Hard is the written version with weather, part journeys and two aircraft.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'ANT Practise',
    tile: 'ANT',
    registryKeys: ['ant-practise'],
    simulates: null,
    aliases: ['ant practise', 'ant practice', 'ant drill'],
    what: 'eight plain speed-distance-time questions on one page, with the figures given to you. A drill for the arithmetic on its own, without the board to read.',
  },
  {
    name: 'Symbols',
    registryKeys: ['symbols'],
    simulates: null,
    aliases: ['symbols', 'visual search', 'symbol search'],
    what: 'spot the target symbol in a grid that grows every round. Closest to the Visual Search Test, which has never carried a code on a score sheet.',
  },
  {
    name: 'Code Duplicates',
    registryKeys: ['code-duplicates'],
    simulates: 'DRT',
    aliases: ['code duplicates', 'code dupes', 'duplicates', 'drt', 'digit recognition'],
    what: 'memorise a run of digits, then count how many times one of them appeared.',
  },
  {
    name: 'Angles',
    registryKeys: ['angles'],
    simulates: 'ABD5',
    aliases: ['angles', 'abd', 'abd5', 'bearings', 'angles bearings and degrees'],
    what: 'judge angles and bearings quickly and accurately.',
  },
  {
    name: 'Instruments',
    registryKeys: ['instruments'],
    simulates: 'INSC',
    aliases: ['instruments', 'insc', 'instrument comprehension', 'dials'],
    what: 'read cockpit instruments against the clock and say what the aircraft is doing.',
  },
  {
    name: 'Trace Practise 2D',
    tile: 'Trace 1/2',
    registryKeys: ['plane-turn-2d'],
    simulates: null,
    aliases: ['trace practise 2d', 'trace practice 2d', '2d practise', '2d practice', 'trace 2d', 'plane turn 2d'],
    what: 'free practice with no questions and no clock: fly the turn in two dimensions until the rotations come without thinking. Built for Trace 1, not a test in its own right.',
  },
  {
    name: 'Trace Practise 3D',
    tile: 'Trace 1/2',
    registryKeys: ['plane-turn-3d'],
    simulates: null,
    aliases: ['trace practise 3d', 'trace practice 3d', '3d practise', '3d practice', 'trace 3d', 'the 3d one', 'plane turn 3d'],
    what: 'the same free practice in three dimensions, flying a real aircraft model. This is what someone means by "the 3D practise" or "trace 3D" - it exists, it is ours, and there is no Trace 3 in the battery.',
  },
  {
    name: 'Trace 1',
    tile: 'Trace 1/2',
    registryKeys: ['trace-1'],
    simulates: 'TRAC1',
    aliases: ['trace 1', 'trace one', 'trac1'],
    what: 'watch the Hawk T2 fly and name each turn as it happens - the control-copying half of the Trace tests.',
  },
  {
    name: 'Trace 2',
    tile: 'Trace 1/2',
    registryKeys: ['trace-2'],
    simulates: 'TRAC2',
    aliases: ['trace 2', 'trace two', 'trac2'],
    what: 'four coloured aircraft manoeuvre together, then one question a round on what you saw, eight rounds. The recall half.',
  },
  {
    name: 'FLAG',
    registryKeys: ['flag', 'flag-easier'],
    simulates: 'FLAG',
    aliases: ['flag', 'figures logistics and groups'],
    what: 'sixty seconds of tracking aircraft, answering maths and identification questions and hitting target shapes at the same time.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'Visualisation 2D and 3D',
    registryKeys: ['visualisation-2d', 'visualisation-3d'],
    simulates: 'VISS',
    aliases: ['visualisation', 'visualization', 'viss', 'vis 2d', 'vis 3d', 'visualisation 3d', 'shapes'],
    what: 'weld flat shapes together in your head (2D) or rotate solid composites to find the matching figure (3D). Two modes on one tile.',
  },
  {
    name: 'DPT',
    registryKeys: ['dpt', 'dpt-hard', 'dpt-easier'],
    simulates: 'DPT',
    aliases: ['dpt', 'dynamic projection', 'dynamic projection test'],
    what: 'vector several aircraft through gates on compass bearings and intercept contacts. The longest game here.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'ACT',
    registryKeys: ['act'],
    simulates: 'ACT',
    aliases: ['act', 'auditory capacity', 'auditory capacity test', 'the audio one'],
    what: 'fly a tunnel on spoken callsigns, threading every shape except the ones the briefing tells you to avoid, while reacting to bleeps.',
  },
  {
    name: 'Numerical Operations',
    registryKeys: ['numerical-ops', 'numerical-ops-easier'],
    simulates: 'NOP',
    aliases: ['numerical operations', 'numerical ops', 'num ops', 'nop', 'the maths game', 'mental arithmetic'],
    what: 'two-number arithmetic against the clock across four escalating rounds.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'DAD',
    registryKeys: ['dad'],
    simulates: 'DAD',
    aliases: ['dad', 'directions and distances', 'directions'],
    what: 'follow a journey of relative turns from text alone, then name the direction back to where you started.',
  },
  {
    name: 'Cognitive Updating Test',
    registryKeys: ['cut', 'cut-easier'],
    simulates: 'CUT',
    aliases: ['cut', 'cognitive updating', 'cognitive updating test'],
    what: 'six aircraft displays at once for three minutes - hold fuel, speed, sensors, pressure and load drops in tolerance while the warnings stack up.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'Situational Awareness Test',
    registryKeys: ['sat', 'sat-easier'],
    simulates: 'SAT',
    aliases: ['sat', 'situational awareness', 'situational awareness test'],
    what: 'watch a tactical picture of units, aircraft and radio calls build up, then answer on it from memory.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'Rapid Tracking Test',
    registryKeys: ['rtt', 'rtt-easier'],
    simulates: 'RTT',
    aliases: ['rtt', 'rapid tracking', 'rapid tracking test', 'the camera one'],
    what: 'slew a sensor camera onto moving targets and capture three centred frames of each before the pass ends. Plays on a joystick if one is plugged in.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'Spatial Integration Test',
    registryKeys: ['sit', 'sit-easier'],
    simulates: 'SIT',
    aliases: ['sit', 'spatial integration', 'spatial integration test'],
    what: 'study the ground one isolated layer at a time, then judge a rotated two-second clip of the whole scene on a single detail.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'System Logic Test',
    registryKeys: ['slt', 'slt-easier'],
    simulates: 'SLT',
    aliases: ['slt', 'system logic', 'system logic test'],
    what: 'an index of tabs with only two readable at once, and no question answerable from one tab alone.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'Verbal Logic Test',
    registryKeys: ['vlt', 'vlt-easier'],
    simulates: 'VLT',
    aliases: ['vlt', 'verbal logic', 'verbal logic test'],
    what: 'tabs of briefing prose, two readable at once. Every answer needs two of them joined, and the plainly stated one is usually the trap.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'Table Reading Test',
    registryKeys: ['matf', 'matf-easier'],
    simulates: 'MATF',
    aliases: ['matf', 'table reading', 'table reading test'],
    what: 'read a coordinate grid, then a wind sheet in three steps, both against the clock. MATF stands for Table Reading Test, not a multi-attribute task battery.',
    difficulties: ['Easier', 'Hard'],
  },
  {
    name: 'Vigilance Test',
    registryKeys: ['vigilance'],
    simulates: 'VIG1',
    aliases: ['vigilance', 'vig', 'the star grid'],
    what: 'three minutes clearing coordinates off a nine by nine grid, row first then column, with priority tasks that appear once the job has gone quiet. Deliberately has no Easier mode - shortening it would remove the thing it measures.',
  },
  {
    name: 'Sensory Motor Apparatus Test',
    registryKeys: ['sma', 'sma-easier'],
    simulates: 'SMA',
    aliases: ['sma', 'sensory motor', 'sensory motor apparatus', 'the dot', 'the joystick one'],
    what: 'a red dot drifting across the display and a fixed centre crosshair - hold the two together on a joystick, a mouse or a touch pad. The input moves the rate of drift, not the dot.',
    difficulties: ['Easier', 'Hard'],
  },
];

// Things that are not games but come up in the same breath. Short on purpose:
// this block rides in every system prompt, and anything longer belongs in the
// guide rather than here.
const CBAT_APP_FEATURES = [
  'Aptitude Report - estimates your battery score against the cutoff for a role from the games you have played, and shows which parts of the battery you have not covered yet.',
  'Leaderboards on every game, weekly and all-time, plus a chart of your own scores over time.',
  'Every game plays offline in the app, and scores sync when you are back on.',
  'A written CBAT guide, plus Canadian and Australian equivalents, in the Community section.',
];

const CATALOGUE_HEADER = '=== SKYWATCH PRACTICE GAMES ===';
const CATALOGUE_FOOTER = '=== END OF GAME LIST ===';

/**
 * The catalogue as the block that goes into the system prompt.
 *
 * @param {Object}   opts
 * @param {Function} opts.isEnabled  (registryKey) => boolean. An admin can
 *   switch a game off in Game Options, and a bot that recommends a game nobody
 *   can open is worse than one that never mentions it. An entry survives while
 *   ANY of its keys is on, so turning off one difficulty does not hide the game.
 *   Omitted means everything is on.
 * @returns {string}
 */
function renderGameCatalogue({ isEnabled = null } = {}) {
  const live = isEnabled
    ? CBAT_GAME_CATALOGUE.filter(g => g.registryKeys.some(k => isEnabled(k)))
    : CBAT_GAME_CATALOGUE;

  const lines = [
    CATALOGUE_HEADER,
    'This is the full, current list of practice games SkyWatch has built. It is fact about this app, not a candidate report, so it carries no confidence codes and needs no hedging.',
    'They are CBAT-style simulations written from what candidates described. They are not the real tests, and nobody outside the test provider has those.',
    'Each line reads: NAME | also called | what you do | drills, meaning the real test it is built from | modes, where the game has two difficulties.',
    '',
  ];

  for (const g of live) {
    const parts = [g.name];
    parts.push(g.aliases.length ? `also called: ${g.aliases.join(', ')}` : 'also called: -');
    parts.push(g.what);
    parts.push(g.simulates ? `drills: ${g.simulates}` : 'drills: no matching test code');
    if (g.difficulties) parts.push(`modes: ${g.difficulties.join(' and ')}`);
    if (g.tile) parts.push(`found under the ${g.tile} tile`);
    lines.push(`- ${parts.join(' | ')}`);
  }

  lines.push('');
  lines.push('Also in the app:');
  for (const f of CBAT_APP_FEATURES) lines.push(`- ${f}`);
  lines.push(CATALOGUE_FOOTER);

  return lines.join('\n');
}

module.exports = {
  CBAT_GAME_CATALOGUE,
  CBAT_APP_FEATURES,
  CATALOGUE_HEADER,
  CATALOGUE_FOOTER,
  renderGameCatalogue,
};
