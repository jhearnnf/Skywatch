/**
 * backfillCbatUiTheme.js
 *
 * Every CBAT result row carries the theme it was set under (uiTheme, see
 * constants/cbatUiThemes.js), and every board shows it. Only Symbols recorded
 * the field until the 2026-09-16 change that stamps it on every game, so
 * older rows have no theme and their boards say "Not recorded". A row with no
 * theme is taken as a SkyWatch score, the default look, and this stamps it
 * as such.
 *
 * Touches only rows with no theme (missing field or null): a real 'cbat' or
 * 'skywatch' value is never overwritten. Safe to run again - a score that
 * arrives themeless later (an offline outbox queued on an older client) is
 * caught by a re-run, and that client drew the SkyWatch board anyway.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   node backend/scripts/backfillCbatUiTheme.js
 *   node backend/scripts/backfillCbatUiTheme.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const { CBAT_GAMES } = require('../constants/cbatGames');
const { ensureCbatResultPaths } = require('../utils/cbatResult');
const { DEFAULT_UI_THEME } = require('../constants/uiThemes.json');

const apply = process.argv.includes('--apply');

// A row with no recorded theme: the field predates it, or arrived null.
const UNRECORDED = { $or: [{ uiTheme: { $exists: false } }, { uiTheme: null }] };

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  // Adds the uiTheme path to the models that don't declare it themselves;
  // without it Mongoose's strict mode would silently drop the $set.
  ensureCbatResultPaths();

  // One pass per distinct model - plane-turn 2d/3d share a collection.
  const models = new Map();
  for (const cfg of Object.values(CBAT_GAMES)) {
    if (cfg.Model && !models.has(cfg.Model.modelName)) models.set(cfg.Model.modelName, cfg.Model);
  }

  let grandTotal = 0;
  let grandUnrecorded = 0;
  let grandUpdated = 0;
  for (const [name, Model] of models) {
    const total = await Model.countDocuments({});
    const unrecorded = await Model.countDocuments(UNRECORDED);
    grandTotal += total;
    grandUnrecorded += unrecorded;
    let note = '';
    if (apply && unrecorded > 0) {
      const res = await Model.updateMany(UNRECORDED, { $set: { uiTheme: DEFAULT_UI_THEME } });
      grandUpdated += res.modifiedCount;
      note = ` -> updated ${res.modifiedCount}`;
    }
    console.log(`${name.padEnd(44)} ${String(total).padStart(6)} total, ${String(unrecorded).padStart(6)} with no theme${note}`);
  }

  console.log(`\n${grandTotal} scores across ${models.size} collections; ${grandUnrecorded} with no theme -> '${DEFAULT_UI_THEME}'`);
  if (!apply) console.log('Dry run - nothing written. Pass --apply to write.');
  else console.log(`Updated ${grandUpdated}.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
