/**
 * backfillMediaNames.js
 *
 * Historical Media docs sometimes have `name` set to a Cloudinary publicId
 * (e.g. "brief-images/brief-1775566...") instead of a real human-readable
 * title. Current image generation (backend/utils/briefImages.js) writes
 * `name: pageTitle || term`, so new docs are clean — this script cleans
 * legacy records.
 *
 * For each Media doc whose `name` fails isRealImageTitle():
 *   - If `wikiPageTitle` is a valid title, use it.
 *   - Else if `searchTerm` is a valid title, use it.
 *   - Else unset `name` entirely (the display layer already hides nulls).
 *
 * Usage:
 *   node backend/scripts/backfillMediaNames.js            # dry-run (default)
 *   node backend/scripts/backfillMediaNames.js --apply    # write changes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Media    = require('../models/Media');
const { isRealImageTitle } = require('../utils/mediaName');

const APPLY = process.argv.slice(2).includes('--apply');

function pickReplacement(doc) {
  const candidates = [doc.wikiPageTitle, doc.searchTerm];
  for (const c of candidates) {
    const trimmed = c?.toString().trim();
    if (trimmed && isRealImageTitle(trimmed)) return trimmed;
  }
  return null;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB — ${APPLY ? 'APPLY mode' : 'dry run'}`);

  const docs = await Media.find({ name: { $exists: true, $ne: null, $ne: '' } }).lean();
  const bad  = docs.filter(d => !isRealImageTitle(d.name));
  console.log(`Scanned ${docs.length} Media docs with a name; ${bad.length} fail isRealImageTitle`);

  let reassigned = 0;
  let cleared    = 0;

  for (const doc of bad) {
    const replacement = pickReplacement(doc);
    console.log(`  ${doc._id}: "${doc.name}" → ${replacement ? `"${replacement}"` : '(unset)'}`);

    if (APPLY) {
      if (replacement) {
        await Media.updateOne({ _id: doc._id }, { $set: { name: replacement } });
        reassigned++;
      } else {
        await Media.updateOne({ _id: doc._id }, { $unset: { name: 1 } });
        cleared++;
      }
    } else {
      if (replacement) reassigned++;
      else cleared++;
    }
  }

  console.log(`\nDone. ${reassigned} reassigned, ${cleared} cleared${APPLY ? '' : ' (dry run — no writes)'}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
