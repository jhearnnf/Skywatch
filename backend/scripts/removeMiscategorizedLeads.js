/**
 * One-off cleanup: remove three miscategorised auto-generated leads + stubs
 * from the DB:
 *   - "HMS Queen Elizabeth" (warship, wrongly placed under Aircrafts)
 *   - "HMS Prince of Wales" (warship, wrongly placed under Aircrafts)
 *   - "Front-Line Aviation" (umbrella term that duplicates the Fast Jet sub)
 *
 * Safe to run multiple times — deletions are idempotent.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const IntelLead             = require('../models/IntelLead');
const IntelligenceBrief     = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');

const TARGET_TITLES = ['HMS Queen Elizabeth', 'HMS Prince of Wales', 'Front-Line Aviation'];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const titleRegexes = TARGET_TITLES.map(t => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));

  const briefs = await IntelligenceBrief.find({ title: { $in: titleRegexes } }, '_id title category').lean();
  const leads  = await IntelLead.find({ title: { $in: titleRegexes } }, '_id title category').lean();

  console.log(`Found ${briefs.length} brief(s):`, briefs.map(b => `"${b.title}" [${b.category}]`));
  console.log(`Found ${leads.length} lead(s):`,  leads.map(l  => `"${l.title}" [${l.category}]`));

  if (!briefs.length && !leads.length) {
    console.log('Nothing to delete — exiting.');
    await mongoose.disconnect();
    return;
  }

  const briefIds = briefs.map(b => b._id);

  // 1. Clear linkedBriefId on any keyword across other briefs that pointed to these stubs
  if (briefIds.length) {
    const clearLinks = await IntelligenceBrief.updateMany(
      { 'keywords.linkedBriefId': { $in: briefIds } },
      { $unset: { 'keywords.$[elem].linkedBriefId': '' } },
      { arrayFilters: [{ 'elem.linkedBriefId': { $in: briefIds } }] }
    );
    console.log(`Cleared linkedBriefId on keywords in ${clearLinks.modifiedCount} other brief(s)`);
  }

  // 2. Delete read records
  if (briefIds.length) {
    const reads = await IntelligenceBriefRead.deleteMany({ intelBriefId: { $in: briefIds } });
    console.log(`Deleted ${reads.deletedCount} read record(s)`);
  }

  // 3. Delete briefs
  if (briefIds.length) {
    const delBriefs = await IntelligenceBrief.deleteMany({ _id: { $in: briefIds } });
    console.log(`Deleted ${delBriefs.deletedCount} brief(s)`);
  }

  // 4. Delete leads
  if (leads.length) {
    const delLeads = await IntelLead.deleteMany({ _id: { $in: leads.map(l => l._id) } });
    console.log(`Deleted ${delLeads.deletedCount} lead(s)`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => { console.error(err); process.exit(1); });
