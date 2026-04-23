/**
 * cleanupAircraftCategory.js
 *
 * One-off cleanup of the Aircrafts category:
 *   DELETE — not airframes or non-RAF:
 *     - "Maritime Patrol Aircraft"            (generic role)
 *     - "Maritime Patrol and Reconnaissance"  (generic role)
 *     - "Airseeker"                           (duplicate of RC-135W Rivet Joint)
 *     - "C-130"                               (duplicate of C-130J / C-130K)
 *     - "Apache"                              (British Army Air Corps, not RAF)
 *     - "Wildcat Helicopters"                 (Royal Navy / Army, not RAF)
 *
 *   RE-CATEGORISE — specific airframes, wrong bucket/naming:
 *     - "Argosy"     -> "Armstrong Whitworth Argosy", subcategory "Historic — Cold War",      historic=true
 *     - "Nimrod R1"  -> "Hawker Siddeley Nimrod R1",  subcategory "Historic — Post-Cold War", historic=true
 *
 * Cascades for deleted briefs: read-records marked deleted, quiz/BOO/Flashcard/WTA
 * cascade, pull brief _id from all relationship arrays, clear keywords.linkedBriefId,
 * delete matching lead.
 *
 * Safe to re-run — each step is idempotent.
 *
 * Usage:
 *   node backend/scripts/cleanupAircraftCategory.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const IntelLead                            = require('../models/IntelLead');
const IntelligenceBrief                    = require('../models/IntelligenceBrief');
const IntelligenceBriefRead                = require('../models/IntelligenceBriefRead');
const GameQuizQuestion                     = require('../models/GameQuizQuestion');
const GameSessionQuizAttempt               = require('../models/GameSessionQuizAttempt');
const GameSessionQuizResult                = require('../models/GameSessionQuizResult');
const AirstarLog                           = require('../models/AirstarLog');
const GameOrderOfBattle                    = require('../models/GameOrderOfBattle');
const GameSessionOrderOfBattleResult       = require('../models/GameSessionOrderOfBattleResult');
const GameFlashcardRecall                  = require('../models/GameFlashcardRecall');
const GameSessionFlashcardRecallResult     = require('../models/GameSessionFlashcardRecallResult');
const GameWheresThatAircraft               = require('../models/GameWheresThatAircraft');
const GameSessionWheresThatAircraftResult  = require('../models/GameSessionWheresThatAircraftResult');
const GameSessionWhereAircraftResult       = require('../models/GameSessionWhereAircraftResult');

const DELETE_TITLES = [
  'Maritime Patrol Aircraft',
  'Maritime Patrol and Reconnaissance',
  'Airseeker',
  'C-130',
  'Apache',
  'Wildcat Helicopters',
];

const RECATEGORISE = [
  {
    fromTitle:      'Argosy',
    toTitle:        'Armstrong Whitworth Argosy',
    toSubcategory:  'Historic — Cold War',
    markHistoric:   true,
  },
  {
    fromTitle:      'Nimrod R1',
    toTitle:        'Hawker Siddeley Nimrod R1',
    toSubcategory:  'Historic — Post-Cold War',
    markHistoric:   true,
  },
];

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function exactRx(title) { return new RegExp(`^${escapeRegex(title)}$`, 'i'); }

async function cascadeDeleteBrief(briefId) {
  // Collect ids for cascade
  const questions = await GameQuizQuestion.find({ intelBriefId: briefId }, '_id').lean();
  const questionIds = questions.map(q => q._id);
  const booGames   = await GameOrderOfBattle.find({ anchorBriefId: briefId }, '_id').lean();
  const booGameIds = booGames.map(g => g._id);
  const flashGames = await GameFlashcardRecall.find({ 'cards.intelBriefId': briefId }, '_id').lean();
  const flashGameIds = flashGames.map(g => g._id);
  const waaGames   = await GameWheresThatAircraft.find({ intelBriefId: briefId }, '_id').lean();
  const waaGameIds = waaGames.map(g => g._id);

  await Promise.all([
    IntelligenceBrief.findByIdAndDelete(briefId),
    IntelligenceBriefRead.updateMany(
      { intelBriefId: briefId },
      { $set: { briefDeletedNote: 'Brief deleted — aircraft category cleanup', completed: false, coinsAwarded: false } }
    ),
    GameQuizQuestion.deleteMany({ intelBriefId: briefId }),
    GameSessionQuizAttempt.deleteMany({ intelBriefId: briefId }),
    GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
    AirstarLog.deleteMany({ briefId }),
    GameSessionOrderOfBattleResult.deleteMany({ gameId: { $in: booGameIds } }),
    GameOrderOfBattle.deleteMany({ anchorBriefId: briefId }),
    GameSessionFlashcardRecallResult.deleteMany({ gameId: { $in: flashGameIds } }),
    GameFlashcardRecall.deleteMany({ 'cards.intelBriefId': briefId }),
    GameSessionWheresThatAircraftResult.deleteMany({ gameId: { $in: waaGameIds } }),
    GameWheresThatAircraft.deleteMany({ intelBriefId: briefId }),
    GameSessionWhereAircraftResult.deleteMany({ aircraftBriefId: briefId }),
    IntelligenceBrief.updateMany({}, { $pull: {
      associatedBaseBriefIds:     briefId,
      associatedSquadronBriefIds: briefId,
      associatedAircraftBriefIds: briefId,
      associatedMissionBriefIds:  briefId,
      associatedTrainingBriefIds: briefId,
      relatedBriefIds:            briefId,
      relatedHistoric:            briefId,
      mentionedBriefIds:          briefId,
    } }),
    IntelligenceBrief.updateMany(
      { 'keywords.linkedBriefId': briefId },
      { $unset: { 'keywords.$[elem].linkedBriefId': '' } },
      { arrayFilters: [{ 'elem.linkedBriefId': briefId }] }
    ),
  ]);
}

async function runDeletes() {
  const rxs = DELETE_TITLES.map(exactRx);
  const briefs = await IntelligenceBrief.find({ title: { $in: rxs }, category: { $regex: /^aircrafts?$/i } }, '_id title').lean();
  const leads  = await IntelLead.find({ title: { $in: rxs }, category: { $regex: /^aircrafts?$/i } }, '_id title').lean();

  console.log(`\n[DELETE] found ${briefs.length} brief(s) + ${leads.length} lead(s)`);

  for (const b of briefs) {
    console.log(`  - cascading brief "${b.title}" (${b._id})`);
    await cascadeDeleteBrief(b._id);
  }
  if (leads.length) {
    const res = await IntelLead.deleteMany({ _id: { $in: leads.map(l => l._id) } });
    console.log(`  - deleted ${res.deletedCount} lead(s)`);
  }
}

async function runRecategorise() {
  for (const plan of RECATEGORISE) {
    const rx = exactRx(plan.fromTitle);

    const brief = await IntelligenceBrief.findOne({ title: rx, category: { $regex: /^aircrafts?$/i } });
    if (brief) {
      brief.title       = plan.toTitle;
      brief.subcategory = plan.toSubcategory;
      if (plan.markHistoric) brief.historic = true;
      await brief.save();
      console.log(`[RECAT] brief "${plan.fromTitle}" -> "${plan.toTitle}"  [${plan.toSubcategory}] historic=${brief.historic}  (${brief._id})`);
    } else {
      console.log(`[RECAT] brief "${plan.fromTitle}" — not found (skip)`);
    }

    const lead = await IntelLead.findOne({ title: rx, category: { $regex: /^aircrafts?$/i } });
    if (lead) {
      lead.title       = plan.toTitle;
      lead.subcategory = plan.toSubcategory;
      if (plan.markHistoric) lead.isHistoric = true;
      await lead.save();
      console.log(`[RECAT] lead  "${plan.fromTitle}" -> "${plan.toTitle}"  [${plan.toSubcategory}] isHistoric=${lead.isHistoric}  (${lead._id})`);
    } else {
      console.log(`[RECAT] lead  "${plan.fromTitle}" — not found (skip)`);
    }
  }
}

async function compactPriorities() {
  const catRx = { $regex: /^aircrafts?$/i };

  for (const [label, Model] of [['briefs', IntelligenceBrief], ['leads', IntelLead]]) {
    const docs = await Model.find(
      { category: catRx, priorityNumber: { $ne: null } },
      '_id title priorityNumber'
    )
      .sort({ priorityNumber: 1, _id: 1 })
      .lean();

    const ops = [];
    let gapsFound = 0;
    docs.forEach((d, i) => {
      const expected = i + 1;
      if (d.priorityNumber !== expected) {
        gapsFound++;
        ops.push({
          updateOne: {
            filter: { _id: d._id },
            update: { $set: { priorityNumber: expected } },
          },
        });
      }
    });

    if (ops.length) {
      const res = await Model.bulkWrite(ops, { ordered: false });
      console.log(`[COMPACT ${label}] ${gapsFound} gap(s) closed — ${res.modifiedCount} ${label} renumbered (1..${docs.length})`);
    } else {
      console.log(`[COMPACT ${label}] no gaps (${docs.length} ${label} already sequential)`);
    }
  }
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  await runDeletes();
  await runRecategorise();
  await compactPriorities();

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch(err => { console.error(err); process.exit(1); });
