/**
 * Backfill: re-run keyword linking for all published briefs that have keywords.
 *
 * Runs the full three-stage autoLinkKeywords pipeline:
 *   Stage 1 — word-level candidate filtering
 *   Stage 2 — AI disambiguation with category labels + keyword descriptions
 *   Stage 3 — auto-seed new IntelLead + stub for unmatched keywords (skipped in --dry-run)
 *
 * Each brief's keywords are re-linked from scratch (existing linkedBriefIds
 * are cleared before re-linking so stale links don't persist).
 *
 * Usage:
 *   cd backend && node scripts/backfillKeywordLinks.js
 *
 * Options:
 *   --dry-run             Print what would change without writing to DB or creating stubs
 *   --title "partial"     Only process briefs whose title contains this string (case-insensitive)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { autoLinkKeywords } = require('../utils/keywordLinking');

const DRY_RUN    = process.argv.includes('--dry-run');
const titleArg   = (() => {
  const idx = process.argv.indexOf('--title');
  return idx !== -1 ? process.argv[idx + 1]?.toLowerCase() : null;
})();

async function openRouterChat(messages, model, maxTokens = 2048) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title': 'SkyWatch',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  if (DRY_RUN) console.log('DRY RUN — no DB writes will be made\n');

  const query = {
    status: 'published',
    'keywords.0': { $exists: true },
  };
  if (titleArg) query.title = { $regex: titleArg, $options: 'i' };

  const briefs = await IntelligenceBrief.find(
    query,
    '_id title keywords descriptionSections'
  ).lean();

  console.log(`Found ${briefs.length} brief(s) to process${titleArg ? ` matching "${titleArg}"` : ''}.\n`);

  let updated = 0;
  let unchanged = 0;
  let errored = 0;

  for (const brief of briefs) {
    process.stdout.write(`  ${brief.title} ... `);

    // Strip existing linkedBriefIds so we re-link from scratch
    const strippedKeywords = (brief.keywords || []).map(k => ({
      keyword: k.keyword,
      generatedDescription: k.generatedDescription,
      // linkedBriefId intentionally omitted / cleared
    }));

    try {
      const relinked = await autoLinkKeywords(
        strippedKeywords,
        brief.descriptionSections,
        openRouterChat,
        brief._id,
        brief.title,
        { skipSeed: DRY_RUN }
      );

      // Compare old vs new links
      const oldLinks = (brief.keywords || []).map(k => String(k.linkedBriefId ?? ''));
      const newLinks = relinked.map(k => String(k.linkedBriefId ?? ''));
      const changed  = oldLinks.some((old, i) => old !== newLinks[i]);

      if (!changed) {
        console.log('no change');
        unchanged++;
        continue;
      }

      // Log what changed
      const diffs = relinked
        .map((k, i) => {
          const oldId = String(brief.keywords[i]?.linkedBriefId ?? '');
          const newId = String(k.linkedBriefId ?? '');
          if (oldId === newId) return null;
          return `"${k.keyword}": ${oldId || 'null'} → ${newId || 'null'}`;
        })
        .filter(Boolean);

      console.log(`${diffs.length} link(s) changed:`);
      diffs.forEach(d => console.log(`    ${d}`));

      if (!DRY_RUN) {
        await IntelligenceBrief.findByIdAndUpdate(brief._id, { keywords: relinked });
      }
      updated++;
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      errored++;
    }
  }

  console.log(`\n── Done ──`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Errored : ${errored}`);
  if (DRY_RUN) console.log('\n(dry run — no writes made)');

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
