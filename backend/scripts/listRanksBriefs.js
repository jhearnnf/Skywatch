/**
 * listRanksBriefs.js
 *
 * Read-only audit of intel briefs under category: 'Ranks'.
 * Groups by subcategory, flags exact / fuzzy duplicate titles.
 *
 * Usage:
 *   node backend/scripts/listRanksBriefs.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const briefs = await IntelligenceBrief
    .find({ category: 'Ranks' })
    .select('_id title subtitle subcategory status priorityNumber dateAdded')
    .sort({ subcategory: 1, title: 1 })
    .lean();

  console.log(`Total briefs in 'Ranks': ${briefs.length}\n`);

  const bySub = {};
  for (const b of briefs) {
    const k = b.subcategory || '(no subcategory)';
    (bySub[k] ||= []).push(b);
  }

  for (const sub of Object.keys(bySub).sort()) {
    const list = bySub[sub];
    console.log(`── ${sub} (${list.length}) ──`);
    for (const b of list) {
      const pri = b.priorityNumber == null ? '—' : b.priorityNumber;
      console.log(`  [${b.status}] pri=${pri}  ${b.title}`);
      if (b.subtitle) console.log(`      ↳ ${b.subtitle}`);
    }
    console.log('');
  }

  // Exact + fuzzy duplicate detection across the whole Ranks set
  console.log('── Duplicate candidates ──');
  const exact = {};
  for (const b of briefs) {
    const k = normalize(b.title);
    (exact[k] ||= []).push(b);
  }
  let foundExact = false;
  for (const [k, group] of Object.entries(exact)) {
    if (group.length > 1) {
      foundExact = true;
      console.log(`\nEXACT title match ("${k}"):`);
      for (const b of group) {
        console.log(`  _id=${b._id}  [${b.status}]  sub=${b.subcategory}  title="${b.title}"`);
      }
    }
  }
  if (!foundExact) console.log('  (no exact title matches)');

  console.log('\nFuzzy title matches (Jaccard ≥ 0.6, different IDs):');
  let foundFuzzy = false;
  for (let i = 0; i < briefs.length; i++) {
    for (let j = i + 1; j < briefs.length; j++) {
      const a = briefs[i];
      const b = briefs[j];
      if (normalize(a.title) === normalize(b.title)) continue; // already in exact
      const score = jaccard(a.title, b.title);
      if (score >= 0.6) {
        foundFuzzy = true;
        console.log(`  ${score.toFixed(2)}  "${a.title}"  ↔  "${b.title}"`);
        console.log(`         ${a._id} (${a.subcategory})  |  ${b._id} (${b.subcategory})`);
      }
    }
  }
  if (!foundFuzzy) console.log('  (none)');

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
