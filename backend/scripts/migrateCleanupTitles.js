/**
 * migrateCleanupTitles.js
 *
 * One-off cleanup migration agreed with product:
 *   1. Aircraft: strip manufacturer prefix from 8 modern briefs (+ lead + glb file rename)
 *   2. Tech: merge 4 duplicate pairs; rename 2 to drop manufacturer/descriptor
 *   3. Missions: fix ALLCAPS operation naming (2 entries)
 *
 * DRY-RUN by default — prints every change it would make.
 * Pass --run to execute.
 *
 * Usage:
 *   node backend/scripts/migrateCleanupTitles.js           # dry run
 *   node backend/scripts/migrateCleanupTitles.js --run     # execute
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const IntelligenceBrief              = require('../models/IntelligenceBrief');
const IntelLead                      = require('../models/IntelLead');
const GameQuizQuestion               = require('../models/GameQuizQuestion');
const GameOrderOfBattle              = require('../models/GameOrderOfBattle');
const GameFlashcardRecall            = require('../models/GameFlashcardRecall');
const GameWheresThatAircraft         = require('../models/GameWheresThatAircraft');
const GameSessionQuizAttempt         = require('../models/GameSessionQuizAttempt');
const GameSessionFlashcardRecallResult = require('../models/GameSessionFlashcardRecallResult');
const GameSessionWhereAircraftResult = require('../models/GameSessionWhereAircraftResult');
const IntelligenceBriefRead          = require('../models/IntelligenceBriefRead');
const AirstarLog                     = require('../models/AirstarLog');
const AptitudeSyncUsage              = require('../models/AptitudeSyncUsage');
const ProblemReport                  = require('../models/ProblemReport');
const SystemLog                      = require('../models/SystemLog');
const User                           = require('../models/User');
const AppSettings                    = require('../models/AppSettings');

const DRY = !process.argv.includes('--run');

// ── Rename tables ─────────────────────────────────────────────────────────
const AIRCRAFT_RENAMES = [
  { from: 'BAE Systems Hawk T2',                from2: 'Hawk T2' },
  { from: 'Boeing E-7A Wedgetail',              from2: 'E-7A Wedgetail' },
  { from: 'Boeing RC-135W Rivet Joint',         from2: 'RC-135W Rivet Joint' },
  { from: 'Boeing P-8A Poseidon MRA1',          from2: 'P-8A Poseidon MRA1' },
  { from: 'Boeing Chinook HC6/6A',              from2: 'Chinook HC6/6A' },
  { from: 'Airbus A330 MRTT Voyager KC2/KC3',   from2: 'A330 MRTT Voyager KC2/KC3' },
  { from: 'Airbus A400M Atlas C1',              from2: 'A400M Atlas C1' },
  { from: 'Boeing C-17A Globemaster III',       from2: 'C-17A Globemaster III' },
].map(r => ({ from: r.from, to: r.from2 }));

const TECH_MERGES = [
  { loser: 'AIM-132 ASRAAM',                        winner: 'ASRAAM / AIM-132' },
  { loser: 'Morpheus',                              winner: 'MORPHEUS Future Tactical Comms' },
  { loser: 'Storm Shadow',                          winner: 'Storm Shadow / SCALP-EG' },
  { loser: 'Dragonfire directed energy laser weapon', winner: 'Dragonfire Directed Energy Weapon' },
];

const TECH_RENAMES = [
  { from: 'SPEAR 3 / MBDA SPEAR',    to: 'SPEAR 3' },
  { from: 'Harpoon anti-ship missile', to: 'Harpoon' },
];

const MISSION_RENAMES = [
  { from: 'Operation Ruman', to: 'Operation RUMAN' },
  { from: 'FOX DEFENDER',    to: 'Operation FOX DEFENDER' },
];

// ── Filename slug (matches src/data/aircraftModels.js) ────────────────────
function titleToSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9\-]+/g, ' ').trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function renameTitle(label, fromTitle, toTitle, { expectCategory } = {}) {
  const brief = await IntelligenceBrief.findOne({ title: fromTitle });
  if (!brief) { console.log(`  [${label}] SKIP brief not found: "${fromTitle}"`); return null; }
  if (expectCategory && brief.category !== expectCategory) {
    console.log(`  [${label}] SKIP category mismatch for "${fromTitle}" (got ${brief.category}, expected ${expectCategory})`);
    return null;
  }
  console.log(`  [${label}] "${fromTitle}"  →  "${toTitle}"`);
  if (DRY) return brief;
  brief.title = toTitle;
  await brief.save();

  const lead = await IntelLead.findOne({ title: fromTitle });
  if (lead) {
    lead.title = toTitle;
    await lead.save();
    console.log(`      ↳ lead renamed`);
  } else {
    console.log(`      ↳ no matching lead`);
  }
  return brief;
}

async function mergeBrief(loserTitle, winnerTitle) {
  const [loser, winner] = await Promise.all([
    IntelligenceBrief.findOne({ title: loserTitle }),
    IntelligenceBrief.findOne({ title: winnerTitle }),
  ]);
  if (!loser)  { console.log(`  [merge] SKIP loser not found: "${loserTitle}"`);  return; }
  if (!winner) { console.log(`  [merge] SKIP winner not found: "${winnerTitle}"`); return; }
  if (String(loser._id) === String(winner._id)) {
    console.log(`  [merge] SKIP loser==winner for "${loserTitle}"`);
    return;
  }
  console.log(`  [merge] "${loserTitle}" (${loser._id})  →  "${winnerTitle}" (${winner._id})`);
  if (DRY) return;

  const L = loser._id, W = winner._id;

  // 1) Rewire single-ref fields (replace L with W)
  const singleRefOps = [
    // Game definitions + session results
    [GameQuizQuestion,        'intelBriefId'],
    [GameOrderOfBattle,       'anchorBriefId'],
    [GameWheresThatAircraft,  'intelBriefId'],
    [GameSessionQuizAttempt,  'intelBriefId'],
    [GameSessionFlashcardRecallResult, 'intelBriefId'],
    [GameSessionWhereAircraftResult,   'aircraftBriefId'],
    // User-facing tracking
    [IntelligenceBriefRead,   'intelBriefId'],
    [AirstarLog,              'briefId'],
    [AptitudeSyncUsage,       'briefId'],
    [ProblemReport,           'intelligenceBrief'],
    [SystemLog,               'briefId'],
    [SystemLog,               'sourceBriefId'],
    [User,                    'selectedBadgeBriefId'],
  ];
  for (const [Model, field] of singleRefOps) {
    const res = await Model.updateMany({ [field]: L }, { $set: { [field]: W } });
    if (res.modifiedCount) console.log(`      ↳ ${Model.modelName}.${field}: ${res.modifiedCount} rewired`);
  }

  // 2) Rewire array-of-refs on other briefs (capture IDs first, then pull L + addToSet W)
  const arrayFields = [
    'associatedBaseBriefIds',
    'associatedSquadronBriefIds',
    'associatedAircraftBriefIds',
    'associatedMissionBriefIds',
    'associatedTrainingBriefIds',
    'relatedBriefIds',
    'relatedHistoric',
    'mentionedBriefIds',
  ];
  for (const f of arrayFields) {
    const refed = await IntelligenceBrief.find({ [f]: L }, '_id').lean();
    if (!refed.length) continue;
    const ids = refed.map(d => d._id);
    await IntelligenceBrief.updateMany({ _id: { $in: ids } }, { $pull:     { [f]: L } });
    await IntelligenceBrief.updateMany({ _id: { $in: ids } }, { $addToSet: { [f]: W } });
    console.log(`      ↳ IntelligenceBrief.${f}: ${refed.length} rewired`);
  }

  // 3) Rewire nested keyword.linkedBriefId
  const kwHits = await IntelligenceBrief.updateMany(
    { 'keywords.linkedBriefId': L },
    { $set: { 'keywords.$[elem].linkedBriefId': W } },
    { arrayFilters: [{ 'elem.linkedBriefId': L }] }
  );
  if (kwHits.modifiedCount) console.log(`      ↳ keywords.linkedBriefId: ${kwHits.modifiedCount} rewired`);

  // 4) Rewire GameOrderOfBattle.choices[].briefId
  const boChoiceHits = await GameOrderOfBattle.updateMany(
    { 'choices.briefId': L },
    { $set: { 'choices.$[elem].briefId': W } },
    { arrayFilters: [{ 'elem.briefId': L }] }
  );
  if (boChoiceHits.modifiedCount) console.log(`      ↳ GameOrderOfBattle.choices.briefId: ${boChoiceHits.modifiedCount} rewired`);

  // 5) Rewire GameFlashcardRecall.cards[].intelBriefId
  const fcCardHits = await GameFlashcardRecall.updateMany(
    { 'cards.intelBriefId': L },
    { $set: { 'cards.$[elem].intelBriefId': W } },
    { arrayFilters: [{ 'elem.intelBriefId': L }] }
  );
  if (fcCardHits.modifiedCount) console.log(`      ↳ GameFlashcardRecall.cards.intelBriefId: ${fcCardHits.modifiedCount} rewired`);

  // 6) Rewire GameSessionWhereAircraftResult.selectedBaseIds / correctBaseIds (arrays)
  for (const f of ['selectedBaseIds', 'correctBaseIds']) {
    const refed = await GameSessionWhereAircraftResult.find({ [f]: L }, '_id').lean();
    if (!refed.length) continue;
    const ids = refed.map(d => d._id);
    await GameSessionWhereAircraftResult.updateMany({ _id: { $in: ids } }, { $pull:     { [f]: L } });
    await GameSessionWhereAircraftResult.updateMany({ _id: { $in: ids } }, { $addToSet: { [f]: W } });
    console.log(`      ↳ GameSessionWhereAircraftResult.${f}: ${refed.length} rewired`);
  }

  // 7) Rewire AppSettings.cbatTargetAircraftBriefIds (string ids)
  const settings = await AppSettings.findOne();
  if (settings?.cbatTargetAircraftBriefIds?.length) {
    const Ls = String(L), Ws = String(W);
    const before = settings.cbatTargetAircraftBriefIds;
    if (before.includes(Ls)) {
      const next = Array.from(new Set(before.map(x => x === Ls ? Ws : x)));
      settings.cbatTargetAircraftBriefIds = next;
      await settings.save();
      console.log(`      ↳ AppSettings.cbatTargetAircraftBriefIds rewired`);
    }
  }

  // 8) Delete loser brief + its lead
  await IntelligenceBrief.deleteOne({ _id: L });
  const leadDel = await IntelLead.deleteOne({ title: loserTitle });
  console.log(`      ↳ loser brief deleted; lead deleted=${leadDel.deletedCount}`);
}

async function renameGlbFiles() {
  const modelsDir = path.resolve(__dirname, '../../public/models');
  console.log(`\n── glb filename renames (${modelsDir}) ──`);
  for (const { from, to } of AIRCRAFT_RENAMES) {
    const oldFile = path.join(modelsDir, `${titleToSlug(from)}.glb`);
    const newFile = path.join(modelsDir, `${titleToSlug(to)}.glb`);
    if (!fs.existsSync(oldFile)) { console.log(`  (no glb)   ${path.basename(oldFile)}`); continue; }
    console.log(`  rename:   ${path.basename(oldFile)}  →  ${path.basename(newFile)}`);
    if (!DRY) fs.renameSync(oldFile, newFile);
  }
}

async function main() {
  console.log(`\nmigrateCleanupTitles — ${DRY ? 'DRY RUN' : 'LIVE RUN'}\n`);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  console.log(`\n═══ 1. Aircraft manufacturer-prefix strip (${AIRCRAFT_RENAMES.length}) ═══`);
  for (const r of AIRCRAFT_RENAMES) {
    await renameTitle('aircraft', r.from, r.to, { expectCategory: 'Aircrafts' });
  }

  console.log(`\n═══ 2a. Tech merges (${TECH_MERGES.length}) ═══`);
  for (const m of TECH_MERGES) await mergeBrief(m.loser, m.winner);

  console.log(`\n═══ 2b. Tech title cleanups (${TECH_RENAMES.length}) ═══`);
  for (const r of TECH_RENAMES) {
    await renameTitle('tech', r.from, r.to, { expectCategory: 'Tech' });
  }

  console.log(`\n═══ 3. Mission ALLCAPS fixes (${MISSION_RENAMES.length}) ═══`);
  for (const r of MISSION_RENAMES) {
    await renameTitle('mission', r.from, r.to, { expectCategory: 'Missions' });
  }

  await renameGlbFiles();

  console.log(`\n═══ Done (${DRY ? 'DRY — no writes' : 'LIVE — changes applied'}) ═══\n`);
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
