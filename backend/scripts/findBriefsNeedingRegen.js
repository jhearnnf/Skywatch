/**
 * findBriefsNeedingRegen.js
 *
 * Scans published briefs for body anti-patterns that only the OLD raf-asset
 * prompt produced but don't belong under the brief's current shape — i.e.
 * "RAF training" / "training pathway" / "modern-day RAF" framing leaking into
 * Actors, Threats, Treaties, AOR, Allies, historic subjects, and the
 * Heritage/Terminology categories.
 *
 * Also flags universal content-quality issues: Sonar refusal disclaimers,
 * empty descriptionSections, Section 4 bodies that name the subject
 * (violates the blind-summary rule).
 *
 * Output: grouped text report (or JSON with --json). Optionally sets
 * flaggedForEdit=true + flaggedAt=now on each flagged brief with --apply so
 * they surface in the admin edit queue.
 *
 * Usage:
 *   node backend/scripts/findBriefsNeedingRegen.js            # report only
 *   node backend/scripts/findBriefsNeedingRegen.js --json     # machine-readable
 *   node backend/scripts/findBriefsNeedingRegen.js --apply    # also set flaggedForEdit
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');

const IntelligenceBrief = require('../models/IntelligenceBrief');
const { getBriefShape } = require('../utils/briefPromptShapes');
const { bodiesText }    = require('../utils/descriptionSections');

const AS_JSON = process.argv.includes('--json');
const APPLY   = process.argv.includes('--apply');
const log = (...a) => { if (!AS_JSON) console.log(...a); };

// Anti-patterns triggered per shape — each match yields one reason on the brief.
const SHAPE_PATTERNS = {
  actor: [
    { re: /\bRAF training\b/i,                reason: 'actor body references RAF training (old-prompt framing)' },
    { re: /\btraining pathway/i,              reason: 'actor body references training pathway (old-prompt framing)' },
    { re: /\btraining phase/i,                reason: 'actor body references training phase (old-prompt framing)' },
    { re: /\btraining pipeline/i,             reason: 'actor body references training pipeline (old-prompt framing)' },
    { re: /\btraining block/i,                reason: 'actor body references training block (old-prompt framing)' },
    { re: /\bmodern[-\s]?day RAF\b/i,         reason: 'actor body uses "modern-day RAF" framing (old-prompt)' },
    { re: /No verifiable (connection|link)/i, reason: 'Sonar disclaimer in body' },
    { re: /No direct RAF connection/i,        reason: 'Sonar disclaimer in body' },
  ],
  threat: [
    { re: /\bRAF training\b/i,                reason: 'threat body references RAF training (old-prompt framing)' },
    { re: /\btraining pathway/i,              reason: 'threat body references training pathway (old-prompt)' },
    { re: /\btraining phase/i,                reason: 'threat body references training phase (old-prompt)' },
    { re: /\bmodern[-\s]?day RAF\b/i,         reason: 'threat body uses "modern-day RAF" framing' },
  ],
  treaty: [
    { re: /\bRAF training\b/i,                reason: 'treaty body references RAF training (old-prompt)' },
    { re: /\btraining pathway/i,              reason: 'treaty body references training pathway (old-prompt)' },
    { re: /\btraining phase/i,                reason: 'treaty body references training phase (old-prompt)' },
  ],
  'region-or-ally': [
    { re: /\bRAF training\b/i,                reason: 'region/ally body references RAF training (old-prompt)' },
    { re: /\btraining pathway/i,              reason: 'region/ally body references training pathway (old-prompt)' },
    { re: /\btraining phase/i,                reason: 'region/ally body references training phase (old-prompt)' },
  ],
  'raf-asset-historic': [
    { re: /\bmodern[-\s]?day RAF\b/i,         reason: 'historic subject uses "modern-day RAF" framing (should be in-era)' },
    { re: /\bcurrently in service\b/i,        reason: 'historic subject framed as currently in service' },
    { re: /\btraining pipeline/i,             reason: 'historic subject references a current training pipeline' },
  ],
  // raf-asset: no shape anti-patterns — training pathways etc. are expected.
};

// Anti-patterns triggered per category regardless of shape — catches Heritage
// / Terminology briefs that defaulted to raf-asset but shouldn't dwell on
// training pipelines (ceremonies, jargon definitions, etc.).
const CATEGORY_PATTERNS = {
  Heritage: [
    { re: /\btraining pathway/i,              reason: 'Heritage brief: training pathway framing is off-topic' },
    { re: /\btraining phase/i,                reason: 'Heritage brief: training phase framing is off-topic' },
    { re: /\btraining pipeline/i,             reason: 'Heritage brief: training pipeline framing is off-topic' },
    { re: /\btraining block/i,                reason: 'Heritage brief: training block framing is off-topic' },
  ],
  Terminology: [
    { re: /\btraining pathway/i,              reason: 'Terminology brief: training pathway framing is off-topic' },
    { re: /\btraining phase/i,                reason: 'Terminology brief: training phase framing is off-topic' },
    { re: /\btraining pipeline/i,             reason: 'Terminology brief: training pipeline framing is off-topic' },
    { re: /\btraining block/i,                reason: 'Terminology brief: training block framing is off-topic' },
  ],
};

// Applied to every brief regardless of shape/category.
const UNIVERSAL_PATTERNS = [
  { re: /No relevant information/i,           reason: 'Sonar refusal leaked into body' },
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  log(`Connected. Mode: ${APPLY ? 'APPLY (will set flaggedForEdit)' : 'DRY-RUN (report only)'}\n`);

  // Only scan published briefs — stubs have no body to evaluate.
  const briefs = await IntelligenceBrief.find({ status: 'published' })
    .select('_id title category subcategory historic descriptionSections flaggedForEdit')
    .lean();

  log(`Scanning ${briefs.length} published brief(s)…\n`);

  const flagged = [];

  for (const b of briefs) {
    const shape = getBriefShape({
      category:    b.category,
      subcategory: b.subcategory,
      historic:    !!b.historic,
    });
    const reasons = [];

    // Empty-body check
    const bodies = Array.isArray(b.descriptionSections) ? b.descriptionSections : [];
    const anyBody = bodiesText(bodies).trim();
    if (!bodies.length || !anyBody) {
      reasons.push('descriptionSections is empty');
    } else {
      // Full body text for all sections.
      const full = anyBody;

      // Shape patterns
      for (const p of (SHAPE_PATTERNS[shape] ?? [])) {
        if (p.re.test(full)) reasons.push(p.reason);
      }
      // Category patterns
      for (const p of (CATEGORY_PATTERNS[b.category] ?? [])) {
        if (p.re.test(full)) reasons.push(p.reason);
      }
      // Universal
      for (const p of UNIVERSAL_PATTERNS) {
        if (p.re.test(full)) reasons.push(p.reason);
      }

      // Section-4 blind rule: final section body must NOT contain the
      // subject's title (case-insensitive substring). Skip if only 1 section.
      if (bodies.length >= 2 && b.title) {
        const last = bodies[bodies.length - 1];
        const lastBody = typeof last === 'string' ? last : (last?.body || '');
        if (lastBody && lastBody.toLowerCase().includes(b.title.toLowerCase())) {
          reasons.push('Section 4 body names the subject (violates blind-summary rule)');
        }
      }
    }

    if (reasons.length) {
      // De-duplicate reasons on a single brief
      const unique = [...new Set(reasons)];
      flagged.push({
        briefId:          String(b._id),
        title:            b.title,
        category:         b.category,
        subcategory:      b.subcategory ?? '',
        shape,
        alreadyFlagged:   !!b.flaggedForEdit,
        reasons:          unique,
      });
    }
  }

  // Apply flag to briefs that aren't already flagged.
  let newlyFlagged = 0;
  if (APPLY && flagged.length) {
    const toFlag = flagged.filter(f => !f.alreadyFlagged).map(f => f.briefId);
    if (toFlag.length) {
      const r = await IntelligenceBrief.updateMany(
        { _id: { $in: toFlag } },
        { $set: { flaggedForEdit: true, flaggedAt: new Date() } },
      );
      newlyFlagged = r.modifiedCount ?? toFlag.length;
    }
  }

  const report = {
    totalScanned:    briefs.length,
    totalFlagged:    flagged.length,
    alreadyFlagged:  flagged.filter(f => f.alreadyFlagged).length,
    newlyFlagged,
    apply:           APPLY,
    flagged,
  };

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    await mongoose.disconnect();
    return;
  }

  // Group by (category, shape) for a readable report
  const byGroup = new Map();
  for (const f of flagged) {
    const k = `${f.category} · ${f.shape}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(f);
  }

  for (const [group, items] of [...byGroup.entries()].sort()) {
    log(`── ${group}  (${items.length}) ──`);
    for (const f of items) {
      const flag = f.alreadyFlagged ? ' [already flagged]' : '';
      log(`  • ${f.title}${flag}`);
      for (const r of f.reasons) log(`      – ${r}`);
    }
    log('');
  }

  log('Summary:');
  log(`  Scanned:          ${briefs.length}`);
  log(`  Flagged total:    ${flagged.length}`);
  log(`  Already flagged:  ${report.alreadyFlagged}`);
  if (APPLY) log(`  Newly flagged:    ${newlyFlagged}`);
  if (!APPLY && flagged.length) log('\n  (run with --apply to set flaggedForEdit=true on all flagged briefs)');

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
