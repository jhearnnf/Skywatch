/**
 * cleanupOrphanedUserData.js
 *
 * One-shot: deletes rows in the OWNED_BY_USER collections whose `userId` points
 * at a User that no longer exists.
 *
 * Why they exist: before the deletion cascade shipped (commit b2af1ff,
 * 2026-07-16), the admin delete-user route wiped only six collections —
 * AirstarLog, the two quiz session models, Order of Battle, IntelligenceBriefRead
 * and ProblemReport. Every CBAT result the user had ever recorded was left
 * behind. Accounts deleted before that date therefore still have scores in the
 * database. Since b2af1ff both the admin and self-serve delete paths call
 * deleteUserAndData(), which covers all of OWNED_BY_USER, so this is legacy
 * residue only — no new orphans should appear.
 *
 * Why it matters: orphaned results still rank in the CBAT leaderboard
 * aggregations. They're dropped by the users $lookup/$unwind at render time, so
 * they don't show up as rows — they just silently shrink the board, which used
 * to make padLeaderboard fill the hole with a demo row.
 *
 * Safety: skips docs with a null/absent userId (nothing to orphan), and reports
 * per-collection counts before touching anything. Idempotent.
 *
 * Usage:
 *   node backend/scripts/cleanupOrphanedUserData.js           # dry run (default)
 *   node backend/scripts/cleanupOrphanedUserData.js --apply   # actually deletes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { OWNED_BY_USER } = require('../services/deleteUserData');

const APPLY = process.argv.includes('--apply');

// Ids of orphaned docs in one collection, plus the deleted users they point at.
async function findOrphans(Model) {
  const rows = await Model.aggregate([
    { $match: { userId: { $ne: null, $exists: true } } },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } },
    { $match: { 'u.0': { $exists: false } } },
    { $project: { _id: 1, userId: 1 } },
  ]);
  return {
    ids: rows.map((r) => r._id),
    userIds: new Set(rows.map((r) => String(r.userId))),
  };
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);

  console.log(APPLY ? 'MODE: apply (deleting)\n' : 'MODE: dry run (no writes)\n');

  const allUserIds = new Set();
  let total = 0;

  for (const modelName of OWNED_BY_USER) {
    const Model = require(`../models/${modelName}`);
    const { ids, userIds } = await findOrphans(Model);
    if (!ids.length) continue;

    userIds.forEach((id) => allUserIds.add(id));
    total += ids.length;
    console.log(`${modelName.padEnd(38)} ${String(ids.length).padStart(4)} orphan row(s)`);

    if (APPLY) {
      const res = await Model.deleteMany({ _id: { $in: ids } });
      console.log(`${''.padEnd(38)} ${String(res.deletedCount).padStart(4)} deleted`);
    }
  }

  console.log(`\n${total} orphan row(s) from ${allUserIds.size} deleted account(s)`);
  allUserIds.forEach((id) => console.log(`  ${id}`));
  if (!total) console.log('Nothing to clean.');
  else if (!APPLY) console.log('\nDry run — re-run with --apply to delete.');

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
