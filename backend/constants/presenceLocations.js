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

module.exports = { LOCATIONS, LOCATION_MAX, locationLabel };
