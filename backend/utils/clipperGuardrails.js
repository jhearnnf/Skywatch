// Clipper guardrails — validates generated script copy before an admin ever
// sees it as "ready".
//
// These rules are code rather than prompt instructions on purpose. The source
// material makes every one of them easy to violate: it is a Discord export
// about the *real* CBAT, written by named people, and most of its findings are
// only amber-confidence. A prompt that asks nicely will hold for the first ten
// videos and drift by the hundredth. A validator does not drift.
//
// Findings are returned, never auto-corrected. The admin sees the offending
// span highlighted and decides — silently rewriting a script would hide the
// fact that the model keeps reaching for a claim we don't allow.

const {
  subjectFor, allowedRecipeIds, mentionsSubject,
} = require('../constants/clipperSubjects');

// Handles from the guide that are also ordinary English words. Matching these
// strictly would fire on innocent copy ("God knows", "the mighty Typhoon",
// "overwatch"), so they are reported as warnings for a human to glance at
// rather than as errors that block. Anything NOT in this list is treated as a
// distinctive handle and is an error — that is the safe direction, because a
// new handle appearing in the guide should fail loudly rather than slip out.
const COMMON_WORD_HANDLES = new Set([
  'God', 'Hi', 'Yo', 'Mac', 'Mighty', 'Pigeon', 'Overwatch', 'Theo', 'Chu',
  'Brax', 'Bgd', 'Sked', 'hp', 'electro', 'white bread', 'y e s', 'green jit',
  'Jack', 'Ollie', 'Elsie', 'Amelia', 'Borris',
]);

// Claims that the site is, or replicates, the real CBAT.
// See feedback_never_claim_real_cbat — ours are CBAT-style simulations, and the
// guide itself notes places where the apps do NOT match the real test.
const REAL_CBAT_PATTERNS = [
  { re: /\b(?:the\s+)?(?:actual|real|official|genuine)\s+CBAT\s+(?:test|tests|questions?)\s+(?:on|in|at)\s+(?:our|the)\s+(?:site|app|platform)/i,
    message: 'Claims the site hosts the real CBAT tests' },
  { re: /\b(?:this|our|the)\s+(?:is|are)\s+the\s+(?:actual|real|official)\s+CBAT\b/i,
    message: 'States the simulation is the real CBAT' },
  { re: /\bidentical\s+to\s+the\s+(?:real|actual|official)\s+CBAT\b/i,
    message: 'Claims parity with the real CBAT' },
  { re: /\b(?:exact|exactly)\s+(?:the\s+)?same\s+(?:as\s+)?(?:the\s+)?(?:real|actual|official)\s+CBAT\b/i,
    message: 'Claims parity with the real CBAT' },
  { re: /\bpractise\s+the\s+(?:real|actual|official)\s+CBAT\b/i,
    message: 'Implies the real CBAT can be practised here' },
];

// See feedback_no_raf_application — never explicitly position the site as
// helping an RAF application. Keep references general.
const RAF_APPLICATION_PATTERNS = [
  { re: /\b(?:pass|ace|smash|nail)\s+(?:your|the)\s+RAF\s+(?:application|selection|recruitment)/i,
    message: 'Positions the site as helping an RAF application' },
  { re: /\bget\s+(?:into|in\s+to)\s+the\s+RAF\b/i,
    message: 'Positions the site as a route into the RAF' },
  { re: /\bjoin\s+the\s+RAF\b.{0,40}\b(?:with|using|thanks\s+to)\b/i,
    message: 'Links joining the RAF to using the site' },
  { re: /\b(?:boost|improve|strengthen)\s+your\s+RAF\s+(?:application|chances)/i,
    message: 'Claims the site improves RAF application chances' },
];

// Hedging that makes an amber-confidence finding honest. An amber fact stated
// flatly reads as established fact; the guide's own confidence grade says it
// isn't. See §3 of APPLICATION_INFO/CLIPPER_PLAN.md.
const HEDGE_PATTERNS = [
  /\breportedly\b/i, /\bapparently\b/i, /\ballegedly\b/i,
  /\bsome\s+(?:people|sitters|candidates|applicants)\b/i,
  /\bmany\s+(?:people|sitters|candidates|applicants)\b/i,
  /\ba\s+lot\s+of\s+(?:people|sitters|candidates)\b/i,
  /\b(?:people|sitters|candidates)\s+(?:say|said|report|reported|reckon)\b/i,
  /\bseems?\s+to\b/i, /\bappears?\s+to\b/i, /\btend(?:s|ed)?\s+to\b/i,
  /\bin\s+most\s+cases\b/i, /\boften\b/i, /\busually\b/i, /\btypically\b/i,
  /\bworth\s+(?:checking|verifying|confirming)\b/i,
  /\bmight\b/i, /\bmay\b/i, /\bcould\b/i,
];

function hasHedge(text) {
  return HEDGE_PATTERNS.some(re => re.test(text));
}

// Escape a handle for use inside a RegExp — handles contain ., ", -, Σ etc.
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary match that also works for handles starting/ending in a
// non-word character (e.g. `1Harriet1`, `H.E.N.R.Y MK2`, `SumgaPi Σπ`), where
// \b would behave unexpectedly. We assert a non-word-ish neighbour instead.
function handleRegex(handle) {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(handle)}(?![A-Za-z0-9])`, 'gu');
}

// ── Individual checks ───────────────────────────────────────────────────────

function checkNames(text, blocklist) {
  const findings = [];
  for (const handle of blocklist || []) {
    if (!handle || handle.length < 2) continue;
    const re = handleRegex(handle);
    let m;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        rule:     'real-name',
        severity: COMMON_WORD_HANDLES.has(handle) ? 'warning' : 'error',
        message:  COMMON_WORD_HANDLES.has(handle)
          ? `"${handle}" is a real handle from the guide, but also an ordinary word — check the usage`
          : `"${handle}" is a real person from the source material and must not be named`,
        start: m.index,
        end:   m.index + m[0].length,
        match: m[0],
      });
    }
  }
  return findings;
}

function checkPatterns(text, patterns, rule) {
  const findings = [];
  for (const { re, message } of patterns) {
    const m = re.exec(text);
    if (m) {
      findings.push({
        rule,
        severity: 'error',
        message,
        start: m.index,
        end:   m.index + m[0].length,
        match: m[0],
      });
    }
  }
  return findings;
}

// Grade gate. Red facts must never be cited at all; amber facts must be hedged
// somewhere in the beat that uses them.
function checkGrades(beats, factsByKey) {
  const findings = [];

  for (const beat of beats) {
    const keys = Array.isArray(beat.factKeys) ? beat.factKeys : [];
    for (const key of keys) {
      const fact = factsByKey.get(key);
      if (!fact) {
        findings.push({
          rule: 'unknown-fact', severity: 'error', beatId: beat.id,
          message: `Beat cites unknown fact "${key}"`,
        });
        continue;
      }
      if (fact.grade === 'red') {
        findings.push({
          rule: 'red-fact', severity: 'error', beatId: beat.id,
          message: `Beat cites red-confidence fact "${key}" — red facts are excluded from scripts`,
        });
      }
      if (fact.grade === 'amber' && !hasHedge(beat.text || '')) {
        findings.push({
          rule: 'unhedged-amber', severity: 'error', beatId: beat.id,
          message: `Beat states amber-confidence fact "${key}" without hedging — it needs "reportedly", "a lot of sitters say", or similar`,
        });
      }
    }
  }

  return findings;
}

// See feedback_marketing_copy_style — hyphens, not em dashes, in outward copy.
function checkStyle(text) {
  const findings = [];
  const re = /[—–]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    findings.push({
      rule: 'style-dash', severity: 'warning',
      message: 'Use a hyphen, not an em/en dash, in marketing copy',
      start: m.index, end: m.index + m[0].length, match: m[0],
    });
  }
  return findings;
}

// ── Is the product actually in the video? ───────────────────────────────────
//
// The complaint that produced this check was that a finished render was hard to
// read as an advert for anything: a subject was chosen, and the script then
// mentioned it once in the outro over stock jets. Nothing anywhere objected,
// because nothing anywhere was looking.
//
// Thresholds match the wording in services/clipperAi.js subjectBrief - the
// prompt asks, this decides. Findings are warnings rather than errors: a thin
// mention is a weak video, not an unpublishable one, and the admin can look at
// the beats and disagree. The content rules above stay errors because those are
// claims we must not make at all.
const MIN_SUBJECT_MENTIONS = 3;
const MIN_SUBJECT_CAPTURES = 3;
// "Early" means inside the first two beats. A product first shown in beat six
// is a product most of the audience never saw.
const EARLY_BEATS = 2;

function checkSubject(beats, subject) {
  if (!subject) return [];

  const findings = [];
  const named = beats.filter(b => mentionsSubject(b.text, subject));
  const shots = beats.filter(b => b.visual?.kind === 'capture'
    && b.visual?.recipeId === subject.recipeId);

  if (named.length < MIN_SUBJECT_MENTIONS) {
    findings.push({
      rule: 'subject-unnamed', severity: 'warning', beatId: null,
      message: `This video is promoting ${subject.spokenName} but names it in only ${named.length} of ${beats.length} beats - it needs ${MIN_SUBJECT_MENTIONS}`,
    });
  }
  if (shots.length < MIN_SUBJECT_CAPTURES) {
    findings.push({
      rule: 'subject-unseen', severity: 'warning', beatId: null,
      message: `Only ${shots.length} beat(s) show ${subject.spokenName} on screen - it needs ${MIN_SUBJECT_CAPTURES} capture beats using "${subject.recipeId}"`,
    });
  }

  const early = beats.slice(0, EARLY_BEATS);
  if (shots.length > 0 && !early.some(b => shots.includes(b))) {
    findings.push({
      rule: 'subject-shown-late', severity: 'warning', beatId: beats[0]?.id ?? null,
      message: `${subject.spokenName} is not on screen until beat ${beats.indexOf(shots[0]) + 1} - show it in the first ${EARLY_BEATS}`,
    });
  }

  // Filming a different game while the voice talks about this one reads as
  // deliberate misdirection, which is worse than stock footage.
  const allowed = new Set(allowedRecipeIds(subject));
  for (const beat of beats) {
    const id = beat.visual?.kind === 'capture' ? beat.visual?.recipeId : '';
    if (id && !allowed.has(id)) {
      findings.push({
        rule: 'subject-wrong-capture', severity: 'error', beatId: beat.id,
        message: `Beat films "${id}" in a video about ${subject.spokenName}`,
      });
    }
  }

  return findings;
}

// ── Public API ──────────────────────────────────────────────────────────────

// Validate a whole generated script.
//   script    — { beats: [{ id, text, factKeys }], outro?: { copy } }
//   facts     — array of ClipperFact-shaped rows (needs factKey + grade)
//   blocklist — array of real names harvested at ingest
//   subject   — { key } the video is promoting, or null for a tips video that
//               shows nothing. Decides the subject-presence checks below.
//
// Returns { ok, errors, warnings, findings }. `ok` is false when any finding
// has severity 'error'; warnings never block.
function validateScript(script, facts, blocklist, subject = null) {
  const beats = Array.isArray(script?.beats) ? script.beats : [];
  const factsByKey = new Map((facts || []).map(f => [f.factKey, f]));

  const findings = [];

  // Per-beat text checks, so findings carry the beat they belong to.
  for (const beat of beats) {
    const text = String(beat?.text ?? '');
    const scoped = [
      ...checkNames(text, blocklist),
      ...checkPatterns(text, REAL_CBAT_PATTERNS, 'real-cbat-claim'),
      ...checkPatterns(text, RAF_APPLICATION_PATTERNS, 'raf-application-claim'),
      ...checkStyle(text),
    ];
    for (const f of scoped) findings.push({ ...f, beatId: beat?.id ?? null });
  }

  // The outro is marketing copy and is where RAF-application claims are most
  // likely to appear, so it gets the same treatment.
  const outro = String(script?.outro?.copy ?? '');
  if (outro) {
    const scoped = [
      ...checkNames(outro, blocklist),
      ...checkPatterns(outro, REAL_CBAT_PATTERNS, 'real-cbat-claim'),
      ...checkPatterns(outro, RAF_APPLICATION_PATTERNS, 'raf-application-claim'),
      ...checkStyle(outro),
    ];
    for (const f of scoped) findings.push({ ...f, beatId: 'outro' });
  }

  findings.push(...checkGrades(beats, factsByKey));
  findings.push(...checkSubject(beats, subjectFor(subject?.key ?? subject)));

  const errors   = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');

  return { ok: errors.length === 0, errors, warnings, findings };
}

module.exports = {
  validateScript,
  hasHedge,
  checkNames,
  checkGrades,
  checkStyle,
  checkSubject,
  MIN_SUBJECT_MENTIONS,
  MIN_SUBJECT_CAPTURES,
  EARLY_BEATS,
  COMMON_WORD_HANDLES,
  REAL_CBAT_PATTERNS,
  RAF_APPLICATION_PATTERNS,
  HEDGE_PATTERNS,
};
