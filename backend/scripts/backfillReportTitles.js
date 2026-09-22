/**
 * backfillReportTitles.js
 *
 * Every support ticket gets a one-line title from the model as it opens
 * (utils/reportTitle.js). Tickets that predate that carry an excerpt of their
 * opening message instead, in the Community rail and the admin queue; this
 * writes a proper title for each of them, on the report AND on its thread.
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
const ProblemReport    = require('../models/ProblemReport');
const ChatConversation = require('../models/ChatConversation');
const { generateReportTitle, excerptTitle } = require('../utils/reportTitle');

const apply = process.argv.includes('--apply');

// An open report whose title is still just the opening of its description —
// either absent, or the excerpt the migration wrote. A real generated title is
// never overwritten.
function needsTitle(report) {
  const t = String(report.title ?? '').trim();
  return !t || t === excerptTitle(report.description);
}

const OPEN_BUG_REPORTS = { solved: false, kind: { $ne: 'chat_message' } };

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const reports = (await ProblemReport.find(OPEN_BUG_REPORTS).sort({ time: -1 }).lean())
    .filter(needsTitle);
  console.log(`${reports.length} open report(s) with no generated title.`);

  let written = 0;
  for (const r of reports) {
    const opening = String(r.description).replace(/\s+/g, ' ').slice(0, 70);
    if (!apply) { console.log(`  ${r._id}  ${r.pageReported.padEnd(28)} ${opening}`); continue; }
    const title = await generateReportTitle({ description: r.description, pageReported: r.pageReported });
    if (!title) { console.log(`  ${r._id}  (no title returned)  ${opening}`); continue; }
    // The thread is what the rail and the console show; the report is what the
    // admin card shows. Both carry the title.
    await Promise.all([
      ProblemReport.updateOne({ _id: r._id }, { $set: { title } }),
      r.conversationId ? ChatConversation.updateOne({ _id: r.conversationId }, { $set: { title } }) : null,
    ]);
    written += 1;
    console.log(`  ${r._id}  "${title}"  <-  ${opening}`);
  }

  if (!apply) console.log('Dry run - nothing written, no model calls made. Pass --apply to title them.');
  else console.log(`Titled ${written} of ${reports.length}.`);

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
