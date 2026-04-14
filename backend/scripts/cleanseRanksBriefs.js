/**
 * cleanseRanksBriefs.js
 *
 * Ranks-category cleanup:
 *   1. Delete superseded / non-rank / historic briefs + matching leads:
 *        - "Aircraftman / Aircraftwoman"      (superseded by Air Specialist Class 2)
 *        - "Junior Technician"                (rank abolished 2005)
 *        - "Non-Commissioned Aircrew"         (merged into Master Aircrew)
 *        - "Chief of the Air Staff"           (appointment, not a rank)
 *   2. Cascade all dependent data for each deleted brief (reads, quiz Qs,
 *      game sessions, aircoin logs, media orphans, relationship back-refs).
 *   3. Compact Ranks priorityNumbers to a gap-free 1..N on both IntelLead
 *      and IntelligenceBrief so the Learn Pathway stays coherent.
 *
 * Dry-run by default. Pass --apply to write changes.
 *
 * Usage:
 *   node backend/scripts/cleanseRanksBriefs.js
 *   node backend/scripts/cleanseRanksBriefs.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const IntelligenceBrief     = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const IntelLead             = require('../models/IntelLead');
const GameQuizQuestion      = require('../models/GameQuizQuestion');
const GameSessionQuizResult = require('../models/GameSessionQuizResult');
const GameOrderOfBattle     = require('../models/GameOrderOfBattle');
const GameSessionOrderOfBattleResult = require('../models/GameSessionOrderOfBattleResult');
const GameFlashcardRecall   = require('../models/GameFlashcardRecall');
const GameSessionFlashcardRecallResult = require('../models/GameSessionFlashcardRecallResult');
const AircoinLog            = require('../models/AircoinLog');
const User                  = require('../models/User');

// Optional models — load defensively in case any is absent
let GameSessionQuizAttempt, GameWheresThatAircraft, GameSessionWheresThatAircraftResult, GameSessionWhereAircraftResult;
try { GameSessionQuizAttempt = require('../models/GameSessionQuizAttempt'); } catch {}
try { GameWheresThatAircraft = require('../models/GameWheresThatAircraft'); } catch {}
try { GameSessionWheresThatAircraftResult = require('../models/GameSessionWheresThatAircraftResult'); } catch {}
try { GameSessionWhereAircraftResult = require('../models/GameSessionWhereAircraftResult'); } catch {}

const APPLY = process.argv.includes('--apply');

const TITLES_TO_DELETE = [
  'Aircraftman / Aircraftwoman',   // superseded by Air Recruit
  'Junior Technician',             // rank abolished 2005
  'Non-Commissioned Aircrew',      // merged into Master Aircrew
  'Chief of the Air Staff',        // appointment, not a rank
  'Air Specialist (Class 2)',      // empty stub — LAC brief will be renamed to this
];

// Order matters: each rename must run AFTER its target title has been freed
// by the deletion phase (both on IntelligenceBrief and IntelLead, which has
// a unique-title index). Subtitle updates are minimal — only where the old
// text references an obsolete rank name; full body content review is deferred.
const RENAMES = [
  {
    from: 'Leading Aircraftman / Leading Aircraftwoman',
    to:   'Air Specialist (Class 2)',
    subtitle: null, // no stale rank-name reference
  },
  {
    from: 'Senior Aircraftman / Senior Aircraftwoman',
    to:   'Air Specialist (Class 1)',
    subtitle: 'Other-rank grade following basic training, above Air Specialist (Class 2)',
  },
];

function log(...a) { console.log(...a); }

async function cascadeDeleteBrief(brief) {
  const briefId = brief._id;
  const briefObjectId = new mongoose.Types.ObjectId(briefId);

  const [questionIds, booGameIds, flashGameIds, waaGameIds] = await Promise.all([
    GameQuizQuestion.distinct('_id', { intelBriefId: briefId }),
    GameOrderOfBattle.distinct('_id', { anchorBriefId: briefId }),
    GameFlashcardRecall.distinct('_id', { 'cards.intelBriefId': briefId }),
    GameWheresThatAircraft ? GameWheresThatAircraft.distinct('_id', { intelBriefId: briefId }) : Promise.resolve([]),
  ]);

  const coinGroups = await AircoinLog.aggregate([
    { $match: { briefId: briefObjectId } },
    { $group: { _id: '$userId', total: { $sum: '$amount' } } },
  ]);

  log(`  • AircoinLog entries to reverse: ${coinGroups.length} user(s), ` +
      `total coins=${coinGroups.reduce((s, g) => s + g.total, 0)}`);
  log(`  • Quiz questions: ${questionIds.length}, BOO games: ${booGameIds.length}, ` +
      `Flashcard games: ${flashGameIds.length}, WAA games: ${waaGameIds.length}`);

  if (!APPLY) return;

  // Reverse aircoins
  await Promise.all(coinGroups.map(async ({ _id: userId, total }) => {
    const u = await User.findById(userId).select('totalAircoins cycleAircoins');
    if (!u) return;
    u.totalAircoins = Math.max(0, (u.totalAircoins ?? 0) - total);
    u.cycleAircoins = Math.max(0, (u.cycleAircoins ?? 0) - total);
    await u.save();
  }));

  const ops = [
    IntelligenceBrief.findByIdAndDelete(briefId),
    IntelligenceBriefRead.updateMany({ intelBriefId: briefId }, { $set: {
      briefDeletedNote: 'Brief deleted (ranks cleanse)',
      completed: false,
      coinsAwarded: false,
    } }),
    GameQuizQuestion.deleteMany({ intelBriefId: briefId }),
    GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
    AircoinLog.deleteMany({ briefId }),
    GameSessionOrderOfBattleResult.deleteMany({ gameId: { $in: booGameIds } }),
    GameOrderOfBattle.deleteMany({ anchorBriefId: briefId }),
    GameSessionFlashcardRecallResult.deleteMany({ gameId: { $in: flashGameIds } }),
    GameFlashcardRecall.deleteMany({ 'cards.intelBriefId': briefId }),
    IntelligenceBrief.updateMany({}, { $pull: {
      associatedBaseBriefIds:     briefObjectId,
      associatedSquadronBriefIds: briefObjectId,
      associatedAircraftBriefIds: briefObjectId,
      relatedBriefIds:            briefObjectId,
      relatedHistoric:            briefObjectId,
      mentionedBriefIds:          briefObjectId,
    } }),
    IntelligenceBrief.updateMany(
      { 'keywords.linkedBriefId': briefObjectId },
      { $set: { 'keywords.$[k].linkedBriefId': null } },
      { arrayFilters: [{ 'k.linkedBriefId': briefObjectId }] },
    ),
  ];
  if (GameSessionQuizAttempt) ops.push(GameSessionQuizAttempt.deleteMany({ intelBriefId: briefId }));
  if (GameSessionWheresThatAircraftResult) ops.push(GameSessionWheresThatAircraftResult.deleteMany({ gameId: { $in: waaGameIds } }));
  if (GameWheresThatAircraft) ops.push(GameWheresThatAircraft.deleteMany({ intelBriefId: briefId }));
  if (GameSessionWhereAircraftResult) ops.push(GameSessionWhereAircraftResult.deleteMany({ aircraftBriefId: briefId }));

  await Promise.all(ops);
}

async function deleteMatchingLead(title) {
  const lead = await IntelLead.findOne({ title });
  if (!lead) {
    log(`  • No matching IntelLead found for "${title}"`);
    return;
  }
  log(`  • IntelLead matched (pri=${lead.priorityNumber}) — will delete`);
  if (APPLY) await IntelLead.deleteOne({ _id: lead._id });
}

async function renameBriefAndLead({ from, to, subtitle }) {
  log(`\n"${from}"  →  "${to}"`);

  const brief = await IntelligenceBrief.findOne({ category: 'Ranks', title: from });
  if (!brief) {
    log(`  • No brief found with title "${from}" — skipping`);
  } else {
    log(`  • Brief _id=${brief._id}  status=${brief.status}  pri=${brief.priorityNumber}`);
    if (subtitle && subtitle !== brief.subtitle) {
      log(`  • Subtitle updated: "${brief.subtitle}" → "${subtitle}"`);
    }
    if (APPLY) {
      const update = { title: to };
      if (subtitle) update.subtitle = subtitle;
      await IntelligenceBrief.updateOne({ _id: brief._id }, { $set: update });
    }
  }

  const lead = await IntelLead.findOne({ title: from });
  if (!lead) {
    log(`  • No IntelLead with title "${from}" — skipping lead rename`);
  } else {
    log(`  • IntelLead _id=${lead._id}  pri=${lead.priorityNumber} — will rename`);
    if (APPLY) {
      const leadUpdate = { title: to };
      if (subtitle) leadUpdate.subtitle = subtitle;
      await IntelLead.updateOne({ _id: lead._id }, { $set: leadUpdate });
    }
  }
}

async function compactRanksPriorities() {
  log('\n── Compacting Ranks priorities ──');

  // After deletions, read the surviving leads and re-number 1..N by current priority.
  // In dry-run, simulate the deletes by filtering out the targeted titles.
  const allLeads = await IntelLead.find({ category: 'Ranks' })
    .select('_id title priorityNumber')
    .lean();
  // Dry-run simulation: apply filter (deletions) and map (renames) so the
  // compaction output reflects the post-apply state.
  const renameMap = new Map(RENAMES.map(r => [r.from, r.to]));
  const leads = APPLY
    ? allLeads
    : allLeads
        .filter(l => !TITLES_TO_DELETE.includes(l.title))
        .map(l => renameMap.has(l.title) ? { ...l, title: renameMap.get(l.title) } : l);

  // Sort: existing numbered first by asc; any null priorities go to end
  leads.sort((a, b) => {
    if (a.priorityNumber == null && b.priorityNumber == null) return a.title.localeCompare(b.title);
    if (a.priorityNumber == null) return 1;
    if (b.priorityNumber == null) return -1;
    return a.priorityNumber - b.priorityNumber;
  });

  log(`  Surviving Ranks leads: ${leads.length}`);

  const leadOps  = [];
  const briefOps = [];
  let changes = 0;
  leads.forEach((lead, i) => {
    const newPri = i + 1;
    if (lead.priorityNumber !== newPri) {
      changes++;
      log(`    pri ${String(lead.priorityNumber ?? '—').padStart(3)} → ${String(newPri).padStart(3)}   ${lead.title}`);
    }
    leadOps.push({
      updateOne: {
        filter: { _id: lead._id },
        update: { $set: { priorityNumber: newPri } },
      },
    });
    briefOps.push({
      updateMany: {
        filter: { category: 'Ranks', title: lead.title },
        update: { $set: { priorityNumber: newPri } },
      },
    });
  });
  log(`  Priority changes: ${changes}`);

  if (APPLY && leadOps.length) {
    await IntelLead.bulkWrite(leadOps);
    await IntelligenceBrief.bulkWrite(briefOps);
    log('  Applied.');
  }
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  log(`Connected. Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}\n`);

  log(`── Targets (${TITLES_TO_DELETE.length}) ──`);
  for (const title of TITLES_TO_DELETE) {
    log(`\n"${title}"`);
    const briefs = await IntelligenceBrief.find({ category: 'Ranks', title }).lean();
    if (briefs.length === 0) {
      log('  (no brief with this exact title in Ranks — skipping brief delete)');
    }
    for (const b of briefs) {
      log(`  Brief _id=${b._id}  status=${b.status}  pri=${b.priorityNumber}  subcategory=${b.subcategory}`);
      await cascadeDeleteBrief(b);
    }
    await deleteMatchingLead(title);
  }

  log(`\n── Renames (${RENAMES.length}) ──`);
  for (const r of RENAMES) {
    await renameBriefAndLead(r);
  }

  await compactRanksPriorities();

  await mongoose.disconnect();
  log('\nDone.');
}

run().catch((err) => { console.error(err); process.exit(1); });
