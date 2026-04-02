/**
 * One-time backfill: populate mentionedBriefIds for all existing published briefs.
 *
 * Optimised: loads the full candidate pool (IntelLead titles) once and builds a
 * title→IntelligenceBrief._id map, then scans each brief locally rather than
 * hitting the DB per brief.
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

  let updated = 0;
  for (const brief of briefs) {
    const descLower = (brief.descriptionSections || []).join(' ').toLowerCase();
    if (!descLower.trim()) continue;

    const linkedIds = new Set([
      ...(brief.associatedBaseBriefIds     || []).map(String),
      ...(brief.associatedSquadronBriefIds || []).map(String),
      ...(brief.associatedAircraftBriefIds || []).map(String),
      ...(brief.associatedMissionBriefIds  || []).map(String),
      ...(brief.associatedTrainingBriefIds || []).map(String),
      ...(brief.relatedBriefIds            || []).map(String),
      String(brief._id),
    ]);

    const mentionedIds = [];
    for (const lead of poolWithCandidates) {
      if (linkedIds.has(String(lead.briefId))) continue;
      const wordBoundary = WORD_BOUNDARY_CATEGORIES.has(lead.category);
      for (const candidate of lead.candidates) {
        const term = candidate.toLowerCase();
        const matched = wordBoundary
          ? new RegExp(`(?<![a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i').test(descLower)
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
      updated++;
    }
  }

  console.log(`\nDone. ${updated} briefs had text mentions stored.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
