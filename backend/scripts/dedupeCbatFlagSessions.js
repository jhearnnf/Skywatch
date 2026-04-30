/**
 * dedupeCbatFlagSessions.js
 *
 * One-shot cleanup for duplicate FLAG sessions caused by a StrictMode bug
 * (the end-of-game POST was fired from inside a setStats updater, which
 * React invokes twice in dev — every play wrote two identical rows).
 *
 * What counts as a duplicate here: same userId, identical scoring fields
 * (totalScore + every sub-counter + aircraftBriefId + grade), and createdAt
 * within 5 seconds of each other. That window is wide enough to catch
 * StrictMode's near-simultaneous double-POSTs but narrow enough that two
 * legitimate plays with the same score (minutes apart) won't collide.
 *
 * For each duplicate group, the earliest row is kept; the rest are deleted.
 *
 * Dry-run by default. Pass --apply to actually delete.
 *
 * Usage:
 *   node backend/scripts/dedupeCbatFlagSessions.js
 *   node backend/scripts/dedupeCbatFlagSessions.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const GameSessionCbatFlagResult = require('../models/GameSessionCbatFlagResult');

const APPLY = process.argv.includes('--apply');
const WINDOW_MS = 5000;

const SCORING_FIELDS = [
  'totalScore',
  'mathCorrect', 'mathWrong', 'mathTimeout',
  'aircraftCorrect', 'aircraftWrong', 'aircraftMissed',
  'targetHits', 'targetMisses',
  'aircraftsSeen', 'aircraftBriefId',
  'totalTime', 'grade',
];

function fingerprint(doc) {
  return SCORING_FIELDS.map(f => `${f}=${doc[f] ?? ''}`).join('|');
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`[dedupe] connected — mode: ${APPLY ? 'APPLY (will delete)' : 'DRY RUN'}`);

  // Pull every FLAG session ordered by user then time so adjacent rows in the
  // same user's stream are easy to compare pairwise.
  const all = await GameSessionCbatFlagResult.find({})
    .sort({ userId: 1, createdAt: 1 })
    .lean();
  console.log(`[dedupe] scanned ${all.length} flag sessions`);

  const toDelete = [];
  let groups = 0;

  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    // Walk forward while we're still inside the same user, the rows match on
    // every scoring field, and the next row is within WINDOW_MS of `a`.
    const fpA = fingerprint(a);
    const groupStart = i;
    while (i + 1 < all.length) {
      const b = all[i + 1];
      if (String(b.userId) !== String(a.userId)) break;
      if (fingerprint(b) !== fpA) break;
      if (b.createdAt - a.createdAt > WINDOW_MS) break;
      // Same user, identical fingerprint, within window → duplicate of a.
      toDelete.push(b._id);
      i++;
    }
    if (i > groupStart) {
      groups++;
      const span = all[i].createdAt - a.createdAt;
      console.log(
        `  user=${a.userId} score=${a.totalScore} kept=${a._id} ` +
        `dropped=${i - groupStart} span=${span}ms`
      );
    }
  }

  console.log(`[dedupe] found ${groups} duplicate groups, ${toDelete.length} rows to delete`);

  if (!APPLY) {
    console.log('[dedupe] dry run — re-run with --apply to delete');
  } else if (toDelete.length === 0) {
    console.log('[dedupe] nothing to delete');
  } else {
    const result = await GameSessionCbatFlagResult.deleteMany({ _id: { $in: toDelete } });
    console.log(`[dedupe] deleted ${result.deletedCount} rows`);
  }

  await mongoose.disconnect();
})().catch(err => {
  console.error('[dedupe] failed:', err);
  process.exit(1);
});
