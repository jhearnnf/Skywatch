/**
 * backfillRankOrder.js
 *
 * One-time-but-idempotent backfill for IntelLead.rankOrder.
 *
 * Steps:
 *   1. Look up every Ranks IntelLead, resolve its canonical rankOrder via
 *      backend/constants/rankOrder.js (modern titles + legacy aliases).
 *   2. Set rankOrder on each lead that resolved to a value.
 *   3. Run compactRankOrder() to renumber to a contiguous 1..N and mirror
 *      every value into IntelligenceBrief.gameData.rankHierarchyOrder.
 *   4. Print a report of any Ranks leads that didn't match the canonical
 *      list — those need manual slotting.
 *
 * Dry-run by default. Pass --apply to write changes.
 *
 * Usage:
 *   node backend/scripts/backfillRankOrder.js
 *   node backend/scripts/backfillRankOrder.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const IntelLead    = require('../models/IntelLead');
const { lookupRankOrderByTitle } = require('../constants/rankOrder');
const { compactRankOrder }       = require('../utils/rankOrdering');

const APPLY = process.argv.includes('--apply');

function log(...a) { console.log(...a); }

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  log(`Connected. Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}\n`);

  const leads = await IntelLead.find({ category: 'Ranks' })
    .select('_id title rankOrder')
    .lean();

  log(`Ranks leads found: ${leads.length}\n`);

  const matched   = [];
  const unmatched = [];
  for (const lead of leads) {
    const canonical = lookupRankOrderByTitle(lead.title);
    if (canonical == null) {
      unmatched.push(lead);
    } else {
      matched.push({ lead, canonical });
    }
  }

  log(`── Matched (${matched.length}) ──`);
  for (const { lead, canonical } of matched) {
    const arrow = lead.rankOrder === canonical ? '=' : `${lead.rankOrder ?? '—'} → ${canonical}`;
    log(`  ${String(canonical).padStart(3)}  ${arrow.padStart(10)}  ${lead.title}`);
  }

  if (unmatched.length) {
    log(`\n── Unmatched (${unmatched.length}) — these need manual slotting ──`);
    for (const lead of unmatched) {
      log(`  pri ${lead.rankOrder ?? '—'}  ${lead.title}`);
    }
  }

  if (!APPLY) {
    log('\nDry-run complete. Re-run with --apply to write.');
    await mongoose.disconnect();
    return;
  }

  // Phase 1: stamp the canonical order onto every matched lead.
  const ops = matched
    .filter(({ lead, canonical }) => lead.rankOrder !== canonical)
    .map(({ lead, canonical }) => ({
      updateOne: {
        filter: { _id: lead._id },
        update: { $set: { rankOrder: canonical } },
      },
    }));
  if (ops.length) {
    const r = await IntelLead.bulkWrite(ops);
    log(`\nApplied ${r.modifiedCount ?? ops.length} canonical rankOrder updates.`);
  } else {
    log('\nAll matched leads already have the canonical rankOrder.');
  }

  // Phase 2: compact + mirror to briefs. Multiple leads may map to the same
  // canonical slot if duplicates exist in the DB; compactRankOrder will
  // expand the sequence to 1..N preserving the relative order.
  const compactResult = await compactRankOrder();
  log(`Compacted: ${compactResult.leadsCompacted} lead(s), ${compactResult.briefsUpdated} brief title(s) mirrored.`);

  await mongoose.disconnect();
  log('\nDone.');
}

run().catch((err) => { console.error(err); process.exit(1); });
