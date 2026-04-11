/**
 * One-time backfill: stamp `publishedAt` on existing published briefs that
 * predate the field. Uses `updatedAt` as the stand-in (best available proxy
 * for when the brief was finalised). Stubs are left alone — they get a real
 * `publishedAt` when they're actually promoted.
 *
 * Usage:
 *   cd backend && node scripts/backfillPublishedAt.js          # dry run
 *   cd backend && node scripts/backfillPublishedAt.js --apply  # write to DB
 */

require('dotenv').config();
const mongoose          = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const DRY_RUN = !process.argv.includes('--apply');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB  [${DRY_RUN ? 'DRY RUN — pass --apply to write' : 'APPLY MODE'}]\n`);

  const briefs = await IntelligenceBrief.find(
    { status: 'published', publishedAt: null },
    '_id title updatedAt createdAt',
  ).lean();

  console.log(`Found ${briefs.length} published briefs missing publishedAt.\n`);

  let updated = 0;
  for (const b of briefs) {
    const stamp = b.updatedAt ?? b.createdAt ?? new Date();
    console.log(`  ${b._id}  ${stamp.toISOString()}  ${b.title}`);
    if (!DRY_RUN) {
      await IntelligenceBrief.updateOne(
        { _id: b._id },
        { $set: { publishedAt: stamp } },
        { timestamps: false },
      );
    }
    updated += 1;
  }

  console.log(`\n${DRY_RUN ? 'Would update' : 'Updated'} ${updated} briefs.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
