/**
 * checkLeadsBriefsDiscrepancies.js
 *
 * Read-only cross-check of IntelLead vs IntelligenceBrief. Reports all
 * discrepancies without writing anything. Covers both stubs and published
 * briefs — the brief is source-of-truth for shared fields regardless of
 * status.
 *
 * Classes reported:
 *   1. Field drift         — lead field != matching brief field
 *                            (title, subtitle, nickname, category,
 *                            subcategory, isHistoric↔historic)
 *   2. Orphan leads        — lead with no matching brief
 *   3. Orphan briefs       — brief with no matching lead
 *   4. Status drift        — lead.isPublished mismatches brief.status
 *   5. Subcategory invalid — lead subcategory not in SUBCATEGORIES[category]
 *                            (IntelLead schema does not enum-validate this)
 *   6. Duplicate briefs    — multiple briefs sharing a normalised title
 *
 * Matching is by normalised title (lowercased, punctuation-stripped,
 * whitespace-collapsed) — mirrors admin.js:normaliseLeadTitle.
 *
 * Usage:
 *   node backend/scripts/checkLeadsBriefsDiscrepancies.js
 *   node backend/scripts/checkLeadsBriefsDiscrepancies.js --json
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');

const IntelLead          = require('../models/IntelLead');
const IntelligenceBrief  = require('../models/IntelligenceBrief');
const { SUBCATEGORIES }  = require('../constants/categories');

const AS_JSON = process.argv.includes('--json');
const log = (...a) => { if (!AS_JSON) console.log(...a); };

function normaliseLeadTitle(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

const LEAD_SYNC_FIELDS = ['title', 'subtitle', 'nickname', 'category', 'subcategory'];

function section(title) {
  log('');
  log(`── ${title} ──`);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  log('Connected. DRY-RUN (no writes).');

  const [leads, briefs] = await Promise.all([
    IntelLead.find()
      .select('_id title subtitle nickname category subcategory isHistoric isPublished priorityNumber')
      .lean(),
    IntelligenceBrief.find()
      .select('_id title subtitle nickname category subcategory historic status publishedAt')
      .lean(),
  ]);

  log(`\nTotal leads:  ${leads.length}`);
  log(`Total briefs: ${briefs.length}`);
  log(`  stubs:     ${briefs.filter(b => b.status === 'stub').length}`);
  log(`  published: ${briefs.filter(b => b.status === 'published').length}`);

  const briefByNorm = new Map();
  const briefDupes  = new Map(); // norm → [briefs]
  for (const b of briefs) {
    const k = normaliseLeadTitle(b.title);
    if (!k) continue;
    if (briefByNorm.has(k)) {
      const arr = briefDupes.get(k) ?? [briefByNorm.get(k)];
      arr.push(b);
      briefDupes.set(k, arr);
    } else {
      briefByNorm.set(k, b);
    }
  }

  const leadByNorm = new Map();
  for (const l of leads) {
    const k = normaliseLeadTitle(l.title);
    if (k) leadByNorm.set(k, l);
  }

  // 1. Field drift + 4. Status drift + 5. Subcategory invalid
  const fieldDrift         = [];
  const statusDrift        = [];
  const invalidSubcategory = [];
  const orphanLeads        = [];

  for (const lead of leads) {
    // 5. Subcategory validity (leads only — briefs are validated at save time)
    if (lead.subcategory) {
      const valid = SUBCATEGORIES[lead.category];
      if (!valid || !valid.includes(lead.subcategory)) {
        invalidSubcategory.push({
          leadId:      String(lead._id),
          title:       lead.title,
          category:    lead.category,
          subcategory: lead.subcategory,
        });
      }
    }

    const brief = briefByNorm.get(normaliseLeadTitle(lead.title));
    if (!brief) {
      orphanLeads.push({ leadId: String(lead._id), title: lead.title, category: lead.category });
      continue;
    }

    // 1. Field drift (shared fields)
    const drifted = {};
    for (const f of LEAD_SYNC_FIELDS) {
      const next = brief[f] ?? '';
      const prev = lead[f]  ?? '';
      if (next !== prev) drifted[f] = { lead: prev, brief: next };
    }
    if (!!brief.historic !== !!lead.isHistoric) {
      drifted.historic = { lead: !!lead.isHistoric, brief: !!brief.historic };
    }
    if (Object.keys(drifted).length) {
      fieldDrift.push({
        leadId:  String(lead._id),
        briefId: String(brief._id),
        title:   lead.title,
        drifted,
      });
    }

    // 4. Status drift
    const briefPublished = brief.status === 'published';
    if (briefPublished !== !!lead.isPublished) {
      statusDrift.push({
        leadId:          String(lead._id),
        briefId:         String(brief._id),
        title:           lead.title,
        leadIsPublished: !!lead.isPublished,
        briefStatus:     brief.status,
      });
    }
  }

  // 3. Orphan briefs (brief with no matching lead)
  const orphanBriefs = [];
  for (const brief of briefs) {
    if (!leadByNorm.has(normaliseLeadTitle(brief.title))) {
      orphanBriefs.push({
        briefId:  String(brief._id),
        title:    brief.title,
        category: brief.category,
        status:   brief.status,
      });
    }
  }

  // 6. Duplicate briefs
  const duplicateBriefs = [];
  for (const [norm, arr] of briefDupes) {
    duplicateBriefs.push({
      normalisedTitle: norm,
      briefs: arr.map(b => ({ briefId: String(b._id), title: b.title, status: b.status })),
    });
  }

  const report = {
    totals: {
      leads:           leads.length,
      briefs:          briefs.length,
      briefStubs:      briefs.filter(b => b.status === 'stub').length,
      briefPublished:  briefs.filter(b => b.status === 'published').length,
    },
    counts: {
      fieldDrift:         fieldDrift.length,
      orphanLeads:        orphanLeads.length,
      orphanBriefs:       orphanBriefs.length,
      statusDrift:        statusDrift.length,
      invalidSubcategory: invalidSubcategory.length,
      duplicateBriefs:    duplicateBriefs.length,
    },
    fieldDrift,
    orphanLeads,
    orphanBriefs,
    statusDrift,
    invalidSubcategory,
    duplicateBriefs,
  };

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    await mongoose.disconnect();
    return;
  }

  // Pretty text report
  section(`1. Field drift (${fieldDrift.length})`);
  if (!fieldDrift.length) log('  none');
  for (const r of fieldDrift) {
    log(`  • ${r.title}`);
    for (const [f, { lead, brief }] of Object.entries(r.drifted)) {
      log(`      ${f.padEnd(12)} lead=${JSON.stringify(lead)}  brief=${JSON.stringify(brief)}`);
    }
  }

  section(`2. Orphan leads — no matching brief (${orphanLeads.length})`);
  if (!orphanLeads.length) log('  none');
  for (const r of orphanLeads) log(`  • [${r.category}] ${r.title}`);

  section(`3. Orphan briefs — no matching lead (${orphanBriefs.length})`);
  if (!orphanBriefs.length) log('  none');
  for (const r of orphanBriefs) log(`  • [${r.category}/${r.status}] ${r.title}`);

  section(`4. Status drift — lead.isPublished vs brief.status (${statusDrift.length})`);
  if (!statusDrift.length) log('  none');
  for (const r of statusDrift) {
    log(`  • ${r.title}`);
    log(`      lead.isPublished=${r.leadIsPublished}  brief.status=${r.briefStatus}`);
  }

  section(`5. Invalid subcategory on lead (${invalidSubcategory.length})`);
  if (!invalidSubcategory.length) log('  none');
  for (const r of invalidSubcategory) {
    log(`  • ${r.title}`);
    log(`      category="${r.category}"  subcategory="${r.subcategory}"`);
  }

  section(`6. Duplicate briefs — same normalised title (${duplicateBriefs.length})`);
  if (!duplicateBriefs.length) log('  none');
  for (const r of duplicateBriefs) {
    log(`  • norm="${r.normalisedTitle}"`);
    for (const b of r.briefs) log(`      [${b.status}] ${b.title}  (${b.briefId})`);
  }

  log('');
  log('Summary:');
  for (const [k, v] of Object.entries(report.counts)) {
    log(`  ${k.padEnd(20)} ${v}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
