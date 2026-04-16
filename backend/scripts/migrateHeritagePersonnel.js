/**
 * migrateHeritagePersonnel.js
 *
 * One-shot migration: moves existing `Heritage › Famous Personnel` briefs and
 * leads into `Actors › Historic RAF Personnel`. Run once after deploying the
 * Actors category. Idempotent — re-running after all matches are migrated is
 * a no-op.
 *
 * Usage:
 *   node backend/scripts/migrateHeritagePersonnel.js           # dry-run
 *   node backend/scripts/migrateHeritagePersonnel.js --apply   # write to DB
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const IntelLead = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const APPLY = process.argv.includes('--apply');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

  const briefFilter = { category: 'Heritage', subcategory: 'Famous Personnel' };
  const leadFilter  = { category: 'Heritage', subcategory: 'Famous Personnel' };

  const [matchingBriefs, matchingLeads] = await Promise.all([
    IntelligenceBrief.find(briefFilter, '_id title status').lean(),
    IntelLead.find(leadFilter, '_id title').lean(),
  ]);

  console.log(`Found ${matchingBriefs.length} brief(s) and ${matchingLeads.length} lead(s) to migrate.`);
  for (const b of matchingBriefs) console.log(`  brief  "${b.title}" (${b.status})`);
  for (const l of matchingLeads)  console.log(`  lead   "${l.title}"`);

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write.');
    await mongoose.disconnect();
    return;
  }

  const update = { category: 'Actors', subcategory: 'Historic RAF Personnel', historic: true };
  const leadUpdate = { category: 'Actors', subcategory: 'Historic RAF Personnel', isHistoric: true };

  const [briefResult, leadResult] = await Promise.all([
    IntelligenceBrief.updateMany(briefFilter, { $set: update }),
    IntelLead.updateMany(leadFilter, { $set: leadUpdate }),
  ]);

  console.log(`\nMigrated ${briefResult.modifiedCount} brief(s) and ${leadResult.modifiedCount} lead(s).`);
  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
