/**
 * addGazaHamasLeads.js
 *
 * Additive, idempotent script: inserts "Gaza Strip" (AOR) and "Hamas" (Threats)
 * as IntelLead + stub IntelligenceBrief pairs in the live DB. Skips any lead
 * that already exists by title. Does NOT wipe or touch any other data.
 *
 * Usage:
 *   node backend/scripts/addGazaHamasLeads.js           # dry-run (preview only)
 *   node backend/scripts/addGazaHamasLeads.js --apply   # write to DB
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const IntelLead = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const APPLY = process.argv.includes('--apply');

const ENTRIES = [
  {
    title: 'Gaza Strip',
    nickname: '',
    subtitle: 'Contested airspace and humanitarian corridor affecting UK basing at RAF Akrotiri and regional ISR tasking',
    category: 'AOR',
    subcategory: 'Middle East & CENTCOM',
    section: 'AOR',
    subsection: 'Middle East & CENTCOM',
    priorityNumber: 8,
  },
  {
    title: 'Hamas',
    nickname: '',
    subtitle: 'Palestinian militant group in Gaza employing rockets, drones and tunnels — context for Levant airspace and regional threat picture',
    category: 'Threats',
    subcategory: 'Asymmetric & Non-State',
    section: 'THREATS',
    subsection: 'Asymmetric & Non-State',
    priorityNumber: 12,
  },
];

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

  for (const entry of ENTRIES) {
    const existingLead  = await IntelLead.findOne({ title: entry.title }, '_id title').lean();
    const existingBrief = await IntelligenceBrief.findOne({ title: entry.title }, '_id title status').lean();

    if (existingLead && existingBrief) {
      console.log(`  SKIP   "${entry.title}" — lead + brief already present`);
      continue;
    }

    if (!APPLY) {
      console.log(`  WOULD CREATE  "${entry.title}" [${entry.category} / ${entry.subcategory}] priority=${entry.priorityNumber}`);
      if (existingLead)  console.log(`                (lead exists, would create missing stub brief)`);
      if (existingBrief) console.log(`                (brief exists, would create missing lead)`);
      continue;
    }

    if (!existingLead) {
      await IntelLead.create({
        title:          entry.title,
        nickname:       entry.nickname,
        subtitle:       entry.subtitle,
        category:       entry.category,
        subcategory:    entry.subcategory,
        section:        entry.section,
        subsection:     entry.subsection,
        isPublished:    false,
        isHistoric:     false,
        priorityNumber: entry.priorityNumber,
      });
      console.log(`  CREATE lead   "${entry.title}"`);
    }

    if (!existingBrief) {
      await IntelligenceBrief.create({
        title:               entry.title,
        subtitle:            entry.subtitle,
        category:            entry.category,
        subcategory:         entry.subcategory,
        status:              'stub',
        historic:            false,
        priorityNumber:      entry.priorityNumber,
        descriptionSections: [],
        keywords:            [],
        sources:             [],
      });
      console.log(`  CREATE stub   "${entry.title}"`);
    }
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
