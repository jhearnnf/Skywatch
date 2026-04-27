/**
 * cleanupFlashcardLeak.js — one-off backfill for the flashcard-unlock bugs
 * fixed by the briefs.js / games.js changes. Cleans up bad rows that were
 * created or mutated before the new guards landed.
 *
 * Run-order safe: idempotent, survives multiple runs.
 *
 *   1. Delete IntelligenceBriefRead rows pointing at briefs whose status is
 *      still 'stub'. These rows can only have been created by the old GET
 *      /:id flow which lazily upserted rows for any brief the user could
 *      load — including unpublished stubs admins were previewing.
 *
 *   2. Reset reachedFlashcard:false (and clear flashcardUnlockedAt) on rows
 *      that look like on-mount-fire artefacts: brief had < 4 sections at the
 *      time of writing but the user never advanced past section 0 and never
 *      completed it. Heuristic: completed:false && currentSection:0 &&
 *      timeSpentSeconds < 10. Strong signal that the user landed on /brief/:id
 *      before sections were generated and immediately bailed.
 *
 *   3. Backfill flashcardUnlockedAt from firstReadAt for legacy rows where
 *      reachedFlashcard:true but the new field is null. Best-guess but stable
 *      across re-runs (firstReadAt doesn't move).
 *
 * Usage:  node backend/scripts/cleanupFlashcardLeak.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose              = require('mongoose');
const IntelligenceBrief     = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  // ─── 1. Delete read rows for stub briefs ────────────────────────────────
  const stubBriefIds = await IntelligenceBrief.distinct('_id', { status: 'stub' });
  const stubDelete = await IntelligenceBriefRead.deleteMany({
    intelBriefId: { $in: stubBriefIds },
  });
  console.log(`[1] Deleted ${stubDelete.deletedCount} read rows pointing at stub briefs (across ${stubBriefIds.length} stubs).`);

  // ─── 2. Reset on-mount-fire artefacts ───────────────────────────────────
  const artefactReset = await IntelligenceBriefRead.updateMany(
    {
      reachedFlashcard:  true,
      completed:         false,
      currentSection:    0,
      timeSpentSeconds:  { $lt: 10 },
    },
    { $set: { reachedFlashcard: false, flashcardUnlockedAt: null } },
  );
  console.log(`[2] Reset reachedFlashcard on ${artefactReset.modifiedCount} on-mount-fire artefact rows.`);

  // ─── 3. Backfill flashcardUnlockedAt for legacy rows ────────────────────
  // Use a single-pass aggregation update so we can reference firstReadAt.
  // Mongoose requires { updatePipeline: true } to allow an aggregation pipeline.
  const backfill = await IntelligenceBriefRead.updateMany(
    { reachedFlashcard: true, flashcardUnlockedAt: null },
    [{ $set: { flashcardUnlockedAt: '$firstReadAt' } }],
    { updatePipeline: true },
  );
  console.log(`[3] Backfilled flashcardUnlockedAt from firstReadAt on ${backfill.modifiedCount} legacy rows.`);

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
