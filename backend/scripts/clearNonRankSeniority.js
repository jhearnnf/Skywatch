/**
 * clearNonRankSeniority.js — one-shot
 *
 * Clears rankOrder on the 7 Ranks/Specialist-Role leads that are *concepts
 * about* the RAF career structure rather than actual ranks (commission types,
 * career streams, Officer Cadet, etc.). Also clears the matching brief
 * gameData.rankHierarchyOrder so the BriefReader's Seniority stat hides for
 * these titles. Then runs compactRankOrder() to renumber the remaining 20
 * real ranks to a contiguous 1..20.
 *
 * Idempotent. Run any time:
 *   node backend/scripts/clearNonRankSeniority.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const IntelLead         = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { compactRankOrder } = require('../utils/rankOrdering');

const TITLES = [
  'Special Duties (SD) List',
  'Short Service Commission',
  'Permanent Commission',
  'Acting Rank',
  'Officer Cadet (RAF)',
  'Volunteer Reserve Commission',
  'Branch and Trade Groups (RAF)',
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const leadResult = await IntelLead.updateMany(
    { category: 'Ranks', title: { $in: TITLES } },
    { $set: { rankOrder: null } },
  );
  console.log(`Cleared rankOrder on ${leadResult.modifiedCount} lead(s).`);

  const briefResult = await IntelligenceBrief.updateMany(
    { category: 'Ranks', title: { $in: TITLES } },
    { $unset: { 'gameData.rankHierarchyOrder': '' } },
  );
  console.log(`Cleared gameData.rankHierarchyOrder on ${briefResult.modifiedCount} brief(s).`);

  const compactResult = await compactRankOrder();
  console.log(`Compacted: ${compactResult.leadsCompacted} lead(s), ${compactResult.briefsUpdated} brief title(s) mirrored.`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => { console.error(err); process.exit(1); });
