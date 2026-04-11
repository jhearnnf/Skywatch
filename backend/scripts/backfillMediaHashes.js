/**
 * backfillMediaHashes.js
 *
 * One-off: walks every Cloudinary asset under brief-images/ and copies its
 * `etag` (MD5 of the stored bytes) onto the matching Media doc's
 * `contentHash` field. This lets the new upload-time dedupe logic in
 * briefImages.js and /admin/save-generated-image recognise existing media
 * for files that were uploaded before `contentHash` existed.
 *
 * Usage:
 *   node backend/scripts/backfillMediaHashes.js        # dry-run
 *   node backend/scripts/backfillMediaHashes.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose  = require('mongoose');
const cloudinary = require('cloudinary').v2;

const Media = require('../models/Media');

const APPLY  = process.argv.includes('--apply');
const PREFIX = 'brief-images';

async function listAll() {
  const assets = [];
  let nextCursor;
  do {
    const q = cloudinary.search
      .expression(`folder:${PREFIX}/* AND resource_type:image`)
      .max_results(500);
    if (nextCursor) q.next_cursor(nextCursor);
    const res = await q.execute();
    for (const r of res.resources) {
      if (r.etag) assets.push({ public_id: r.public_id, etag: r.etag });
    }
    nextCursor = res.next_cursor;
  } while (nextCursor);
  return assets;
}

async function run() {
  console.log(`\n=== backfillMediaHashes [${APPLY ? 'APPLY' : 'DRY-RUN'}] ===\n`);

  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error('CLOUDINARY_* env vars missing');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const assets = await listAll();
  console.log(`Cloudinary: ${assets.length} asset(s) with etags`);

  const etagByPublicId = new Map(assets.map(a => [a.public_id, a.etag]));

  const mediaNeedingHash = await Media.find({
    cloudinaryPublicId: { $ne: null, $exists: true },
    $or: [{ contentHash: null }, { contentHash: { $exists: false } }],
  });
  console.log(`Media docs missing contentHash: ${mediaNeedingHash.length}`);

  let matched = 0;
  let unmatched = 0;
  let conflicts = 0;
  const ops = [];

  for (const m of mediaNeedingHash) {
    const etag = etagByPublicId.get(m.cloudinaryPublicId);
    if (!etag) {
      unmatched++;
      continue;
    }
    // Avoid collisions: if another Media already owns this hash, skip so the
    // unique dedupe semantics hold. The dedupe script should have removed
    // these already — log if any survive.
    const existing = await Media.findOne({ contentHash: etag, _id: { $ne: m._id } });
    if (existing) {
      conflicts++;
      console.warn(`  ! hash ${etag} already on Media ${existing._id}; skipping ${m._id} (${m.cloudinaryPublicId})`);
      continue;
    }
    matched++;
    ops.push({ updateOne: { filter: { _id: m._id }, update: { $set: { contentHash: etag } } } });
  }

  console.log('\n--- Summary ---');
  console.log(`Matched + writable: ${matched}`);
  console.log(`No etag for publicId: ${unmatched}`);
  console.log(`Hash conflicts (skipped): ${conflicts}`);

  if (!APPLY) {
    console.log('(dry-run — nothing written)');
  } else if (ops.length) {
    const res = await Media.bulkWrite(ops);
    console.log(`bulkWrite: modified ${res.modifiedCount} doc(s)`);
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
