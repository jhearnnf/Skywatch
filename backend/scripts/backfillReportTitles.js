/**
 * backfillReportTitles.js
 *
 * Every problem report gets a one-line title from the model just after it is
 * filed (utils/reportTitle.js, 2026-09-22). Reports filed before that have
 * none and show an excerpt of their description instead, in the Community
 * rail and the admin queue. This writes a title for each of them.
 *
 * Only OPEN bug reports with no title are touched: a resolved report is out
 * of every rail already, and a reported chat message is not a ticket. A title
 * that exists is never overwritten. Safe to run again.
 *
 * Costs one small model call per report, so it is dry-run by default and
 * prints what it would title. Pass --apply to call the model and write.
 *
 * Usage:
 *   node backend/scripts/backfillReportTitles.js
 *   node backend/scripts/backfillReportTitles.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const ProblemReport = require('../models/ProblemReport');
const { generateReportTitle } = require('../utils/reportTitle');

const apply = process.argv.includes('--apply');

const UNTITLED = {
  solved: false,
  kind: { $ne: 'chat_message' },
  $or: [{ title: { $exists: false } }, { title: null }, { title: '' }],
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const reports = await ProblemReport.find(UNTITLED).sort({ time: -1 }).lean();
  console.log(`${reports.length} open report(s) with no title.`);

  let written = 0;
  for (const r of reports) {
    const opening = String(r.description).replace(/\s+/g, ' ').slice(0, 70);
    if (!apply) { console.log(`  ${r._id}  ${r.pageReported.padEnd(28)} ${opening}`); continue; }
    const title = await generateReportTitle({ description: r.description, pageReported: r.pageReported });
    if (!title) { console.log(`  ${r._id}  (no title returned)  ${opening}`); continue; }
    await ProblemReport.updateOne({ _id: r._id }, { $set: { title } });
    written += 1;
    console.log(`  ${r._id}  "${title}"  <-  ${opening}`);
  }

  if (!apply) console.log('Dry run - nothing written, no model calls made. Pass --apply to title them.');
  else console.log(`Titled ${written} of ${reports.length}.`);

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
