/**
 * consolidateNatoDupe.js
 *
 * One-off: consolidate the duplicate NATO briefs/leads.
 *   Winner: "NATO" — 41 incoming references, common acronym form.
 *   Loser : "North Atlantic Treaty Organization" — 5 incoming refs, less used.
 *
 * Steps (dry-run by default; pass --apply to write):
 *   1. For every brief that points at the loser via any of the 9 ref fields,
 *      replace loser's ID with winner's. If winner's ID is already present,
 *      just remove loser's (no duplicate).
 *   2. Drop loser's ID from the winner's own outbound ref fields.
 *   3. Merge into winner: unique media, unique sources (by URL), unique
 *      keywords (by keyword text), unique mentionedBriefIds.
 *   4. Delete loser's GameQuizQuestion docs (14 orphaned by deletion).
 *   5. Delete loser brief.
 *   6. Delete loser lead.
 *
 * Does NOT touch airstar logs / read records because both briefs have 0 reads.
 *
 * Usage:
 *   node backend/scripts/consolidateNatoDupe.js           # dry-run
 *   node backend/scripts/consolidateNatoDupe.js --apply   # execute
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const IntelLead             = require('../models/IntelLead');
const IntelligenceBrief     = require('../models/IntelligenceBrief');
const GameQuizQuestion      = require('../models/GameQuizQuestion');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');

const APPLY = process.argv.includes('--apply');

const WINNER_BRIEF_ID = '69da3a6d528c84d3e76a9b24'; // NATO
const LOSER_BRIEF_ID  = '69d153937d04876778c78092'; // North Atlantic Treaty Organization
const WINNER_LEAD_ID  = '69da3a6d528c84d3e76a9b22';
const LOSER_LEAD_ID   = '69d153937d04876778c78090';

const REF_FIELDS = [
  'associatedBaseBriefIds',
  'associatedSquadronBriefIds',
  'associatedAircraftBriefIds',
  'associatedMissionBriefIds',
  'associatedTrainingBriefIds',
  'relatedBriefIds',
  'relatedHistoric',
  'mentionedBriefIds',
];

function s(id) { return String(id); }

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const winnerOid = new mongoose.Types.ObjectId(WINNER_BRIEF_ID);
  const loserOid  = new mongoose.Types.ObjectId(LOSER_BRIEF_ID);

  const winner = await IntelligenceBrief.findById(WINNER_BRIEF_ID);
  const loser  = await IntelligenceBrief.findById(LOSER_BRIEF_ID);
  if (!winner) throw new Error(`Winner brief not found: ${WINNER_BRIEF_ID}`);
  if (!loser)  throw new Error(`Loser brief not found: ${LOSER_BRIEF_ID}`);

  console.log(`Winner: ${winner.title} (${winner._id})`);
  console.log(`Loser:  ${loser.title} (${loser._id})\n`);

  // ── 1. Redirect array-field references on OTHER briefs ───────────────────
  const incoming = await IntelligenceBrief.find({
    _id: { $ne: loserOid },
    $or: [
      ...REF_FIELDS.map(f => ({ [f]: loserOid })),
      { 'keywords.linkedBriefId': loserOid },
    ],
  });

  console.log(`Incoming references to redirect: ${incoming.length}`);

  let arrayRedirects = 0;
  let kwRedirects    = 0;

  for (const b of incoming) {
    const updates = {};
    for (const f of REF_FIELDS) {
      const arr = (b[f] ?? []).map(s);
      if (!arr.includes(s(loserOid))) continue;
      // Replace loser → winner, then dedupe (winner may already be present).
      const replaced = arr.map(id => id === s(loserOid) ? s(winnerOid) : id);
      const deduped  = [...new Set(replaced)];
      updates[f] = deduped.map(id => new mongoose.Types.ObjectId(id));
      arrayRedirects++;
    }
    // keywords.linkedBriefId redirect
    let kwChanged = false;
    const kws = (b.keywords ?? []).map(k => {
      if (s(k.linkedBriefId) === s(loserOid)) {
        kwChanged = true;
        kwRedirects++;
        return { ...(k.toObject ? k.toObject() : k), linkedBriefId: winnerOid };
      }
      return k;
    });
    if (kwChanged) updates.keywords = kws;

    if (Object.keys(updates).length) {
      console.log(`  ${b.title.padEnd(55)} ${Object.keys(updates).join(', ')}`);
      if (APPLY) await IntelligenceBrief.updateOne({ _id: b._id }, { $set: updates });
    }
  }
  console.log(`  → array-field updates: ${arrayRedirects}, keyword-link updates: ${kwRedirects}\n`);

  // ── 2. Drop loser's ID from winner's own outbound refs ───────────────────
  const winnerUpdates = {};
  for (const f of REF_FIELDS) {
    const arr = (winner[f] ?? []).map(s);
    if (!arr.includes(s(loserOid))) continue;
    const cleaned = [...new Set(arr.filter(id => id !== s(loserOid)))];
    winnerUpdates[f] = cleaned.map(id => new mongoose.Types.ObjectId(id));
  }
  // keywords on the winner that point at the loser — null them out.
  let winnerKwChanged = false;
  const winnerKws = (winner.keywords ?? []).map(k => {
    if (s(k.linkedBriefId) === s(loserOid)) {
      winnerKwChanged = true;
      return { ...(k.toObject ? k.toObject() : k), linkedBriefId: null };
    }
    return k;
  });
  if (winnerKwChanged) winnerUpdates.keywords = winnerKws;

  if (Object.keys(winnerUpdates).length) {
    console.log(`Winner self-reference cleanup: ${Object.keys(winnerUpdates).join(', ')}`);
    if (APPLY) await IntelligenceBrief.updateOne({ _id: winner._id }, { $set: winnerUpdates });
  } else {
    console.log(`Winner has no self-references to the loser.`);
  }
  console.log('');

  // ── 3. Merge loser → winner (media, sources, keywords, mentionedBriefIds) ─
  // Re-fetch winner so we see the updates from step 2 before merging.
  const winnerNow = APPLY ? await IntelligenceBrief.findById(WINNER_BRIEF_ID) : winner;

  const mergeSet = {};

  // Media: dedup by _id
  const winnerMediaIds = new Set((winnerNow.media ?? []).map(s));
  const uniqueLoserMedia = (loser.media ?? []).filter(m => !winnerMediaIds.has(s(m)));
  if (uniqueLoserMedia.length) {
    mergeSet.media = [...(winnerNow.media ?? []), ...uniqueLoserMedia];
  }

  // Sources: dedup by URL
  const winnerUrls = new Set((winnerNow.sources ?? []).map(x => x.url));
  const uniqueLoserSources = (loser.sources ?? []).filter(x => !winnerUrls.has(x.url));
  if (uniqueLoserSources.length) {
    mergeSet.sources = [...(winnerNow.sources ?? []), ...uniqueLoserSources];
  }

  // Keywords: dedup by keyword text (case-insensitive)
  const winnerKwSet = new Set((winnerNow.keywords ?? []).map(k => (k.keyword || '').toLowerCase()));
  const uniqueLoserKws = (loser.keywords ?? [])
    .filter(k => k.keyword && !winnerKwSet.has(k.keyword.toLowerCase()))
    // Any loser keyword that linked to the loser brief itself → null the link
    .map(k => {
      const obj = k.toObject ? k.toObject() : { ...k };
      if (s(obj.linkedBriefId) === s(loserOid)) obj.linkedBriefId = null;
      return obj;
    });
  if (uniqueLoserKws.length) {
    mergeSet.keywords = [...(winnerNow.keywords ?? []), ...uniqueLoserKws];
  }

  // mentionedBriefIds: dedup, drop loser's own id and the winner's own id.
  const winnerMentioned = new Set((winnerNow.mentionedBriefIds ?? []).map(s));
  const mergedMentioned = new Set(winnerMentioned);
  for (const id of (loser.mentionedBriefIds ?? [])) {
    const sid = s(id);
    if (sid === s(loserOid) || sid === s(winnerOid)) continue;
    mergedMentioned.add(sid);
  }
  if (mergedMentioned.size !== winnerMentioned.size) {
    mergeSet.mentionedBriefIds = [...mergedMentioned].map(id => new mongoose.Types.ObjectId(id));
  }

  console.log(`Merge into winner:`);
  console.log(`  media:              +${uniqueLoserMedia.length}  (total would be ${(mergeSet.media ?? winnerNow.media ?? []).length})`);
  console.log(`  sources:            +${uniqueLoserSources.length}  (total would be ${(mergeSet.sources ?? winnerNow.sources ?? []).length})`);
  console.log(`  keywords:           +${uniqueLoserKws.length}  (total would be ${(mergeSet.keywords ?? winnerNow.keywords ?? []).length})`);
  console.log(`  mentionedBriefIds:  total ${(mergeSet.mentionedBriefIds ?? winnerNow.mentionedBriefIds ?? []).length}`);
  if (APPLY && Object.keys(mergeSet).length) {
    await IntelligenceBrief.updateOne({ _id: winner._id }, { $set: mergeSet });
  }
  console.log('');

  // ── 4. Delete loser's quiz questions ─────────────────────────────────────
  const quizCount = await GameQuizQuestion.countDocuments({ intelBriefId: loser._id });
  console.log(`Loser quiz questions to delete: ${quizCount}`);
  if (APPLY && quizCount) {
    await GameQuizQuestion.deleteMany({ intelBriefId: loser._id });
  }

  // Sanity: verify no read records on loser (expected 0).
  const readCount = await IntelligenceBriefRead.countDocuments({ intelBriefId: loser._id });
  if (readCount) {
    console.log(`  WARNING: loser has ${readCount} read record(s) — will orphan. Aborting.`);
    await mongoose.disconnect();
    return;
  }

  // ── 5. Delete loser brief ────────────────────────────────────────────────
  console.log(`Deleting loser brief.`);
  if (APPLY) await IntelligenceBrief.deleteOne({ _id: loser._id });

  // ── 6. Delete loser lead ─────────────────────────────────────────────────
  const loserLead = await IntelLead.findById(LOSER_LEAD_ID);
  if (loserLead) {
    console.log(`Deleting loser lead: ${loserLead.title}`);
    if (APPLY) await IntelLead.deleteOne({ _id: loserLead._id });
  } else {
    console.log(`Loser lead already absent.`);
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN complete — pass --apply to execute.'}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
