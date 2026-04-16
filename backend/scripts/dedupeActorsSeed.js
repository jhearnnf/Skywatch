/**
 * dedupeActorsSeed.js
 *
 * One-shot: removes the non-VC duplicates ("Guy Gibson", "Leonard Cheshire")
 * created by seedActors.js where the migrated VC-suffixed versions
 * ("Guy Gibson VC", "Leonard Cheshire VC") already exist as the canonical
 * Historic RAF Personnel records. Removes both the IntelLead and the stub
 * IntelligenceBrief.
 *
 * Usage:
 *   node backend/scripts/dedupeActorsSeed.js           # dry-run
 *   node backend/scripts/dedupeActorsSeed.js --apply   # write
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const IntelLead = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const APPLY = process.argv.includes('--apply');

// Pairs of (duplicate to delete, canonical to keep)
const DUPES = [
  { remove: 'Guy Gibson',       keep: 'Guy Gibson VC' },
  { remove: 'Leonard Cheshire', keep: 'Leonard Cheshire VC' },
];

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

  let deletedBriefs = 0;
  let deletedLeads  = 0;

  for (const { remove, keep } of DUPES) {
    const canonical = await IntelligenceBrief.findOne({ title: keep }, '_id title status').lean();
    if (!canonical) {
      console.log(`  WARN  canonical "${keep}" not found — skipping deletion of "${remove}" to avoid losing the only copy`);
      continue;
    }

    const dupeBrief = await IntelligenceBrief.findOne({ title: remove }, '_id title status').lean();
    const dupeLead  = await IntelLead.findOne({ title: remove }, '_id title').lean();

    if (!dupeBrief && !dupeLead) {
      console.log(`  SKIP  no duplicate "${remove}" present`);
      continue;
    }

    if (dupeBrief?.status && dupeBrief.status !== 'stub') {
      console.log(`  WARN  "${remove}" brief is status="${dupeBrief.status}" (not stub) — skipping to avoid deleting filled content`);
      continue;
    }

    if (!APPLY) {
      if (dupeBrief) console.log(`  WOULD DELETE brief "${remove}" (canonical kept: "${keep}")`);
      if (dupeLead)  console.log(`  WOULD DELETE lead  "${remove}"`);
      continue;
    }

    if (dupeBrief) {
      await IntelligenceBrief.deleteOne({ _id: dupeBrief._id });
      console.log(`  DELETE brief "${remove}"`);
      deletedBriefs++;
    }
    if (dupeLead) {
      await IntelLead.deleteOne({ _id: dupeLead._id });
      console.log(`  DELETE lead  "${remove}"`);
      deletedLeads++;
    }
  }

  await mongoose.disconnect();
  console.log(APPLY ? `\nDone. Deleted ${deletedBriefs} brief(s), ${deletedLeads} lead(s).` : '\nDry run — pass --apply to write.');
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
