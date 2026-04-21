/**
 * One-time backfill: fix mentionedBriefIds and keyword self-links for all existing briefs.
 *
 * Pass 1 — mentionedBriefIds:
 *   Re-scans all published briefs with the updated matching logic:
 *   - No bare "No. X" Squadron candidates (prevents false matches like
 *     "No. 7 Force Protection Wing" linking to "No. 7 Squadron RAF")
 *   - Word-boundary matching for Squadrons, Bases, Aircrafts (not just Ranks)
 *   Note: AI validation is skipped here for speed. The text-only fixes above
 *   resolve the known false-positive cases without requiring API calls.
 *
 * Pass 2 — keyword self-links:
 *   Strips any keywords[].linkedBriefId that points back to the brief itself
 *   (e.g. "main operating base" on RAF Marham linking to RAF Marham).
 *   Pure DB operation — no AI calls needed.
 *
 * Usage:
 *   cd backend && node scripts/backfillMentionedBriefs.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelLead = require('../models/IntelLead');
const { getMatchCandidates, SCAN_CATEGORIES, WORD_BOUNDARY_CATEGORIES } = require('../utils/mentionedBriefs');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // ── Pass 1: Re-scan mentionedBriefIds ───────────────────────────────────────

  console.log('\n── Pass 1: Re-scanning mentionedBriefIds ──');

  // Load all scannable leads — these are the 850+ candidate titles
  const leads = await IntelLead.find(
    { category: { $in: SCAN_CATEGORIES } },
    '_id title nickname category'
  ).lean();

  // Build title→IntelligenceBrief._id map (stub or published)
  const leadTitles = leads.map(l => l.title);
  const briefDocs = await IntelligenceBrief.find(
    { title: { $in: leadTitles } },
    '_id title'
  ).lean();
  const titleToBriefId = new Map(briefDocs.map(b => [b.title, b._id]));

  // Pre-compute match candidates for every lead so we don't redo it per brief
  const poolWithCandidates = leads
    .map(l => ({ ...l, briefId: titleToBriefId.get(l.title), candidates: getMatchCandidates(l.title, l.category, l.nickname) }))
    .filter(l => l.briefId); // skip leads with no stub yet

  console.log(`Candidate pool: ${poolWithCandidates.length} leads with stubs`);

  const briefs = await IntelligenceBrief.find(
    { status: 'published', descriptionSections: { $exists: true, $not: { $size: 0 } } },
    '_id title descriptionSections associatedBaseBriefIds associatedSquadronBriefIds associatedAircraftBriefIds associatedMissionBriefIds associatedTrainingBriefIds relatedBriefIds'
  ).lean();

  console.log(`Scanning ${briefs.length} published briefs...`);

  let mentionUpdated = 0;
  for (const brief of briefs) {
    const descLower = require('../utils/descriptionSections').bodiesText(brief.descriptionSections).toLowerCase();
    if (!descLower.trim()) continue;

    // Exclude self and all explicitly associated briefs
    const linkedIds = new Set([
      String(brief._id),
      ...(brief.associatedBaseBriefIds     || []).map(String),
      ...(brief.associatedSquadronBriefIds || []).map(String),
      ...(brief.associatedAircraftBriefIds || []).map(String),
      ...(brief.associatedMissionBriefIds  || []).map(String),
      ...(brief.associatedTrainingBriefIds || []).map(String),
      ...(brief.relatedBriefIds            || []).map(String),
    ]);

    const mentionedIds = [];
    for (const lead of poolWithCandidates) {
      if (linkedIds.has(String(lead.briefId))) continue;
      const wordBoundary = WORD_BOUNDARY_CATEGORIES.has(lead.category);
      for (const candidate of lead.candidates) {
        const term    = candidate.toLowerCase();
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matched = wordBoundary
          ? new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i').test(descLower)
          : descLower.includes(term);
        if (matched) {
          mentionedIds.push(lead.briefId);
          break;
        }
      }
    }

    await IntelligenceBrief.findByIdAndUpdate(brief._id, { mentionedBriefIds: mentionedIds });
    if (mentionedIds.length) {
      console.log(`  ${brief.title}: ${mentionedIds.length} mention(s)`);
      mentionUpdated++;
    }
  }

  console.log(`Pass 1 done. ${mentionUpdated} briefs had text mentions stored.`);

  // ── Pass 2: Strip keyword self-links ────────────────────────────────────────

  console.log('\n── Pass 2: Stripping keyword self-links ──');

  // Load all briefs that have keywords with a linkedBriefId
  const allBriefs = await IntelligenceBrief.find(
    { 'keywords.linkedBriefId': { $exists: true, $ne: null } },
    '_id title keywords'
  ).lean();

  console.log(`Checking ${allBriefs.length} briefs with linked keywords...`);

  let selfLinkFixed = 0;
  for (const brief of allBriefs) {
    const selfLinked = (brief.keywords || []).filter(
      k => k.linkedBriefId && String(k.linkedBriefId) === String(brief._id)
    );
    if (!selfLinked.length) continue;

    // Null out linkedBriefId for any keyword that points back to this brief
    await IntelligenceBrief.updateOne(
      { _id: brief._id },
      {
        $set: Object.fromEntries(
          brief.keywords
            .map((k, i) => [i, k])
            .filter(([, k]) => k.linkedBriefId && String(k.linkedBriefId) === String(brief._id))
            .map(([i]) => [`keywords.${i}.linkedBriefId`, null])
        ),
      }
    );

    console.log(`  ${brief.title}: removed ${selfLinked.length} self-link(s) (keywords: ${selfLinked.map(k => `"${k.keyword}"`).join(', ')})`);
    selfLinkFixed++;
  }

  console.log(`Pass 2 done. ${selfLinkFixed} briefs had keyword self-links removed.`);

  console.log('\nBackfill complete.');
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
