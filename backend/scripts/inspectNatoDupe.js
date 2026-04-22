/**
 * inspectNatoDupe.js — one-off: compare "NATO" vs "North Atlantic Treaty
 * Organization" briefs + leads so we can pick a canonical winner before
 * merging and deleting the other.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const IntelLead             = require('../models/IntelLead');
const IntelligenceBrief     = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const GameQuizQuestion      = require('../models/GameQuizQuestion');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const titles = ['NATO', 'North Atlantic Treaty Organization'];
  const briefs = await IntelligenceBrief.find({ title: { $in: titles } }).lean();
  const leads  = await IntelLead.find({ title: { $in: titles } }).lean();

  for (const b of briefs) {
    console.log(`── BRIEF: ${b.title} ──`);
    console.log(`  _id:                  ${b._id}`);
    console.log(`  category/subcategory: ${b.category} / ${b.subcategory || '(none)'}`);
    console.log(`  subtitle:             ${b.subtitle}`);
    console.log(`  nickname:             ${b.nickname || '(none)'}`);
    console.log(`  status:               ${b.status}`);
    console.log(`  publishedAt:          ${b.publishedAt}`);
    console.log(`  descriptionSections:  ${b.descriptionSections?.length ?? 0}`);
    console.log(`  keywords:             ${b.keywords?.length ?? 0}`);
    console.log(`  sources:              ${b.sources?.length ?? 0}`);
    console.log(`  media:                ${b.media?.length ?? 0}`);
    console.log(`  flaggedForEdit:       ${b.flaggedForEdit}`);
    console.log(`  mentionedBriefIds:    ${(b.mentionedBriefIds ?? []).length}`);
    console.log(`  relatedHistoric:      ${(b.relatedHistoric ?? []).length}`);

    const refs = await IntelligenceBrief.find({
      $or: [
        { associatedBaseBriefIds:     b._id },
        { associatedSquadronBriefIds: b._id },
        { associatedAircraftBriefIds: b._id },
        { associatedMissionBriefIds:  b._id },
        { associatedTrainingBriefIds: b._id },
        { relatedBriefIds:            b._id },
        { relatedHistoric:            b._id },
        { mentionedBriefIds:          b._id },
        { 'keywords.linkedBriefId':   b._id },
      ],
    }).select('_id title').lean();
    console.log(`  incoming references:  ${refs.length}  ${refs.map(r => r.title).join(' | ')}`);

    const reads = await IntelligenceBriefRead.countDocuments({ intelBriefId: b._id });
    console.log(`  read records:         ${reads}`);

    const qCount = await GameQuizQuestion.countDocuments({ intelBriefId: b._id });
    console.log(`  quiz questions:       ${qCount}`);
    console.log('');
  }

  for (const l of leads) {
    console.log(`── LEAD: ${l.title} ──`);
    console.log(`  _id:            ${l._id}`);
    console.log(`  category:       ${l.category}`);
    console.log(`  subtitle:       ${l.subtitle}`);
    console.log(`  priorityNumber: ${l.priorityNumber}`);
    console.log(`  isPublished:    ${l.isPublished}`);
    console.log('');
  }

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
