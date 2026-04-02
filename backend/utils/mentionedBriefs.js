const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelLead = require('../models/IntelLead');

// Categories whose titles are worth scanning for as in-text mentions
const SCAN_CATEGORIES = [
  'Bases', 'Squadrons', 'Aircrafts', 'Missions',
  'Tech', 'Threats', 'Terminology', 'Allies',
  'AOR', 'Training', 'Heritage', 'Roles', 'Ranks', 'Treaties',
];

// Categories that require whole-word matching to avoid false positives
// (e.g. rank titles used as job titles in prose rather than links)
const WORD_BOUNDARY_CATEGORIES = new Set(['Ranks']);

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
    // "No. 14 Squadron RAF" → also try "No. 14 Squadron" and "No. 14"
    const noMatch = title.match(/^(No\.\s*\d+)\s+Squadron/i);
    if (noMatch) raw.push(noMatch[1]);
    // Strip the full suffix to get "No. 14 Squadron" form
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
 * Excludes briefs that are already explicitly linked via any association array.
 * Returns an array of ObjectIds for matched briefs.
 */
async function scanMentionedBriefIds(brief) {
  const descLower = (brief.descriptionSections || []).join(' ').toLowerCase();
  if (!descLower.trim()) return [];

  // Use IntelLead as the candidate pool (850+ titles) so descriptions are scanned
  // against the full catalogue, not just the subset of generated briefs.
  // For each matched lead, we resolve the corresponding IntelligenceBrief (stub or
  // published) by title — guaranteed to exist since reset-stubs-and-leads ensures
  // every lead has a stub.
  const leads = await IntelLead.find(
    { category: { $in: SCAN_CATEGORIES } },
    '_id title nickname category'
  ).lean();

  // Build a title→IntelligenceBrief._id lookup in one query
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
    ...(brief.relatedBriefIds            || []).map(b => String(b._id ?? b)),
  ]);

  const ids = [];
  for (const lead of leads) {
    const briefId = titleToBriefId.get(lead.title);
    if (!briefId) continue; // no stub exists yet — skip
    if (linkedIds.has(String(briefId))) continue;
    const wordBoundary = WORD_BOUNDARY_CATEGORIES.has(lead.category);
    for (const candidate of getMatchCandidates(lead.title, lead.category, lead.nickname)) {
      const term = candidate.toLowerCase();
      const matched = wordBoundary
        ? new RegExp(`(?<![a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i').test(descLower)
        : descLower.includes(term);
      if (matched) {
        ids.push(briefId);
        break;
      }
    }
  }
  return ids;
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
