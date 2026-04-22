/**
 * runLeadsBriefsCleanup.js
 *
 * One-shot cleanup that applies the three safe backfill operations the new
 * admin endpoints expose, in order:
 *
 *   1. backfill-from-news-briefs   — create leads for orphan News briefs
 *   2. backfill-published          — tick lead.isPublished where brief is published
 *   3. backfill-briefs-from-leads  — fill empty brief nickname/subtitle from lead
 *                                    (only fills empty fields — never overwrites)
 *
 * Runs a dry-run pass first, prints the numbers, then applies each step.
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   node backend/scripts/runLeadsBriefsCleanup.js
 *   node backend/scripts/runLeadsBriefsCleanup.js --dry-run   (preview only)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');

const IntelLead         = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const DRY_ONLY = process.argv.includes('--dry-run');

function normaliseLeadTitle(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ── 1. Backfill News briefs → leads ────────────────────────────────────────
async function backfillFromNewsBriefs({ apply }) {
  const [newsBriefs, leads] = await Promise.all([
    IntelligenceBrief.find({ category: 'News' })
      .select('_id title subtitle nickname category subcategory historic status eventDate')
      .lean(),
    IntelLead.find().select('title').lean(),
  ]);

  const leadSet = new Set(leads.map(l => normaliseLeadTitle(l.title)));
  const docs = [];
  for (const b of newsBriefs) {
    if (!b.title) continue;
    if (leadSet.has(normaliseLeadTitle(b.title))) continue;
    docs.push({
      title:       b.title,
      subtitle:    b.subtitle    ?? '',
      nickname:    b.nickname    ?? '',
      category:    b.category,
      subcategory: b.subcategory ?? '',
      isHistoric:  !!b.historic,
      isPublished: b.status === 'published',
      eventDate:   b.eventDate   ?? null,
    });
  }

  if (apply && docs.length) {
    await IntelLead.insertMany(docs, { ordered: false });
  }
  return { created: docs.length, titles: docs.map(d => d.title) };
}

// ── 2. Tick lead.isPublished where a matching published brief exists ───────
async function backfillPublished({ apply }) {
  const publishedBriefTitles = await IntelligenceBrief.distinct('title', { status: 'published' });
  const normPublished = new Set(publishedBriefTitles.map(normaliseLeadTitle));

  const leads = await IntelLead.find({ isPublished: false }).select('_id title').lean();
  const toMark = leads.filter(l => normPublished.has(normaliseLeadTitle(l.title)));

  if (apply && toMark.length) {
    await IntelLead.updateMany({ _id: { $in: toMark.map(l => l._id) } }, { isPublished: true });
  }
  return { marked: toMark.length, titles: toMark.map(l => l.title) };
}

// ── 3. Fill empty brief nickname/subtitle from matching lead ───────────────
async function backfillBriefsFromLeads({ apply }) {
  const BACKFILL_FIELDS = ['nickname', 'subtitle'];

  const [leads, briefs] = await Promise.all([
    IntelLead.find().select('_id title nickname subtitle').lean(),
    IntelligenceBrief.find().select('_id title nickname subtitle').lean(),
  ]);

  const leadByNorm = new Map();
  for (const l of leads) if (l.title) leadByNorm.set(normaliseLeadTitle(l.title), l);

  const changes = [];
  for (const brief of briefs) {
    const lead = leadByNorm.get(normaliseLeadTitle(brief.title));
    if (!lead) continue;
    const updates = {};
    for (const f of BACKFILL_FIELDS) {
      const briefVal = (brief[f] ?? '').trim();
      const leadVal  = (lead[f]  ?? '').trim();
      if (!briefVal && leadVal) updates[f] = leadVal;
    }
    if (Object.keys(updates).length) {
      changes.push({ briefId: brief._id, title: brief.title, updates });
      if (apply) await IntelligenceBrief.updateOne({ _id: brief._id }, updates);
    }
  }
  return { changed: changes.length, sample: changes.slice(0, 10) };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${DRY_ONLY ? 'DRY-RUN (no writes)' : 'APPLY'}\n`);

  console.log('── Pass 1: dry-run preview ──');
  const p1 = await backfillFromNewsBriefs({ apply: false });
  console.log(`  1. News→lead: would create ${p1.created} lead(s)`);
  if (p1.titles.length) p1.titles.slice(0, 10).forEach(t => console.log(`       • ${t}`));
  if (p1.titles.length > 10) console.log(`       … +${p1.titles.length - 10} more`);

  const p2 = await backfillPublished({ apply: false });
  console.log(`  2. Tick isPublished: would mark ${p2.marked} lead(s)`);
  if (p2.titles.length) p2.titles.slice(0, 10).forEach(t => console.log(`       • ${t}`));
  if (p2.titles.length > 10) console.log(`       … +${p2.titles.length - 10} more`);

  const p3 = await backfillBriefsFromLeads({ apply: false });
  console.log(`  3. Lead→brief (empty-only): would update ${p3.changed} brief(s)`);
  for (const c of p3.sample) {
    const fieldNote = Object.entries(c.updates).map(([f, v]) => `${f}="${v}"`).join(', ');
    console.log(`       • ${c.title}: ${fieldNote}`);
  }
  if (p3.changed > p3.sample.length) console.log(`       … +${p3.changed - p3.sample.length} more`);

  if (DRY_ONLY) {
    console.log('\n--dry-run set — exiting without writes.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n── Pass 2: applying ──');
  const a1 = await backfillFromNewsBriefs({ apply: true });
  console.log(`  1. News→lead:           created ${a1.created}`);
  const a2 = await backfillPublished({ apply: true });
  console.log(`  2. Tick isPublished:    marked  ${a2.marked}`);
  const a3 = await backfillBriefsFromLeads({ apply: true });
  console.log(`  3. Lead→brief (empty):  updated ${a3.changed}`);

  console.log('\nDone. Re-run checkLeadsBriefsDiscrepancies.js to verify.');
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
