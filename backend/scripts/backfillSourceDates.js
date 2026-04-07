/**
 * One-time backfill: scrape real publication dates for all source URLs on
 * published briefs where the stored articleDate is missing or may be inaccurate.
 *
 * For each source on every published brief, the script fetches the page and
 * extracts the article's actual publication date from structured meta tags
 * (JSON-LD datePublished, article:published_time, etc.).
 * Wikipedia sources use article:modified_time (last edited date) instead.
 *
 * A small delay is added between briefs to avoid hammering external sites.
 *
 * Usage:
 *   cd backend && node scripts/backfillSourceDates.js          # dry run
 *   cd backend && node scripts/backfillSourceDates.js --apply  # write to DB
 */

require('dotenv').config();
const mongoose          = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { scrapeArticleDate } = require('../utils/scrapeArticleDate');

const DRY_RUN      = !process.argv.includes('--apply');
const INTER_BRIEF_DELAY_MS = 300; // pause between briefs to be polite to external sites

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB  [${DRY_RUN ? 'DRY RUN — pass --apply to write' : 'APPLY MODE'}]\n`);

  const briefs = await IntelligenceBrief.find(
    { status: 'published', 'sources.0': { $exists: true } },
    '_id title sources'
  ).lean();

  console.log(`Found ${briefs.length} published briefs with sources.\n`);

  let totalSources  = 0;
  let totalUpdated  = 0;
  let totalFailed   = 0;
  let briefsChanged = 0;

  for (const brief of briefs) {
    const updates = {}; // { 'sources.N.articleDate': 'YYYY-MM-DD' }
    const log     = [];

    for (let i = 0; i < brief.sources.length; i++) {
      const src = brief.sources[i];
      totalSources++;

      let scraped;
      try {
        scraped = await scrapeArticleDate(src.url);
      } catch {
        scraped = null;
      }

      if (!scraped) {
        totalFailed++;
        log.push(`  [${i}] FAIL  ${src.siteName || src.url}`);
        continue;
      }

      const existing = src.articleDate
        ? (src.articleDate instanceof Date
            ? src.articleDate.toISOString().slice(0, 10)
            : String(src.articleDate).slice(0, 10))
        : null;

      if (scraped === existing) {
        log.push(`  [${i}] SAME  ${src.siteName || src.url}  →  ${scraped}`);
        continue;
      }

      updates[`sources.${i}.articleDate`] = scraped;
      totalUpdated++;
      log.push(`  [${i}] UPDATE ${src.siteName || src.url}  ${existing ?? '(none)'} → ${scraped}`);
    }

    const hasChanges = Object.keys(updates).length > 0;
    if (hasChanges) briefsChanged++;

    const prefix = hasChanges ? '●' : '○';
    console.log(`${prefix} ${brief.title}`);
    for (const line of log) console.log(line);

    if (hasChanges && !DRY_RUN) {
      await IntelligenceBrief.updateOne({ _id: brief._id }, { $set: updates });
    }

    await sleep(INTER_BRIEF_DELAY_MS);
  }

  console.log('\n── Summary ──────────────────────────────────────────');
  console.log(`Briefs scanned : ${briefs.length}`);
  console.log(`Sources scanned: ${totalSources}`);
  console.log(`Updated        : ${totalUpdated}  (across ${briefsChanged} briefs)`);
  console.log(`No date found  : ${totalFailed}`);
  if (DRY_RUN) console.log('\nDry run — no changes written. Re-run with --apply to commit.');

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
