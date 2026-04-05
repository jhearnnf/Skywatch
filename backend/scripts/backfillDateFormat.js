/**
 * Backfill: rewrite US-style dates in descriptionSections to UK format.
 *
 * Converts patterns like:
 *   "March 3rd, 2026"   → "3rd March 2026"
 *   "January 14, 2025"  → "14 January 2025"
 *   "on March 3rd"      → "on 3rd March"
 *   "by March 3"        → "by 3 March"
 *
 * Only touches descriptionSections — does NOT modify sources, titles, subtitles,
 * or any structured date fields (dateAdded, eventDate).
 *
 * Usage:
 *   cd backend && node scripts/backfillDateFormat.js [--dry-run] [--title "partial"]
 *
 * Options:
 *   --dry-run          Print diffs without writing to DB
 *   --title "partial"  Only process briefs whose title contains this string (case-insensitive)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const DRY_RUN  = process.argv.includes('--dry-run');
const titleArg = (() => {
  const idx = process.argv.indexOf('--title');
  return idx !== -1 ? process.argv[idx + 1]?.toLowerCase() : null;
})();

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const MONTH_PATTERN = MONTHS.join('|');

const ORDINAL_SUFFIX = '(?:st|nd|rd|th)';

// Matches: "March 3rd, 2026" | "March 3, 2026" | "March 3rd" | "March 3"
// (?!\d) prevents matching the leading digits of a bare year (e.g. "June 2018" won't match).
// Capture groups: [1]=month [2]=day-digits [3]=ordinal-suffix (optional) [4]=year (optional)
const US_DATE_RE = new RegExp(
  `(${MONTH_PATTERN})\\s+(\\d{1,2})(?!\\d)(${ORDINAL_SUFFIX})?(?:,?\\s*(\\d{4}))?`,
  'g'
);

/**
 * Returns the appropriate ordinal suffix for a day number.
 */
function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Convert a single text string, replacing all US-style dates with UK format.
 */
function convertDates(text) {
  return text.replace(US_DATE_RE, (match, month, day, suffix, year) => {
    const d = parseInt(day, 10);
    const suf = suffix || ordinal(d);
    return year
      ? `${d}${suf} ${month} ${year}`
      : `${d}${suf} ${month}`;
  });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. DRY_RUN=${DRY_RUN}${titleArg ? ` FILTER="${titleArg}"` : ''}\n`);

  const query = { status: 'published' };
  if (titleArg) query.title = { $regex: titleArg, $options: 'i' };

  const briefs = await IntelligenceBrief.find(query).select('title descriptionSections');
  console.log(`Found ${briefs.length} brief(s) to scan.\n`);

  let updatedCount = 0;

  for (const brief of briefs) {
    if (!brief.descriptionSections?.length) continue;

    const originalSections = brief.descriptionSections;
    const updatedSections  = originalSections.map(convertDates);

    const changed = updatedSections.some((s, i) => s !== originalSections[i]);
    if (!changed) continue;

    updatedCount++;
    console.log(`--- ${brief.title} (${brief._id}) ---`);
    originalSections.forEach((orig, i) => {
      if (orig !== updatedSections[i]) {
        console.log(`  Section ${i + 1} BEFORE: ${orig}`);
        console.log(`  Section ${i + 1} AFTER:  ${updatedSections[i]}`);
      }
    });
    console.log();

    if (!DRY_RUN) {
      brief.descriptionSections = updatedSections;
      await brief.save();
    }
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'} ${updatedCount} brief(s).`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
