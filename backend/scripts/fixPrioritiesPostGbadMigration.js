/**
 * fixPrioritiesPostGbadMigration.js
 *
 * Post-migration cleanup of priorityNumber gaps + collisions caused by moving
 * Sky Sabre / CAMM, Starstreak HVM, Rapier FSC out of Aircrafts into Tech.
 *
 *   (a) Compacts the Aircrafts priority sequence from 18 onwards, closing the
 *       gaps left by the 3 removed briefs. Pre-existing gaps at 3, 4, 5 are
 *       preserved (they represent reserved slots for unauthored briefs).
 *   (b) Resolves the 3 Tech priorityNumber collisions by appending the
 *       migrated briefs to the end of the Tech priority sequence.
 *
 * No unique index on priorityNumber exists, so a single-pass update is safe.
 *
 * Usage:
 *   node backend/scripts/fixPrioritiesPostGbadMigration.js           # dry-run
 *   node backend/scripts/fixPrioritiesPostGbadMigration.js --apply   # write
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const APPLY = process.argv.includes('--apply');
const MIGRATED_TITLES = ['Sky Sabre / CAMM', 'Starstreak HVM', 'Rapier FSC'];

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

  // ── Part 1: compact Aircrafts priorities >= 18 ─────────────────────────────
  const aircrafts = await IntelligenceBrief
    .find({ category: 'Aircrafts', priorityNumber: { $ne: null, $gte: 18 } }, 'title priorityNumber')
    .sort({ priorityNumber: 1 })
    .lean();

  let next = 18;
  const aircraftsPlan = aircrafts
    .map(a => ({ _id: a._id, title: a.title, from: a.priorityNumber, to: next++ }))
    .filter(p => p.from !== p.to);

  console.log(`\nAircrafts compaction plan — ${aircraftsPlan.length} shift(s) (preserving gaps at 3-5):`);
  aircraftsPlan.forEach(p => console.log(`  "${p.title}": ${p.from} → ${p.to}`));

  // ── Part 2: reassign 3 migrated Tech briefs to end of Tech ─────────────────
  const tech = await IntelligenceBrief
    .find({ category: 'Tech', priorityNumber: { $ne: null } }, 'title priorityNumber')
    .sort({ priorityNumber: 1 })
    .lean();

  const maxTechNonMigrated = tech
    .filter(t => !MIGRATED_TITLES.includes(t.title))
    .reduce((m, t) => Math.max(m, t.priorityNumber), 0);

  const migrated = tech.filter(t => MIGRATED_TITLES.includes(t.title));
  const techPlan = [...migrated]
    .sort((a, b) => a.priorityNumber - b.priorityNumber)
    .map((t, i) => ({ _id: t._id, title: t.title, from: t.priorityNumber, to: maxTechNonMigrated + 1 + i }));

  console.log(`\nTech reassignment plan — ${techPlan.length} brief(s) (max non-migrated Tech priority = ${maxTechNonMigrated}):`);
  techPlan.forEach(p => console.log(`  "${p.title}": ${p.from} → ${p.to}`));

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write.');
    await mongoose.disconnect();
    return;
  }

  const allPlans = [...aircraftsPlan, ...techPlan];
  for (const p of allPlans) {
    await IntelligenceBrief.updateOne({ _id: p._id }, { $set: { priorityNumber: p.to } });
  }

  console.log(`\nApplied ${allPlans.length} priorityNumber updates.`);
  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
