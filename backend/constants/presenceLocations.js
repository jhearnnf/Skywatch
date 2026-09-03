// What page someone is on, for the admin presence strip in Community.
//
// The client reports a raw pathname on the heartbeat; this turns it into a
// human label, and the label is what gets stored. The path itself is
// deliberately NOT persisted, because most of the interesting ones carry a
// record id — /brief/:briefId, /chat/:conversationId, /case-files/:slug/... —
// and storing those would put a running trail of what each user is reading on
// their own document. "Reading a brief" answers the question the strip asks
// ("where is everyone?") without keeping that trail.
//
// An unmatched path stores null rather than falling back to the raw string, so
// a route added later cannot quietly start leaking ids through the gap.
//
// Order matters: first match wins, so the specific entries come before the
// prefixes they'd otherwise be swallowed by (/play/quiz before /play, and every
// /cbat/<game> before /cbat).
const LOCATIONS = [
  // ── CBAT ───────────────────────────────────────────────────────────────────
  // These mirror the `gameTitle` props on the routes in src/App.jsx rather than
  // deriving from CBAT_GAMES, because the two do not line up: the registry is
  // keyed by score model (plane-turn-2d, plane-turn-3d, visualisation-2d…) and
  // several of those share one route. The route is what a person is "on".
  [/^\/cbat\/trace\/?$/,            'CBAT · Trace 1/2'],
  [/^\/cbat\/angles\/?$/,           'CBAT · Angles'],
  [/^\/cbat\/code-duplicates\/?$/,  'CBAT · Code Duplicates'],
  [/^\/cbat\/symbols\/?$/,          'CBAT · Symbols'],
  [/^\/cbat\/target\/?$/,           'CBAT · Target'],
  [/^\/cbat\/instruments\/?$/,      'CBAT · Instruments'],
  [/^\/cbat\/ant\/?$/,              'CBAT · ANT'],
  [/^\/cbat\/flag\/?$/,             'CBAT · FLAG'],
  [/^\/cbat\/visualisation\/?$/,    'CBAT · Visualisation'],
  [/^\/cbat\/dpt\/?$/,              'CBAT · DPT'],
  [/^\/cbat\/act\/?$/,              'CBAT · ACT'],
  [/^\/cbat\/numerical-ops\/?$/,    'CBAT · Numerical Operations'],
  [/^\/cbat\/dad\/?$/,              'CBAT · Directions and Distances'],
  [/^\/cbat\/sat\/?$/,              'CBAT · Situational Awareness'],
  [/^\/cbat\/cut\/?$/,              'CBAT · Cognitive Updating'],
  [/^\/cbat\/rtt\/?$/,              'CBAT · Rapid Tracking'],
  [/^\/cbat\/sit\/?$/,              'CBAT · Spatial Integration'],
  [/^\/cbat\/slt\/?$/,              'CBAT · System Logic'],
  [/^\/cbat\/vlt\/?$/,              'CBAT · Verbal Logic'],
  [/^\/cbat\/matf\/?$/,             'CBAT · Table Reading'],
  [/^\/cbat\/vigilance\/?$/,        'CBAT · Vigilance'],
  [/^\/cbat\/sma\/?$/,              'CBAT · Sensory Motor'],
  [/^\/cbat\/[^/]+\/leaderboard\/?$/, 'CBAT · Leaderboard'],
  [/^\/cbat\/?$/,                   'CBAT menu'],

  // ── Community ──────────────────────────────────────────────────────────────
  // A conversation id is exactly the sort of thing this file does not keep, and
  // an admin looking at the strip is already in Community anyway.
  [/^\/chat\/admin\/?$/,            'Community console'],
  [/^\/chat(\/[^/]+)?\/?$/,         'Community'],

  // ── Briefs and brief games ─────────────────────────────────────────────────
  [/^\/brief\/[^/]+\/?$/,               'Reading a brief'],
  [/^\/quiz\/[^/]+\/?$/,                'Brief quiz'],
  [/^\/aptitude-sync\/[^/]+\/?$/,       'Aptitude Sync'],
  [/^\/battle-of-order\/[^/]+\/?$/,     'Battle of Order'],
  [/^\/wheres-that-aircraft\/[^/]+\/?$/, "Where's That Aircraft"],
  [/^\/learn-priority\/?$/,             'Learn Priority'],

  // ── Case files ─────────────────────────────────────────────────────────────
  [/^\/case-files\/[^/]+\/[^/]+\/debrief\/?$/, 'Case file debrief'],
  [/^\/case-files\/[^/]+\/[^/]+\/?$/,          'Playing a case file'],
  [/^\/case-files\/?$/,                        'Case Files'],

  // ── Play hub ───────────────────────────────────────────────────────────────
  [/^\/play\/quiz\/?$/,             'Quiz briefs'],
  [/^\/play\/battle-of-order\/?$/,  'Battle of Order briefs'],
  [/^\/play\/?$/,                   'Play'],

  // ── Profile and progress ───────────────────────────────────────────────────
  [/^\/profile\/badge\/?$/,         'Choosing a badge'],
  [/^\/profile\/?$/,                'Profile'],
  [/^\/rankings\/?$/,               'Rankings'],
  [/^\/airstar-history\/?$/,        'Airstar history'],
  [/^\/game-history\/?$/,           'Game history'],
  [/^\/cbat-game-history\/?$/,      'CBAT history'],
  [/^\/intel-brief-history\/?$/,    'Brief history'],

  // ── Admin ──────────────────────────────────────────────────────────────────
  [/^\/admin\/openrouter-usage\/?$/, 'Admin · OpenRouter usage'],
  [/^\/admin\/award-preview\/?$/,    'Admin · Award preview'],
  [/^\/admin\/?$/,                   'Admin'],
  [/^\/clipper\/?$/,                 'Clipper'],

  // ── Everything else ────────────────────────────────────────────────────────
  [/^\/immerse\/?$/,                '3D World'],
  [/^\/subscribe\/?$/,              'Subscribe'],
  [/^\/report\/?$/,                 'Reporting a problem'],
  [/^\/contact\/?$/,                'Contact'],
  [/^\/privacy\/?$/,                'Privacy'],
  [/^\/delete-account\/?$/,         'Deleting their account'],
  [/^\/share\/?$/,                  'Share'],
  [/^\/login\/?$/,                  'Login'],
  [/^\/home\/?$/,                   'Home'],
  [/^\/?$/,                         'Landing page'],
];

// Longest label above, plus room — a guard against a future entry, not a limit
// anything currently comes near.
const LOCATION_MAX = 60;

// Path → label, or null when nothing matches (an unknown route, a junk value, a
// query string someone appended by hand). Only ever called with client input,
// so it must not throw on anything.
function locationLabel(path) {
  if (typeof path !== 'string') return null;

  // Take the pathname and nothing else: a query string or fragment can carry
  // ids and search terms, and neither is part of "what page are they on".
  const clean = path.split('?')[0].split('#')[0].trim();
  if (!clean || !clean.startsWith('/') || clean.length > 300) return null;

  const hit = LOCATIONS.find(([rx]) => rx.test(clean));
  return hit ? hit[1].slice(0, LOCATION_MAX) : null;
}

// ── Which CBAT hub card someone is standing on ───────────────────────────────
//
// Same heartbeat, a second question. `locationLabel` answers "what page is this
// person on" in words; this answers "which tile on /cbat does that page belong
// to", so the hub can float a dot over it for admins.
//
// A card is not a route. One card covers the game, both halves of a combined
// tile, the practise mode and every leaderboard variant of it — an admin
// looking at the Target tile wants to see the person reading Target's
// leaderboard as being *at Target*, not somewhere else.
//
// These keys are the frontend's, from src/data/cbatGames.js. They are the card
// identity the hub renders by, so this list must stay in step with it: a game
// added there and missed here simply never shows a dot.
const CBAT_CARDS = [
  'target', 'ant', 'symbols', 'code-duplicates', 'angles', 'instruments',
  'plane-turn', 'flag', 'visualisation', 'dpt', 'act', 'numerical-ops', 'dad',
  'cut', 'sat', 'rtt', 'sit', 'slt', 'vlt', 'matf', 'vigilance', 'sma',
];

// Everything whose path segment is not already the card key. Two sources of
// difference, both real rather than tidy-able:
//   • the combined tiles — one card, two modes, and a route named after neither
//     ('/cbat/trace' is the 'plane-turn' card);
//   • leaderboard paths, which are keyed by *score model* (backend/constants/
//     cbatGames.js) rather than by card, because several models share one tile.
// The legacy redirect targets are here too: a client can beat once from the old
// URL before the router replaces it.
const CBAT_SEGMENT_TO_CARD = {
  'trace':            'plane-turn',
  'trace-1':          'plane-turn',
  'trace-2':          'plane-turn',
  'plane-turn':       'plane-turn',
  'plane-turn-2d':    'plane-turn',
  'plane-turn-3d':    'plane-turn',
  'visualisation-2d': 'visualisation',
  'visualisation-3d': 'visualisation',
  'ant-practise':     'ant',
};

// Difficulty is a leaderboard split, not a card split: 'cut-easier' and 'cut'
// are the same tile. Stripped before the lookup so a new Easier board never
// needs an entry above.
const CBAT_DIFFICULTY_SUFFIX = /-(easier|hard)$/;

// Path → card key, or null for anything that is not a CBAT game page. Called
// with client input, so it must not throw, and it returns a key only from the
// allowlist above — an unknown segment can no more end up stored here than an
// unknown path can end up stored as a label.
function cbatCardKey(path) {
  if (typeof path !== 'string') return null;

  const clean = path.split('?')[0].split('#')[0].trim();
  if (!clean || !clean.startsWith('/') || clean.length > 300) return null;

  // The game page itself, or one of its leaderboards. Nothing else under /cbat
  // belongs to a tile — /cbat is the hub, /cbat/report is the Aptitude Report.
  const m = clean.match(/^\/cbat\/([a-z0-9-]{1,40})(?:\/leaderboard)?\/?$/);
  if (!m) return null;

  const seg = m[1].replace(CBAT_DIFFICULTY_SUFFIX, '');
  if (CBAT_SEGMENT_TO_CARD[seg]) return CBAT_SEGMENT_TO_CARD[seg];
  return CBAT_CARDS.includes(seg) ? seg : null;
}

// The path every card is reached by, which is the card key itself except for
// the one tile whose route is named after neither of its modes.
function cardPath(card) {
  return card === 'plane-turn' ? '/cbat/trace' : `/cbat/${card}`;
}

// Label → card, for rows written before the card field existed.
//
// `lastLocation` has been recorded by every deployed backend since August, so
// an admin can see someone is on "CBAT · Angles" whether or not the server
// handling that person's heartbeat knows about tiles yet. Reading the tile back
// out of the label is what lets the dots use that history instead of waiting
// for it to be re-recorded.
//
// Built by running each card's own path through locationLabel() rather than
// hand-written, so it cannot fall out of step with the table above: reword a
// label and this follows it.
//
// Only the game pages come back. Every leaderboard is one label ("CBAT ·
// Leaderboard") with the game deliberately dropped, so a label can never say
// which tile a board belongs to — that is what the stored card is for, and why
// this is a fallback rather than the mechanism.
const CARD_BY_LABEL = new Map(
  CBAT_CARDS.map(card => [locationLabel(cardPath(card)), card]),
);

function cbatCardFromLabel(label) {
  if (typeof label !== 'string') return null;
  return CARD_BY_LABEL.get(label) ?? null;
}

module.exports = {
  LOCATIONS, LOCATION_MAX, locationLabel,
  CBAT_CARDS, cbatCardKey, cbatCardFromLabel,
};
