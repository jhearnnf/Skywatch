const path = require('path');
const fs   = require('fs');

const IntelligenceBrief    = require('../models/IntelligenceBrief');
const { SUBCATEGORIES }    = require('../constants/categories');
const IntelLead            = require('../models/IntelLead');
const { SCAN_CATEGORIES }  = require('./mentionedBriefs');
const { reprioritizeCategory } = require('./priorityRanking');
const { bodiesText }       = require('./descriptionSections');
const { validateAirframeTitle } = require('./airframeValidation');

// Auto-generated leads are appended to a JSONL sidecar file — NOT to seedLeads.js
// directly. Writing to a .js file inside the backend tree would trigger nodemon
// to restart the dev server mid-request and break brief generation. .jsonl is
// outside nodemon's watched extension list (js,mjs,cjs,json), so appends are
// invisible to the watcher. seedLeads.js reads this file on startup and merges
// the entries into its LEADS array.
const SEED_LEADS_GENERATED_PATH = path.join(__dirname, '../seeds/seedLeads.generated.jsonl');

// Valid categories the AI may assign to auto-generated leads (excludes News)
const SEEDABLE_CATEGORIES = [
  'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Roles',
  'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties', 'Heritage',
];

// Title-prefix rules: these prefixes indicate subject types that don't belong
// in the listed categories. E.g. "HMS"/"RFA"/"USS" are naval vessels — not
// aircraft, even if they carry aircraft. Keeps the AI from shoehorning ships
// into Aircrafts just because an F-35B brief mentioned a carrier.
const DISALLOWED_PREFIXES_BY_CATEGORY = {
  Aircrafts: [/^HMS\s/i, /^RFA\s/i, /^USS\s/i, /^HMCS\s/i, /^USNS\s/i, /^FS\s/i],
};

/**
 * Reject classifications that violate hard rules:
 *  - Ship-prefix titles in Aircrafts (naval vessels aren't aircraft)
 *  - Umbrella titles that just restate a subcategory name (e.g.
 *    "Front-Line Aviation" ≈ the Fast Jet subcategory itself — too generic)
 * Returns { ok: boolean, reason?: string }.
 */
function validateLeadClassification(title, category, { SUBCATEGORIES }) {
  const prefixes = DISALLOWED_PREFIXES_BY_CATEGORY[category] || [];
  if (prefixes.some(re => re.test(title))) {
    return { ok: false, reason: `title prefix disallowed under ${category}` };
  }
  const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const allSubs = Object.values(SUBCATEGORIES).flat();
  const isUmbrella = allSubs.some(s => {
    const normSub = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    return normTitle === normSub;
  });
  if (isUmbrella) {
    return { ok: false, reason: `title "${title}" restates an existing subcategory (umbrella term)` };
  }
  // Airframe-specific rules for Aircrafts: reject generic role phrases,
  // plural-suffix titles ("Wildcat Helicopters"), and role phrases
  // ("Maritime Patrol and Reconnaissance").
  if (category === 'Aircrafts') {
    const airframeCheck = validateAirframeTitle(title);
    if (!airframeCheck.ok) return { ok: false, reason: airframeCheck.message };
  }
  return { ok: true };
}

/**
 * Build a predicate that rejects keywords matching the brief's own title,
 * subtitle, nickname, or acronym-expansion — the keyword extractor must never
 * surface these because they point back at the brief itself.
 *
 *  - title / nickname: substring match in either direction (e.g. title "JTAC"
 *    rejects keyword "jtac", and title "RAF Lossiemouth" rejects keyword
 *    "Lossiemouth"). Preserves the pre-existing title behaviour.
 *  - subtitle: normalised equality only (subtitles are often full sentences,
 *    so a substring match would reject legitimate keywords mentioned inside
 *    them). A JTAC brief with subtitle "Joint Terminal Attack Controllers"
 *    therefore rejects that exact phrase as a keyword.
 *  - acronym expansion: if the title or nickname is a 2–6 letter all-caps
 *    acronym, reject multi-word keywords whose first letters spell the
 *    acronym (e.g. title "JTAC" rejects "joint terminal attack controllers").
 */
function buildTitleRejectCheck({ title, subtitle, nickname } = {}) {
  const titleLower    = (title || '').trim().toLowerCase();
  const nicknameLower = (nickname || '').trim().toLowerCase();
  const normForEquality = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const subtitleNorm = normForEquality(subtitle);

  const acronymSources = [title, nickname]
    .map(s => (s || '').trim())
    .filter(t => /^[A-Z]{2,6}$/.test(t))
    .map(t => t.toLowerCase());

  return (keyword) => {
    const kl = (keyword || '').toLowerCase().trim();
    if (!kl) return false;

    for (const r of [titleLower, nicknameLower]) {
      if (!r) continue;
      if (kl === r || r.includes(kl) || kl.includes(r)) return true;
    }

    if (subtitleNorm && normForEquality(kl) === subtitleNorm) return true;

    if (acronymSources.length) {
      const words = kl.split(/\s+/).filter(Boolean);
      if (words.length >= 2) {
        const firstLetters = words.map(w => w[0]).join('');
        if (acronymSources.includes(firstLetters)) return true;
      }
    }

    return false;
  };
}

/**
 * Normalise a title for fuzzy duplicate detection.
 * Strips common prefixes (RAF, HMS, RNAS), punctuation, and collapses whitespace
 * so that "RAF College Cranwell" and "RAF Cranwell" both become "college cranwell" / "cranwell"
 * and the substring check catches them.
 */
function normForDupe(title) {
  return title
    .toLowerCase()
    .replace(/\b(raf|hms|rnas|royal|air|force|college|station)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Minimum normalised length for a title to participate in substring-based dupe
// matching. Anything shorter is too weak a signal — e.g. "Royal Air Force"
// strips to "" and would otherwise match every new title.
const MIN_NORM_LEN = 4;

function isFuzzyTitleDuplicate(newTitle, existingNorms) {
  const normNew = normForDupe(newTitle);
  if (normNew.length < MIN_NORM_LEN) return false;
  for (const ex of existingNorms) {
    if (!ex || ex.length < MIN_NORM_LEN) continue;
    if (ex.includes(normNew) || normNew.includes(ex)) return true;
  }
  return false;
}

// Normalisation used by the exact-match override. Mirrors the EXACT-MATCH
// PRIORITY rule in the Stage 2 prompt: case-insensitive, strip leading "The ",
// strip trailing simple plural "s". Trim and lowercase.
function normExactTitle(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/^the\s+/, '')
    .replace(/s$/, '');
}

// Pure function: re-points AI-chosen links to an exact-title-match candidate
// when one exists (any category). Respects AI null decisions — only overrides
// when the AI picked a non-null but different target. Returns a new links array.
function applyExactMatchOverride(links, candidateList, logger) {
  let overrideCount = 0;
  const result = links.map(l => {
    if (!l?.title) return l;
    const kwNorm = normExactTitle(l.keyword);
    if (!kwNorm) return l;
    const exactMatch = candidateList.find(t => normExactTitle(t) === kwNorm);
    if (exactMatch && exactMatch !== l.title) {
      logger?.(`[autoLinkKeywords] Exact-match override "${l.keyword}" [${l.type || '?'}]: "${l.title}" → "${exactMatch}"`);
      overrideCount++;
      return { ...l, title: exactMatch };
    }
    return l;
  });
  if (overrideCount > 0) {
    logger?.(`[autoLinkKeywords] Exact-match override re-pointed ${overrideCount} link(s)`);
  }
  return result;
}

// Allowed pairs between the AI's keyword-type classification and the
// candidate brief's category. Used as a post-AI safety net in Stage 2 —
// if Haiku classifies a keyword as ROLE but still proposes a [Squadrons]
// candidate, we strip the link rather than arguing with the model.
// GENERIC is intentionally absent (generics never link).
const KEYWORD_TYPE_TO_CATEGORY = {
  AIRCRAFT:  'Aircrafts',
  BASE:      'Bases',
  UNIT:      'Squadrons',
  ROLE:      'Roles',
  RANK:      'Ranks',
  PERSON:    'Actors',
  OPERATION: 'Missions',
  TECH:      'Tech',
  TRAINING:  'Training',
  THREAT:    'Threats',
  ALLY:      'Allies',
  REGION:    'AOR',
  TREATY:    'Treaties',
  TERM:      'Terminology',
};

// Common English words that are too generic to use as title-matching signals
const STOP_WORDS = new Set([
  // Short common words (would match everywhere)
  'with', 'from', 'over', 'this', 'that', 'into', 'been', 'have', 'will',
  'also', 'when', 'were', 'they', 'them', 'some', 'than', 'then', 'what',
  'your', 'each', 'more', 'most', 'such', 'very', 'both', 'only', 'just',
  'even', 'back', 'well', 'long', 'down', 'made', 'make', 'used', 'take',
  'come', 'about', 'after', 'other', 'which', 'their', 'these', 'those',
  'there', 'where', 'while', 'being', 'since', 'under', 'first', 'three',
  'later', 'based', 'known', 'given', 'using', 'until', 'would', 'could',
  // RAF / military noise — appear in too many brief titles to be useful signals
  'force', 'royal', 'group', 'wing', 'joint', 'fleet', 'field', 'corps',
  'command', 'station', 'united', 'national', 'british', 'defence',
  'central', 'allied', 'combined', 'support', 'operations', 'operational',
]);

// All-uppercase acronyms that look distinctive but appear in nearly every title
const NOISE_ACRONYMS = new Set(['RAF', 'RAFR', 'UK', 'US', 'USA', 'EU', 'UN', 'HQ']);

/**
 * Extract meaningful signal words from a title for use in Stage 1 pre-filtering.
 * Rules:
 *  - Split on whitespace / punctuation
 *  - Regular words: min 4 chars, not in STOP_WORDS
 *  - Acronyms (all-uppercase): min 3 chars, not in NOISE_ACRONYMS
 * Returns an array of lowercase strings.
 */
function titleSignalWords(title) {
  return title
    .split(/[\s\-\/().,']+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(w => {
      if (!w) return false;
      const isAcronym   = w === w.toUpperCase() && /[A-Z]/.test(w);
      const isPureDigit = /^\d+$/.test(w);
      // Allow 2-char acronyms (catches Roman numerals: IX, XI, II etc. used in squadron names)
      if (isAcronym)   return w.length >= 2 && !NOISE_ACRONYMS.has(w);
      // Allow digit strings of 2+ chars (catches squadron numbers: "11", "617" etc.)
      if (isPureDigit) return w.length >= 2;
      return w.length >= 4 && !STOP_WORDS.has(w.toLowerCase());
    })
    .map(w => w.toLowerCase());
}

/**
 * Append new lead entries to the JSONL sidecar file so they survive a DB reset.
 * One JSON object per line — cheap to append, safe against concurrent writers,
 * and merged into LEADS by seedLeads.loadLeadsFromDisk() at seed time.
 */
function appendToSeedLeads(entries) {
  try {
    const lines = entries.map(e => JSON.stringify({
      title:       e.title,
      nickname:    e.nickname    || '',
      subtitle:    e.subtitle    || '',
      category:    e.category,
      subcategory: e.subcategory || '',
      section:     e.category.toUpperCase(),
      subsection:  e.subcategory || '',
    })).join('\n') + '\n';
    fs.appendFileSync(SEED_LEADS_GENERATED_PATH, lines, 'utf8');
    console.log(`[appendToSeedLeads] Appended ${entries.length} entry(ies) to seedLeads.generated.jsonl`);
  } catch (err) {
    console.error('[appendToSeedLeads] Failed to write seedLeads.generated.jsonl (non-fatal):', err.message);
  }
}

/**
 * Stage 3 — For keywords still without a linkedBriefId, ask the AI which ones
 * warrant a new IntelLead + stub brief. Creates them in the DB, appends to
 * seedLeads.js, and triggers a priority re-ranking for each affected category.
 *
 * @param {Array}    keywords
 * @param {Function} openRouterChat
 * @param {*}        [sourceBriefId]    - ID of the brief whose keywords triggered this
 * @param {string}   [sourceBriefTitle] - title of that brief (for failure logs)
 */
async function seedUnmatchedKeywords(keywords, openRouterChat, sourceBriefId, sourceBriefTitle) {
  const unmatched = keywords.filter(k => !k.linkedBriefId && k.keyword);
  if (!unmatched.length) return keywords;

  // Fetch all existing lead titles so the AI can avoid near-duplicates
  const existingLeads = await IntelLead.find({}, 'title category').lean();
  const existingTitleList = existingLeads.map(l => `- "${l.title}" [${l.category}]`).join('\n');

  const subcategoryGuide = SEEDABLE_CATEGORIES
    .map(cat => {
      const subs = SUBCATEGORIES[cat];
      return subs && subs.length ? `  ${cat}: [${subs.map(s => `"${s}"`).join(', ')}]` : null;
    })
    .filter(Boolean)
    .join('\n');

  const prompt = `You are a curator deciding which RAF/military keywords deserve their own dedicated intel brief in a learning platform for RAF applicants and enthusiasts.

A keyword earns a YES only if ALL of the following are true:
1. It names a distinct, specific subject (a named aircraft, base, unit, rank, treaty, weapon system, doctrine, etc.) — not a feature, sub-component, spec, or detail of something else.
2. An RAF applicant would benefit significantly from reading a full multi-section brief and answering quiz questions specifically about this topic — beyond what a passing mention in another brief already covers.
3. It fits one of the valid subcategories listed below without stretching. If no subcategory is a reasonable fit, the answer is NO — do not force a poor match.
4. It is NOT a duplicate or near-duplicate of an existing brief listed below. Different names for the same thing count as duplicates (e.g. "RAF College Cranwell" is a duplicate of "RAF Cranwell", "Eurofighter" is a duplicate of "Eurofighter Typhoon"). If a keyword refers to the same subject as an existing brief under a slightly different name, answer NO.

Answer NO for:
- Aircraft or vehicle sub-components / features (e.g. thrust reversers, blown flaps, cargo capacity figures)
- Companies / manufacturers unless they are a major standalone subject with dedicated RAF learning value AND fit a subcategory cleanly (e.g. a prime contractor like BAE Systems — yes; an engine maker whose content belongs inside an aircraft brief — no)
- Generic infrastructure or ancillary details (e.g. hardened shelters, specific runways, named training centres whose content belongs inside a base brief)
- Named exercises unless they are a well-known, recurring, strategically significant exercise (not a one-off leadership event)
- Roles or service types that are NCO trades or administrative categories rather than distinct commissioned career streams
- Keywords that refer to the same subject as an existing brief (see list below) under a different name — these are duplicates, not new topics
- Naval vessels / warships (anything prefixed "HMS", "RFA", "USS", "HMCS", "USNS") — these are NOT aircraft and must never be classified under Aircrafts even when they carry aircraft. They may fit AOR or Heritage if strategically significant, otherwise leave them as keyword mentions inside the relevant aircraft brief.
- Umbrella or generic terms that simply restate one of the subcategory names above (e.g. "Front-Line Aviation" is just the Fast Jet subcategory under a vaguer label — NO). A valid lead names a specific, concrete subject, not a category of things.

Existing briefs (do NOT create duplicates of these):
${existingTitleList}

Valid subcategories per category (if no listed subcategory fits the keyword reasonably, answer NO):
${subcategoryGuide}

Keywords to evaluate:
${unmatched.map(k => `- "${k.keyword}"${k.generatedDescription ? `: ${k.generatedDescription}` : ''}`).join('\n')}

For each YES, provide:
- title: clean encyclopaedia-style title (e.g. "Sky Sabre" not "the Sky Sabre GBAD system")
- category: one of [${SEEDABLE_CATEGORIES.join(', ')}]
- subcategory: must be one of the valid options listed above for the chosen category
- nickname: short abbreviation or callsign if applicable, else ""
- subtitle: one concise sentence, max 20 words

Return ONLY valid JSON — no markdown, no extra text:
{
  "leads": [
    { "keyword": "exact keyword text", "title": "...", "category": "...", "subcategory": "...", "nickname": "...", "subtitle": "..." }
  ]
}
Only include keywords where the answer is YES. If none qualify, return { "leads": [] }.`;

  let leads = [];
  try {
    const raw     = await openRouterChat([{ role: 'user', content: prompt }], 'openai/gpt-4o-mini', 1024);
    const content = raw.choices?.[0]?.message?.content ?? '{}';
    const cleaned = content.replace(/```json\n?|```/g, '').trim();
    leads = JSON.parse(cleaned).leads ?? [];
  } catch (err) {
    console.error('[seedUnmatchedKeywords] AI evaluation failed (non-fatal):', err.message);
    return keywords;
  }

  if (!leads.length) return keywords;

  const updatedKeywords  = [...keywords];
  const newSeedEntries   = [];
  const createdStubs     = []; // { title, category, briefId } — for reprioritize pass

  // Build a normalised set of existing titles for fuzzy duplicate detection
  const normExisting = new Set(existingLeads.map(l => normForDupe(l.title)));

  for (const lead of leads) {
    const { keyword, title, category, nickname, subtitle } = lead;
    if (!title || !category || !SEEDABLE_CATEGORIES.includes(category)) continue;

    // Hard-rule classification check (ship-prefix in Aircrafts, umbrella titles, etc.)
    const classCheck = validateLeadClassification(title, category, { SUBCATEGORIES });
    if (!classCheck.ok) {
      console.log(`[seedUnmatchedKeywords] Rejected "${title}" [${category}] — ${classCheck.reason}`);
      continue;
    }

    // Validate subcategory against the model's enum; fall back to '' rather than storing junk
    const validSubs = SUBCATEGORIES[category] ?? [];
    const subcategory = validSubs.includes(lead.subcategory) ? lead.subcategory : '';

    // Subcategory is mandatory for any category that defines subcategories — skip
    // this lead rather than seeding a brief that would fail the model validator
    // (or worse, slip through with a blank and hide from subcategory filters).
    if (validSubs.length > 0 && !subcategory) {
      console.log(`[seedUnmatchedKeywords] Skipped "${title}" [${category}] — AI returned no valid subcategory`);
      continue;
    }

    // Fuzzy duplicate check: if normalised title is a substring of (or contains) an existing title, skip.
    const normNew = normForDupe(title);
    if (isFuzzyTitleDuplicate(title, normExisting)) {
      console.log(`[seedUnmatchedKeywords] Skipped near-duplicate "${title}" (fuzzy match with existing lead)`);
      continue;
    }

    // Check for existing IntelLead (case-insensitive)
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await IntelLead.findOne(
      { title: { $regex: `^${escapedTitle}$`, $options: 'i' } },
      '_id title'
    ).lean();

    if (existing) {
      // Lead exists — try to link keyword to an existing stub
      const existingBrief = await IntelligenceBrief.findOne({ title: existing.title }, '_id').lean();
      if (existingBrief) {
        const idx = updatedKeywords.findIndex(k => k.keyword?.toLowerCase() === keyword?.toLowerCase());
        if (idx !== -1 && !updatedKeywords[idx].linkedBriefId) {
          updatedKeywords[idx] = { ...updatedKeywords[idx], linkedBriefId: existingBrief._id };
          console.log(`[seedUnmatchedKeywords] Linked "${keyword}" → existing "${existing.title}"`);
        }
      }
      continue;
    }

    // Create IntelLead
    let newLead;
    try {
      newLead = await IntelLead.create({
        title, category,
        subcategory: subcategory || '',
        nickname: nickname || '',
        subtitle: subtitle || '',
        section:    category.toUpperCase(),
        subsection: subcategory || '',
      });
    } catch (err) {
      if (err.code === 11000) continue; // duplicate race — skip silently
      console.error(`[seedUnmatchedKeywords] Failed to create lead "${title}":`, err.message);
      continue;
    }

    // Create stub IntelligenceBrief
    let newBrief;
    try {
      newBrief = await IntelligenceBrief.create({
        title,
        category,
        subcategory: subcategory || '',
        subtitle: subtitle || '',
        status:   'stub',
        descriptionSections: [],
        keywords: [],
        sources:  [],
      });
    } catch (err) {
      // Roll back the lead to avoid orphaned leads
      await IntelLead.deleteOne({ _id: newLead._id }).catch(() => {});
      console.error(`[seedUnmatchedKeywords] Failed to create stub for "${title}":`, err.message);
      continue;
    }

    // Set linkedBriefId on the matching keyword
    const idx = updatedKeywords.findIndex(k => k.keyword?.toLowerCase() === keyword?.toLowerCase());
    if (idx !== -1) {
      updatedKeywords[idx] = { ...updatedKeywords[idx], linkedBriefId: newBrief._id };
    }

    // Track the new title so subsequent loop iterations catch duplicates within the same batch
    normExisting.add(normNew);

    newSeedEntries.push({ title, category, subcategory: subcategory || '', nickname: nickname || '', subtitle: subtitle || '' });
    createdStubs.push({ title, category, briefId: newBrief._id });
    console.log(`[seedUnmatchedKeywords] Created new lead + stub: "${title}" [${category}]`);
  }

  if (newSeedEntries.length) {
    appendToSeedLeads(newSeedEntries);
  }

  // Re-rank each affected category once (batched — one call per category)
  if (createdStubs.length) {
    const categoriesAffected = [...new Set(createdStubs.map(s => s.category))];
    for (const cat of categoriesAffected) {
      const stubsInCat = createdStubs.filter(s => s.category === cat);
      await reprioritizeCategory(
        cat,
        stubsInCat.map(s => ({ title: s.title, briefId: s.briefId })),
        sourceBriefId,
        sourceBriefTitle,
        openRouterChat
      ).catch(err => console.error(`[seedUnmatchedKeywords] reprioritize failed for "${cat}" (non-fatal):`, err.message));
    }
  }

  return updatedKeywords;
}

/**
 * Auto-link keywords to IntelligenceBrief IDs using a three-stage pipeline:
 *
 * Stage 1 — Word-level pre-filter (local, cheap):
 *   Build a word→[lead titles] index from all scannable IntelLead titles.
 *   Scan the description text AND keyword texts for those words.
 *   Collect all IntelLead titles that had at least one word hit → candidate pool.
 *
 * Stage 2 — AI disambiguation (targeted, small prompt):
 *   Send candidate pool + description + keywords (with descriptions) to the AI.
 *   AI identifies which candidate title each keyword refers to, using category
 *   labels to disambiguate (e.g. company name → [Tech], not [Aircrafts]).
 *   Resolve matched titles to IntelligenceBrief IDs and set linkedBriefId.
 *
 * Stage 3 — Auto-seed unmatched keywords:
 *   For keywords still without a linkedBriefId, ask the AI if they warrant a
 *   new IntelLead + stub brief. Creates them in DB and appends to seedLeads.js.
 *
 * @param {Array}    keywords           - keyword objects: [{ keyword, generatedDescription }]
 * @param {Array}    descriptionSections - canonical [{heading, body}] array (strings also tolerated)
 * @param {Function} openRouterChat     - the openRouterChat fn from admin.js
 * @param {*}        [currentBriefId]   - ID of the brief being generated (prevents self-linking)
 * @param {string}   [currentBriefTitle]
 * @param {object}   [opts]
 * @param {boolean}  [opts.skipSeed=false] - skip Stage 3 stub creation (use for dry-run backfills)
 * @returns {Array} keywords with linkedBriefId populated where a match was found
 */
async function autoLinkKeywords(keywords, descriptionSections, openRouterChat, currentBriefId, currentBriefTitle, { skipSeed = false } = {}) {
  if (!keywords?.length) return keywords;

  const descText  = bodiesText(descriptionSections);
  const descLower = descText.toLowerCase();

  // Load all scannable leads
  const leads = await IntelLead.find(
    { category: { $in: SCAN_CATEGORIES } },
    '_id title nickname category'
  ).lean();

  // ── Stage 1: build word index and find candidates ──────────────────────────

  // word (lowercase) → Set of lead titles
  const wordToTitles  = new Map();
  // title → category (preserved for Stage 2 prompt)
  const titleToCategory = new Map();

  for (const lead of leads) {
    titleToCategory.set(lead.title, lead.category);
    const words = [
      ...titleSignalWords(lead.title),
      ...(lead.nickname ? titleSignalWords(lead.nickname) : []),
    ];
    for (const word of words) {
      if (!wordToTitles.has(word)) wordToTitles.set(word, new Set());
      wordToTitles.get(word).add(lead.title);
    }
  }

  // Texts to scan: description + every keyword phrase
  const kwTexts   = keywords.map(k => k.keyword.toLowerCase());
  const scanTexts = [descLower, ...kwTexts];

  const candidateTitles = new Set();
  for (const [word, titles] of wordToTitles) {
    if (scanTexts.some(t => t.includes(word))) {
      for (const title of titles) candidateTitles.add(title);
    }
  }

  // ── Stage 2: AI disambiguation ─────────────────────────────────────────────

  const unlinkedKws = keywords.filter(k => !k.linkedBriefId);
  if (!unlinkedKws.length) return keywords;

  let linkedKeywords = [...keywords];

  if (candidateTitles.size) {
    // Exclude the current brief from candidates to prevent self-linking
    const candidateList = [...candidateTitles].filter(
      t => !currentBriefTitle || t.toLowerCase() !== currentBriefTitle.toLowerCase()
    );

    if (candidateList.length) {
      const prompt = `You are linking RAF intel brief keywords to the correct brief title from a candidate list.

YOUR DEFAULT ANSWER IS null. A missing link is ALWAYS better than a wrong one.

For every keyword, follow this exact procedure IN ORDER:

STEP 1 — Classify the keyword. Decide the TYPE of subject the keyword names. Use this mapping:
  • Aircraft / airframe / helicopter / drone (e.g. "F-35B", "Dassault Falcon 900LX", "Chinook HC6A") → type = AIRCRAFT
  • Base / airfield / station (e.g. "RAF Lossiemouth", "RAF Marham") → type = BASE
  • Unit / squadron / wing / group / team that is explicitly named as a single collective entity (e.g. "No. 617 Squadron", "Tactical Air Control Parties", "RAF Police") → type = UNIT
  • Role / career / job title, INCLUDING roles prefixed with a unit or branch name (e.g. "Weapon Systems Operator", "Gunners", "RAF Regiment Gunners", "Flight Operations Officer", "Intelligence Analyst", "Royal Engineers Sapper") → type = ROLE. A plural job title preceded by a branch name (e.g. "X Branch Y-ers") is still a ROLE, not a UNIT — it names the people doing the job, not a specific named squadron.
  • Military rank (e.g. "Sergeant", "Flight Lieutenant") → type = RANK
  • Named individual person → type = PERSON
  • Named operation, mission, or exercise (e.g. "Operation SHADER", "Exercise Cobra Warrior") → type = OPERATION
  • Named weapon system, sensor, equipment (e.g. "AIM-120 AMRAAM", "Paveway IV") → type = TECH
  • Named training programme or course (e.g. "Initial Officer Training", "JTAC Training and Certification") → type = TRAINING
  • Named threat / adversary asset (e.g. "Iskander-M", "Kh-101") → type = THREAT
  • Named ally / partner nation / organisation (e.g. "NATO", "France") → type = ALLY
  • Named region / area of responsibility (e.g. "Gaza Strip", "Baltic States") → type = REGION
  • Named treaty / agreement → type = TREATY
  • Doctrine / tactical concept / terminology (e.g. "Quick Reaction Alert") → type = TERM
  • Generic descriptor that does NOT name a specific subject (e.g. "ground forces", "air assets", "air defence", "fighter aircraft", "radar systems", "combat sorties", "training pipelines", "expeditionary operations", "battlefield effectiveness", "time-sensitive strikes", "air-to-ground missions", "multinational exercises", "basic courses") → type = GENERIC

STEP 2 — If the keyword's type is GENERIC, return null IMMEDIATELY. Do not link. Move to the next keyword.

STEP 3 — Otherwise, check the candidate list. A link is ONLY allowed when the candidate's [category] EXACTLY matches the keyword's type:
  AIRCRAFT → [Aircrafts]      BASE → [Bases]          UNIT → [Squadrons]       ROLE → [Roles]
  RANK → [Ranks]              PERSON → [Actors]       OPERATION → [Missions]   TECH → [Tech]
  TRAINING → [Training]       THREAT → [Threats]      ALLY → [Allies]          REGION → [AOR]
  TREATY → [Treaties]         TERM → [Terminology]

  HARD RULE: If no candidate has a category that EXACTLY matches the keyword's type, return null. Do NOT substitute a related or semantically-adjacent category. The following cross-type substitutions are all WRONG and must return null — even though each pair feels related, the substitution sends the reader to a different subject than the one they clicked on:
    • ROLE keyword → [Squadrons] candidate: WRONG (role is a job; squadron is a unit of people doing various jobs). Example: "RAF Regiment Gunners" → "No. 1 Squadron RAF Regiment" — NULL.
    • ROLE keyword → [Training] candidate: WRONG (role is the job; training is the course you take to get the job). Example: "Intelligence Analyst Trade" → "Intelligence Analyst Training" — NULL.
    • ROLE keyword → [Ranks] candidate: WRONG (role is a job; rank is a level). Example: "Fighter Controller" → "Sergeant" — NULL.
    • AIRCRAFT keyword → [Squadrons] candidate: WRONG. Example: "Dassault Falcon 900LX" → "No. 32 Squadron RAF" — NULL.
    • AIRCRAFT keyword → [Bases] candidate: WRONG (aircraft type is not a place). Example: "F-35B" → "RAF Marham" — NULL.
    • UNIT keyword → [Training] candidate: WRONG. Example: "Fire Support Teams" → "JTAC Training and Certification" — NULL.
    • UNIT keyword → [Roles] candidate: WRONG. Example: "Tactical Air Control Parties" → "Air Traffic Control Officer" — NULL.
    • BASE keyword → [Squadrons] candidate: WRONG (a base is a location; a squadron is a unit based there). Example: "RAF Marham" → "No. 617 Squadron" — NULL.
    • Any generic/object keyword → [Roles]/[Ranks]/[Actors] candidate: WRONG. Example: "air traffic control infrastructure" → "Air Traffic Control Officer" — NULL.

  If you feel tempted to substitute a "close enough" category because the learner might find it "relevant" — resist. The link sends the reader to a DIFFERENT subject than the keyword named, and that breaks trust. null is always safer than cross-type.

STEP 4 — Among candidates of the matching category, pick the one the description is SPECIFICALLY about. Use these rules in order:
  • EXACT-MATCH PRIORITY (highest). If one of the matching-category candidates has a title that is an exact case-insensitive match for the keyword text (ignoring leading "The " and trailing plurals), you MUST select that candidate — never prefer a similar-but-different-variant candidate when an exact match is available.
    – Example (aircraft): keyword "Hawk T2" with candidates ["BAE Systems Hawk T1", "Hawk T2"] → MUST pick "Hawk T2", NEVER "BAE Systems Hawk T1".
    – Example (ally): keyword "Royal Air Force" with candidates ["NATO", "Royal Air Force"] → MUST pick "Royal Air Force", NEVER "NATO" — even when the surrounding passage discusses alliance/coalition context. The keyword names the RAF specifically; NATO is a different (related but distinct) subject.
    – The rule is about NAMING: when the reader clicks a keyword titled X, they expect to land on the brief titled X. Picking a different brief because it's "related" breaks that contract.
  • Abbreviations / spelled-out forms (e.g. "QRA" ↔ "UK QRA North", "JTAC" ↔ "Joint Terminal Attack Controller").
  • Temporal coherence: modern-service passages link to current candidates, not Historic/Former/WWII/Cold War ones. Historical passages link to period-appropriate candidates.
  • Allegiance coherence: adversary/threat keywords must NOT link to RAF/Allied candidates. RAF keywords must NOT link to Threat candidates.
  • Context specificity: the surrounding sentences must be genuinely about that candidate's specific subject, not merely mentioning related words.

If after all four steps you are not confident, return null.

Description:
"""
${descText.slice(0, 1500)}
"""

Keywords extracted from this description (with their descriptions):
${unlinkedKws.map(k => `- "${k.keyword}"${k.generatedDescription ? `: ${k.generatedDescription}` : ''}`).join('\n')}

Candidate brief titles with their category (you may ONLY link to titles in this list):
${candidateList.map(t => `- "${t}" [${titleToCategory.get(t) || 'Unknown'}]`).join('\n')}

Return ONLY valid JSON — no markdown, no extra text. Include the "type" you classified in STEP 1 for every keyword so your reasoning is auditable:
{
  "links": [
    { "keyword": "exact keyword text", "type": "AIRCRAFT|BASE|UNIT|ROLE|RANK|PERSON|OPERATION|TECH|TRAINING|THREAT|ALLY|REGION|TREATY|TERM|GENERIC", "title": "matched candidate title or null" }
  ]
}`;

      let links = [];
      try {
        const raw     = await openRouterChat([{ role: 'user', content: prompt }], 'anthropic/claude-haiku-4.5', 1024);
        const content = raw.choices?.[0]?.message?.content ?? '{}';
        const cleaned = content.replace(/```json\n?|```/g, '').trim();
        links = JSON.parse(cleaned).links ?? [];
      } catch (err) {
        console.error('[autoLinkKeywords] AI disambiguation failed (non-fatal):', err.message);
      }

      if (links.length) {
        // Exact-match override (runs FIRST): any AI pick where the keyword text
        // exactly matches a candidate title (any category) is re-pointed to that
        // candidate. Respects AI null decisions. See applyExactMatchOverride.
        links = applyExactMatchOverride(links, candidateList, (msg) => console.log(msg));

        // Type-guard (runs AFTER exact-match): drop any remaining link where the AI's
        // declared keyword type doesn't match the candidate's category. Exact-match
        // overrides above are exempt (they may intentionally cross categories). For
        // everything else — catches cases where Haiku classifies correctly in STEP 1
        // but still proposes a cross-type link in STEP 4.
        const beforeCount = links.filter(l => l.title).length;
        const exactOverrideTitles = new Set(
          links.filter(l => l.title && normExactTitle(l.title) === normExactTitle(l.keyword))
               .map(l => l.title)
        );
        links = links.map(l => {
          if (!l.title || !l.type) return l;
          if (exactOverrideTitles.has(l.title)) return l; // exempt exact matches
          const expected = KEYWORD_TYPE_TO_CATEGORY[l.type];
          const actual   = titleToCategory.get(l.title);
          if (!expected || expected !== actual) {
            console.log(`[autoLinkKeywords] Type-mismatch guard dropped "${l.keyword}" [${l.type}] → "${l.title}" [${actual || 'Unknown'}]`);
            return { ...l, title: null };
          }
          return l;
        });
        const droppedCount = beforeCount - links.filter(l => l.title).length;
        if (droppedCount > 0) {
          console.log(`[autoLinkKeywords] Type-mismatch guard dropped ${droppedCount} cross-type link(s)`);
        }

        // Resolve matched titles → IntelligenceBrief IDs
        const matchedTitles = [...new Set(links.filter(l => l.title).map(l => l.title))];
        const briefDocs     = await IntelligenceBrief.find({ title: { $in: matchedTitles } }, '_id title').lean();
        const titleToId     = new Map(briefDocs.map(b => [b.title, b._id]));

        linkedKeywords = linkedKeywords.map(kw => {
          if (kw.linkedBriefId) return kw;
          const match   = links.find(l => l.keyword?.toLowerCase() === kw.keyword?.toLowerCase());
          if (!match?.title) return kw;
          const briefId = titleToId.get(match.title);
          if (!briefId) return kw;
          if (currentBriefId && String(briefId) === String(currentBriefId)) return kw;
          return { ...kw, linkedBriefId: briefId };
        });
      }
    }
  }

  // ── Stage 3: Auto-seed stubs for still-unmatched keywords ─────────────────

  if (!skipSeed) {
    linkedKeywords = await seedUnmatchedKeywords(linkedKeywords, openRouterChat, currentBriefId, currentBriefTitle);
  }

  return linkedKeywords;
}

module.exports = { autoLinkKeywords, seedUnmatchedKeywords, validateLeadClassification, buildTitleRejectCheck, isFuzzyTitleDuplicate, normForDupe, applyExactMatchOverride, normExactTitle };
