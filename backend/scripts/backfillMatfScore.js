/**
 * backfillMatfScore.js
 *
 * Table Reading Test boards rank on `score` (correct minus wrong, floored at
 * 0) from 2026-09-23; before that they ranked on correctCount, and a wrong
 * answer cost nothing, so mashing the buttons topped the board. Every row
 * already stores correctCount and attempted, so the new score can be worked
 * out for the old rows exactly as the server now works it out for new ones
 * (utils/matfScore.js). Without this, old rows have no `score` and drop off
 * the boards and personal bests entirely.
 *
 * Only rows with no score are touched, so it is safe to run again.
 * Prints the rows whose score drops the most, so spammed runs are visible.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   node backend/scripts/backfillMatfScore.js
 *   node backend/scripts/backfillMatfScore.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const GameSessionCbatMatfResult = require('../models/GameSessionCbatMatfResult');
const GameSessionCbatMatfEasierResult = require('../models/GameSessionCbatMatfEasierResult');
const { matfScore } = require('../utils/matfScore');

const apply = process.argv.includes('--apply');

const UNSCORED = { $or: [{ score: { $exists: false } }, { score: null }] };

async function backfill(label, Model) {
  const rows = await Model.find(UNSCORED).select('userId correctCount attempted').lean();
  console.log(`\n${label}: ${rows.length} rows with no score`);

  const scored = rows.map(r => ({ ...r, score: matfScore(r.correctCount, r.attempted) }));
  const biggestDrops = [...scored]
    .sort((a, b) => ((b.correctCount || 0) - b.score) - ((a.correctCount || 0) - a.score))
    .slice(0, 10);
  for (const r of biggestDrops) {
    console.log(`  user ${r.userId}  ${r.correctCount}/${r.attempted} correct -> score ${r.score}`);
  }

  if (!apply || scored.length === 0) return;
  const res = await Model.bulkWrite(scored.map(r => ({
    updateOne: { filter: { _id: r._id }, update: { $set: { score: r.score } } },
  })));
  console.log(`  Updated ${res.modifiedCount}.`);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await backfill('matf (Hard)', GameSessionCbatMatfResult);
  await backfill('matf-easier', GameSessionCbatMatfEasierResult);
  if (!apply) console.log('\nDry run - nothing written. Pass --apply to write.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
