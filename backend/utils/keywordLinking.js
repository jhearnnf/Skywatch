const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelLead         = require('../models/IntelLead');
const { SCAN_CATEGORIES } = require('./mentionedBriefs');

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
      const isAcronym = w === w.toUpperCase() && /[A-Z]/.test(w);
      if (isAcronym) return w.length >= 3 && !NOISE_ACRONYMS.has(w);
      return w.length >= 4 && !STOP_WORDS.has(w.toLowerCase());
    })
    .map(w => w.toLowerCase());
}

/**
 * Auto-link keywords to IntelligenceBrief IDs using a two-stage pipeline:
 *
 * Stage 1 — Word-level pre-filter (local, cheap):
 *   Build a word→[lead titles] index from all scannable IntelLead titles.
 *   Scan the description text AND keyword texts for those words.
 *   Collect all IntelLead titles that had at least one word hit → candidate pool.
 *
 * Stage 2 — AI disambiguation (targeted, small prompt):
 *   Send candidate pool + description + keywords to the AI.
 *   AI identifies which candidate title each keyword refers to (handles
 *   abbreviations, spelled-out forms, context disambiguation).
 *   Resolve matched titles to IntelligenceBrief IDs and set linkedBriefId.
 *
 * @param {Array}    keywords           - keyword objects from generation: [{ keyword, generatedDescription }]
 * @param {string[]} descriptionSections
 * @param {Function} openRouterChat     - the openRouterChat fn from admin.js
 * @returns {Array} keywords with linkedBriefId populated where a match was found
 */
async function autoLinkKeywords(keywords, descriptionSections, openRouterChat) {
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
  const wordToTitles = new Map();
  for (const lead of leads) {
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

  if (!candidateTitles.size) return keywords;

  // ── Stage 2: AI disambiguation ─────────────────────────────────────────────

  const unlinkedKws = keywords.filter(k => !k.linkedBriefId);
  if (!unlinkedKws.length) return keywords;

  const candidateList = [...candidateTitles];

  const prompt = `You are linking RAF intel brief keywords to the correct brief title from a candidate list.

Description:
"""
${descText.slice(0, 1500)}
"""

Keywords extracted from this description:
${unlinkedKws.map(k => `- "${k.keyword}"`).join('\n')}

Candidate brief titles (you may ONLY link to titles in this list):
${candidateList.map(t => `- "${t}"`).join('\n')}

For each keyword, identify which candidate title it refers to in context — considering abbreviations (e.g. "QRA" → "UK QRA North"), spelled-out forms (e.g. "Quick Reaction Alert" → "UK QRA North"), and partial names. Use the description context to disambiguate when multiple candidates are plausible (e.g. prefer "UK QRA North" over "UK QRA South" if the description is about a northern base). Return null if no candidate clearly matches.

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
    return keywords;
  }

  // Resolve matched titles → IntelligenceBrief IDs
  const matchedTitles = [...new Set(links.filter(l => l.title).map(l => l.title))];
  if (!matchedTitles.length) return keywords;

  const briefDocs  = await IntelligenceBrief.find({ title: { $in: matchedTitles } }, '_id title').lean();
  const titleToId  = new Map(briefDocs.map(b => [b.title, b._id]));

  // Apply linkedBriefId to each matched keyword
  return keywords.map(kw => {
    if (kw.linkedBriefId) return kw;
    const match   = links.find(l => l.keyword?.toLowerCase() === kw.keyword?.toLowerCase());
    if (!match?.title) return kw;
    const briefId = titleToId.get(match.title);
    if (!briefId) return kw;
    return { ...kw, linkedBriefId: briefId };
  });
}

module.exports = { autoLinkKeywords };
