/**
 * renameAircoinsToAirstars.js
 *
 * Database migration: rename every "aircoin(s)" field and collection to "airstar(s)".
 *
 * Uses raw MongoDB operations (not Mongoose models) so it works regardless of
 * whether the model files have been renamed yet. Idempotent — $rename silently
 * skips documents that don't have the source field, and collection/enum updates
 * check first.
 *
 * Usage:
 *   node backend/scripts/renameAircoinsToAirstars.js           # dry-run
 *   node backend/scripts/renameAircoinsToAirstars.js --apply   # write changes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

// field-level renames per collection
const FIELD_RENAMES = {
  users: {
    totalAircoins: 'totalAirstars',
    cycleAircoins: 'cycleAirstars',
  },
  levels: {
    aircoinsToNextLevel: 'airstarsToNextLevel',
  },
  appsettings: {
    aircoinsPerWin:                'airstarsPerWin',
    aircoinsPerWinEasy:            'airstarsPerWinEasy',
    aircoinsPerWinMedium:          'airstarsPerWinMedium',
    aircoinsPerBriefRead:          'airstarsPerBriefRead',
    aircoinsFirstLogin:            'airstarsFirstLogin',
    aircoinsStreakBonus:           'airstarsStreakBonus',
    aircoins100Percent:            'airstars100Percent',
    aircoinsOrderOfBattleEasy:     'airstarsOrderOfBattleEasy',
    aircoinsOrderOfBattleMedium:   'airstarsOrderOfBattleMedium',
    aircoinsFlashcardPerCard:      'airstarsFlashcardPerCard',
    aircoinsFlashcardPerfectBonus: 'airstarsFlashcardPerfectBonus',
    aircoinsWhereAircraftRound1:   'airstarsWhereAircraftRound1',
    aircoinsWhereAircraftRound2:   'airstarsWhereAircraftRound2',
    aircoinsWhereAircraftBonus:    'airstarsWhereAircraftBonus',
    volumeAircoin:                 'volumeAirstar',
    soundEnabledAircoin:           'soundEnabledAirstar',
  },
  gametypes: {
    awardedAircoins: 'awardedAirstars',
  },
  gamesessionquizresults:               { aircoinsEarned: 'airstarsEarned' },
  gamesessionorderofbattleresults:      { aircoinsEarned: 'airstarsEarned' },
  gamesessionflashcardrecallresults:    { aircoinsEarned: 'airstarsEarned' },
  gamesessionwhereaircraftresults:      { aircoinsEarned: 'airstarsEarned' },
  gamesessionwheresthataircraftresults: { aircoinsEarned: 'airstarsEarned' },
  gamesessionquizattempts:              { aircoinsEarned: 'airstarsEarned' },
  aptitudesyncusages:                   { aircoinsEarned: 'airstarsEarned' },
};

// collections we want to rename wholesale
const COLLECTION_RENAMES = [
  { from: 'aircoinlogs', to: 'airstarlogs' },
];

// enum value updates — AdminAction.actionType
const ENUM_UPDATES = [
  { collection: 'adminactions', field: 'actionType', from: 'change_aircoins', to: 'change_airstars' },
];

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  console.log(APPLY ? '=== APPLY mode — writing changes ===' : '=== DRY-RUN — no writes ===');
  console.log(`Connecting to ${process.env.MONGODB_URI.replace(/\/\/([^:]+):[^@]+@/, '//$1:****@')}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const existingNames = new Set((await db.listCollections().toArray()).map(c => c.name));
  const report = [];

  // 1. Field renames
  for (const [coll, renames] of Object.entries(FIELD_RENAMES)) {
    if (!existingNames.has(coll)) {
      report.push(`[skip] ${coll}: collection does not exist`);
      continue;
    }
    const sourceFields = Object.keys(renames);
    const matchFilter = { $or: sourceFields.map(f => ({ [f]: { $exists: true } })) };
    const matched = await db.collection(coll).countDocuments(matchFilter);
    if (matched === 0) {
      report.push(`[noop] ${coll}: 0 docs have any of [${sourceFields.join(', ')}]`);
      continue;
    }
    if (APPLY) {
      const res = await db.collection(coll).updateMany({}, { $rename: renames });
      report.push(`[apply] ${coll}: matched ${matched}, modified ${res.modifiedCount} (renamed ${sourceFields.length} field(s))`);
    } else {
      report.push(`[dry]   ${coll}: would rename ${sourceFields.length} field(s) on ${matched} docs`);
    }
  }

  // 2. Enum value updates
  for (const { collection, field, from, to } of ENUM_UPDATES) {
    if (!existingNames.has(collection)) {
      report.push(`[skip] ${collection}.${field}: collection does not exist`);
      continue;
    }
    const matched = await db.collection(collection).countDocuments({ [field]: from });
    if (matched === 0) {
      report.push(`[noop] ${collection}.${field}: 0 docs with value "${from}"`);
      continue;
    }
    if (APPLY) {
      const res = await db.collection(collection).updateMany({ [field]: from }, { $set: { [field]: to } });
      report.push(`[apply] ${collection}.${field}: "${from}" → "${to}" on ${res.modifiedCount} docs`);
    } else {
      report.push(`[dry]   ${collection}.${field}: would update "${from}" → "${to}" on ${matched} docs`);
    }
  }

  // 3. Collection renames
  for (const { from, to } of COLLECTION_RENAMES) {
    if (!existingNames.has(from)) {
      report.push(`[skip] collection ${from}: does not exist`);
      continue;
    }
    if (existingNames.has(to)) {
      const fromCount = await db.collection(from).countDocuments();
      const toCount = await db.collection(to).countDocuments();
      report.push(`[warn] both ${from} (${fromCount} docs) and ${to} (${toCount} docs) exist — manual merge required`);
      continue;
    }
    if (APPLY) {
      await db.collection(from).rename(to);
      report.push(`[apply] collection ${from} → ${to}`);
    } else {
      const count = await db.collection(from).countDocuments();
      report.push(`[dry]   collection ${from} (${count} docs) → ${to}`);
    }
  }

  console.log('\n' + report.join('\n'));
  await mongoose.disconnect();
  console.log(APPLY ? '\nDone.' : '\nDone (dry-run). Re-run with --apply to write changes.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
