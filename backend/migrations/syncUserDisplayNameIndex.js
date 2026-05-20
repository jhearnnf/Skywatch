'use strict';

/**
 * Reconcile the User.displayNameLower index with the schema.
 *
 * The schema declares a partial unique index that only applies when
 * displayNameLower is a string, so users without a display name (the field
 * absent / null) never collide. An earlier deployment created the index
 * without that partial filter, which made every new account hit
 * E11000 dup key { displayNameLower: null } as soon as a second user
 * registered. Mongoose does not auto-rebuild indexes whose options drift,
 * so we explicitly drop the stale one and let syncIndexes() rebuild it.
 *
 * Idempotent: if the current index already matches the schema, this is a no-op.
 */

const User = require('../models/User');

const EXPECTED_NAME = 'displayNameLower_1';
const EXPECTED_PARTIAL = { displayNameLower: { $type: 'string' } };

function partialFiltersMatch(actual) {
  if (!actual || typeof actual !== 'object') return false;
  const a = actual.displayNameLower;
  if (!a || typeof a !== 'object') return false;
  return a.$type === 'string';
}

async function syncUserDisplayNameIndex({ logger = console } = {}) {
  const collection = User.collection;
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch (err) {
    // Collection doesn't exist yet (fresh DB) — syncIndexes will create it.
    if (err?.codeName === 'NamespaceNotFound') {
      await User.syncIndexes();
      return { dropped: false, rebuilt: true };
    }
    throw err;
  }

  const existing = indexes.find(i => i.name === EXPECTED_NAME);
  const needsDrop = existing && (
    existing.unique !== true ||
    !partialFiltersMatch(existing.partialFilterExpression)
  );

  if (needsDrop) {
    if (logger?.log) {
      logger.log(
        `[migration] syncUserDisplayNameIndex: dropping stale "${EXPECTED_NAME}" ` +
        `(unique=${existing.unique}, partial=${JSON.stringify(existing.partialFilterExpression)})`
      );
    }
    try {
      await collection.dropIndex(EXPECTED_NAME);
    } catch (err) {
      if (err?.codeName !== 'IndexNotFound') throw err;
    }
  }

  // Always sync so a missing index is recreated and any other drift is reconciled.
  await User.syncIndexes();

  return { dropped: !!needsDrop, rebuilt: true };
}

module.exports = syncUserDisplayNameIndex;
