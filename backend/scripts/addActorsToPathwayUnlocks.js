/**
 * addActorsToPathwayUnlocks.js
 *
 * One-shot: ensures AppSettings.pathwayUnlocks includes an Actors entry so the
 * live Learn Priorities page shows the category. Idempotent — skips if present.
 *
 * Usage:
 *   node backend/scripts/addActorsToPathwayUnlocks.js           # dry-run
 *   node backend/scripts/addActorsToPathwayUnlocks.js --apply   # write
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const AppSettings = require('../models/AppSettings');

const APPLY = process.argv.includes('--apply');

const ACTORS_UNLOCK = {
  category:      'Actors',
  levelRequired: 5,
  rankRequired:  3,
  tierRequired:  'silver',
};

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

  const settings = await AppSettings.getSettings();
  if (!settings) {
    console.error('AppSettings singleton not found. Run the app once to seed it.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const existing = (settings.pathwayUnlocks || []).find(u => u.category === 'Actors');
  if (existing) {
    console.log('Actors already present in pathwayUnlocks — nothing to do.');
    console.log('  existing:', JSON.stringify(existing));
    await mongoose.disconnect();
    return;
  }

  console.log('Would append:', JSON.stringify(ACTORS_UNLOCK));
  if (!APPLY) {
    console.log('\nDry run — pass --apply to write.');
    await mongoose.disconnect();
    return;
  }

  settings.pathwayUnlocks = [...(settings.pathwayUnlocks || []), ACTORS_UNLOCK];
  await settings.save();
  console.log('Appended Actors to AppSettings.pathwayUnlocks.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
