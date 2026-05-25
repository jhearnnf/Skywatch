'use strict';

/**
 * Splits legacy GameSessionCbatStart docs with gameKey='plane-turn' into
 * 'plane-turn-2d' (the historical default mode).
 *
 * Context: the CBAT registry used to have one 'plane-turn' entry with a `mode`
 * field on result docs. Reports/leaderboards/personal-bests now treat 2D and 3D
 * as separate games keyed 'plane-turn-2d' and 'plane-turn-3d'. The start tracker
 * (GameSessionCbatStart) stores gameKey alongside startedAt, but never recorded
 * mode — so legacy starts can only be attributed by historical default, which is
 * '2d' (3D was added later and was opt-in via a mode toggle).
 *
 * Idempotent: re-running matches zero docs after the first apply.
 *
 * Called automatically from server.js on every boot; safe to keep there.
 */
async function splitPlaneTurnStarts({ db, logger = console } = {}) {
  if (!db) throw new Error('db handle required (mongoose.connection.db)');

  const result = await db.collection('gamesessioncbatstarts').updateMany(
    { gameKey: 'plane-turn' },
    { $set: { gameKey: 'plane-turn-2d' } }
  );

  if (result.modifiedCount > 0) {
    logger.log?.(
      `[migration] splitPlaneTurnStarts: rewrote ${result.modifiedCount} legacy 'plane-turn' starts to 'plane-turn-2d'`
    );
  }
  return { migrated: result.modifiedCount };
}

module.exports = splitPlaneTurnStarts;
