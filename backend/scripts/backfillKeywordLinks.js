/**
 * One-time backfill: re-run keyword auto-linking across existing briefs using
 * the updated Stage 2 disambiguation rules (type/temporal/allegiance coherence
 * and default-to-null on weak context).
 *
 * Processes briefs in batches so results can be eyeballed between runs and AI
 * spend is controlled. Dry-run by default — add --commit to persist changes.
 *
 * Usage:
 *   cd backend && node scripts/backfillKeywordLinks.js [options]
 *
 * Options:
 *   --offset N       Skip the first N briefs (stable _id ascending order). Default 0.
 *   --limit  N       Process this many briefs. Default 10.
 *   --commit         Write changes. Default: dry-run (print diffs, touch nothing).
 *   --seed           Also run Stage 3 stub seeding for still-unlinked keywords.
 *                    Default: skipped — backfill focuses on fixing existing links.
 *   --force-relink   Clear existing linkedBriefId values before re-running the pipeline.
 *                    Default: off (only fills gaps on unlinked keywords). Turn ON to
 *                    re-evaluate and potentially REPLACE existing links that were
 *                    made under the old pipeline (e.g. the ATC-style mislinks).
 *                    Costs more AI calls — every keyword goes to Stage 2, not just
 *                    the unlinked ones.
 *
 * Typical flow:
 *   node scripts/backfillKeywordLinks.js                        # dry-run first 10, gap-fill only
 *   node scripts/backfillKeywordLinks.js --force-relink         # dry-run first 10, re-evaluate all
 *   node scripts/backfillKeywordLinks.js --force-relink --commit
 *   node scripts/backfillKeywordLinks.js --offset 10 --force-relink --commit
 */

require('dotenv').config();
const mongoose = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { autoLinkKeywords } = require('../utils/keywordLinking');
const { callOpenRouter } = require('../utils/openRouter');

function parseArgs() {
  const args = { offset: 0, limit: 10, commit: false, seed: false, forceRelink: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit')            args.commit      = true;
    else if (a === '--seed')         args.seed        = true;
    else if (a === '--force-relink') args.forceRelink = true;
    else if (a === '--offset')       args.offset      = parseInt(argv[++i], 10) || 0;
    else if (a === '--limit')        args.limit       = parseInt(argv[++i], 10) || 10;
  }
  return args;
}

// Minimal AI caller matching the signature autoLinkKeywords expects.
// Usage is logged against the 'backfill-keyword-links' feature.
async function openRouterChat(messages, model, maxTokens = 1024) {
  return callOpenRouter({
    key:  'main',
    body: { model, messages, max_tokens: maxTokens },
  });
}

function linkDiff(oldKws, newKws) {
  // Pair by keyword text (case-insensitive) and emit { keyword, before, after } for anything that moved.
  const byKey = new Map(oldKws.map(k => [k.keyword?.toLowerCase(), k]));
  const changes = [];
  for (const nk of newKws) {
    const ok = byKey.get(nk.keyword?.toLowerCase());
    const before = ok?.linkedBriefId ? String(ok.linkedBriefId) : null;
    const after  = nk.linkedBriefId  ? String(nk.linkedBriefId)  : null;
    if (before !== after) changes.push({ keyword: nk.keyword, before, after });
  }
  return changes;
}

async function run() {
  const { offset, limit, commit, seed, forceRelink } = parseArgs();
  console.log(`Mode: ${commit ? 'COMMIT (writes)' : 'DRY-RUN (no writes)'} | seed stubs: ${seed ? 'yes' : 'no'} | force-relink: ${forceRelink ? 'yes' : 'no'} | offset: ${offset} | limit: ${limit}`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const briefs = await IntelligenceBrief.find(
    {
      status:   'published',
      keywords: { $exists: true, $not: { $size: 0 } },
    },
    '_id title descriptionSections keywords',
  )
    .sort({ _id: 1 })
    .skip(offset)
    .limit(limit)
    .lean();

  console.log(`Processing ${briefs.length} brief(s) [${offset + 1}..${offset + briefs.length}]\n`);

  // Cache title lookup across the batch so diff output can print titles, not just ObjectIds.
  const allIds = new Set();
  for (const b of briefs) for (const k of (b.keywords || [])) {
    if (k.linkedBriefId) allIds.add(String(k.linkedBriefId));
  }

  let briefsTouched = 0;
  let totalChanges  = 0;

  for (const brief of briefs) {
    try {
      // In force-relink mode, strip existing linkedBriefId values so Stage 2 evaluates
      // every keyword fresh. Otherwise autoLinkKeywords short-circuits on any keyword
      // that already has a link — which leaves bad existing links (e.g. the original
      // "ATC infrastructure → ATC Officer" mislink) untouched.
      const kwInput = forceRelink
        ? brief.keywords.map(k => ({ ...k, linkedBriefId: null }))
        : brief.keywords;

      const relinked = await autoLinkKeywords(
        kwInput,
        brief.descriptionSections,
        openRouterChat,
        brief._id,
        brief.title,
        { skipSeed: !seed },
      );

      const changes = linkDiff(brief.keywords, relinked);
      if (!changes.length) {
        console.log(`  "${brief.title}": no changes`);
        continue;
      }

      briefsTouched++;
      totalChanges += changes.length;

      // Resolve any new ObjectIds to titles so the diff is readable
      const newIds = [...new Set(changes.map(c => c.after).filter(Boolean).concat(changes.map(c => c.before).filter(Boolean)))];
      const docs = await IntelligenceBrief.find({ _id: { $in: newIds } }, '_id title').lean();
      const titleMap = new Map(docs.map(d => [String(d._id), d.title]));
      const fmt = (id) => id ? `"${titleMap.get(id) || '(missing)'}"` : 'null';

      console.log(`  "${brief.title}" — ${changes.length} change(s):`);
      for (const c of changes) {
        console.log(`    • "${c.keyword}": ${fmt(c.before)} → ${fmt(c.after)}`);
      }

      if (commit) {
        // Preserve existing keyword order and all non-link fields; only update linkedBriefId per entry.
        await IntelligenceBrief.updateOne(
          { _id: brief._id },
          {
            $set: Object.fromEntries(
              relinked.map((k, i) => [`keywords.${i}.linkedBriefId`, k.linkedBriefId || null]),
            ),
          },
        );
      }
    } catch (err) {
      console.error(`  "${brief.title}": failed — ${err.message}`);
    }
  }

  console.log(`\nDone. ${briefsTouched} brief(s) would change, ${totalChanges} link update(s). ${commit ? 'Written to DB.' : 'No changes written (dry-run).'}`);

  const nextOffset = offset + briefs.length;
  if (briefs.length === limit) {
    console.log(`\nNext batch: --offset ${nextOffset} --limit ${limit}${commit ? ' --commit' : ''}${seed ? ' --seed' : ''}${forceRelink ? ' --force-relink' : ''}`);
  } else {
    console.log('\nReached end of brief set.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
