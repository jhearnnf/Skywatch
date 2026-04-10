const path = require('path');
const fs   = require('fs');

const IntelligenceBrief    = require('../models/IntelligenceBrief');
const { SUBCATEGORIES }    = IntelligenceBrief;
const IntelLead            = require('../models/IntelLead');
const { SCAN_CATEGORIES }  = require('./mentionedBriefs');
const { reprioritizeCategory } = require('./priorityRanking');

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

Answer NO for:
- Aircraft or vehicle sub-components / features (e.g. thrust reversers, blown flaps, cargo capacity figures)
- Companies / manufacturers unless they are a major standalone subject with dedicated RAF learning value AND fit a subcategory cleanly (e.g. a prime contractor like BAE Systems — yes; an engine maker whose content belongs inside an aircraft brief — no)
- Generic infrastructure or ancillary details (e.g. hardened shelters, specific runways, named training centres whose content belongs inside a base brief)
- Named exercises unless they are a well-known, recurring, strategically significant exercise (not a one-off leadership event)
- Roles or service types that are NCO trades or administrative categories rather than distinct commissioned career streams

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

  for (const lead of leads) {
    const { keyword, title, category, nickname, subtitle } = lead;
    if (!title || !category || !SEEDABLE_CATEGORIES.includes(category)) continue;

    // Validate subcategory against the model's enum; fall back to '' rather than storing junk
    const validSubs = SUBCATEGORIES[category] ?? [];
    const subcategory = validSubs.includes(lead.subcategory) ? lead.subcategory : '';

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
 * @param {string[]} descriptionSections
 * @param {Function} openRouterChat     - the openRouterChat fn from admin.js
 * @param {*}        [currentBriefId]   - ID of the brief being generated (prevents self-linking)
 * @param {string}   [currentBriefTitle]
 * @param {object}   [opts]
 * @param {boolean}  [opts.skipSeed=false] - skip Stage 3 stub creation (use for dry-run backfills)
 * @returns {Array} keywords with linkedBriefId populated where a match was found
 */
async function autoLinkKeywords(keywords, descriptionSections, openRouterChat, currentBriefId, currentBriefTitle, { skipSeed = false } = {}) {
  if (!keywords?.length) return keywords;

  const descText  = (descriptionSections || []).join(' ');
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

Description:
"""
${descText.slice(0, 1500)}
"""

Keywords extracted from this description (with their descriptions):
${unlinkedKws.map(k => `- "${k.keyword}"${k.generatedDescription ? `: ${k.generatedDescription}` : ''}`).join('\n')}

Candidate brief titles with their category (you may ONLY link to titles in this list):
${candidateList.map(t => `- "${t}" [${titleToCategory.get(t) || 'Unknown'}]`).join('\n')}

For each keyword, identify which candidate title it refers to in context — considering abbreviations (e.g. "QRA" → "UK QRA North"), spelled-out forms (e.g. "Quick Reaction Alert" → "UK QRA North"), and partial names. Use the category as a type hint: if a keyword names a company or manufacturer, prefer a [Tech] or [Allies] candidate over an [Aircrafts] candidate; if a keyword names an aircraft, prefer [Aircrafts]. Use the description context to disambiguate when multiple candidates are plausible. Return null if no candidate clearly matches.

Return ONLY valid JSON — no markdown, no extra text:
{
  "links": [
    { "keyword": "exact keyword text", "title": "matched candidate title or null" }
  ]
}`;

      let links = [];
      try {
        const raw     = await openRouterChat([{ role: 'user', content: prompt }], 'openai/gpt-4o-mini', 1024);
        const content = raw.choices?.[0]?.message?.content ?? '{}';
        const cleaned = content.replace(/```json\n?|```/g, '').trim();
        links = JSON.parse(cleaned).links ?? [];
      } catch (err) {
        console.error('[autoLinkKeywords] AI disambiguation failed (non-fatal):', err.message);
      }

      if (links.length) {
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

module.exports = { autoLinkKeywords, seedUnmatchedKeywords };
