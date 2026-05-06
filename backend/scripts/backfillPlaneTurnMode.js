/**
 * backfillPlaneTurnMode.js
 *
 * One-shot: stamps `mode: '2d'` on every GameSessionCbatPlaneTurnResult that
 * pre-dates the 2D/3D split (commit 474d0dc, 2026-05-05). Those entries were
 * written before the schema added a `mode` field, so they have no `mode` at
 * all — and the new leaderboard / personal-best routes filter `{ mode: '2d' }`,
 * which Mongo doesn't match for documents where the field is missing.
 *
 * Marking them '2d' is the historically correct value: 3D mode didn't exist
 * yet when these were recorded. Idempotent.
 *
 * Usage:
 *   node backend/scripts/backfillPlaneTurnMode.js           # dry run (default)
 *   node backend/scripts/backfillPlaneTurnMode.js --apply   # actually writes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const GameSessionCbatPlaneTurnResult = require('../models/GameSessionCbatPlaneTurnResult');

const APPLY = process.argv.includes('--apply');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

  const filter = { mode: { $exists: false } };

  const total       = await GameSessionCbatPlaneTurnResult.countDocuments({});
  const missing     = await GameSessionCbatPlaneTurnResult.countDocuments(filter);
  const have2d      = await GameSessionCbatPlaneTurnResult.countDocuments({ mode: '2d' });
  const have3d      = await GameSessionCbatPlaneTurnResult.countDocuments({ mode: '3d' });

  console.log('Plane Turn results breakdown:');
  console.log(`  total:           ${total}`);
  console.log(`  mode = '2d':     ${have2d}`);
  console.log(`  mode = '3d':     ${have3d}`);
  console.log(`  mode missing:    ${missing}  ← will be backfilled to '2d'`);

  if (missing === 0) {
    console.log('\nNothing to do.');
    await mongoose.disconnect();
    return;
  }

  // Show a small sample so we can sanity-check before writing.
  const sample = await GameSessionCbatPlaneTurnResult.find(filter)
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  console.log('\nSample (most recent 5 of the missing-mode docs):');
  for (const r of sample) {
    console.log(`  ${r._id} userId=${r.userId} rotations=${r.totalRotations} time=${r.totalTime} aircraft=${r.aircraftUsed ?? '(none)'} createdAt=${r.createdAt?.toISOString()}`);
  }

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write.');
    await mongoose.disconnect();
    return;
  }

  const result = await GameSessionCbatPlaneTurnResult.updateMany(filter, { $set: { mode: '2d' } });
  console.log(`\nUpdated ${result.modifiedCount} documents (matched ${result.matchedCount}).`);

  // Verify
  const remaining = await GameSessionCbatPlaneTurnResult.countDocuments(filter);
  console.log(`Remaining with missing mode: ${remaining}`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
