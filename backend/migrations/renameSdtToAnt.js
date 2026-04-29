'use strict';

/**
 * One-shot rename of the CBAT SDT result collection to ANT.
 *
 * Background: the CBAT game previously called "SDT" (Speed Distance Time) was
 * renamed to "ANT" (Airborne Numerical Test) to match real CBAT terminology.
 * The Mongoose model GameSessionCbatSdtResult became GameSessionCbatAntResult,
 * which auto-derives a new collection name (gamesessioncbatantresults). This
 * migration moves historical scores from the old collection to the new one.
 *
 * Schema is identical between the two — only the names changed — so a plain
 * collection rename preserves every document, every index definition, and
 * every _id.
 *
 * Idempotent:
 *   - If the old collection does not exist: no-op.
 *   - If only the old collection exists: rename it.
 *   - If both exist (e.g. a few docs were written to the new collection
 *     between deploy and migration): copy old docs into new (skipping _id
 *     conflicts so anything written post-deploy is preserved), then drop old.
 *   - If only the new collection exists: no-op.
 *
 * Run via: node backend/scripts/renameSdtToAnt.js
 * Do NOT register this in server.js — it should only run once, manually,
 * after the new backend has been deployed.
 */

const OLD_COLLECTION = 'gamesessioncbatsdtresults';
const NEW_COLLECTION = 'gamesessioncbatantresults';

async function renameSdtToAnt({ db, logger = console } = {}) {
  if (!db) throw new Error('db handle required (mongoose.connection.db)');

  const collections = await db.listCollections().toArray();
  const names = new Set(collections.map(c => c.name));
  const hasOld = names.has(OLD_COLLECTION);
  const hasNew = names.has(NEW_COLLECTION);

  if (!hasOld && !hasNew) {
    logger.log?.(`[migration] renameSdtToAnt: neither collection exists — no-op`);
    return { action: 'noop', migrated: 0 };
  }

  if (!hasOld && hasNew) {
    logger.log?.(`[migration] renameSdtToAnt: already migrated — no-op`);
    return { action: 'already-migrated', migrated: 0 };
  }

  if (hasOld && !hasNew) {
    await db.collection(OLD_COLLECTION).rename(NEW_COLLECTION);
    const count = await db.collection(NEW_COLLECTION).countDocuments();
    logger.log?.(`[migration] renameSdtToAnt: renamed ${OLD_COLLECTION} -> ${NEW_COLLECTION} (${count} docs)`);
    return { action: 'renamed', migrated: count };
  }

  // Both exist — copy old into new, skipping _id conflicts, then drop old.
  const oldDocs = await db.collection(OLD_COLLECTION).find({}).toArray();
  let inserted = 0;
  let skipped = 0;
  for (const doc of oldDocs) {
    try {
      await db.collection(NEW_COLLECTION).insertOne(doc);
      inserted += 1;
    } catch (err) {
      if (err && err.code === 11000) {
        skipped += 1;
      } else {
        throw err;
      }
    }
  }
  await db.collection(OLD_COLLECTION).drop();
  logger.log?.(
    `[migration] renameSdtToAnt: merged ${inserted} doc(s) from ${OLD_COLLECTION} into ` +
    `${NEW_COLLECTION} (${skipped} skipped as duplicate _id), then dropped ${OLD_COLLECTION}`
  );
  return { action: 'merged', migrated: inserted, skipped };
}

module.exports = renameSdtToAnt;
