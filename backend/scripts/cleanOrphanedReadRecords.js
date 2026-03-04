require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const IntelligenceBrief     = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const validIds = await IntelligenceBrief.distinct('_id');
  console.log(`Live briefs: ${validIds.length}`);

  const before = await IntelligenceBriefRead.countDocuments();
  console.log(`Read records before cleanup: ${before}`);

  const result = await IntelligenceBriefRead.deleteMany({
    intelBriefId: { $nin: validIds },
  });

  const after = await IntelligenceBriefRead.countDocuments();
  console.log(`Deleted ${result.deletedCount} orphaned record(s). Read records after: ${after}`);

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
