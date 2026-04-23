/**
 * auditAircraftCategory.js
 *
 * Lists every IntelligenceBrief and IntelLead whose category matches "Aircraft"
 * (case-insensitive, also matches "Aircrafts"), grouped by subcategory.
 * Intended to surface entries whose titles describe a role/mission type rather
 * than a specific airframe.
 *
 * Output only — makes no changes.
 *
 * Usage:
 *   node backend/scripts/auditAircraftCategory.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose          = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelLead         = require('../models/IntelLead');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB — scanning Aircraft category');

  // First, list every distinct category so we know what to match
  const distinctBriefCats = await IntelligenceBrief.distinct('category');
  const distinctLeadCats  = await IntelLead.distinct('category');
  console.log('\nDistinct categories on briefs:', distinctBriefCats);
  console.log('Distinct categories on leads: ', distinctLeadCats);

  const catFilter = { $regex: /^aircrafts?$/i };

  const briefs = await IntelligenceBrief.find(
    { category: catFilter },
    '_id title subtitle category subcategory status historic'
  ).lean();
  const leads = await IntelLead.find(
    { category: catFilter },
    '_id title subtitle category subcategory isPublished isHistoric'
  ).lean();

  console.log(`\n=== BRIEFS (${briefs.length}) ===`);
  const bySubBrief = groupBy(briefs, b => `${b.category} / ${b.subcategory || '(no subcategory)'}`);
  for (const [sub, list] of Object.entries(bySubBrief).sort()) {
    console.log(`\n  -- ${sub} (${list.length}) --`);
    for (const b of list.sort((a, b) => a.title.localeCompare(b.title))) {
      console.log(`    ${b._id}  "${b.title}"${b.subtitle ? `  — ${truncate(b.subtitle, 80)}` : ''}`);
    }
  }

  console.log(`\n=== LEADS (${leads.length}) ===`);
  const bySubLead = groupBy(leads, l => `${l.category} / ${l.subcategory || '(no subcategory)'}`);
  for (const [sub, list] of Object.entries(bySubLead).sort()) {
    console.log(`\n  -- ${sub} (${list.length}) --`);
    for (const l of list.sort((a, b) => a.title.localeCompare(b.title))) {
      const flags = [
        l.isPublished ? 'pub' : 'unpub',
        l.isHistoric && 'historic',
      ].filter(Boolean).join(',');
      console.log(`    ${l._id}  [${flags}]  "${l.title}"${l.subtitle ? `  — ${truncate(l.subtitle, 80)}` : ''}`);
    }
  }

  await mongoose.disconnect();
}

function groupBy(arr, fn) {
  return arr.reduce((acc, x) => {
    const k = fn(x);
    (acc[k] ||= []).push(x);
    return acc;
  }, {});
}

function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

run().catch(err => { console.error(err); process.exit(1); });
