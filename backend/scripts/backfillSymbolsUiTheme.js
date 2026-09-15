/**
 * backfillSymbolsUiTheme.js
 *
 * Symbols scores started recording the theme they were set under on
 * 2026-09-15 (uiTheme on GameSessionCbatSymbolsResult, see
 * constants/cbatUiThemes.js). Every score before that was set on the SkyWatch
 * screen: until that day the Real CBAT theme only recoloured Symbols, and the
 * typed-answer Visual Search board that makes the theme a different game
 * shipped in the same change as the field. So a row with no theme is a
 * SkyWatch score, and the board should say so rather than "Not recorded".
 *
 * Only rows with no theme are touched (missing field or null), so this is
 * safe to run again after the recording client has deployed: a real 'cbat' or
 * 'skywatch' value is never overwritten. Scores that arrive with no theme
 * AFTER the deploy (an offline outbox queued on an older client) will also be
 * caught by a re-run, which is still right - that client drew the old board.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   node backend/scripts/backfillSymbolsUiTheme.js
 *   node backend/scripts/backfillSymbolsUiTheme.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const GameSessionCbatSymbolsResult = require('../models/GameSessionCbatSymbolsResult');
const { DEFAULT_UI_THEME } = require('../constants/uiThemes.json');

const apply = process.argv.includes('--apply');

// A row with no recorded theme: the field predates it, or arrived null.
const UNRECORDED = { $or: [{ uiTheme: { $exists: false } }, { uiTheme: null }] };

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const total = await GameSessionCbatSymbolsResult.countDocuments({});
  const unrecorded = await GameSessionCbatSymbolsResult.countDocuments(UNRECORDED);
  const byTheme = await GameSessionCbatSymbolsResult.aggregate([
    { $group: { _id: '$uiTheme', n: { $sum: 1 } } },
  ]);
  console.log(`Symbols scores: ${total} total`);
  for (const { _id, n } of byTheme) console.log(`  ${_id ?? '(none)'}: ${n}`);
  console.log(`${unrecorded} with no theme -> would become '${DEFAULT_UI_THEME}'`);

  if (!apply) {
    console.log('Dry run - nothing written. Pass --apply to write.');
  } else if (unrecorded === 0) {
    console.log('Nothing to do.');
  } else {
    const res = await GameSessionCbatSymbolsResult.updateMany(UNRECORDED, { $set: { uiTheme: DEFAULT_UI_THEME } });
    console.log(`Updated ${res.modifiedCount} of ${res.matchedCount} matched.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
