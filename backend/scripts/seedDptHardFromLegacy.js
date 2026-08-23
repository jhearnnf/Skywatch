/**
 * seedDptHardFromLegacy.js
 *
 * Carries every pre-split DPT run onto the new four-round Hard board.
 *
 * DPT shipped as a single eight-round ladder. The Easier/Hard split cut it in
 * half — Easier plays rounds 1-4, Hard plays rounds 5-8 — but the original `dpt`
 * key could not simply become Hard: clients predating the split are still out
 * there playing the eight-round game and reading that board with hardcoded URLs
 * (a native build only changes with a store release, and an offline score can
 * sit in the outbox for days). So `dpt` stays exactly what it was, and the split
 * lives on two new keys.
 *
 * That leaves the new Hard board empty and 61 players with no standing on it.
 * This copies each eight-round run across with the value of rounds 1-4 removed:
 *
 *     100 × min(gatesHit, 12)  +  500
 *
 * — 12 gates over rounds 1-4 at 100 each, plus 50 × (1+2+3+4) of completion
 * bonus. For any run that hit 12 or more gates that is a flat 1,700, which is
 * also exactly a perfect score on the new Easier board. The min() only bites on
 * the runs that hit fewer than 12 gates in total and therefore cannot have
 * earned twelve gates' worth anywhere. The result is floored at 0.
 *
 * The rounds-1-4 share cannot be computed exactly — see utils/dptLegacyNormalise.js
 * for why (no round index on a gate hit, no counter for the transport-into-enemy
 * penalty, danger-zone seconds unrecorded) and for why the estimate is safe
 * where it matters. The evidence it is right: the top run, 6,900 with all 36
 * gates, comes across as exactly 5,200 — a perfect four-round Hard run.
 *
 * NOTHING on the eight-round board is modified. Copies carry `originalScore` and
 * `carriedOverFromLegacy`, and keep the original `createdAt` so progress charts
 * and weekly boards read in the right order. Re-running is a no-op, and
 * --revert removes the copies.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   node backend/scripts/seedDptHardFromLegacy.js
 *   node backend/scripts/seedDptHardFromLegacy.js --apply
 *   node backend/scripts/seedDptHardFromLegacy.js --revert --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const GameSessionCbatDptResult     = require('../models/GameSessionCbatDptResult');
const GameSessionCbatDptHardResult = require('../models/GameSessionCbatDptHardResult');
const { earlyRoundValue, FULL_EARLY_VALUE } = require('../utils/dptLegacyNormalise');

const APPLY  = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

async function revert() {
  const n = await GameSessionCbatDptHardResult.countDocuments({ carriedOverFromLegacy: true });
  console.log(`${n} carried-over run(s) on the Hard board.`);
  if (!APPLY) return console.log('\nDry run — pass --apply to write.');
  const { deletedCount } = await GameSessionCbatDptHardResult.deleteMany({ carriedOverFromLegacy: true });
  console.log(`Removed ${deletedCount} carried-over run(s). Runs actually played on Hard are untouched.`);
}

async function seed() {
  const already = await GameSessionCbatDptHardResult.countDocuments({ carriedOverFromLegacy: true });
  if (already > 0) {
    console.log(`${already} run(s) already carried over — nothing to do. Use --revert --apply first to redo it.`);
    return;
  }

  const docs = await GameSessionCbatDptResult
    .find()
    .sort({ totalScore: -1 })
    .lean();

  if (docs.length === 0) {
    console.log('No runs on the eight-round board — nothing to carry over.');
    return;
  }

  let flat = 0, capped = 0, floored = 0;
  const rows = docs.map(d => {
    const subtract = earlyRoundValue(d.gatesHit);
    const score    = Math.max(0, (d.totalScore || 0) - subtract);
    if (subtract === FULL_EARLY_VALUE) flat++; else capped++;
    if (score === 0 && (d.totalScore || 0) > 0) floored++;
    return {
      userId:                d.userId,
      totalScore:            score,
      totalTime:             d.totalTime,
      // The ladder rounds a Hard run covers. A pre-split run really did play
      // them, on its way through all eight.
      finalRound:            Math.max(5, d.finalRound || 8),
      firstRound:            5,
      gatesHit:              d.gatesHit || 0,
      dangerZoneViolations:  d.dangerZoneViolations || 0,
      separationViolations:  d.separationViolations || 0,
      interceptions:         d.interceptions || 0,
      aircraftUsed:          d.aircraftUsed,
      carriedOverFromLegacy: true,
      originalScore:         d.totalScore || 0,
      createdAt:             d.createdAt,
      _subtract:             subtract,
    };
  });

  console.log(`${rows.length} eight-round run(s) to carry over.`);
  console.log(`  ${flat} at the full -${FULL_EARLY_VALUE} (hit 12+ gates)`);
  console.log(`  ${capped} capped to their own gate count (hit fewer than 12)`);
  console.log(`  ${floored} floored to 0 (scored less than their rounds 1-4 share)`);
  console.log('\nTop 10 as they will appear on the Hard board:');
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${String(r.originalScore).padStart(5)} -> ${String(r.totalScore).padStart(5)}  (-${r._subtract}, ${r.gatesHit} gates)`);
  }

  if (!APPLY) return console.log('\nDry run — pass --apply to write.');

  await GameSessionCbatDptHardResult.insertMany(rows.map(({ _subtract, ...row }) => row));
  console.log(`\nCarried ${rows.length} run(s) onto the Hard board. The eight-round board is untouched.`);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    if (REVERT) await revert();
    else await seed();
  } finally {
    await mongoose.disconnect();
  }
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
