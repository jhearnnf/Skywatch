/**
 * cleanupOrphanedGameDefinitions.js
 *
 * One-off cleanup for user-generated game-definition docs that no longer
 * have any session results pointing at them — typically accumulated from
 * pre-fix reset-stats calls that deleted sessions but left the definitions
 * behind.
 *
 * Scope:
 *   - GameFlashcardRecall  (user-generated per session)
 *   - GameOrderOfBattle    (user-generated per session)
 *
 * Out of scope:
 *   - GameWheresThatAircraft — content-seeded per brief, not user-generated.
 *   - GameQuizQuestion — brief-scoped, managed through the admin UI.
 *
 * Usage:
 *   node backend/scripts/cleanupOrphanedGameDefinitions.js
 *   node backend/scripts/cleanupOrphanedGameDefinitions.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const GameFlashcardRecall              = require('../models/GameFlashcardRecall');
const GameSessionFlashcardRecallResult = require('../models/GameSessionFlashcardRecallResult');
const GameOrderOfBattle                = require('../models/GameOrderOfBattle');
const GameSessionOrderOfBattleResult   = require('../models/GameSessionOrderOfBattleResult');

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log(...a);

async function findOrphans(DefinitionModel, SessionModel, label) {
  const totalDefs = await DefinitionModel.countDocuments();
  const referencedIds = await SessionModel.distinct('gameId');
  const referencedSet = new Set(referencedIds.map(String));

  const allDefIds = await DefinitionModel.distinct('_id');
  const orphanIds = allDefIds.filter(id => !referencedSet.has(String(id)));

  log(`── ${label} ──`);
  log(`  Total docs: ${totalDefs}`);
  log(`  Referenced by a session: ${referencedSet.size}`);
  log(`  Orphans (no session reference): ${orphanIds.length}`);

  if (!APPLY || orphanIds.length === 0) return orphanIds.length;

  const { deletedCount } = await DefinitionModel.deleteMany({ _id: { $in: orphanIds } });
  log(`  Deleted ${deletedCount} orphan(s).`);
  return deletedCount;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  log(`Connected. Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}\n`);

  const flashOrphans = await findOrphans(
    GameFlashcardRecall,
    GameSessionFlashcardRecallResult,
    'GameFlashcardRecall',
  );
  log('');
  const booOrphans = await findOrphans(
    GameOrderOfBattle,
    GameSessionOrderOfBattleResult,
    'GameOrderOfBattle',
  );

  log(`\nTotal orphans ${APPLY ? 'deleted' : 'found'}: ${flashOrphans + booOrphans}`);

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
