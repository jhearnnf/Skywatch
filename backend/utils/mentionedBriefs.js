const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelLead = require('../models/IntelLead');
const { bodiesText } = require('./descriptionSections');

// Categories whose titles are worth scanning for as in-text mentions
const SCAN_CATEGORIES = [
  'Bases', 'Squadrons', 'Aircrafts', 'Missions',
  'Tech', 'Threats', 'Terminology', 'Allies',
  'AOR', 'Training', 'Heritage', 'Roles', 'Ranks', 'Treaties',
];

// Categories that require whole-word matching to avoid false positives
// Extended to Squadrons, Bases, Aircrafts — substring matching is too loose for these
// (e.g. "No. 7" would match "No. 7 Force Protection Wing" without word boundaries)
const WORD_BOUNDARY_CATEGORIES = new Set(['Ranks', 'Squadrons', 'Bases', 'Aircrafts']);

/**
 * Generate all candidate match strings for a brief's title.
 * Handles category-specific abbreviations/variants (e.g. strips "RAF " prefix
 * from Bases, strips " RAF" suffix from Squadrons, uses nickname for Aircrafts).
 * Returns strings sorted longest-first, all >= 4 chars.
 */
function getMatchCandidates(title, category, nickname) {
  if (!title) return [];
  const raw = [title];

  if (category === 'Bases') {
    if (/^RAF /i.test(title))             raw.push(title.replace(/^RAF /i, ''));
    if (/^Royal Air Force /i.test(title)) raw.push(title.replace(/^Royal Air Force /i, ''));
  } else if (category === 'Squadrons') {
    if (/ RAF$/i.test(title))             raw.push(title.replace(/ RAF$/i, ''));
    if (/ Royal Air Force$/i.test(title)) raw.push(title.replace(/ Royal Air Force$/i, ''));
    // "No. 14 Squadron RAF" → also try "No. 14 Squadron" and abbreviated "No. 14 Sqn"
    // Deliberately do NOT emit bare "No. X" — too ambiguous (Wings, Groups, Force Protection
    // Wings etc. share the same number and would cause false positive matches)
    const noMatch = title.match(/^(No\.\s*\d+)\s+Squadron/i);
    if (noMatch) raw.push(`${noMatch[1]} Sqn`);
    // Strip suffix to get "No. 14 Squadron" form
    const squadronBase = title.replace(/ (RAF|Royal Air Force)$/i, '').trim();
    if (squadronBase !== title) raw.push(squadronBase);
  } else if (category === 'Aircrafts') {
    if (nickname) raw.push(nickname);
  } else if (category === 'Missions') {
    // "Operation Shader" → also try "Op Shader"
    if (/^Operation /i.test(title)) raw.push(title.replace(/^Operation /i, 'Op '));
  } else if (category === 'Treaties') {
    // "The Ottawa Treaty" → also try "Ottawa Treaty"
    if (/^The /i.test(title)) raw.push(title.replace(/^The /i, ''));
  }

  return [...new Set(raw)]
    .filter(c => c.length >= 4)
    .sort((a, b) => b.length - a.length); // longest first so most specific wins
}

/**
 * Scan a brief's description sections for verbatim mentions of other scannable
 * brief titles (using all candidate forms from getMatchCandidates).
 *
 * Excludes briefs that are already explicitly linked via any association array,
 * and never links a brief to itself.
 *
 * @param {object}   brief           - the brief document
 * @param {Function} [openRouterChat] - optional; when provided, matches that won on a
 *                                     short-form candidate (not the full title) are
 *                                     validated by a single batched AI call before
 *                                     being included, preventing false positives like
 *                                     "No. 7" matching "No. 7 Force Protection Wing"
 *                                     when the description is about a different unit.
 * Returns an array of ObjectIds for matched briefs.
 */
async function scanMentionedBriefIds(brief, openRouterChat) {
  const descText  = bodiesText(brief.descriptionSections);
  const descLower = descText.toLowerCase();
  if (!descLower.trim()) return [];

  // Use IntelLead as the candidate pool (850+ titles) so descriptions are scanned
  // against the full catalogue, not just the subset of generated briefs.
  const leads = await IntelLead.find(
    { category: { $in: SCAN_CATEGORIES } },
    '_id title nickname category'
  ).lean();

  // Build a title→IntelligenceBrief._id lookup in one query
  // Excludes the brief itself (_id: { $ne: brief._id }) to prevent self-links
  const leadTitles = leads.map(l => l.title);
  const briefDocs = await IntelligenceBrief.find(
    { title: { $in: leadTitles }, _id: { $ne: brief._id } },
    '_id title'
  ).lean();
  const titleToBriefId = new Map(briefDocs.map(b => [b.title, b._id]));

  // Build exclusion set from all explicit association arrays
  const linkedIds = new Set([
    ...(brief.associatedBaseBriefIds     || []).map(b => String(b._id ?? b)),
    ...(brief.associatedSquadronBriefIds || []).map(b => String(b._id ?? b)),
    ...(brief.associatedAircraftBriefIds || []).map(b => String(b._id ?? b)),
    ...(brief.associatedMissionBriefIds  || []).map(b => String(b._id ?? b)),
    ...(brief.associatedTrainingBriefIds || []).map(b => String(b._id ?? b)),
    ...(brief.associatedTechBriefIds     || []).map(b => String(b._id ?? b)),
    ...(brief.relatedBriefIds            || []).map(b => String(b._id ?? b)),
  ]);

  // matches: { briefId, title, winningCandidate }
  // Track the winning candidate so we can flag ambiguous matches for AI validation
  const matches = [];
  for (const lead of leads) {
    const briefId = titleToBriefId.get(lead.title);
    if (!briefId) continue; // no stub exists yet — skip
    if (linkedIds.has(String(briefId))) continue;
    const wordBoundary = WORD_BOUNDARY_CATEGORIES.has(lead.category);
    for (const candidate of getMatchCandidates(lead.title, lead.category, lead.nickname)) {
      const term    = candidate.toLowerCase();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matched = wordBoundary
        ? new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i').test(descLower)
        : descLower.includes(term);
      if (matched) {
        matches.push({ briefId, title: lead.title, winningCandidate: candidate });
        break;
      }
    }
  }

  if (!matches.length) return [];

  // AI validation pass: for any match that won on a short-form candidate rather than
  // the full title, ask the AI to confirm the description genuinely refers to that unit.
  // This catches cases like "No. 7 Sqn" matching a brief about "No. 7 Force Protection Wing".
  if (openRouterChat) {
    const ambiguous = matches.filter(
      m => m.winningCandidate.toLowerCase() !== m.title.toLowerCase()
    );
    if (ambiguous.length) {
      const prompt = `You are validating whether an RAF intelligence brief description genuinely mentions specific units or subjects.

Description text:
"""
${descText.slice(0, 2000)}
"""

For each entry below, answer YES if the description genuinely refers to that specific unit/subject by name or clear implication. Answer NO if the match is incidental — e.g. the text uses a similar number or abbreviation for a completely different unit (like "No. 7 Force Protection Wing" matching "No. 7 Squadron RAF").

${ambiguous.map((m, i) => `${i + 1}. "${m.title}" (matched via short form "${m.winningCandidate}")`).join('\n')}

Return ONLY valid JSON — no markdown, no extra text:
{ "results": [{ "title": "...", "confirmed": true }] }
Only include entries where confirmed is true.`;

      try {
        const raw     = await openRouterChat([{ role: 'user', content: prompt }], 'openai/gpt-4o-mini', 512);
        const content = raw.choices?.[0]?.message?.content ?? '{}';
        const cleaned = content.replace(/```json\n?|```/g, '').trim();
        const { results } = JSON.parse(cleaned);
        const confirmed = new Set((results || []).filter(r => r.confirmed).map(r => r.title));
        // Remove ambiguous matches that were not confirmed by the AI
        const rejectedTitles = new Set(
          ambiguous.filter(m => !confirmed.has(m.title)).map(m => m.title)
        );
        for (let i = matches.length - 1; i >= 0; i--) {
          if (rejectedTitles.has(matches[i].title)) matches.splice(i, 1);
        }
        if (rejectedTitles.size) {
          console.log(`[scanMentionedBriefIds] AI rejected ${rejectedTitles.size} ambiguous match(es):`, [...rejectedTitles].join(', '));
        }
      } catch (err) {
        console.error('[scanMentionedBriefIds] AI validation failed (non-fatal):', err.message);
      }
    }
  }

  return matches.map(m => m.briefId);
}

/**
 * Add a matchTerms string[] to each item in a populated associated-brief array.
 * Input items must be plain objects with title, category, and optionally nickname.
 */
function enrichWithMatchTerms(arr) {
  return (arr || []).map(b => ({
    ...b,
    matchTerms: getMatchCandidates(b.title, b.category, b.nickname),
  }));
}

module.exports = { getMatchCandidates, scanMentionedBriefIds, enrichWithMatchTerms, SCAN_CATEGORIES, WORD_BOUNDARY_CATEGORIES };
